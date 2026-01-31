import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';
import { sendMessageToGemini } from '@/lib/gemini';
import { sendTelegramMessage, sendTelegramPhoto, sendTelegramVideo, sendTelegramAction, sendTelegramCopyableCode } from '@/lib/telegram';
import { WiinPayService } from '@/lib/wiinpayService';

// Esta rota atua como um worker em segundo plano.
// Ela aguarda, verifica mensagens mais recentes (debounce), e então processa a resposta.
// É chamada pelo Webhook principal mas NÃO DEVE atrasar a resposta do webhook.

const normalizeCityKey = (input: string) => {
    return (input || '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .trim();
};

const detectCityFromText = (input: string): string | null => {
    const match = input.match(/\b(?:sou|moro)\s+(?:de|do|da|em)\s+([\p{L}\s]{2,40})/iu);
    if (!match) return null;
    let city = match[1].trim();
    city = city.replace(/[\n\r\.\!\?].*$/, '').trim();

    const parts = city.split(/\s+/).slice(0, 3);
    return parts.join(' ');
};

const getNeighborCity = (city: string | null) => {
    if (!city) return 'uma cidade vizinha';
    const c = normalizeCityKey(city);
    if (c.includes('rio') || c === 'rj') return 'niteroi';
    if (c.includes('sao paulo') || c === 'sp' || c.includes('sampa')) return 'suzano';
    if (c.includes('campinas')) return 'hortolandia';
    if (c.includes('santos')) return 'sao vicente';
    if (c.includes('guarulhos')) return 'aruja';
    if (c.includes('curitiba')) return 'sao jose dos pinhais';
    if (c.includes('belo horizonte') || c === 'bh') return 'contagem';
    if (c.includes('fortaleza')) return 'eusebio';
    if (c.includes('salvador')) return 'lauro de freitas';
    return 'uma cidade vizinha';
};

const clampStat = (n: number) => Math.max(0, Math.min(100, Number(n) || 0));

const normalizeStats = (stats: any, base = { tarado: 5, financeiro: 10, carente: 20, sentimental: 20 }) => {
    const s = stats || base;
    return {
        tarado: clampStat((s as any).tarado ?? base.tarado),
        financeiro: clampStat((s as any).financeiro ?? base.financeiro),
        carente: clampStat((s as any).carente ?? base.carente),
        sentimental: clampStat((s as any).sentimental ?? base.sentimental)
    };
};

const isAllZero = (stats: any) => {
    if (!stats) return true;
    return (Number(stats.tarado) || 0) === 0 &&
        (Number(stats.financeiro) || 0) === 0 &&
        (Number(stats.carente) || 0) === 0 &&
        (Number(stats.sentimental) || 0) === 0;
};

const applyHeuristicStats = (text: string, current: any) => {
    const base = { tarado: 5, financeiro: 10, carente: 20, sentimental: 20 };
    const s = normalizeStats(current, base);
    const t = (text || '').toLowerCase();

    const inc = (key: keyof typeof s, val: number) => {
        s[key] = clampStat(s[key] + val);
    };

    if (/(manda.*foto|quero ver|deixa eu ver|cad[e?]|nudes?|foto|vídeo|video|pelada|sem roupa|manda mais)/i.test(t)) inc('tarado', 20);
    if (/(gostosa|delicia|tes[a?]o|safada|linda|d[ei]l?icia)/i.test(t)) inc('tarado', 10);
    if (/(quero transar|chupar|comer|foder|gozar|pau|buceta|porra|me come|te comer)/i.test(t)) inc('tarado', 30);

    if (/(quanto custa|pix|vou comprar|passa o pix|quanto e|pre[cç]o|valor|mensal|vital[ií]cio)/i.test(t)) inc('financeiro', 20);
    if (/(tenho dinheiro|sou rico|ferrari|viajei|carro|viagem)/i.test(t)) inc('financeiro', 20);
    if (/(ta caro|caro|sem dinheiro|liso|desempregado)/i.test(t)) inc('financeiro', -20);

    if (/(bom dia amor|boa noite vida|sonhei com vc|to sozinho|ningu[e?]m me quer|queria uma namorada|carente|me chama|sdds|saudade)/i.test(t)) inc('carente', 15);
    if (t.trim().split(/\s+/).length <= 2) inc('carente', -10);

    if (/(saudade|solid[a?]o|sentindo falta|carinho|afeto)/i.test(t)) inc('sentimental', 15);

    return s;
};

const GLUE_DICT = new Set([
    'amor', 'vida', 'casa', 'banho', 'foto', 'video', 'hoje', 'agora', 'aqui', 'sozinha', 'cansada', 'cansado',
    'deitada', 'molhada', 'pelada', 'safada', 'gostosa', 'quente', 'fria', 'carente', 'tesao', 'tesão',
    'buceta', 'pau', 'gozar', 'porra', 'queria', 'querendo', 'saudade'
]);

const fixGluedWords = (text: string) => {
    return (text || '').split(/(\s+)/).map((part) => {
        if (!part || /^\s+$/.test(part)) return part;
        if (!/^[\p{L}]+$/u.test(part)) return part;
        const lower = part.toLowerCase();
        if (lower.length < 8 || lower.length > 22) return part;
        for (let i = 3; i <= lower.length - 3; i++) {
            const left = lower.slice(0, i);
            const right = lower.slice(i);
            if (GLUE_DICT.has(left) && GLUE_DICT.has(right)) {
                return `${left} ${right}`;
            }
        }
        return part;
    }).join('');
};

const sanitizeOutgoingMessage = (text: string) => {
    let out = (text || '').trim();
    out = out.replace(/\ba\s+lari\b/gi, 'eu');
    out = out.replace(/\ba\s+larissa\b/gi, 'eu');
    out = out.replace(/\s+/g, ' ');
    out = fixGluedWords(out);
    return out;
};

const extractPrices = (text: string) => {
    if (!text) return [];
    const matches = text.match(/\b\d{1,3}[.,]\d{2}\b/g) || [];
    return matches.map(m => Number(m.replace(',', '.'))).filter(n => !Number.isNaN(n));
};

const inferPixValue = (texts: string[]) => {
    for (let i = texts.length - 1; i >= 0; i--) {
        const prices = extractPrices(texts[i]);
        if (prices.length > 0) return prices[prices.length - 1];
    }
    return null;
};

const FUNNEL_STEPS = [
    "WELCOME",
    "CONNECTION",
    "TRIGGER_PHASE",
    "HOT_TALK",
    "PREVIEW",
    "SALES_PITCH",
    "NEGOTIATION",
    "CLOSING",
    "PAYMENT_CHECK",
    "PAYMENT_CONFIRMED"
];

const stageIndex = (stage?: string | null) => {
    if (!stage) return -1;
    return FUNNEL_STEPS.indexOf(stage.toUpperCase());
};

const ACTION_STAGE_MAP: Record<string, string> = {
    send_shower_photo: 'TRIGGER_PHASE',
    send_lingerie_photo: 'TRIGGER_PHASE',
    send_wet_finger_photo: 'TRIGGER_PHASE',
    send_ass_photo_preview: 'PREVIEW',
    send_video_preview: 'PREVIEW',
    send_hot_video_preview: 'PREVIEW',
    generate_pix_payment: 'PAYMENT_CHECK',
    check_payment_status: 'PAYMENT_CHECK'
};

const inferStageFromText = (text: string) => {
    const t = (text || '').toLowerCase();
    if (/(pix|paguei|comprovante)/i.test(t)) return 'PAYMENT_CHECK';
    if (/(r\$|\b\d{1,3}[.,]\d{2}\b|pre[cç]o|valor|quanto custa|quanto e)/i.test(t)) return 'NEGOTIATION';
    if (/(vip|acesso|mensal|vital[ií]cio)/i.test(t)) return 'SALES_PITCH';
    if (/(prévia|previa|video|vídeo|foto|pelada|sem roupa)/i.test(t)) return 'PREVIEW';
    return null;
};

const randNormal = (): number => {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
};

const sampleGamma = (alpha: number): number => {
    if (alpha < 1) {
        const u = Math.random();
        return sampleGamma(1 + alpha) * Math.pow(u, 1 / alpha);
    }
    const d = alpha - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
        let x = randNormal();
        let v = 1 + c * x;
        if (v <= 0) continue;
        v = v * v * v;
        const u = Math.random();
        if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
        if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
};

const sampleBeta = (alpha: number, beta: number): number => {
    const x = sampleGamma(alpha);
    const y = sampleGamma(beta);
    return x / (x + y);
};

const pickPromptVariant = async (stage: string) => {
    const { data, error } = await supabase
        .from('prompt_variants')
        .select('id, stage, label, content, successes, failures, weight, enabled')
        .eq('enabled', true)
        .eq('stage', stage)
        .limit(50);

    if (error || !data || data.length === 0) return null;

    let best = null as any;
    let bestScore = -1;
    for (const variant of data) {
        const successes = Number(variant.successes || 0);
        const failures = Number(variant.failures || 0);
        const weight = Number(variant.weight || 1);
        const score = sampleBeta(successes + 1, failures + 1) * weight;
        if (score > bestScore) {
            bestScore = score;
            best = variant;
        }
    }
    return best;
};
const normalizeLoopText = (text: string) => {
    return (text || '')
        .toLowerCase()
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .trim();
};

const detectRepetition = (messages: { content: string }[]) => {
    const last = messages[messages.length - 1]?.content || '';
    const normLast = normalizeLoopText(last);
    if (!normLast) return { repeats: 0, last: last };
    let repeats = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
        const norm = normalizeLoopText(messages[i].content);
        if (norm === normLast) repeats++;
        else break;
    }
    return { repeats, last };
};

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { sessionId, triggerMessageId, force } = body;

    console.log(`[PROCESSADOR] Iniciado para sessão ${sessionId}`);

    // Buscar Dados da Sessão e Token CEDO para ativar indicador de digitando
    const { data: session } = await supabase.from('sessions').select('*').eq('id', sessionId).single();
    if (!session) return NextResponse.json({ error: 'Sessão não encontrada' });

    if (!force && session.status && session.status !== 'active') {
        return NextResponse.json({ status: 'paused' });
    }

    const { data: tokenData } = await supabase
        .from('bot_settings')
        .select('value')
        .eq('key', 'telegram_bot_token')
        .single();

    const botToken = tokenData?.value;
    if (!botToken) return NextResponse.json({ error: 'Sem token' });
    const chatId = session.telegram_chat_id;

    // CONFIG: Tempo Total de Espera 6000ms (Debounce para Agrupamento)
    // Estratégia: Esperar 2s -> Enviar Digitando -> Esperar 4s -> Processar
    // Isso garante que se o lead mandar várias mensagens seguidas, a gente agrupe.

    // 1. Primeira Espera (2s)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 2. Enviar Ação Digitando
    await sendTelegramAction(botToken, chatId, 'typing');

    // 3. Segunda Espera (4s)
    await new Promise(resolve => setTimeout(resolve, 4000));

    // 4. Verificar mensagens mais recentes (Lógica de Substituição)
    // Verificamos se há alguma mensagem MAIS NOVA que a que disparou este worker.
    // Se passamos `triggerMessageId`, usamos ele.

    const { data: latestMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('session_id', sessionId)
        .eq('sender', 'user')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (latestMsg && triggerMessageId) {
        const latestIdStr = String(latestMsg.id);
        const triggerIdStr = String(triggerMessageId);

        if (latestIdStr !== triggerIdStr) {
            console.log(`[PROCESSADOR] Abortando. Disparado por ${triggerIdStr} mas a última é ${latestIdStr}`);
            return NextResponse.json({ status: 'superseded' });
        }
    }

    // Se chegamos aqui, DEVEMOS manter o status digitando ativo se o processamento demorar?
    // Digitando no Telegram dura ~5s. Pode ter expirado ou estar perto. 
    // Vamos enviar de novo só por segurança/frescor para o atraso real de geração.
    await sendTelegramAction(botToken, chatId, 'typing');

    // 5. Contexto e Lógica


    // Identificar Contexto (Mensagens Não Respondidas)
    // Encontrar tempo da última mensagem do bot
    const { data: lastBotMsg } = await supabase
        .from('messages')
        .select('created_at, content')
        .eq('session_id', sessionId)
        .eq('sender', 'bot')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    const cutoffTime = lastBotMsg ? lastBotMsg.created_at : new Date(0).toISOString();

    // Buscar mensagens agrupadas
    const { data: groupMessages } = await supabase
        .from('messages')
        .select('content, sender')
        .eq('session_id', sessionId)
        .gt('created_at', cutoffTime)
        .order('created_at', { ascending: true });

    if (!groupMessages || groupMessages.length === 0) {
        console.log("[PROCESSADOR] Sem mensagens para processar?");
        return NextResponse.json({ status: 'done' });
    }

    const triggerPrefix = "[ADMIN_TRIGGER_SALE]";
    const filteredGroupMessages = (groupMessages || []).filter((m: any) => {
        if (m.sender === 'user') return true;
        if (m.sender === 'system' && typeof m.content === 'string' && m.content.startsWith(triggerPrefix)) return true;
        return false;
    });

    if (!filteredGroupMessages || filteredGroupMessages.length === 0) {
        console.log("[PROCESSADOR] Sem mensagens para processar?");
        return NextResponse.json({ status: 'done' });
    }

    const combinedText = filteredGroupMessages.map((m: any) => m.content).join("\n");
    const userOnlyText = filteredGroupMessages.filter((m: any) => m.sender === 'user').map((m: any) => m.content).join("\n");
    const repetition = detectRepetition(filteredGroupMessages);
    console.log(`[PROCESSADOR] Enviando para Gemini: ${combinedText}`);

    const { data: lastOfferMsg } = await supabase
        .from('messages')
        .select('created_at')
        .eq('session_id', sessionId)
        .or("content.ilike.%[M?DIA:% ,content.ilike.%PIX GENERATED%")
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    const lastOfferAt = lastOfferMsg?.created_at ? new Date(lastOfferMsg.created_at).getTime() : null;
    const minutesSinceOffer = lastOfferAt ? Math.floor((Date.now() - lastOfferAt) / 60000) : 999;

    // 4. Preparar Contexto e Mídia (Se hover)
    const currentStage = (session.funnel_step || "WELCOME").toUpperCase();
    let selectedVariant: any = null;
    let variantAssignment: { id: string, variant_id: string, stage: string } | null = null;

    selectedVariant = await pickPromptVariant(currentStage);
    let extraScript = "";
    if (selectedVariant?.content) {
        extraScript = `# VARIACAO AUTOMATICA (${currentStage})\n- use este bloco como prioridade nesta resposta.\n${selectedVariant.content}`;
        const { data: assignment } = await supabase.from('variant_assignments').insert({
            session_id: session.id,
            variant_id: selectedVariant.id,
            stage: currentStage
        }).select('id, variant_id, stage').single();
        if (assignment) variantAssignment = assignment;
    }

    const detectedCity = detectCityFromText(userOnlyText);
    const storedCity = typeof session.user_city === 'string' ? session.user_city.trim() : '';
    let userCity = storedCity;
    if (detectedCity) {
        const detectedKey = normalizeCityKey(detectedCity);
        const storedKey = normalizeCityKey(storedCity);
        if (!storedKey || detectedKey !== storedKey) {
            userCity = detectedCity;
            await supabase.from('sessions').update({ user_city: detectedCity }).eq('id', session.id);
        }
    }
    const hasCity = Boolean(userCity);
    const neighborCity = hasCity ? getNeighborCity(userCity) : '';

    const context = {
        userCity: hasCity ? userCity : undefined,
        neighborCity: hasCity ? neighborCity : undefined,
        isHighTicket: session.device_type === 'iPhone',
        totalPaid: session.total_paid || 0,
        currentStats: session.lead_score,
        minutesSinceOffer,
        extraScript
    };

    const extractFileAndCaption = (input: string) => {
        const lines = input.split(/\r?\n/);
        const firstLine = lines[0] || '';
        const captionMatch = input.match(/caption:\s*(.*)$/i);
        const caption = captionMatch ? captionMatch[1].trim() : '';
        const match = firstLine.match(/File_ID: ([^\s]+)/);
        const fileId = match ? match[1].trim() : '';
        return { fileId, caption };
    };

    let finalUserMessage = combinedText;
    let mediaData = undefined;

    // Detectar Audio
    const audioMatch = combinedText.match(/\[AUDIO_UUID: (.+)\]/);
    if (audioMatch && botToken) {
        const fileId = audioMatch[1];
        console.log(`[PROCESSADOR] Detectado Áudio ID: ${fileId}`);

        try {
            // Importar dinamicamente para evitar erro circular se houver, ou usar as funcoes diretas
            const { getTelegramFilePath, getTelegramFileDownloadUrl } = await import('@/lib/telegram');

            const filePath = await getTelegramFilePath(botToken, fileId);
            if (filePath) {
                const downloadUrl = getTelegramFileDownloadUrl(botToken, filePath);
                console.log(`[PROCESSADOR] Baixando áudio de: ${downloadUrl}`);

                const res = await fetch(downloadUrl);
                const arrayBuffer = await res.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const base64Audio = buffer.toString('base64');

                mediaData = {
                    mimeType: 'audio/ogg', // Telegram voice notes are usually OGG Opus
                    data: base64Audio
                };

                // Remove o tag interna para a IA não se confundir, ou passamos uma instrução
                finalUserMessage = "Enviou um áudio de voz.";
            }
        } catch (e) {
            console.error("Erro ao baixar áudio:", e);
        }
    }

    // Detectar V??deo
    const videoMatch = combinedText.match(/\[VIDEO_UPLOAD\] File_ID: (.+)/);
    if (videoMatch && botToken) {
        const { fileId, caption } = extractFileAndCaption(videoMatch[0]);
        if (fileId) {
            try {
                const { getTelegramFilePath, getTelegramFileDownloadUrl } = await import('@/lib/telegram');
                const filePath = await getTelegramFilePath(botToken, fileId);
                if (filePath) {
                    const downloadUrl = getTelegramFileDownloadUrl(botToken, filePath);
                    const { data: videoMsg } = await supabase
                        .from('messages')
                        .select('id')
                        .eq('session_id', session.id)
                        .eq('sender', 'user')
                        .ilike('content', `%${fileId}%`)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .single();
                    if (videoMsg) {
                        await supabase.from('messages').update({
                            media_url: downloadUrl,
                            media_type: 'video'
                        }).eq('id', videoMsg.id);
                    }
                    finalUserMessage = "Enviou um v??deo." + (caption ? `\nLegenda do usu??rio: ${caption}` : '');
                }
            } catch (e) {
                console.error("Erro ao processar v??deo:", e);
            }
        }
    }

    // Detectar Foto (Novo)
    const photoMatch = combinedText.match(/\[PHOTO_UPLOAD\] File_ID: (.+)/);
    if (photoMatch && botToken) {
        const { fileId, caption } = extractFileAndCaption(photoMatch[0]);
        if (!fileId) return NextResponse.json({ status: 'invalid_photo' });
        console.log(`[PROCESSADOR] Detectada FOTO ID: ${fileId}`);

        try {
            const { getTelegramFilePath, getTelegramFileDownloadUrl } = await import('@/lib/telegram');
            const filePath = await getTelegramFilePath(botToken, fileId);
            if (filePath) {
                const downloadUrl = getTelegramFileDownloadUrl(botToken, filePath);
                console.log(`[PROCESSADOR] URL da Foto: ${downloadUrl}`);

                // 1. Atualizar a mensagem original com o media_url para o Chat Monitor ver
                // Precisamos achar a mensagem do usuário com esse FileID
                const { data: photoMsg } = await supabase
                    .from('messages')
                    .select('id')
                    .eq('session_id', session.id)
                    .eq('sender', 'user')
                    .ilike('content', `%${fileId}%`)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .single();

                if (photoMsg) {
                    await supabase.from('messages').update({
                        media_url: downloadUrl, // Url temporária do Telegram (1h)
                        media_type: 'image'
                    }).eq('id', photoMsg.id);
                }

                // 2. Opcional: Baixar e enviar para o Gemini (Vision)
                // CAUSA ERRO DE SAFETY SE FOR NUDE. DESATIVADO TEMPORARIAMENTE.
                /*
                const res = await fetch(downloadUrl);
                const arrayBuffer = await res.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const base64Image = buffer.toString('base64');

                mediaData = {
                    mimeType: 'image/jpeg',
                    data: base64Image
                };
                
                finalUserMessage = "Enviou uma foto/nude. Analise a imagem se possível.";
                */

                finalUserMessage = "Enviou uma foto PROIBIDA (Nude ou +18). O sistema bloqueou a imagem por segurança. Reaja como se tivesse visto algo muito excitante.";
            }
        } catch (e) {
            console.error("Erro ao processar foto:", e);
        }
    }

    if (combinedText.includes(triggerPrefix)) {
        finalUserMessage = `${finalUserMessage}\n\n[OBSERVACAO INTERNA: o admin pediu para iniciar a venda agora. Use o contexto da conversa e leve para proposta/preco de forma natural.]`;
    }
    if (repetition.repeats >= 2) {
        finalUserMessage = `${finalUserMessage}\n\n[OBSERVACAO INTERNA: o lead repetiu a mesma mensagem ${repetition.repeats}x ("${repetition.last}"). Responda diferente, quebre o loop e puxe o assunto com algo novo e humano. Nao repita a mesma frase.]`;
    }
    if (!hasCity && /(de onde (voce|vc) e|vc e de onde|qual (sua|a) cidade|onde (voce|vc) mora)/i.test(userOnlyText)) {
        finalUserMessage = `${finalUserMessage}\n\n[OBSERVACAO INTERNA: o lead perguntou sua cidade, mas voce AINDA NAO sabe a cidade dele. Pergunte primeiro "de onde vc e anjo?" e NAO diga sua cidade agora.]`;
    }

    const aiResponse = await sendMessageToGemini(session.id, finalUserMessage, context, mediaData);

    console.log("🤖 Resposta Gemini Stats:", JSON.stringify(aiResponse.lead_stats, null, 2));

    // 5. Atualizar Stats & Salvar Pensamentos
    const currentStats = normalizeStats(session.lead_score);
    if (!aiResponse.lead_stats) {
        aiResponse.lead_stats = applyHeuristicStats(userOnlyText, currentStats);
    }

    const aiStats = normalizeStats(aiResponse.lead_stats);
    const heuristicStats = applyHeuristicStats(userOnlyText, currentStats);

    const aiUnchanged = JSON.stringify(aiStats) === JSON.stringify(currentStats);
    if (isAllZero(aiStats) || aiUnchanged) {
        aiResponse.lead_stats = heuristicStats;
    } else {
        aiResponse.lead_stats = {
            tarado: Math.max(aiStats.tarado, heuristicStats.tarado),
            financeiro: Math.max(aiStats.financeiro, heuristicStats.financeiro),
            carente: Math.max(aiStats.carente, heuristicStats.carente),
            sentimental: Math.max(aiStats.sentimental, heuristicStats.sentimental)
        };
    }

    console.log("📊 [STATS UPDATE] ANTES:", JSON.stringify(session.lead_score));
    console.log("📊 [STATS UPDATE] DEPOIS (IA):", JSON.stringify(aiResponse.lead_stats));

    // LÓGICA DE CONFIANÇA NA IA: A IA recebe os stats atuais no contexto.
    // Confiamos na saída dela para aumentar OU diminuir os valores.

    const previousStep = session.funnel_step;
    const aiStep = aiResponse.current_state ? String(aiResponse.current_state).toUpperCase().trim() : "";
    let nextStep = FUNNEL_STEPS.includes(aiStep) ? aiStep : (previousStep || "WELCOME");
    const actionStep = ACTION_STAGE_MAP[aiResponse.action || ''] || null;
    const inferredStep = actionStep || inferStageFromText([
        ...(Array.isArray(aiResponse.messages) ? aiResponse.messages : []),
        combinedText
    ].join('\n'));

    if (inferredStep) {
        const nextIdx = stageIndex(nextStep);
        const infIdx = stageIndex(inferredStep);
        if (infIdx > nextIdx) {
            nextStep = inferredStep;
        }
    }

    const updateResult = await supabase.from('sessions').update({
        lead_score: aiResponse.lead_stats,
        funnel_step: nextStep,
    }).eq('id', session.id).select();

    if (updateResult.error) {
        console.error("❌ ERRO ao Atualizar Stats:", updateResult.error);
    } else {
        console.log("✅ Stats Atualizados no DB com Sucesso:", updateResult.data);
    }

    if (nextStep && previousStep !== nextStep) {
        try {
            await supabase.from('funnel_events').insert({
                session_id: session.id,
                step: nextStep,
                source: 'ai'
            });
        } catch (e: any) {
            console.warn("Falha ao registrar funnel_events:", e?.message || e);
        }
    }

    if (variantAssignment) {
        try {
            const prevIdx = stageIndex(previousStep);
            const nextIdx = stageIndex(nextStep);
            let outcome: boolean | null = null;
            if (prevIdx >= 0 && nextIdx >= 0) {
                if (nextIdx > prevIdx) outcome = true;
                if (nextIdx < prevIdx) outcome = false;
            }
            if (outcome !== null) {
                await supabase.from('variant_assignments').update({ success: outcome }).eq('id', variantAssignment.id);
                const { data: variantRow } = await supabase
                    .from('prompt_variants')
                    .select('successes, failures')
                    .eq('id', variantAssignment.variant_id)
                    .single();
                const successes = Number(variantRow?.successes || 0) + (outcome ? 1 : 0);
                const failures = Number(variantRow?.failures || 0) + (outcome ? 0 : 1);
                await supabase.from('prompt_variants').update({
                    successes,
                    failures,
                    updated_at: new Date().toISOString()
                }).eq('id', variantAssignment.variant_id);
            }
        } catch (e: any) {
            console.warn("Falha ao registrar resultado da variacao:", e?.message || e);
        }
    }

    if (aiResponse.internal_thought) {
        await supabase.from('messages').insert({
            session_id: session.id,
            sender: 'thought',
            content: aiResponse.internal_thought
        });
    }

    // 5.5 Atualizar Transcrição de Áudio (Se houver)
    if (aiResponse.audio_transcription && audioMatch) {
        // audioMatch[0] é todo o texto "[AUDIO_UUID: ...]"
        // Vamos atualizar a mensagem do usuário que contém isso.
        // Precisamos achar o ID da mensagem.
        // Podemos tentar achar pelo conteúdo exato no banco para essa sessão.

        const { data: audioMsg } = await supabase
            .from('messages')
            .select('id')
            .eq('session_id', session.id)
            .eq('sender', 'user')
            .ilike('content', `%${audioMatch[1]}%`) // Match pelo UUID
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (audioMsg) {
            console.log(`[PROCESSADOR] Atualizando transcrição para MSG ${audioMsg.id}`);
            await supabase.from('messages').update({
                content: `[ÁUDIO (Transcrição): "${aiResponse.audio_transcription}"]`
            }).eq('id', audioMsg.id);
        }
    }

    // 6. Enviar Respostas

    const outgoingMessages = Array.isArray(aiResponse.messages)
        ? aiResponse.messages
        : [String(aiResponse.messages || '')].filter(Boolean);

    const safeMessages = (outgoingMessages.length > 0 ? outgoingMessages : ['amor?'])
        .map((m: string) => sanitizeOutgoingMessage(m))
        .filter(Boolean);

    const lastBotContent = lastBotMsg?.content || '';
    const normLastBot = normalizeLoopText(lastBotContent);
    const normFirstOut = normalizeLoopText(safeMessages[0] || '');
    if (normLastBot && normFirstOut && normLastBot === normFirstOut) {
        safeMessages[0] = `ei amor ${safeMessages[0]}`;
    }

    for (let i = 0; i < safeMessages.length; i++) {
        const msgText = safeMessages[i];

        // Delay fixo entre 3 a 4 segundos (solicitado pelo usuário)
        // Isso dá um tempo de leitura/digitação consistente para cada balão.
        const delay = Math.floor(Math.random() * (4000 - 3000 + 1)) + 3000;

        await sendTelegramAction(botToken, chatId, 'typing');
        await new Promise(r => setTimeout(r, delay));

        await supabase.from('messages').insert({
            session_id: session.id,
            sender: 'bot',
            content: msgText
        });

        await sendTelegramMessage(botToken, chatId, msgText);
    }

    if (combinedText.includes(triggerPrefix)) {
        try {
            await supabase
                .from('messages')
                .delete()
                .eq('session_id', session.id)
                .eq('sender', 'system')
                .ilike('content', '[ADMIN_TRIGGER_SALE]%');
        } catch (e: any) {
            console.warn("Falha ao limpar trigger de venda:", e?.message || e);
        }
    }




    // 6.5 Atualizar Last Bot Activity
    // Importante para o Cron de Reengajamento saber quando foi a última msg
    const nowIso = new Date().toISOString();
    await supabase.from('sessions').update({
        last_bot_activity_at: nowIso,
        last_message_at: nowIso
    }).eq('id', session.id);

    // 7. Lidar com Mídia
    if (aiResponse.action !== 'none') {
        const SHOWER_PHOTO = "https://i.ibb.co/dwf177Kc/download.jpg";
        const LINGERIE_PHOTO = "https://i.ibb.co/dsx5mTXQ/3297651933149867831-62034582678-jpg.jpg";
        const WET_PHOTO = "https://i.ibb.co/mrtfZbTb/fotos-de-bucetas-meladas-0.jpg";
        const VIDEO_PREVIEW = "BAACAgEAAxkBAAIHMmllipghQzttsno99r2_C_8jpAIiAAL9BQACaHUxR4HU9Y9IirkLOAQ";
        const HOT_PREVIEW_VIDEO = "BAACAgEAAxkBAAIJ52ll0E_2iOfBZnzMe34rOr6Mi5hjAAIsBQACWoUoR8dO8XUHmuEwOAQ";
        const ASS_PHOTO_PREVIEW_ID = "AgACAgEAAxkBAAIJ7mll03HJtLdhDpZIFFYsOAuZ52UdAAIYDmsbWoUoR5pkHZDTJ9f0AQADAgADeQADOAQ";

        let mediaUrl = null;
        let mediaType = null;
        let caption = "";

        switch (aiResponse.action) {
            case 'send_shower_photo': mediaUrl = SHOWER_PHOTO; mediaType = 'image'; caption = ""; break;
            case 'send_lingerie_photo': mediaUrl = LINGERIE_PHOTO; mediaType = 'image'; break;
            case 'send_wet_finger_photo': mediaUrl = WET_PHOTO; mediaType = 'image'; break;
            case 'send_ass_photo_preview': mediaUrl = ASS_PHOTO_PREVIEW_ID; mediaType = 'image'; break;
            case 'send_video_preview': mediaUrl = VIDEO_PREVIEW; mediaType = 'video'; break;
            case 'send_hot_video_preview': mediaUrl = HOT_PREVIEW_VIDEO; mediaType = 'video'; break;
            case 'check_payment_status':
                // Verificar se o último pagamento foi pago
                try {
                    // Precisamos buscar o ID do último pagamento de algum lugar.
                    // Por enquanto, vamos procurar a ÚLTIMA mensagem de sistema com dados PIX?
                    // Ou mais limpo: O usuário diz "Paguei", verificamos o último pagamento criado para este usuário no WiinPay?
                    // O Serviço WiinPay precisa suportar listagem ou armazenamos paymentId na sessão?

                    // SIMPLIFICAÇÃO: Vamos assumir que armazenamos o último PaymentID em mensagens ou sessão.
                    // Vamos procurar a última mensagem de pagamento no DB
                    const { data: lastPayMsg } = await supabase
                        .from('messages')
                        .select('content, payment_data')
                        .eq('session_id', session.id)
                        .eq('sender', 'system')
                        .ilike('content', '%PIX GENERATED%')
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .single();

                    if (lastPayMsg) {
                        // Extrair Valor e ID
                        // Formato esperado: "[SYSTEM: PIX GENERATED - 24.90 | ID: abc-123]"
                        const content = lastPayMsg.content || '';
                        const valueMatch = content.match(/PIX GENERATED - (\d+(\.\d+)?)/);
                        const idMatch = content.match(/ID: ([a-zA-Z0-9\-_]+)/);

                        const value = lastPayMsg.payment_data?.value ?? (valueMatch ? parseFloat(valueMatch[1]) : 0);
                        const paymentId = lastPayMsg.payment_data?.paymentId ?? (idMatch ? idMatch[1] : null);

                        if (!paymentId) {
                            await sendTelegramMessage(botToken, chatId, "amor nao achei o codigo da transação aqui... manda o comprovante?");
                            break;
                        }

                        console.log(`[PROCESSADOR] Verificando Pagamento ID: ${paymentId}`);
                        const statusData = await WiinPayService.getPaymentStatus(paymentId);

                        console.log(`[PROCESSADOR] Status WiinPay:`, JSON.stringify(statusData));

                        const rawStatus = statusData?.status || statusData?.data?.status || statusData?.payment?.status || statusData?.data?.payment?.status || 'pending';
                        const status = String(rawStatus).toLowerCase();
                        const isPaid = ['approved', 'paid', 'completed', 'confirmed', 'success', 'aprovado'].includes(status);

                        if (isPaid) {
                            // Incrementar LTV
                            const currentTotal = session.total_paid || 0;
                            const newTotal = currentTotal + value;

                            await supabase.from('sessions').update({
                                total_paid: newTotal,
                            }).eq('id', session.id);

                            // Notificar IA sobre sucesso (via Mensagem de Sistema oculta)
                            await supabase.from('messages').insert({
                                session_id: session.id,
                                sender: 'system',
                                content: `[SISTEMA: PAGAMENTO CONFIRMADO - R$ ${value}. TOTAL PAGO: R$ ${newTotal}]`
                            });

                            await sendTelegramMessage(botToken, chatId, "confirmado amor! obrigada... vou te mandar agora");

                            // Forçar IA a saber que pagou na proxima iteração se necessário, 
                            // mas aqui ela já recebe o input de sistema acima.
                            if (paymentId) {
                                const { data: lastPixMsg } = await supabase
                                    .from('messages')
                                    .select('id, payment_data')
                                    .eq('session_id', session.id)
                                    .eq('sender', 'system')
                                    .ilike('content', '%PIX GENERATED%')
                                    .order('created_at', { ascending: false })
                                    .limit(1)
                                    .single();
                                if (lastPixMsg?.id) {
                                    await supabase.from('messages').update({
                                        payment_data: {
                                            ...(lastPixMsg.payment_data || {}),
                                            paid: true,
                                            status: status,
                                            paid_at: new Date().toISOString()
                                        }
                                    }).eq('id', lastPixMsg.id);
                                }
                            }
                            try {
                                await supabase.from('funnel_events').insert({
                                    session_id: session.id,
                                    step: 'PAYMENT_CONFIRMED',
                                    source: 'system'
                                });
                            } catch (e: any) {
                                console.warn("Falha ao registrar pagamento no funil:", e?.message || e);
                            }

                            try {
                                const { data: lastAssign } = await supabase
                                    .from('variant_assignments')
                                    .select('id, variant_id')
                                    .eq('session_id', session.id)
                                    .is('success', null)
                                    .order('created_at', { ascending: false })
                                    .limit(1)
                                    .single();
                                if (lastAssign) {
                                    await supabase.from('variant_assignments').update({ success: true }).eq('id', lastAssign.id);
                                    const { data: variantRow } = await supabase
                                        .from('prompt_variants')
                                        .select('successes')
                                        .eq('id', lastAssign.variant_id)
                                        .single();
                                    const successes = Number(variantRow?.successes || 0) + 1;
                                    await supabase.from('prompt_variants').update({
                                        successes,
                                        updated_at: new Date().toISOString()
                                    }).eq('id', lastAssign.variant_id);
                                }
                            } catch (e: any) {
                                console.warn("Falha ao registrar sucesso da variacao no pagamento:", e?.message || e);
                            }
                        } else {
                            await sendTelegramMessage(botToken, chatId, "amor ainda não caiu aqui... tem certeza? (Status: " + status + ")");
                        }

                    } else {
                        await sendTelegramMessage(botToken, chatId, "amor qual pix? nao achei aqui");


                    }
                } catch (e: any) {
                    console.error("Erro Verificação Pagamento", e);
                    await sendTelegramMessage(botToken, chatId, "deu erro ao verificar amor, manda o comprovante?");
                }
                break;

            case 'generate_pix_payment':
                try {
                    const inferredValue = inferPixValue([
                        ...(Array.isArray(aiResponse.messages) ? aiResponse.messages : []),
                        combinedText,
                        lastBotMsg?.content || ''
                    ]);
                    const value = Number(aiResponse.payment_details?.value ?? inferredValue ?? 19.90);
                    const description = aiResponse.payment_details?.description || "Pack Exclusivo";
                    // Se já existe PIX pendente com o mesmo valor, reenviar o mesmo
                    const { data: lastPixMsg } = await supabase
                        .from('messages')
                        .select('id, payment_data, created_at')
                        .eq('session_id', session.id)
                        .eq('sender', 'system')
                        .ilike('content', '%PIX GENERATED%')
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .single();

                    const lastPaymentData: any = lastPixMsg?.payment_data || {};
                    const sameValue = Number(lastPaymentData.value || 0) === Number(value);
                    const notPaid = lastPaymentData.paid !== true;
                    const lastPixCode = lastPaymentData.pixCopiaCola;
                    const lastPaymentId = lastPaymentData.paymentId;

                    if (sameValue && notPaid && lastPixCode) {
                        await sendTelegramMessage(botToken, chatId, "ta aqui o pix de novo amor 👇");
                        await sendTelegramCopyableCode(botToken, chatId, lastPixCode);

                        await supabase.from('messages').insert({
                            session_id: session.id,
                            sender: 'system',
                            content: "[SYSTEM: PIX RESENT - " + value + " | ID: " + (lastPaymentId || "unknown") + "]",
                            payment_data: {
                                ...lastPaymentData,
                                resent_at: new Date().toISOString()
                            }
                        });
                        break;
                    }
                    // Gerar Pagamento
                    const payment = await WiinPayService.createPayment({
                        value: value,
                        name: session.user_name || "Anônimo",
                        email: (session.user_name && session.user_name.toLowerCase().includes('operação kaique'))
                            ? 'operaçaokaique@gmail.com'
                            : `user_${chatId}@telegram.com`,
                        description: description
                    });

                    // LOG DE DEBUG
                    await supabase.from('messages').insert({
                        session_id: session.id,
                        sender: 'system',
                        content: `[DEBUG] Resposta WiinPay: ${JSON.stringify(payment)}`
                    });

                    if (payment && payment.pixCopiaCola) {
                        await sendTelegramMessage(botToken, chatId, "ta aqui o pix amor 👇");
                        await sendTelegramCopyableCode(botToken, chatId, payment.pixCopiaCola);

                        await supabase.from('messages').insert({
                            session_id: session.id,
                            sender: 'system',
                            content: "[SYSTEM: PIX GENERATED - " + value + " | ID: " + payment.paymentId + "]",
                            payment_data: {
                                paymentId: payment.paymentId,
                                value,
                                description,
                                pixCopiaCola: payment.pixCopiaCola,
                                paid: false,
                                status: payment.status || 'pending'
                            }
                        });
                    } else {
                        await sendTelegramMessage(botToken, chatId, "amor o sistema caiu aqui rapidinho... tenta daqui a pouco?");
                    }
                } catch (err: any) {
                    console.error("Erro Pagamento:", err);
                    // LOG DE ERRO DEBUG
                    await supabase.from('messages').insert({
                        session_id: session.id,
                        sender: 'system',
                        content: `[DEBUG] Erro WiinPay: ${err.message || JSON.stringify(err)}`
                    });

                    await sendTelegramMessage(botToken, chatId, "amor nao consegui gerar o pix agora... que raiva");
                }
                break;
        }

        if (mediaUrl) {
            try {
                if (mediaType === 'image') await sendTelegramPhoto(botToken, chatId, mediaUrl, caption);
                if (mediaType === 'video') await sendTelegramVideo(botToken, chatId, mediaUrl, "olha isso");

                await supabase.from('messages').insert({
                    session_id: session.id,
                    sender: 'bot',
                    content: `[MÍDIA: ${aiResponse.action}]`,
                    media_url: mediaUrl,
                    media_type: mediaType
                });
            } catch (err: any) {
                console.error("Erro ao enviar mídia:", err);
                await supabase.from('messages').insert({
                    session_id: session.id,
                    sender: 'system',
                    content: `[DEBUG: ERRO MÍDIA] ${err.message}`
                });
                // Fallback: Avisar usuário se falhar vídeo
                await sendTelegramMessage(botToken, chatId, "(amor tive um erro pra enviar o video... tenta de novo?)");
            }
        }
    }

    return NextResponse.json({
        success: true,
        debug_stats: aiResponse.lead_stats,
        debug_funnel: nextStep
    });
}
