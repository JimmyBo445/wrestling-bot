const assert = require('assert');
const f = require('./fixtures');
const { run, auto, text } = require('./mock');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok  ', name); } catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); } }
(async () => {
    await f.resetDb();
    await t('/help for a player hides admin-only commands and admin subcommands', async () => {
        const i = await run('help', null, {}, { admin: false, user: 'u1' });
        const t1 = text(i);
        assert.match(t1, /\/character/); assert.match(t1, /\/stats/);
        // 3.7: players see /match, but only `report`
        assert.match(t1, /\/match/); assert.match(t1, /`report`/); assert.doesNotMatch(t1, /`undo`/);
        assert.doesNotMatch(t1, /\/card/); assert.doesNotMatch(t1, /\/admin/);
        assert.doesNotMatch(t1, /`assign`/, 'no admin-only subcommands');
        assert.ok(i.responses[0].p.flags & 64, 'private');
    });
    await t('/help for an admin shows everything with lock markers', async () => {
        const i = await run('help', null, {}, { admin: true });
        const t1 = text(i);
        for (const c of ['/character', '/team', '/match', '/card', '/admin', '/championship', '/standings']) assert.ok(t1.includes(c), c);
        assert.match(t1, /🔒/);
        const e = i.responses[0].p.embeds[0].data;
        assert.ok(e.fields.length <= 25);
        assert.ok(JSON.stringify(e).length < 6000, `embed size ${JSON.stringify(e).length}`);
    });
    await t('/help command:match lists the subcommands', async () => {
        const i = await run('help', null, { command: 'match' }, { admin: true });
        assert.match(text(i), /\/match log\b/); assert.ok(!/\/match log-singles/.test(text(i)), 'retired in 3.5'); assert.doesNotMatch(text(i), /\/match undo/, '3.9: undo is a button under the result');
        const p = await run('help', null, { command: 'match' }, { admin: false, user: 'u1' });
        assert.match(text(p), /\/match report/); assert.ok(!/\/match undo/.test(text(p)), 'players only see report');
        const slash = await run('help', null, { command: '/card' }, { admin: true });
        assert.match(text(slash), /\/card view/); assert.match(text(slash), /\/card add/); assert.doesNotMatch(text(slash), /\/card auto/, "3.8: /card auto is a button now");
    });
    await t('autocomplete suggests command names', async () => {
        const r = await auto('help', null, 'command', 'ma', {}, { admin: true });
        assert.ok(r.some((c) => c.value === 'match'), JSON.stringify(r));
        const pl = await auto('help', null, 'command', 'ma', {}, { admin: false, user: 'u1' });
        assert.deepStrictEqual(pl.map((c) => c.value), ['match'], '3.7: players can use /match report');
    });
    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end(); process.exit(failed ? 1 : 0);
})();
