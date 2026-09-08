const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createClient } = require('@supabase/supabase-js');

async function main() {
    // Exercise the actual dashboard query through the installed Supabase SDK.
    const source = fs.readFileSync('src/app/admin/page.tsx', 'utf8');
    const query = source.match(/await supabase\.from\("sessions"\)[\s\S]*?\.range\(offset, offset \+ batchSize - 1\)/)[0];
    const requests = [];
    const client = createClient('https://fixture.invalid', 'fixture-key', {
        auth: { persistSession: false },
        global: { fetch: async (input) => {
            const url = new URL(input);
            requests.push(url);
            const p = url.searchParams;
            assert.equal(p.get('last_message.limit'), '1');
            assert.equal(p.get('latest_step.limit'), '1');
            assert.equal(p.get('last_message.order'), 'created_at.desc');
            assert.equal(p.get('last_message.sender'), 'in.(user,bot,admin)');
            assert.equal(p.get('latest_step.order'), 'created_at.desc');
            assert.equal(p.get('limit'), '500');
            assert.equal(p.has('session_id'), false, 'No URL containing hundreds of lead IDs');
            assert.ok(p.get('select').includes('last_message:messages('));
            assert.ok(p.get('select').includes('latest_step:funnel_events('));
            return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });
        } },
    });
    const run = new Function('supabase', 'offset', 'batchSize', `return (async () => ${query})();`);
    assert.equal((await run(client, 0, 500)).error, null);
    assert.equal((await run(client, 500, 500)).error, null);
    assert.equal(requests[1].searchParams.get('offset'), '500', 'Pagination must move past first batch');
    assert.ok(requests.every((url) => url.href.length < 1000));
    console.log('PASS: embedded per-lead limits, visible senders, stable pagination and bounded request size');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
