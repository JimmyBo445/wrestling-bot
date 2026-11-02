// 2.21.0: Legacy accolades, per-belt championships on the cards, the record book
const assert = require('assert');
const f = require('./fixtures');
const { run, auto, click, text, sent } = require('./mock');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 5).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const PLAYER = { admin: false, user: 'u9' };
const G = 'g1';
const q = async (sql, a) => (await f.pool.query(sql, a)).rows;
const isErr = (i) => i.responses.some((r) => /⚠️/.test(r.p?.content || ''));
const ids = (i) => JSON.stringify((i.responses.at(-1)?.p?.components || []).map((r) => (r.toJSON ? r.toJSON() : r)));

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const ACE = await f.makeChar(G, 'u1', 'Ace Blackout', 'custom');
    const LIV = await f.makeChar(G, 'u1', 'Liv Morgan', 'womens');
    const BOLT = await f.makeChar(G, 'u2', 'Bolt', 'mens');
    const SHOW = await f.titleId(G, 'Showtime Championship');
    const IC = await f.titleId(G, 'Intercontinental Championship');
    const CTAG = await f.titleId(G, 'Customs Tag Team Championship');
    const JEY = await f.makeChar(G, 'u3', 'Jey', 'custom');

    await t('/legacy award: MITB defaults to the wrestler\'s division and credits the owner; duplicates are refused', async () => {
        let i = await run('legacy', 'award', { accolade: 'mitb', character: ACE, year: 2026 }, ADM);
        assert.ok(!isErr(i), text(i));
        assert.match(text(i), /Ace Blackout\*\* now has \*\*Money in the Bank \(Custom\) 2026\*\* \(credit: <@u1>\)/);
        i = await run('legacy', 'award', { accolade: 'mitb', character: ACE, year: 2026 }, ADM);
        assert.match(text(i), /already has/);
        i = await run('legacy', 'award', { accolade: 'rumble', character: ACE, year: 2025 }, ADM);
        i = await run('legacy', 'award', { accolade: 'rumble', character: ACE, year: 2024, notes: 'Last eliminated Bolt' }, ADM);
        i = await run('legacy', 'award', { accolade: 'mvp', character: LIV, year: 2025, player: 'u7' }, ADM);
        assert.match(text(i), /Face of FNLW MVP 2025\*\* \(credit: <@u7>\)/, 'old wins can credit who played them then');
    });

    await t('year-end awards come from the list; the starter list is there; admins can add, rename and remove names', async () => {
        let i = await run('legacy', 'award', { accolade: 'award', character: ACE, year: 2025 }, ADM);
        assert.match(text(i), /Pick which year-end award/);
        i = await run('legacy', 'award', { accolade: 'award', character: ACE, year: 2025, award_name: 'Best Hair' }, ADM);
        assert.match(text(i), /isn't on your award list/);
        const c = await auto('legacy', 'award', 'award_name', 'year', {}, ADM);
        assert.ok(c.some((x) => x.value === 'Rookie of the Year'));
        i = await run('legacy', 'award', { accolade: 'award', character: ACE, year: 2025, award_name: 'kickout king of the year' }, ADM);
        assert.match(text(i), /Kickout King of the Year 2025/);
        i = await run('legacy', 'award-names', { action: 'add', name: 'Promo of the Year' }, ADM);
        assert.match(text(i), /Promo of the Year/);
        i = await run('legacy', 'award-names', { action: 'rename', name: 'Kickout King of the Year', new_name: 'FNLW Kickout King of the Year' }, ADM);
        assert.match(text(i), /FNLW Kickout King of the Year/);
        assert.strictEqual((await q(`select award_name from legacy where kind='award'`))[0].award_name, 'FNLW Kickout King of the Year', 'past winners follow the rename');
        i = await run('legacy', 'award-names', { action: 'remove', name: 'Cringe Guy Award' }, ADM);
        assert.doesNotMatch(text(i), /• Cringe Guy Award/);
        i = await run('legacy', 'award-names', {}, ADM);
        assert.doesNotMatch(text(i), /• Cringe Guy Award/, 'a removed name does not come back');
    });

    await t('members can view but not award; the honor roll groups by accolade and filters with a dropdown', async () => {
        let i = await run('legacy', 'award', { accolade: 'mvp', character: BOLT }, PLAYER);
        assert.match(text(i), /Only admins and staff/);
        i = await run('legacy', 'list', {}, PLAYER);
        assert.match(text(i), /Face of FNLW MVP:\*\*2025\*\*: Liv Morgan \(<@u7>\)/);
        assert.match(text(i), /Royal Rumble \(Custom\):\*\*2025\*\*: Ace Blackout.*\*\*2024\*\*: Ace Blackout.*Last eliminated Bolt/s);
        assert.match(ids(i), /ui:lg/);
        i = await click('ui:lg', { values: ['rumble'], admin: false, user: 'u9' });
        assert.match(text(i), /Legacy: Royal Rumble/);
        assert.doesNotMatch(text(i), /Money in the Bank/);
        i = await run('legacy', 'view', { character: ACE }, PLAYER);
        assert.match(text(i), /Ace Blackout's Legacy.*Money in the Bank \(Custom\) 2026/s);
        i = await run('legacy', 'view', { player: 'u1' }, PLAYER);
        assert.match(text(i), /FNLW Kickout King of the Year 2025\*\* · Ace Blackout/);
        assert.doesNotMatch(text(i), /Face of FNLW MVP/, 'credit for that one went to u7');
    });

    await t('awards are announced in the Legacy channel without pinging', async () => {
        await run('admin', 'channels', { legacy: 'legacych' }, ADM);
        const before = sent.length;
        const i = await run('legacy', 'award', { accolade: 'mitb', character: BOLT, year: 2026 }, ADM);
        assert.match(text(i), /Announced in <#legacych>/);
        const post = sent.slice(before).find((m) => m.channelId === 'legacych');
        assert.ok(post);
        assert.match(post.payload.embeds[0].data.title, /Money in the Bank \(Men's\) 2026/);
        assert.deepStrictEqual(post.payload.allowedMentions, { parse: [] });
        const quiet = await run('legacy', 'award', { accolade: 'rumble', character: BOLT, year: 2026, announce: false }, ADM);
        assert.doesNotMatch(text(quiet), /Announced/);
    });

    await t('remove takes an accolade back; autocomplete finds it by name or year', async () => {
        const c = await auto('legacy', 'remove', 'accolade', 'bolt', {}, ADM);
        const rumble = c.find((x) => /Royal Rumble/.test(x.name));
        const i = await run('legacy', 'remove', { accolade: rumble.value }, ADM);
        assert.match(text(i), /Removed \*\*Royal Rumble \(Men's\) 2026\*\* from Bolt/);
    });

    await t('Legacy badges: one win shows the year, several show the count', async () => {
        const { characterLegacy, legacyBadges } = require('../src/utils/legacy');
        const labels = legacyBadges(await characterLegacy(ACE)).map((b) => b.label);
        assert.deepStrictEqual(labels.slice(0, 1), ['2X RUMBLE WINNER']);
        assert.ok(labels.includes('CUSTOM MITB 2026'));
        assert.ok(labels.includes('FNLW KICKOUT KING OF THE YEAR 2025'));
    });

    // title history for the cards and the record book
    await run('title', 'reign-add', { title: SHOW, won_date: '2026-01-01', lost_date: '2026-02-01', character: ACE, defenses: 1 }, ADM);
    await run('title', 'reign-add', { title: SHOW, won_date: '2026-02-01', lost_date: '2026-02-01', character: JEY }, ADM);
    await run('title', 'reign-add', { title: SHOW, won_date: '2026-03-01', character: ACE, defenses: 3 }, ADM);
    await run('title', 'reign-add', { title: CTAG, won_date: '2025-04-01', lost_date: '2025-05-01', character: ACE, partner: JEY, team_name: 'Blackout Bros' }, ADM);
    await run('title', 'reign-add', { title: IC, won_date: '2025-01-01', lost_date: '2025-03-01', character: BOLT, defenses: 2 }, ADM);

    await t('the character card lists each belt: current first with its reign number, then former with the count', async () => {
        const { characterTitleList, buildProfileData } = require('../src/utils/cardData');
        const list = await characterTitleList(ACE);
        assert.deepStrictEqual(list.map((x) => [x.name, x.count, x.current, x.nth]), [
            ['Showtime Championship', 2, true, 2], ['Customs Tag Team Championship', 1, false, 0]]);
        const { rows } = await f.pool.query(`SELECT c.*, u.discord_id AS owner_discord_id FROM characters c JOIN users u ON u.id = c.owner_id WHERE c.id = $1`, [ACE]);
        const guild = { id: G, name: 'FNLW', members: { fetch: async () => new Map() } };
        const d = await buildProfileData(guild, rows[0]);
        assert.strictEqual(d.badges[0].label, '2X RUMBLE WINNER', 'Legacy badges come first');
        const buf = await require('../src/cards/profileCard').renderProfileCard(d);
        assert.ok(buf.length > 1000);
        const i = await run('character', 'profile', { character: ACE }, PLAYER);
        assert.ok(!isErr(i), text(i));
    });

    await t('the player card lists each belt with the wrestler who held it, marks current champions, and shows Legacy', async () => {
        const { buildPlayerData } = require('../src/utils/cardData');
        const ownerId = (await q(`select id from users where discord_id='u1'`))[0].id;
        const guild = { id: G, name: 'FNLW', members: { fetch: async () => new Map() } };
        const d = await buildPlayerData(guild, { id: 'u1', username: 'u1' }, ownerId);
        assert.deepStrictEqual(d.titleList.map((x) => [x.name, x.count, x.current, x.holders.join('/')]), [
            ['Showtime Championship', 2, true, 'Ace Blackout'], ['Customs Tag Team Championship', 1, false, 'Blackout Bros']]);
        assert.strictEqual(d.wrestlers.find((w) => w.name === 'Ace Blackout').champ, true);
        assert.strictEqual(d.wrestlers.find((w) => w.name === 'Liv Morgan').champ, false);
        assert.ok(d.legacy.some((b) => b.label === '2X RUMBLE WINNER'));
        const buf = await require('../src/cards/playerCard').renderPlayerCard(d);
        assert.ok(buf.length > 1000);
    });

    await t('/championship records: longest, shortest, most defenses and most reigns with player and character', async () => {
        const i = await run('championship', 'records', { title: SHOW }, PLAYER);
        const out = text(i);
        assert.match(out, /Showtime Championship: Record Book/);
        assert.match(out, /Longest reign:\*\*Ace Blackout\*\* \(<@u1>\): \*\*\d+ days\*\* _\(still going\)_/);
        assert.match(out, /Shortest reign:\*\*Jey\*\* \(<@u3>\): \*\*less than a day\*\*/);
        assert.match(out, /Most defenses in one reign:\*\*Ace Blackout\*\* \(<@u1>\): \*\*3 defenses\*\*/);
        assert.match(out, /Most reigns:<@u1>: \*\*2x\*\* · Ace Blackout/);
        const tag = await run('championship', 'records', { title: CTAG }, PLAYER);
        assert.match(text(tag), /\*\*Blackout Bros\*\*: Ace Blackout & Jey \(<@u1> & <@u3>\)/);
        const empty = await run('championship', 'records', { title: await f.titleId(G, "Women's World Championship") }, PLAYER);
        assert.match(text(empty), /No reigns yet/);
    });

    await t('the belt panel has a Records button for everyone', async () => {
        let i = await click('ui:belt', { values: [String(SHOW)], admin: false, user: 'u9' });
        assert.match(ids(i), /chmp:rec:/);
        i = await click(`chmp:rec:${SHOW}`, { admin: false, user: 'u9' });
        assert.match(text(i), /Record Book/);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end();
    process.exit(failed ? 1 : 0);
})();
