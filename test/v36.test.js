// 2.18.0: title history import links reigns to characters; the history channel names the character
const assert = require('assert');
const f = require('./fixtures');
const { run, text } = require('./mock');
const importer = require('../src/utils/importer');
const history = require('../src/utils/historyChannel');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 5).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const G = 'g1';
const q = async (sql, a) => (await f.pool.query(sql, a)).rows;
const att = { name: 'titles.csv', size: 100, url: 'https://cdn.discordapp.com/t.csv', contentType: 'text/csv' };
const J = '900000000000000011', K = '900000000000000012';
const csv = (lines) => { importer.downloadCsv = async () => ['title,holder,members,character,won,lost,defenses,notes', ...lines].join('\n'); };
const credit = async (reignId) => (await q(`select u.discord_id from reign_owners ro join users u on u.id=ro.user_id where ro.reign_id=$1 order by 1`, [reignId])).map((r) => r.discord_id);
// the same count a character's profile shows
const profileReigns = async (charId) => (await q(
    `SELECT COUNT(DISTINCT tr.id)::int AS n FROM title_reigns tr
     WHERE (tr.team_id IS NULL AND tr.character_id = $1) OR EXISTS (SELECT 1 FROM title_reign_members m WHERE m.reign_id = tr.id AND m.character_id = $1)`, [charId]))[0].n;

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const ACE = await f.makeChar(G, J, 'Ace Blackout', 'custom');
    const LIV = await f.makeChar(G, J, 'Liv Morgan', 'womens');
    const KAI = await f.makeChar(G, K, 'Kai Storm', 'womens');
    const SHOW = await f.titleId(G, 'Showtime Championship');
    const WTAG = await f.titleId(G, "Women's Tag Team Championship");

    await t('a line with a character links the reign, so it counts on the character\'s profile', async () => {
        assert.strictEqual(await profileReigns(ACE), 0);
        csv([`Showtime Championship,Jimmy Uso | Liv Morgan | Ace Blackout,${J},Ace Blackout,9/8/26,,1,`]);
        const i = await run('admin', 'import', { what: 'titles', file: att, apply: true }, ADM);
        assert.match(text(i), /Imported \*\*1\*\* reign/);
        const r = (await q('select id, character_id from title_reigns where title_id=$1', [SHOW]))[0];
        assert.strictEqual(String(r.character_id), ACE);
        assert.deepStrictEqual(await credit(r.id), [J]);
        assert.strictEqual(await profileReigns(ACE), 1);
    });

    await t('re-importing an old reign with the character filled in links it, and changes nothing else', async () => {
        csv([`Showtime Championship,Jimmy Uso | Liv Morgan | Ace Blackout,${J},,6/29/26,8/17/26,0,`]);
        await run('admin', 'import', { what: 'titles', file: att, apply: true }, ADM);
        assert.strictEqual(await profileReigns(ACE), 1);
        csv([`Showtime Championship,Jimmy Uso | Liv Morgan | Ace Blackout,${J},Ace Blackout,6/29/26,8/17/26,0,`,
            `Showtime Championship,Jimmy Uso | Liv Morgan | Ace Blackout,${J},Ace Blackout,9/8/26,,1,`]);
        let i = await run('admin', 'import', { what: 'titles', file: att }, ADM);
        assert.match(text(i), /Will link the character on \*\*1\*\* reign/);
        assert.strictEqual(await profileReigns(ACE), 1, 'preview saves nothing');
        i = await run('admin', 'import', { what: 'titles', file: att, apply: true }, ADM);
        assert.match(text(i), /Linked the character on \*\*1\*\* reign/);
        assert.match(text(i), /No new reigns to add/);
        assert.match(text(i), /1 reign\(s\) were already in the bot/);
        assert.strictEqual(await profileReigns(ACE), 2);
        const r = (await q(`select id, defenses, lost_date::text l from title_reigns where title_id=$1 and won_date='2026-06-29'`, [SHOW]))[0];
        assert.strictEqual(r.defenses, 0);
        assert.strictEqual(r.l, '2026-08-17');
        assert.deepStrictEqual(await credit(r.id), [J]);
    });

    await t('credit stays with the player who won it, even if the character belongs to someone else now', async () => {
        const kOwner = (await q(`select id from users where discord_id=$1`, [K]))[0].id;
        await q('update characters set owner_id=$1 where id=$2', [kOwner, ACE]);
        csv([`Showtime Championship,Jimmy Uso | Liv Morgan | Ace Blackout,${J},Ace Blackout,1/1/26,2/1/26,0,`]);
        await run('admin', 'import', { what: 'titles', file: att, apply: true }, ADM);
        const r = (await q(`select id from title_reigns where title_id=$1 and won_date='2026-01-01'`, [SHOW]))[0];
        assert.deepStrictEqual(await credit(r.id), [J]);
        const jOwner = (await q(`select id from users where discord_id=$1`, [J]))[0].id;
        await q('update characters set owner_id=$1 where id=$2', [jOwner, ACE]);
    });

    await t('tag reigns link every character listed', async () => {
        csv([`Women's Tag Team Championship,Storm Front,${J} ${K},Liv Morgan & Kai Storm,3/1/26,4/1/26,2,`]);
        await run('admin', 'import', { what: 'titles', file: att, apply: true }, ADM);
        assert.strictEqual(await profileReigns(LIV), 1);
        assert.strictEqual(await profileReigns(KAI), 1);
        const r = (await q('select id from title_reigns where title_id=$1', [WTAG]))[0];
        assert.deepStrictEqual(await credit(r.id), [J, K]);
    });

    await t('an unknown character is reported, and the reign is still added without one', async () => {
        csv([`Women's Tag Team Championship,Ghosts,${J},Nobody Here,5/1/26,6/1/26,0,`]);
        const i = await run('admin', 'import', { what: 'titles', file: att, apply: true }, ADM);
        assert.match(text(i), /don't know a wrestler called "Nobody Here"\. The reign is still added/);
        assert.strictEqual((await q(`select count(*)::int n from title_reigns where reign_char_name='Ghosts'`))[0].n, 1);
    });

    await t('the history channel groups by player and names the character on each reign', async () => {
        const all = (await history.renderHistory(G)).join('\n');
        assert.match(all, /3x <@900000000000000011>\n\*1st Reign - 0 Defenses\* · Ace Blackout\n1\/1\/26-2\/1\/26/);
        assert.match(all, /\*3rd Reign - 1 Defense\* · Ace Blackout\n9\/8\/26-\n/);
        assert.match(all, /1x Storm Front\n\*1st Reign - 2 Defenses\*\n\( <@900000000000000011> and <@900000000000000012> \) · Liv Morgan & Kai Storm/);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end();
    process.exit(failed ? 1 : 0);
})();
