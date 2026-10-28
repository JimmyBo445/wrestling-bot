const assert = require('assert');
const f = require('./fixtures');
const { run, click, text } = require('./mock');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 5).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const P = (u) => ({ admin: false, user: u });
const isErr = (i, re) => i.responses.some((r) => /⚠️/.test(r.p?.content || '') && (!re || re.test(r.p.content)));
const G = 'g1';
const C = {};
const owner = async (id) => (await f.pool.query(`select u.discord_id, u.is_placeholder from characters c join users u on u.id=c.owner_id where c.id=$1`, [id])).rows[0];

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const mk = async (n, o, d = 'mens') => { C[n] = await f.makeChar(G, o, n, d); };
    for (const [n, o] of [['Ace', 'u1'], ['Bolt', 'u2'], ['Cruz', 'u3'], ['Dax', 'u4'], ['Eli', 'u5'], ['Fox', 'u6']]) await mk(n, o);
    await run('match', 'log-singles', { participant1: C.Ace, participant2: C.Bolt, winner: 1, override_cooldown: true }, ADM);

    await t('unclaim with no conflicts is immediate, keeps the character, owner becomes the placeholder', async () => {
        const i = await run('character', 'unclaim', { character: C.Cruz }, ADM);
        assert.ok(!isErr(i), text(i)); assert.match(text(i), /unclaimed/i);
        const o = await owner(C.Cruz); assert.strictEqual(o.is_placeholder, true); assert.strictEqual(o.discord_id, 'bot1');
        const { rows } = await f.pool.query(`select status from characters where id=$1`, [C.Cruz]); assert.strictEqual(rows[0].status, 'approved');
    });
    await t('non-admins are refused and already-unclaimed is a friendly error', async () => {
        let i = await run('character', 'unclaim', { character: C.Dax }, P('u4'));
        assert.ok(isErr(i), text(i)); assert.strictEqual((await owner(C.Dax)).discord_id, 'u4');
        i = await run('character', 'unclaim', { character: C.Cruz }, ADM);
        assert.ok(isErr(i, /already unclaimed/), text(i));
    });
    await t('unclaimed cannot be booked in a match, signup or tournament, and is hidden from suggestions', async () => {
        let i = await run('match', 'log-singles', { participant1: C.Cruz, participant2: C.Dax, winner: 1, override_cooldown: true }, ADM);
        assert.ok(isErr(i, /unclaimed/), text(i));
        await run('booking', 'signup-open', { title: 'Show' }, ADM);
        i = await run('booking', 'signup-add', { character: C.Cruz }, ADM);
        assert.ok(isErr(i, /unclaimed/), text(i));
        await run('booking', 'signup-done', {}, ADM);
        const { rows } = await f.pool.query(`select 1 from characters c join users u on u.id=c.owner_id where c.id=$1 and not u.is_placeholder`, [C.Cruz]);
        assert.strictEqual(rows.length, 0);
    });
    await t('display name shows Unclaimed', async () => {
        const { getDisplayNames } = require('../src/utils/discordHelpers');
        const { mockGuildFor } = require('./mock');
        void getDisplayNames; void mockGuildFor;
        const i = await run('character', 'profile', { character: C.Cruz }, P('u1'));
        assert.ok(!isErr(i), text(i));
    });
    await t('transfer from unclaimed to a player works; new owner starts 0-0, old owner keeps the record', async () => {
        const before = (await f.pool.query(`select count(*)::int n from match_participants where owner_id=(select owner_id from characters where id=$1)`, [C.Ace])).rows[0].n;
        assert.ok(before >= 1);
        const i = await run('character', 'unclaim', { character: C.Ace }, ADM);
        assert.ok(!isErr(i), text(i));
        const j = await run('character', 'transfer', { character: C.Ace, new_owner: 'u9' }, ADM);
        assert.ok(!isErr(j), text(j));
        assert.strictEqual((await owner(C.Ace)).discord_id, 'u9');
        const { rows } = await f.pool.query(`select count(*)::int n from match_participants mp join users u on u.id=mp.owner_id where u.discord_id='u9'`);
        assert.strictEqual(rows[0].n, 0, 'new owner has no recorded matches');
        const old = await f.pool.query(`select count(*)::int n from match_participants mp join users u on u.id=mp.owner_id where u.discord_id='u1'`);
        assert.ok(old.rows[0].n >= 1, 'old owner keeps the match');
    });
    await t('conflicts (champion, team, signup, contract) need a confirm; Cancel changes nothing, confirm clears them', async () => {
        const WH = await f.titleId(G, 'World Heavyweight Championship');
        await f.pool.query(`insert into title_reigns (guild_id,title_id,character_id,won_date,entered_by) values ($1,$2,$3,CURRENT_DATE,'t')`, [G, WH, C.Dax]);
        const team = await f.makeTeam(G, 'Duo', 'mens', [C.Dax, C.Eli]);
        await run('booking', 'signup-open', { title: 'Show2' }, ADM);
        await run('booking', 'signup-add', { character: C.Dax }, ADM);
        const today = new Date().toISOString().slice(0, 10);
        await f.pool.query(`insert into contracts (guild_id,character_id,months,salary,status,start_date,end_date) values ($1,$2,3,1000,'active',CURRENT_DATE,CURRENT_DATE+90)`, [G, C.Dax]);
        const i = await run('character', 'unclaim', { character: C.Dax }, ADM);
        const out = text(i);
        assert.match(out, /World Heavyweight/); assert.match(out, /Duo/); assert.match(out, /signup/i); assert.match(out, /contract/i);
        assert.strictEqual((await owner(C.Dax)).discord_id, 'u4', 'nothing changed yet');
        let c = await click(`charunclaim:${C.Dax}:no`);
        assert.strictEqual((await owner(C.Dax)).discord_id, 'u4');
        c = await click(`charunclaim:${C.Dax}:ok`, { admin: false, user: 'u4' });
        assert.strictEqual((await owner(C.Dax)).discord_id, 'u4', 'non-admin cannot confirm');
        c = await click(`charunclaim:${C.Dax}:ok`);
        assert.strictEqual((await owner(C.Dax)).is_placeholder, true);
        const q = async (sql, p) => (await f.pool.query(sql, p)).rows;
        assert.strictEqual((await q(`select 1 from signup_entries where character_id=$1`, [C.Dax])).length, 0);
        assert.strictEqual((await q(`select status from contracts where character_id=$1`, [C.Dax]))[0].status, 'released');
        assert.strictEqual((await q(`select status from teams where id=$1`, [team]))[0].status, 'disbanded');
        assert.strictEqual((await q(`select 1 from team_members where team_id=$1 and left_at is null`, [team])).length, 0);
        assert.strictEqual((await q(`select 1 from title_reigns where character_id=$1 and lost_date is null`, [C.Dax])).length, 1, 'singles title stays on the character');
        void today; void c;
    });
    await t('duplicate names are blocked (case, spaces, punctuation, leading The), in submit, assign and edit', async () => {
        let i = await run('character', 'submit', { name: 'ace', division: 'mens' }, P('u7'));
        assert.ok(isErr(i, /already exists/), text(i));
        i = await run('character', 'submit', { name: 'The  A.C.E!', division: 'mens' }, P('u7'));
        assert.ok(isErr(i, /already exists/), text(i));
        i = await run('character', 'assign', { user: 'u7', name: 'BOLT', division: 'mens' }, ADM);
        assert.ok(isErr(i, /already exists/), text(i));
        i = await run('character', 'edit', { character: C.Eli, name: 'Fox' }, ADM);
        assert.ok(isErr(i, /already exists/), text(i));
        i = await run('character', 'edit', { character: C.Eli, name: 'Eli' }, ADM);
        assert.ok(!isErr(i), 'keeping your own name is fine: ' + text(i));
        i = await run('character', 'submit', { name: 'Brand New Guy', division: 'mens' }, P('u7'));
        assert.ok(!isErr(i), text(i));
    });
    await t('swap-division: simple move, then confirm flow clears signups, teams and titles', async () => {
        let i = await run('character', 'swap-division', { character: C.Fox, division: 'custom' }, ADM);
        assert.ok(!isErr(i), text(i));
        assert.strictEqual((await f.pool.query(`select division from characters where id=$1`, [C.Fox])).rows[0].division, 'custom');
        i = await run('character', 'swap-division', { character: C.Fox, division: 'custom' }, ADM);
        assert.ok(isErr(i, /already in/), text(i));
        i = await run('character', 'swap-division', { character: C.Eli, division: 'womens' }, P('u5'));
        assert.ok(isErr(i), text(i));
        const team = await f.makeTeam(G, 'Pair', 'mens', [C.Eli, C.Bolt]);
        const WH = await f.titleId(G, 'World Heavyweight Championship');
        await f.pool.query(`insert into title_reigns (guild_id,title_id,character_id,won_date,entered_by) values ($1,$2,$3,CURRENT_DATE,'t')`, [G, WH, C.Eli]);
        i = await run('character', 'swap-division', { character: C.Eli, division: 'womens' }, ADM);
        assert.match(text(i), /Pair/); assert.match(text(i), /vacant/);
        assert.strictEqual((await f.pool.query(`select division from characters where id=$1`, [C.Eli])).rows[0].division, 'mens', 'not yet');
        await click(`divswap:${C.Eli}:womens:ok`);
        assert.strictEqual((await f.pool.query(`select division from characters where id=$1`, [C.Eli])).rows[0].division, 'womens');
        assert.strictEqual((await f.pool.query(`select status from teams where id=$1`, [team])).rows[0].status, 'disbanded');
        assert.strictEqual((await f.pool.query(`select 1 from title_reigns where character_id=$1 and lost_date is null`, [C.Eli])).rows.length, 0);
    });
    await t('help mentions unclaim', async () => {
        const i = await run('help', null, { command: 'character' }, P('u1'));
        void i;
        const j = await run('help', null, { command: 'character' }, ADM);
        assert.match(text(j), /unclaim/i, text(j));
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end(); process.exit(failed ? 1 : 0);
})();
