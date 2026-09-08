const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');

async function main() {
    const db = new PGlite();
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
        CREATE TABLE sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), telegram_chat_id text UNIQUE,
        status text DEFAULT 'active', user_name text, lead_memory jsonb DEFAULT '{}', lead_score jsonb,
        total_paid numeric DEFAULT 0, reengagement_sent boolean DEFAULT false, last_message_at timestamptz,
        last_bot_activity_at timestamptz);
        CREATE TABLE messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid REFERENCES sessions ON DELETE CASCADE, content text);
        CREATE TABLE lead_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid REFERENCES sessions ON DELETE CASCADE);
        CREATE TABLE lead_redirects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid REFERENCES sessions ON DELETE SET NULL, telegram_chat_id text, ip text);
        CREATE TABLE preview_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_session_id uuid, example_phrase text);
        CREATE TABLE custom_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid REFERENCES sessions ON DELETE CASCADE, amount numeric);
        CREATE TABLE preview_assets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
        INSERT INTO preview_assets(name) VALUES ('Shared catalog');`);
    const migration = fs.readFileSync(path.join(__dirname, '../telegram_blocked_leads_migration.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration); // idempotent installation
    const original = (await db.query(`INSERT INTO sessions(telegram_chat_id,user_name,lead_memory,total_paid) VALUES ('123','Private name','{"notes":["private"]}',100) RETURNING id`)).rows[0].id;
    const other = (await db.query(`INSERT INTO sessions(telegram_chat_id,user_name) VALUES ('999','Other lead') RETURNING id`)).rows[0].id;
    await db.query(`INSERT INTO messages(session_id,content) VALUES ($1,'Private history'),($2,'Keep me')`, [original,other]);
    await db.query(`INSERT INTO lead_events(session_id) VALUES ($1)`, [original]);
    await db.query(`INSERT INTO lead_redirects(session_id,telegram_chat_id,ip) VALUES ($1,'123','private'),(NULL,'123','private')`, [original]);
    await db.query(`INSERT INTO preview_requests(source_session_id,example_phrase) VALUES ($1,'private')`, [original]);
    await db.query(`INSERT INTO custom_orders(session_id,amount) VALUES ($1,100)`, [original]);
    const apply = async (blocked,time,id) => (await db.query(`SELECT apply_telegram_membership('123',$1,$2,$3) AS applied`,[blocked,time,id])).rows[0].applied;
    assert.equal(await apply(true,'2026-09-08T12:00:00Z',10),true);
    const tombstone = (await db.query(`SELECT * FROM sessions WHERE telegram_chat_id='123'`)).rows[0];
    assert.equal(tombstone.status,'blocked'); assert.notEqual(tombstone.id,original);
    assert.equal(tombstone.user_name,null); assert.deepEqual(tombstone.lead_memory,{}); assert.equal(Number(tombstone.total_paid),0);
    for (const table of ['lead_events','lead_redirects','preview_requests','custom_orders']) assert.equal((await db.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count,0,table);
    assert.deepEqual((await db.query('SELECT content FROM messages')).rows,[{content:'Keep me'}]);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM preview_assets')).rows[0].count,1);
    assert.equal(await apply(true,'2026-09-08T12:00:00Z',10),false,'duplicate delivery');
    assert.equal(await apply(false,'2026-09-08T11:00:00Z',9),false,'old unblock');
    await assert.rejects(db.query(`INSERT INTO messages(session_id,content) VALUES ($1,'stale worker')`,[original]), /Lead unavailable|foreign key/);
    await assert.rejects(db.query(`INSERT INTO preview_requests(source_session_id) VALUES ($1)`,[original]), /Lead unavailable/);
    await assert.rejects(db.query(`INSERT INTO messages(session_id,content) VALUES ($1,'admin send')`,[tombstone.id]), /Lead unavailable/);
    await db.query(`UPDATE sessions SET status='active',lead_memory='{"notes":["stale"]}' WHERE id=$1`,[tombstone.id]);
    assert.equal((await db.query(`SELECT status FROM sessions WHERE id=$1`,[tombstone.id])).rows[0].status,'blocked');
    assert.equal(await apply(false,'2026-09-08T12:00:00Z',11),true,'same-second unblock order');
    assert.equal((await db.query(`SELECT status FROM sessions WHERE telegram_chat_id='123'`)).rows[0].status,'closed');
    assert.equal(await apply(true,'2026-09-08T12:00:00Z',10),false,'stale block cannot erase reopened contact');
    await db.exec(`SET ROLE anon`);
    await assert.rejects(apply(true,'2026-09-08T13:00:00Z',12),/permission denied/);
    await db.exec(`RESET ROLE`);
    // Any cleanup error rolls back ALL deleted records and the status change.
    await db.query(`INSERT INTO messages(session_id,content) VALUES ($1,'rollback evidence')`,[tombstone.id]);
    await db.exec(`CREATE FUNCTION fail_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$;
        CREATE TRIGGER fail_cleanup BEFORE DELETE ON sessions FOR EACH ROW EXECUTE FUNCTION fail_cleanup();`);
    await assert.rejects(apply(true,'2026-09-08T13:00:00Z',12),/test failure/);
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM messages WHERE session_id=$1`,[tombstone.id])).rows[0].count,1);
    await db.close();

    const calls=[];
    const mod={exports:{}};
    const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/telegramMembership.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const mockDb={ rpc: async (...args) => { calls.push(args); return {data:true,error:null}; } };
    new Function('require','module','exports',code)(name=>name==='@/lib/supabaseServer'?{supabaseServer:mockDb}:require(name),mod,mod.exports);
    const api=mod.exports;
    const blocked={response:{error_code:403,description:'Forbidden: bot was blocked by the user'}};
    assert(api.isTelegramBlockedError(blocked));
    for(const e of [new Error('403'),{response:{error_code:403,description:'user is deactivated'}},{response:{error_code:429,description:'bot was blocked by the user'}}]) assert(!api.isTelegramBlockedError(e));
    const token='123:test-token'; const secret=api.telegramWebhookSecret(token);
    assert(api.validTelegramWebhookSecret(secret,token)); assert(!api.validTelegramWebhookSecret(null,token)); assert(!api.validTelegramWebhookSecret('bad',token));
    assert(!api.validTelegramWebhookSecret('é'.repeat(64),token));
    const originalFetch=global.fetch;
    try {
        global.fetch=async()=>({json:async()=>({ok:true,result:{status:'member'}})});
        await api.handleTelegramBlockedError(token,'123',blocked,'2026-09-08T12:00:00Z'); assert.equal(calls.length,0,'unblock won the race');
        global.fetch=async()=>({json:async()=>({ok:true,result:{status:'kicked'}})});
        await api.handleTelegramBlockedError(token,'123',blocked,'2026-09-08T12:00:00.900Z'); assert.equal(calls.length,1);
        assert.equal(calls[0][1].p_event_at, '2026-09-08T12:00:00.000Z');
        global.fetch=async()=>({json:async()=>({ok:false})});
        await assert.rejects(api.handleTelegramBlockedError(token,'123',blocked,'2026-09-08T12:00:00Z')); assert.equal(calls.length,1);
    } finally { global.fetch=originalFetch; }
    console.log('TELEGRAM_BLOCKED_LEADS_OK cleanup=atomic isolation=passed retries=passed stale_writes=blocked unblock=passed auth=passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
