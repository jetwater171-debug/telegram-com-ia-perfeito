const { createClient } = require('@supabase/supabase-js');
// Fetch is native in Node 20+
require('dotenv').config({ path: '.env.local' });

// Configurar Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ ERRO: Variáveis de ambiente faltando (.env.local)");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runTest() {
    console.log("🔍 [PROVA REAL] Iniciando Teste de Barrinhas...");

    // 1. Pegar a última sessão ativa
    const { data: sessions, error } = await supabase
        .from('sessions')
        .select('id, user_name, lead_score')
        .order('created_at', { ascending: false })
        .limit(1);

    if (error || !sessions || sessions.length === 0) {
        console.error("❌ Nenhuma sessão encontrada.", error);
        return;
    }

    const session = sessions[0];
    console.log(`✅ Sessão Alvo: ${session.user_name} (ID: ${session.id})`);
    console.log(`📊 Stats Iniciais:`, session.lead_score);

    const initialFinanceiro = session.lead_score?.financeiro || 0;

    // 2. Enviar mensagem de teste "RICA"
    console.log("\n✉️ Enviando msg de teste: 'sou muito rico tenho ferrari'...");

    // Inserir mensagem
    const { data: msg } = await supabase.from('messages').insert({
        session_id: session.id,
        sender: 'user',
        content: 'sou muito rico tenho uma ferrari e gosto de gastar',
    }).select().single();

    if (!msg) {
        console.error("❌ Falha ao criar mensagem.");
        return;
    }

    // 3. Disparar API
    console.log("🚀 Chamando API process-message...");
    try {
        const response = await fetch('http://localhost:3000/api/process-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: session.id, triggerMessageId: msg.id })
        });

        const result = await response.json();
        console.log("\n📡 Resposta API:", JSON.stringify(result, null, 2));

        // 4. Verificar Banco de Dados Novamente
        console.log("\n🔍 Verificando Banco de Dados (Pós-Processamento)...");
        const { data: updatedSession } = await supabase
            .from('sessions')
            .select('lead_score')
            .eq('id', session.id)
            .single();

        console.log(`📊 Stats Finais:`, updatedSession.lead_score);

        const finalFinanceiro = updatedSession.lead_score?.financeiro || 0;

        if (finalFinanceiro > initialFinanceiro) {
            console.log("\n✅ SUCESSO ABSOLUTO! O Financeiro subiu de " + initialFinanceiro + " para " + finalFinanceiro);
            console.log("👉 Conclusão: O Backend e a IA estão funcionando. O problema é no FRONTEND.");
        } else {
            console.log("\n❌ FALHA: O Financeiro NÃO subiu. (Inicial: " + initialFinanceiro + " -> Final: " + finalFinanceiro + ")");
            console.log("👉 Conclusão: A IA ignorou o comando ou o Backend falhou em salvar.");
        }

    } catch (e) {
        console.error("❌ Erro na requisição:", e);
    }
}

runTest();
