const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    console.log("🔍 Buscando última sessão...");
    const { data: sessions, error } = await supabase
        .from('sessions')
        .select('id, telegram_chat_id, user_name')
        .order('created_at', { ascending: false })
        .limit(1);

    if (error || !sessions || sessions.length === 0) {
        console.error("❌ Nenhuma sessão encontrada.", error);
        return;
    }

    const session = sessions[0];
    console.log(`✅ Sessão encontrada: ${session.user_name} (${session.id})`);

    // Inserir mensagem de teste
    console.log("📩 Enviando mensagem de teste: 'tenho muito dinheiro/gosto de gastar com mulher'...");
    const { data: msg, error: msgError } = await supabase.from('messages').insert({
        session_id: session.id,
        sender: 'user',
        content: 'tenho muito dinheiro e gosto de gastar com mulher gostosa',
        telegram_message_id: 123456
    }).select().single();

    if (msgError) {
        console.error("❌ Erro ao criar mensagem:", msgError);
        return;
    }

    console.log(`✅ Mensagem criada: ${msg.id}`);

    // Chamar API
    console.log("🚀 Chamando process-message API...");
    const response = await fetch('http://localhost:3000/api/process-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sessionId: session.id,
            triggerMessageId: msg.id
        })
    });

    const result = await response.json();
    console.log("\n📊 RESULTADO API:");
    console.log(JSON.stringify(result, null, 2));

    if (result.debug_stats && result.debug_stats.financeiro > 0) {
        console.log("\n✅ SUCESSO! O score financeiro aumentou!");
    } else {
        console.log("\n⚠️ ALERTA: Score financeiro zerado ou não retornado.");
    }
}

run();
