import { NextRequest, NextResponse, after } from 'next/server';
import { createHash } from 'node:crypto';
import { supabaseServer as supabase } from '@/lib/supabaseServer';
import { approveChatJoinRequest } from '@/lib/telegram';
import { appendLeadEventSafe, markAdultVerificationSafe } from '@/lib/brain/eventStore';
import { triggerProcessMessageWithRetry } from '@/lib/processMessageRetry';
import { probeAiRouterHealth } from '@/lib/gemini';
import {
    hasTrustedAdultVerification,
    isPresellAdultVerificationGuaranteed,
    isTrustedAdultVerificationSource,
    PRESELL_ADULT_VERIFICATION_SOURCE,
    withPresellAdultVerification,
} from '@/lib/adultVerification';

// O callback de `after()` aguarda o worker terminar (e, em disputa de sessão,
// pode precisar de uma segunda tentativa). Sem esta janela o deploy pode
// encerrar o webhook antes de o turno durável ser concluído.
export const maxDuration = 300;

const deterministicTelegramMessageUuid = (chatId: string, messageId: unknown) => {
    const hex = createHash('sha256')
        .update(`telegram:${chatId}:${String(messageId)}`)
        .digest('hex')
        .slice(0, 32)
        .split('');
    hex[12] = '5';
    hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
    const value = hex.join('');
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};

const parseStartPayload = (text: string | undefined) => {
    const match = (text || '').trim().match(/^\/?start(?:\s+(.+))?$/i);
    return match?.[1]?.trim() || '';
};

const detectDeviceType = (userAgent: string | null | undefined) => {
    const ua = String(userAgent || '').toLowerCase();
    if (/iphone|ipad|ios/.test(ua)) return 'iPhone';
    if (/android/.test(ua)) return 'Android';
    if (/windows|macintosh|linux/.test(ua)) return 'Desktop';
    return 'Unknown';
};

const normalizeLeadMemory = (input: any) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    return input;
};

const mergeList = (a: any, b: string[]) => {
    const base = Array.isArray(a) ? a.map((v: any) => String(v || '').trim()).filter(Boolean) : [];
    return Array.from(new Set([...base, ...b].map(v => v.toLowerCase()))).slice(0, 12);
};

export async function GET(req: NextRequest) {
    // DIAGNOSTIC ROUTE
    const checks = {
        supabaseConfig: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        geminiConfig: !!process.env.GEMINI_API_KEY,
        dbConnection: false,
        tokenFound: false,
        webhookUrl: req.nextUrl.toString().replace('GET', 'POST') // Approximate
    };

    try {
        const { data, error } = await supabase.from('bot_settings').select('*').limit(1);
        if (!error) checks.dbConnection = true;

        const { data: token } = await supabase.from('bot_settings').select('value').eq('key', 'telegram_bot_token').single();
        const [{ data: aiSettings }, { data: recentAiEvents, error: aiEventsError }] = await Promise.all([
            supabase.from('bot_settings').select('key,value').in('key', [
                'bai_api_key', 'gemini_api_key', 'nvidia_api_key', 'ai_model_order',
            ]),
            supabase.from('ai_gateway_usage_events')
                .select('occurred_at,provider,model,status,http_status,error_kind,cooldown_until')
                .order('occurred_at', { ascending: false })
                .limit(8),
        ]);
        const aiMap = Object.fromEntries((aiSettings || []).map((row: any) => [row.key, row.value || '']));
        const routerDiagnostic = {
            order: String(aiMap.ai_model_order || process.env.AI_MODEL_ORDER || 'bai,gemini,nvidia'),
            configured: {
                bai: Boolean(String(aiMap.bai_api_key || process.env.BAI_API_KEY || '').trim()),
                gemini: Boolean(String(aiMap.gemini_api_key || process.env.GEMINI_API_KEY || '').trim()),
                nvidia: Boolean(String(aiMap.nvidia_api_key || process.env.NVIDIA_API_KEY || '').trim()),
            },
            telemetryReady: !aiEventsError,
            recent: (recentAiEvents || []).map((event: any) => ({
                at: event.occurred_at,
                provider: event.provider,
                model: event.model,
                status: event.status,
                httpStatus: event.http_status,
                errorKind: event.error_kind,
                cooldownUntil: event.cooldown_until,
            })),
        };
        let webhookInfo = null;

        if (token && token.value) {
            checks.tokenFound = true;
            // CHECK TELEGRAM API STATUS
            try {
                const tgRes = await fetch(`https://api.telegram.org/bot${token.value}/getWebhookInfo`);
                webhookInfo = await tgRes.json();
            } catch (err: any) {
                webhookInfo = { error: err.message };
            }
        }

        let activeProbe: Record<string, unknown> | null = null;
        const requestedProbe = req.nextUrl.searchParams.get('probe');
        if (requestedProbe && requestedProbe === process.env.VERCEL_GIT_COMMIT_SHA) {
            try {
                activeProbe = { ok: true, ...await probeAiRouterHealth() };
            } catch (error: any) {
                activeProbe = { ok: false, error: String(error?.message || error).slice(0, 1600) };
            }
        }

        return NextResponse.json({ status: 'Online', checks, webhookInfo, routerDiagnostic, activeProbe }, { status: 200 });
    } catch (e: any) {
        return NextResponse.json({ status: 'Error', error: e.message, checks }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const body = await req.json();

    // 0. Process Chat Join Request (Aprovacao automatica de leads no canal / grupo)
    if (body.chat_join_request) {
        try {
            const joinReq = body.chat_join_request;
            const channelId = joinReq.chat.id;
            const userId = joinReq.from.id;
            const userName = [joinReq.from.first_name, joinReq.from.last_name].filter(Boolean).join(' ') || 'Novo Lead';
            const userChatId = (joinReq.user_chat_id || userId).toString();

            console.log(`[CHAT_JOIN_REQUEST] Recebida solicitacao de entrada de ${userName} (${userId}) no chat ${joinReq.chat.title} (${channelId})`);

            const { data: tokenData } = await supabase
                .from('bot_settings')
                .select('value')
                .eq('key', 'telegram_bot_token')
                .single();

            const botToken = tokenData?.value;
            if (botToken) {
                const approved = await approveChatJoinRequest(botToken, channelId, userId);
                console.log(`[CHAT_JOIN_REQUEST] Resultado aprovacao para ${userName}: ${approved}`);

                let { data: session } = await supabase
                    .from('sessions')
                    .select('*')
                    .eq('telegram_chat_id', userChatId)
                    .single();

                if (!session) {
                    await supabase
                        .from('sessions')
                        .insert([{
                            telegram_chat_id: userChatId,
                            user_name: userName,
                            device_type: 'Unknown',
                            status: 'active',
                            lead_memory: {
                                notes: [`Entrou pelo canal ${joinReq.chat.title || channelId}`],
                                metadata: {
                                    channel_id: channelId,
                                    channel_title: joinReq.chat.title || '',
                                    invite_link: joinReq.invite_link?.invite_link || '',
                                    joined_at: new Date().toISOString()
                                }
                            }
                        }]);
                }
            }
        } catch (joinErr) {
            console.error('[CHAT_JOIN_REQUEST] Erro ao aprovar lead:', joinErr);
        }
        return NextResponse.json({ ok: true });
    }

    const message = body.message || body.edited_message;

    if (!message) {
        return NextResponse.json({ ok: true });
    }

    const chatId = message.chat.id.toString();

    // Extract Text OR Video File ID
    let text = message.text;
    let mediaType: 'image' | 'video' | null = null;

    // 0. Detect Audio/Voice
    if (message.voice) {
        text = `[AUDIO_UUID: ${message.voice.file_id}]`;
    } else if (message.audio) {
        text = `[AUDIO_UUID: ${message.audio.file_id}]`;
    }

    if (message.video) {
        const caption = message.caption ? ` CAPTION: ${message.caption}` : '';
        text = `[VIDEO_UPLOAD] File_ID: ${message.video.file_id}${caption}`;
        mediaType = 'video';
    }

    if (message.photo && message.photo.length > 0) {
        // Telegram envia várias resoluções. A última é a maior.
        const largestPhoto = message.photo[message.photo.length - 1];
        const caption = message.caption ? ` CAPTION: ${message.caption}` : '';
        text = `[PHOTO_UPLOAD] File_ID: ${largestPhoto.file_id}${caption}`;
        mediaType = 'image';
    }

    if (!text) {
        return NextResponse.json({ ok: true });
    }
    let senderName = message.from.first_name || "Desconhecido";
    const startPayload = parseStartPayload(text);
    const leadRedirectCode = startPayload && startPayload.startsWith('l_') ? startPayload : '';
    const presellAdultVerified = isPresellAdultVerificationGuaranteed();

    // CHECK FOR OP KAIQUE
    if (text && (
        text.trim().toLowerCase().startsWith('/start opkaique') ||
        text.trim().toLowerCase().startsWith('start opkaique')
    )) {
        senderName = `${senderName} (operação kaique)`;
    }

    // 0. Detect Audio/Voice



    try {
        // 0. Fetch Bot Token
        const { data: tokenData } = await supabase
            .from('bot_settings')
            .select('value')
            .eq('key', 'telegram_bot_token')
            .single();

        const botToken = tokenData?.value;
        if (!botToken) {
            console.error("Bot Token not configured in DB");
            return NextResponse.json({ error: 'telegram_token_unavailable' }, { status: 500 });
        }

        // 2. Get or Create Session
        let { data: session, error } = await supabase
            .from('sessions')
            .select('*')
            .eq('telegram_chat_id', chatId)
            .single();

        if (error || !session) {
            console.log("Creating new session for", chatId);
            const { data: newSession, error: createError } = await supabase
                .from('sessions')
                .insert([{
                    telegram_chat_id: chatId,
                    user_city: null,
                    device_type: "Unknown",
                    user_name: senderName,
                    status: 'active',
                    lead_memory: {
                        // O funil confirma 18+ antes de abrir o bot. A origem fica
                        // explícita para o worker não pedir a mesma confirmação.
                        metadata: presellAdultVerified
                            ? withPresellAdultVerification({}, new Date().toISOString())
                            : { adult_verified: false, adult_verification_source: 'unverified' },
                        updated_at: new Date().toISOString(),
                    },
                }])
                .select()
                .single();

            if (createError) {
                console.error("Failed to create session", createError);
                return NextResponse.json({ error: 'DB Error' }, { status: 500 });
            }
            session = newSession;
        }

        // Preserva o perfil que o próprio Telegram entrega. Esses campos ajudam
        // continuidade e idioma, mas continuam dados citados: não autorizam
        // inferir identidade, idade, localização ou poder de compra.
        const telegramMemory = normalizeLeadMemory(session.lead_memory);
        const telegramProfilePatch = Object.fromEntries(Object.entries({
            telegram_user_id: message.from?.id ? String(message.from.id) : '',
            telegram_username: message.from?.username ? String(message.from.username) : '',
            telegram_first_name: message.from?.first_name ? String(message.from.first_name) : '',
            telegram_last_name: message.from?.last_name ? String(message.from.last_name) : '',
            telegram_language_code: message.from?.language_code ? String(message.from.language_code) : '',
            telegram_chat_type: message.chat?.type ? String(message.chat.type) : '',
        }).filter(([, value]) => value));
        const telegramProfileChanged = Object.entries(telegramProfilePatch)
            .some(([key, value]) => telegramMemory.metadata?.[key] !== value);
        if (telegramProfileChanged) {
            const leadMemoryWithTelegramProfile = {
                ...telegramMemory,
                metadata: {
                    ...(telegramMemory.metadata || {}),
                    ...telegramProfilePatch,
                },
                updated_at: new Date().toISOString(),
            };
            const { error: telegramProfileError } = await supabase
                .from('sessions')
                .update({ lead_memory: leadMemoryWithTelegramProfile })
                .eq('id', session.id);
            if (!telegramProfileError) session = { ...session, lead_memory: leadMemoryWithTelegramProfile };
        }

        // Também cura sessões criadas antes deste contrato. O switch de ambiente
        // permite reativar a confirmação no chat se o funil de entrada mudar.
        if (presellAdultVerified) {
            const currentMemory = normalizeLeadMemory(session.lead_memory);
            const alreadyTrusted = hasTrustedAdultVerification(currentMemory.metadata);
            if (!alreadyTrusted) {
                const adultVerifiedAt = new Date().toISOString();
                const updatedMemory = {
                    ...currentMemory,
                    metadata: withPresellAdultVerification(currentMemory.metadata, adultVerifiedAt),
                    updated_at: adultVerifiedAt,
                };
                const { error: verificationPatchError } = await supabase
                    .from('sessions')
                    .update({ lead_memory: updatedMemory })
                    .eq('id', session.id);
                if (!verificationPatchError) {
                    session = { ...session, lead_memory: updatedMemory };
                    await Promise.all([
                        markAdultVerificationSafe(String(session.id), adultVerifiedAt),
                        appendLeadEventSafe({
                            sessionId: String(session.id),
                            eventType: 'adult_verified',
                            source: 'presell',
                            sourceId: `presell-contract:${session.id}`,
                            payload: { method: PRESELL_ADULT_VERIFICATION_SOURCE },
                            occurredAt: adultVerifiedAt,
                        }),
                    ]);
                }
            }
        }

        if (leadRedirectCode) {
            const { data: redirectRow } = await supabase
                .from('lead_redirects')
                .select('*')
                .eq('code', leadRedirectCode)
                .single();

            if (redirectRow) {
                const city = redirectRow.city ? String(redirectRow.city) : null;
                const deviceType = detectDeviceType(redirectRow.user_agent);
                const redirectAdultConfirmed = redirectRow.metadata?.adult_confirmed === true;
                const currentMemory = normalizeLeadMemory(session.lead_memory);
                const priorAdultSource = String(currentMemory.metadata?.adult_verification_source || '');
                const priorTrustedAdultVerification = currentMemory.metadata?.adult_verified === true
                    && isTrustedAdultVerificationSource(priorAdultSource);
                const redirectCoveredByPresellContract = presellAdultVerified && Boolean(redirectRow);
                const adultVerified = redirectAdultConfirmed || redirectCoveredByPresellContract || priorTrustedAdultVerification;
                const sourceBits = [
                    redirectRow.utm?.utm_source ? `origem ${redirectRow.utm.utm_source}` : '',
                    redirectRow.utm?.utm_campaign ? `campanha ${redirectRow.utm.utm_campaign}` : '',
                    city ? `cidade captada ${city}` : '',
                    redirectRow.country ? `pais ${redirectRow.country}` : ''
                ].filter(Boolean);

                const updatedMemory = {
                    ...currentMemory,
                    notes: mergeList(currentMemory.notes, [
                        'entrou pelo redirecionador',
                        ...sourceBits
                    ]),
                    metadata: {
                        ...(currentMemory.metadata || {}),
                        redirect_code: leadRedirectCode,
                        redirect_ip: redirectRow.ip || '',
                        redirect_utm: redirectRow.utm || {},
                        redirect_query_params: redirectRow.metadata?.query_params || redirectRow.utm || {},
                        redirect_source_url: redirectRow.source_url || '',
                        redirect_referer: redirectRow.referer || '',
                        redirect_clicked_at: redirectRow.clicked_at || redirectRow.created_at || '',
                        redirect_city: city || '',
                        redirect_region: redirectRow.region || '',
                        redirect_country: redirectRow.country || '',
                        redirect_timezone: redirectRow.timezone || '',
                        redirect_accept_language: redirectRow.metadata?.accept_language || '',
                        redirect_user_agent: redirectRow.user_agent || '',
                        adult_verified: adultVerified,
                        adult_verification_source: redirectAdultConfirmed
                            ? 'presell_explicit_confirmation'
                            : redirectCoveredByPresellContract ? PRESELL_ADULT_VERIFICATION_SOURCE
                            : priorTrustedAdultVerification ? priorAdultSource : 'unverified',
                        ...(redirectAdultConfirmed || redirectCoveredByPresellContract ? {
                            adult_verified_at: redirectRow.clicked_at || redirectRow.created_at || new Date().toISOString(),
                        } : priorTrustedAdultVerification && currentMemory.metadata?.adult_verified_at ? {
                            adult_verified_at: currentMemory.metadata.adult_verified_at,
                        } : {}),
                    },
                    updated_at: new Date().toISOString()
                };

                const sessionPatch: any = {
                    lead_memory: updatedMemory
                };
                if (city && !session.user_city) sessionPatch.user_city = city;
                if (deviceType !== 'Unknown' && (!session.device_type || session.device_type === 'Unknown')) {
                    sessionPatch.device_type = deviceType;
                }

                const { error: sessionPatchError } = await supabase
                    .from('sessions')
                    .update(sessionPatch)
                    .eq('id', session.id);
                if (!sessionPatchError) {
                    session = { ...session, ...sessionPatch };
                }

                if (redirectAdultConfirmed || redirectCoveredByPresellContract) {
                    const adultVerifiedAt = redirectRow.clicked_at || redirectRow.created_at || new Date().toISOString();
                    await Promise.all([
                        markAdultVerificationSafe(String(session.id), adultVerifiedAt),
                        appendLeadEventSafe({
                            sessionId: String(session.id),
                            eventType: 'adult_verified',
                            source: 'presell',
                            sourceId: `presell:${leadRedirectCode}`,
                            payload: {
                                method: redirectAdultConfirmed
                                    ? 'presell_explicit_confirmation'
                                    : PRESELL_ADULT_VERIFICATION_SOURCE,
                                redirect_code: leadRedirectCode,
                            },
                            occurredAt: adultVerifiedAt,
                        }),
                    ]);
                }

                await supabase
                    .from('lead_redirects')
                    .update({
                        claimed_at: new Date().toISOString(),
                        telegram_chat_id: chatId,
                        session_id: session.id
                    })
                    .eq('id', redirectRow.id);
            }
        }

        if (startPayload && !leadRedirectCode) {
            const currentMemory = normalizeLeadMemory(session.lead_memory);
            const updatedMemory = {
                ...currentMemory,
                notes: mergeList(currentMemory.notes, [`origem payload ${startPayload}`]),
                metadata: {
                    ...(currentMemory.metadata || {}),
                    start_payload: startPayload
                },
                updated_at: new Date().toISOString()
            };
            const { error: memErr } = await supabase
                .from('sessions')
                .update({ lead_memory: updatedMemory })
                .eq('id', session.id);
            if (!memErr) {
                session.lead_memory = updatedMemory;
            }
        }

        // 3.5. Reset Reengagement Flag & Update Timestamp
        // Quando o usuário fala, o bot não precisa mais cobrar.
        // ATUALIZAMOS 'last_bot_activity_at' para AGORA para impedir que o cron dispare
        // enquanto a IA ainda está pensando (o que causava o bug de duplicidade).
        const nowIso = new Date().toISOString();
        await supabase.from('sessions').update({
            reengagement_sent: false,
            last_bot_activity_at: nowIso,
            last_message_at: nowIso
        }).eq('id', session.id);

        // ATUALIZAÇÃO PARA OPERAÇÃO KAIQUE (Mesmo se usuário já existir)
        if (text && (
            text.trim().toLowerCase().startsWith('/start opkaique') ||
            text.trim().toLowerCase().startsWith('start opkaique')
        )) {
            if (!session.user_name?.toLowerCase().includes('(operação kaique)')) {
                const newName = `${session.user_name} (operação kaique)`;
                await supabase.from('sessions').update({ user_name: newName }).eq('id', session.id);
                session.user_name = newName;
            }
        }

        // 3. Save User Message - qualquer comando de start sempre é salvo apenas como '/start'
        const isStartCommand = /^\/?start(?:\s+.*)?$/i.test(text.trim());
        const savedContent = isStartCommand ? '/start' : text;

        const telegramMessageUuid = message.message_id === undefined || message.message_id === null
            ? null
            : deterministicTelegramMessageUuid(chatId, message.message_id);
        const messageRow = {
            ...(telegramMessageUuid ? { id: telegramMessageUuid } : {}),
            session_id: session.id,
            sender: 'user',
            content: savedContent,
            media_type: mediaType
        };
        const persistedMessage = telegramMessageUuid
            ? await supabase.from('messages').upsert(messageRow, {
                onConflict: 'id',
                ignoreDuplicates: true,
            }).select().maybeSingle()
            : await supabase.from('messages').insert(messageRow).select().single();
        let insertedMsg = persistedMessage.data;
        let messageInsertError = persistedMessage.error;

        // Em reentrega do mesmo update, o UUID determinístico já existe. Reusa
        // a mesma mensagem para que uma nova tentativa nunca duplique o turno.
        if (!messageInsertError && !insertedMsg && telegramMessageUuid) {
            const existingMessage = await supabase.from('messages')
                .select('id')
                .eq('id', telegramMessageUuid)
                .maybeSingle();
            insertedMsg = existingMessage.data;
            messageInsertError = existingMessage.error;
        }

        // Nunca confirme o update ao Telegram se a mensagem não entrou na fila
        // durável. Um HTTP 500 faz o próprio Telegram reenviar o mesmo update.
        if (messageInsertError || !insertedMsg) {
            console.error('[WEBHOOK] Falha ao persistir mensagem do lead:', messageInsertError?.message || 'insert sem linha');
            return NextResponse.json({ error: 'message_persistence_failed' }, { status: 500 });
        }

        if (session.status && session.status !== 'active') {
            return NextResponse.json({ ok: true, status: 'paused' });
        }

        // 4. Trigger Background Processing (Reliable with `after`)
        const protocol = req.headers.get('x-forwarded-proto') || 'http';
        const host = req.headers.get('host');
        const workerUrl = `${protocol}://${host}/api/process-message`;

        console.log(`[WEBHOOK] Scheduling worker at ${workerUrl}`);

        after(async () => {
            console.log(`[WEBHOOK] Executing background worker trigger...`);
            await triggerProcessMessageWithRetry({
                workerUrl,
                sessionId: String(session.id),
                triggerMessageId: String(insertedMsg.id),
            });
        });

        return NextResponse.json({ ok: true });

    } catch (error) {
        console.error("Webhook Error:", error);
        return NextResponse.json({ error: 'Error processing update' }, { status: 500 });
    }
}
