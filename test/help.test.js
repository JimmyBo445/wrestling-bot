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
        assert.doesNotMatch(t1, /\/match\b/, 'no /match for players');
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
        assert.match(text(i), /\/match log-singles/); assert.match(text(i), /\/match undo/);
        const p = await run('help', null, { command: 'match' }, { admin: false, user: 'u1' });
        assert.match(text(p), /don't have a `\/match` command/);
        const slash = await run('help', null, { command: '/card' }, { admin: true });
        assert.match(text(slash), /\/card auto/);
    });
    await t('autocomplete suggests command names', async () => {
        const r = await auto('help', null, 'command', 'ma', {}, { admin: true });
        assert.ok(r.some((c) => c.value === 'match'), JSON.stringify(r));
        const pl = await auto('help', null, 'command', 'ma', {}, { admin: false, user: 'u1' });
        assert.deepStrictEqual(pl.map((c) => c.value), []);
    });
    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end(); process.exit(failed ? 1 : 0);
})();
