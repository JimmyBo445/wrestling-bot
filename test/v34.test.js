const assert = require('assert');
const f = require('./fixtures');
const { run, text } = require('./mock');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 5).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const isErr = (i) => i.responses.some((r) => /⚠️/.test(r.p?.content || ''));
const G = 'g1';
const C = {};
const q = async (sql, a) => (await f.pool.query(sql, a)).rows;
const credited = async (titleId) => (await q(`select u.discord_id from reign_owners ro join users u on u.id=ro.user_id join title_reigns tr on tr.id=ro.reign_id where tr.title_id=$1 order by tr.id, 1`, [titleId])).map((r) => r.discord_id);

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    for (const [n, o] of [['Ace', 'u1'], ['Bolt', 'u2'], ['Cruz', 'u3'], ['Dax', 'u4'], ['Eli', 'u5']]) C[n] = await f.makeChar(G, o, n);
    const WH = await f.titleId(G, 'World Heavyweight Championship');
    const US = await f.titleId(G, 'United States Championship');
    const TAG = await f.titleId(G, "Men's Tag Team Championship");
    const T1 = await f.makeTeam(G, 'Alpha', 'mens', [C.Ace, C.Bolt]);

    await t('a singles reign credits the wrestler\'s player; tag reigns credit both players', async () => {
        await run('reign', 'add', { title: WH, won_date: '2026-01-01', character: C.Ace }, ADM);
        assert.deepStrictEqual(await credited(WH), ['u1']);
        await run('reign', 'add', { title: TAG, won_date: '2026-01-01', team: T1 }, ADM);
        assert.deepStrictEqual(await credited(TAG), ['u1', 'u2']);
    });
    await t('transferring the character does not move the credit; the new champion\'s player gets their own', async () => {
        await run('character', 'transfer', { character: C.Ace, new_owner: 'u9' }, ADM);
        assert.deepStrictEqual(await credited(WH), ['u1']);
        let i = await run('title', 'match', { title: WH, challenger: C.Cruz, winner: 2 }, ADM);
        assert.ok(!isErr(i), text(i));
        assert.deepStrictEqual(await credited(WH), ['u1', 'u3']);
    });
    await t('editing the holder of a reign re-credits it', async () => {
        await run('reign', 'add', { title: US, won_date: '2026-02-01', character: C.Dax }, ADM);
        const [r] = await q(`select id from title_reigns where title_id=$1`, [US]);
        assert.deepStrictEqual(await credited(US), ['u4']);
        const i = await run('reign', 'edit', { title: US, reign: Number(r.id), character: C.Eli }, ADM);
        assert.ok(!isErr(i), text(i));
        assert.deepStrictEqual(await credited(US), ['u5']);
    });
    await t('unclaimed wrestlers earn no player credit', async () => {
        await run('character', 'unclaim', { character: C.Eli }, ADM);
        await run('reign', 'add', { title: US, won_date: '2026-03-01', character: C.Eli }, ADM).catch(() => {});
        const rows = await q(`select u.is_placeholder from reign_owners ro join users u on u.id=ro.user_id`);
        assert.ok(rows.every((r) => !r.is_placeholder));
    });
    await t('/stats user shows championships; /stats champions ranks players; history says who played', async () => {
        let i = await run('stats', 'user', { user: 'u1', text: true }, { admin: false, user: 'u7' });
        assert.ok(!isErr(i), text(i)); assert.match(text(i), /Championships/); assert.match(text(i), /Men's Tag/);
        i = await run('stats', 'champions', {}, { admin: false, user: 'u7' });
        assert.match(text(i), /<@u1>/); assert.match(text(i), /<@u3>/);
        i = await run('championship', 'history', { title: WH }, { admin: false, user: 'u7' });
        assert.match(text(i), /played by <@u1>/);
        i = await run('stats', 'user', { user: 'u1' }, { admin: false, user: 'u7' });
        assert.ok(!isErr(i));
    });
    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end();
    process.exit(failed ? 1 : 0);
})();
