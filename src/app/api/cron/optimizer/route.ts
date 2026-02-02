import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabaseServer';
import { GoogleGenerativeAI } from '@google/generative-ai';

const MODEL = 'gemini-2.5-flash';
export const dynamic = 'force-dynamic';
const PAGE_SIZE = 200;
const MESSAGE_PAGE_SIZE = 1000;
const MAX_CHARS_PER_CALL = 12000;
const MAX_SESSION_SUMMARY_CHARS = 900;
const DEFAULT_MAX_SESSIONS_PER_RUN = 8;

const getSetting = async (key: string) => {
    const { data } = await supabase.from('bot_settings').select('value').eq('key', key).single();
    return data?.value ?? null;
};

const setSetting = async (key: string, value: string) => {
    await supabase.from('bot_settings').upsert({ key, value });
};

export async function GET(req: NextRequest) {
    try {
        const force = req.nextUrl.searchParams.get('force') === '1';
        const enabledSetting = await getSetting('auto_optimizer_enabled');
        const enabled = enabledSetting ?? 'true';
        if (!force && enabled !== 'true') {
            return NextResponse.json({ ok: true, skipped: 'disabled' });
        }
        if (enabledSetting === null) {
            await setSetting('auto_optimizer_enabled', 'true');
        }

        const lastRun = await getSetting('auto_optimizer_last_run');
        const minInterval = Number(await getSetting('auto_optimizer_min_interval_min')) || 60;
        if (!force && lastRun) {
            const diff = Date.now() - new Date(lastRun).getTime();
            if (diff < minInterval * 60 * 1000) {
                return NextResponse.json({ ok: true, skipped: 'cooldown' });
            }
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return NextResponse.json({ error: 'Missing GEMINI_API_KEY' }, { status: 500 });

        const getSettingNumber = async (key: string, fallback = 0) => {
            const value = await getSetting(key);
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : fallback;
        };

        const fetchAllMessagesForSession = async (sessionId: string) => {
            let from = 0;
            const results: any[] = [];
            while (true) {
                const { data } = await supabase
                    .from('messages')
                    .select('sender, content, created_at')
                    .eq('session_id', sessionId)
                    .order('created_at', { ascending: true })
                    .range(from, from + MESSAGE_PAGE_SIZE - 1);
                if (!data || data.length === 0) break;
                results.push(...data);
                if (data.length < MESSAGE_PAGE_SIZE) break;
                from += MESSAGE_PAGE_SIZE;
            }
            return results;
        };

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: MODEL,
            generationConfig: {
                responseMimeType: 'application/json'
            }
        });

        const summarizeChunk = async (chunkText: string, currentSummary: string) => {
            const prompt = `
Você é um analista de conversas. Atualize o resumo abaixo com base no novo trecho.
Regras:
- Preserve fatos importantes.
- Registre comportamentos do lead, gatilhos, objeções, timing e resposta da Lari.
- Seja objetivo e não invente.

Resumo atual:
${currentSummary || '(vazio)'}

Novo trecho:
${chunkText}

Responda em JSON:
{ "summary": "..." }
`;
            const result = await model.generateContent(prompt);
            const json = JSON.parse(result.response.text());
            const summary = String(json?.summary || '').slice(0, MAX_SESSION_SUMMARY_CHARS);
            return summary;
        };

        const summarizeSession = async (messages: any[], sessionId: string) => {
            const formatted = messages.map(m => `${m.sender}: ${String(m.content || '').slice(0, 500)}`);
            const fullText = formatted.join('\n');

            if (fullText.length <= MAX_CHARS_PER_CALL) {
                const result = await model.generateContent(`
Resuma a conversa abaixo para análise de conversão.
Foque em: linguagem do lead, pedidos, timing de preço, sinais de compra, travas, respostas que funcionaram ou travaram.
Responda em JSON: { "summary": "..." }

Conversa (session ${sessionId}):
${fullText}
`);
                const json = JSON.parse(result.response.text());
                return String(json?.summary || '').slice(0, MAX_SESSION_SUMMARY_CHARS);
            }

            let summary = '';
            let chunk = '';
            for (const line of formatted) {
                if ((chunk + '\n' + line).length > MAX_CHARS_PER_CALL) {
                    summary = await summarizeChunk(chunk, summary);
                    chunk = line;
                } else {
                    chunk = chunk ? `${chunk}\n${line}` : line;
                }
            }
            if (chunk) {
                summary = await summarizeChunk(chunk, summary);
            }
            return summary;
        };

        const updateGlobalSummary = async (current: string, sessionId: string, sessionSummary: string) => {
            const prompt = `
Atualize o resumo global abaixo com a nova sessao resumida.
Responda em JSON: { "summary": "..." }

Resumo global atual:
${current || '(vazio)'}

Nova sessao (${sessionId}):
${sessionSummary}
`;
            const result = await model.generateContent(prompt);
            const json = JSON.parse(result.response.text());
            return String(json?.summary || '').slice(0, MAX_CHARS_PER_CALL);
        };

        const fetchSessionPage = async (paid: boolean, offset: number) => {
            let query = supabase
                .from('sessions')
                .select('id, total_paid')
                .order('last_message_at', { ascending: false })
                .range(offset, offset + PAGE_SIZE - 1);
            query = paid ? query.gt('total_paid', 0) : query.eq('total_paid', 0);
            const { data } = await query;
            return data || [];
        };

        let stage = (await getSetting('auto_optimizer_stage')) || 'paid';
        let paidOffset = await getSettingNumber('auto_optimizer_paid_offset', 0);
        let unpaidOffset = await getSettingNumber('auto_optimizer_unpaid_offset', 0);
        let paidGlobal = (await getSetting('auto_optimizer_paid_summary')) || '';
        let unpaidGlobal = (await getSetting('auto_optimizer_unpaid_summary')) || '';
        const maxSessionsPerRun = Math.max(
            1,
            await getSettingNumber('auto_optimizer_batch_size', DEFAULT_MAX_SESSIONS_PER_RUN)
        );

        let sessionsProcessed = 0;

        const processBatch = async (paid: boolean) => {
            let offset = paid ? paidOffset : unpaidOffset;
            const page = await fetchSessionPage(paid, offset);
            if (page.length === 0) {
                return { done: true, offset };
            }
            for (const session of page) {
                const messages = await fetchAllMessagesForSession(session.id);
                const summary = await summarizeSession(messages, session.id);
                if (paid) {
                    paidGlobal = await updateGlobalSummary(paidGlobal, session.id, summary);
                } else {
                    unpaidGlobal = await updateGlobalSummary(unpaidGlobal, session.id, summary);
                }
                sessionsProcessed += 1;
                if (sessionsProcessed >= maxSessionsPerRun) {
                    offset += 1;
                    return { done: false, offset };
                }
                offset += 1;
            }
            return { done: false, offset };
        };

        if (stage === 'paid') {
            const result = await processBatch(true);
            paidOffset = result.offset;
            if (result.done) stage = 'unpaid';
        }

        if (stage === 'unpaid' && sessionsProcessed < maxSessionsPerRun) {
            const result = await processBatch(false);
            unpaidOffset = result.offset;
            if (result.done) stage = 'final';
        }

        await setSetting('auto_optimizer_paid_offset', String(paidOffset));
        await setSetting('auto_optimizer_unpaid_offset', String(unpaidOffset));
        await setSetting('auto_optimizer_paid_summary', paidGlobal);
        await setSetting('auto_optimizer_unpaid_summary', unpaidGlobal);
        await setSetting('auto_optimizer_stage', stage);

        if (stage !== 'final') {
            await setSetting('auto_optimizer_last_run', new Date().toISOString());
            await setSetting('auto_optimizer_last_result', JSON.stringify({ progress: stage, paidOffset, unpaidOffset, sessionsProcessed }).slice(0, 10000));
            return NextResponse.json({ ok: true, partial: true, stage, paidOffset, unpaidOffset, sessionsProcessed });
        }

        const prompt = `
Você é um analista de vendas. Contexto completo:
- Lari é uma garota de 19 anos que conversa e vende acesso VIP privado (conteúdo adulto).
- O funil inclui: aquecimento, gatilho visual, prévia, proposta, preço e fechamento.
- A conversa acontece no Telegram, estilo informal e rápido.
- Objetivo: maximizar conversão respeitando o ritmo do lead (não vender frio).

Sua tarefa:
1) Analise as conversas pagas vs não pagas.
2) Encontre padrões do LEAD (linguagem, timing, pedidos, objeções, frieza, curiosidade).
3) Identifique momentos que levaram ao fechamento e momentos que travaram.
4) Gere instruções curtas e acionáveis para ajustar o comportamento da Lari.

Regras:
- Foque no comportamento do lead e no fluxo, não em elogios à Lari.
- Diga o que funciona e o que não funciona com base nas mensagens.
- Seja específico (ex: "quando ele pergunta preço cedo, responda X antes de ofertar").

Responda em JSON com:
{
  "diagnostico": "...",
  "mudancas": ["...", "..."],
  "script_block": "texto de instruções para otimizar conversão, curto e direto"
}

Pagas (todas as conversas, resumidas):
${paidGlobal}

Nao pagas (todas as conversas, resumidas):
${unpaidGlobal}
`;

        const result = await model.generateContent(prompt);
        const json = JSON.parse(result.response.text());

        const content = `# AUTO-OTIMIZACAO\n${json.script_block || ''}`;

        await supabase.from('prompt_blocks').upsert({
            key: 'auto_optimizer',
            label: 'Auto Otimizacao',
            content: content,
            enabled: true,
            updated_at: new Date().toISOString()
        });

        await setSetting('auto_optimizer_last_run', new Date().toISOString());
        await setSetting('auto_optimizer_last_result', JSON.stringify(json).slice(0, 10000));
        await setSetting('auto_optimizer_stage', 'paid');
        await setSetting('auto_optimizer_paid_offset', '0');
        await setSetting('auto_optimizer_unpaid_offset', '0');
        await setSetting('auto_optimizer_paid_summary', '');
        await setSetting('auto_optimizer_unpaid_summary', '');

        return NextResponse.json({ ok: true, summary: json.diagnostico, changes: json.mudancas });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'error' }, { status: 500 });
    }
}
