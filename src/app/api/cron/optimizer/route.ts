import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';
import { GoogleGenerativeAI } from '@google/generative-ai';

const MODEL = 'gemini-2.5-flash';
export const dynamic = 'force-dynamic';

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

        // Coletar amostra de conversas pagas e nao pagas
        const { data: paidSessions } = await supabase
            .from('sessions')
            .select('id, total_paid')
            .gt('total_paid', 0)
            .order('last_message_at', { ascending: false })
            .limit(30);

        const { data: unpaidSessions } = await supabase
            .from('sessions')
            .select('id, total_paid')
            .eq('total_paid', 0)
            .order('last_message_at', { ascending: false })
            .limit(30);

        const paidIds = (paidSessions || []).map(s => s.id);
        const unpaidIds = (unpaidSessions || []).map(s => s.id);

        const fetchMessages = async (ids: string[]) => {
            if (!ids.length) return [];
            const { data } = await supabase
                .from('messages')
                .select('session_id, sender, content, created_at')
                .in('session_id', ids)
                .order('created_at', { ascending: true });
            return data || [];
        };

        const paidMsgs = await fetchMessages(paidIds);
        const unpaidMsgs = await fetchMessages(unpaidIds);

        const summarize = (msgs: any[]) => {
            const bySession = new Map<string, any[]>();
            for (const m of msgs) {
                if (!bySession.has(m.session_id)) bySession.set(m.session_id, []);
                bySession.get(m.session_id)!.push(m);
            }
            const sample = [];
            for (const [sid, arr] of bySession) {
                const short = arr.slice(-12).map(m => `${m.sender}: ${String(m.content || '').slice(0, 200)}`).join('\n');
                sample.push(`session ${sid}:\n${short}`);
                if (sample.length >= 10) break;
            }
            return {
                sessions: bySession.size,
                sample
            };
        };

        const paidSummary = summarize(paidMsgs);
        const unpaidSummary = summarize(unpaidMsgs);

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: MODEL,
            generationConfig: {
                responseMimeType: 'application/json'
            }
        });

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

Pagas (amostra):
${paidSummary.sample.join('\n\n')}

Nao pagas (amostra):
${unpaidSummary.sample.join('\n\n')}
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

        return NextResponse.json({ ok: true, summary: json.diagnostico, changes: json.mudancas });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'error' }, { status: 500 });
    }
}
