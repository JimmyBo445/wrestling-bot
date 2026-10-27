const assert = require('assert');
const f = require('./fixtures');
const { run, text } = require('./mock');

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

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const mk = async (n, o, d = 'mens') => { C[n] = await f.makeChar(G, o, n, d); };
    await mk('Ace', 'u1'); await mk('Bolt', 'u2'); await mk('Cruz', 'u3');
    await run('match', 'log-singles', { participant1: C.Ace, participant2: C.Bolt, winner: 1, override_cooldown: true }, ADM);
    const WH = await f.titleId(G, 'World Heavyweight Championship');
    const counts = async () => (await f.pool.query(`select (select count(*) from characters) c, (select count(*) from matches) m, (select count(*) from title_reigns) r`)).rows[0];
    const before = await counts();

    await t('standings: leaderboard, rankings and season work; the old command names are gone', async () => {
        let i = await run('standings', 'leaderboard', {}, P('u1'));
        assert.ok(i.responses.length, 'leaderboard answered'); assert.ok(!isErr(i), text(i));
        i = await run('standings', 'rankings', { division: 'mens' }, P('u1'));
        assert.ok(i.responses.length && !isErr(i), text(i));
        i = await run('standings', 'season-standings', {}, P('u1'));
        assert.match(text(i), /Ace|season|Season|No matches/i, text(i));
        const { loadCommandData } = require('../src/registerCommands');
        const names = loadCommandData().map((c) => c.name);
        for (const gone of ['leaderboard', 'rankings', 'season', 'roster', 'halloffame', 'injury', 'contender', 'matchmaking', 'signup', 'newsletter', 'report']) assert.ok(!names.includes(gone), `${gone} should be gone`);
        assert.strictEqual(names.length, 15, names.join(' '));
    });
    await t('directory: roster, injuries and hall of fame, with admin gates kept', async () => {
        let i = await run('directory', 'roster', { division: 'mens' }, P('u1'));
        assert.ok(i.responses.length && !isErr(i), text(i));
        i = await run('directory', 'injury-add', { character: C.Ace, days: 3 }, P('u1'));
        assert.ok(isErr(i, /Only admins/), text(i));
        i = await run('directory', 'injury-add', { character: C.Ace, days: 3, reason: 'sore' }, ADM);
        assert.ok(!isErr(i), text(i));
        i = await run('directory', 'injury-list', {}, P('u1'));
        assert.match(text(i), /Ace/, text(i));
        i = await run('directory', 'injury-clear', { character: C.Ace }, ADM);
        assert.ok(!isErr(i), text(i));
        i = await run('directory', 'hof-induct', { character: C.Bolt, blurb: 'A legend' }, P('u1'));
        assert.ok(isErr(i, /Only admins/), text(i));
        i = await run('directory', 'hof-induct', { character: C.Bolt, blurb: 'A legend' }, ADM);
        assert.ok(!isErr(i), text(i));
        i = await run('directory', 'hof-list', {}, P('u1'));
        assert.match(text(i), /Bolt/, text(i));
    });
    await t('booking: suggestions for players, signups for admins only', async () => {
        let i = await run('booking', 'suggest', { character: C.Ace }, P('u1'));
        assert.match(text(i), /Fresh matchups/, text(i));
        i = await run('booking', 'signup-open', { title: 'Show' }, P('u1'));
        assert.ok(isErr(i, /Only admins/), text(i));
        i = await run('booking', 'signup-open', { title: 'Show' }, ADM);
        assert.match(text(i), /is open/, text(i));
        i = await run('booking', 'signup-list', {}, ADM);
        assert.ok(!isErr(i), text(i));
        i = await run('signup', 'list', {}, P('u1'));
        assert.ok(isErr(i, /Only admins/), text(i));
        i = await run('booking', 'suggest', { character: C.Ace }, P('u1'));
        assert.ok(isErr(i, /Nobody else has signed up/), text(i));
        i = await run('booking', 'suggest', { character: C.Ace, include_everyone: true }, P('u1'));
        assert.match(text(i), /Fresh matchups/, text(i));
        await run('booking', 'signup-done', {}, ADM);
        i = await run('booking', 'suggest', { character: C.Ace }, P('u1'));
        assert.match(text(i), /Fresh matchups/, text(i));
    });
    await t('championship contender-* works and keeps its admin gates', async () => {
        let i = await run('championship', 'contender-list', {}, P('u1'));
        assert.ok(i.responses.length && !isErr(i), text(i));
        i = await run('championship', 'contender-award', { title: WH, character: C.Cruz }, P('u1'));
        assert.ok(isErr(i, /Only admins/), text(i));
        i = await run('championship', 'contender-award', { title: WH, character: C.Cruz }, ADM);
        assert.ok(!isErr(i), text(i));
        i = await run('championship', 'contender-list', {}, P('u1'));
        assert.match(text(i), /Cruz/, text(i));
        i = await run('championship', 'list', {}, P('u1'));
        assert.ok(i.responses.length && !isErr(i), 'original championship commands still work');
    });
    await t('admin report and newsletter group work, admins only', async () => {
        let i = await run('admin', 'report', {}, ADM);
        assert.match(text(i), /staff report/i, text(i));
        i = await run('admin', 'report', {}, P('u1'));
        assert.ok(isErr(i, /Only admins/), text(i));
        i = await run('admin', 'add', { text: 'Big news' }, { ...ADM, group: 'newsletter' });
        assert.ok(!isErr(i), text(i));
        i = await run('admin', 'list', {}, { ...ADM, group: 'newsletter' });
        assert.match(text(i), /Big news/, text(i));
        i = await run('admin', 'list', {}, { ...P('u1'), group: 'newsletter' });
        assert.ok(isErr(i, /Only admins/), text(i));
        i = await run('admin', 'settings', {}, ADM);
        assert.ok(!isErr(i), 'original admin commands still work');
    });
    await t('nothing in the database changed from using combined commands', async () => {
        const after = await counts();
        assert.deepStrictEqual(after, before);
    });
    await t('help shows the combined commands, hides moved names from the overview, and explains them', async () => {
        const a = await run('help', null, {}, ADM);
        const tx = text(a);
        assert.match(tx, /\/standings/); assert.match(tx, /\/booking/); assert.match(tx, /\/directory/);
        assert.ok(!/\/leaderboard( 🔒)?:/.test(tx) && !/\/injury( 🔒)?:/.test(tx), tx);
        assert.match(tx, /contender-challenge/); assert.match(tx, /newsletter add/);
        const m = await run('help', null, { command: 'injury' }, ADM);
        assert.match(text(m), /merged into a combined command/, text(m)); assert.match(text(m), /\/directory injury-list/, text(m));
        const p = await run('help', null, {}, P('u1'));
        assert.ok(!/signup-open/.test(text(p)), 'players do not see admin-only booking subcommands');
        assert.match(text(p), /suggest/);
    });
    await t('every command definition is valid and the new ones are not too big', async () => {
        const { loadCommandData } = require('../src/registerCommands');
        const all = loadCommandData();
        const names = all.map((c) => c.name);
        assert.strictEqual(new Set(names).size, names.length, 'duplicate command names');
        for (const n of ['standings', 'directory', 'booking']) assert.ok(names.includes(n));
        for (const c of all) assert.ok((c.options || []).length <= 25, c.name);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end(); process.exit(failed ? 1 : 0);
})();
