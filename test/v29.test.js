const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, hasFile, sent } = require('./mock');
const cu = require('../src/utils/contractUtils');

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
const log = (a, b, extra = {}) => run('match', 'log-singles', { participant1: C[a], participant2: C[b], winner: 1, override_cooldown: true, ...extra }, ADM);

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const mk = async (n, o, d = 'mens') => { C[n] = await f.makeChar(G, o, n, d); };
    await mk('Ace', 'u1'); await mk('Bolt', 'u2'); await mk('Cruz', 'u3'); await mk('Dane', 'u4'); await mk('Aria', 'u5', 'womens');
    await f.pool.query(`update guilds set matches_channel_id='matches1', admin_channel_id='staff1' where guild_id=$1`, [G]);

    // ---------- show recap ----------
    await t('card recap writes a paragraph per logged match', async () => {
        await run('card', 'new', { brand: 'raw', division: 'mens', name: 'Monday Mayhem' }, ADM);
        await run('card', 'add', { brand: 'raw', division: 'mens', match_type: 'singles', wrestler1: C.Ace, wrestler2: C.Bolt, stipulation: 'Ladder Match' }, ADM);
        await run('card', 'add', { brand: 'raw', division: 'mens', match_type: 'singles', wrestler1: C.Cruz, wrestler2: C.Dane }, ADM);
        const before = sent.length;
        await log('Ace', 'Bolt', { finish: 'pinfall', score: '1-0' });
        assert.ok(!sent.slice(before).some((m) => /wrap/.test(m.payload?.content || '')), 'not finished yet, no auto recap');
        const i = await run('card', 'recap', { brand: 'raw', division: 'mens' }, ADM);
        const t1 = text(i);
        assert.match(t1, /Ace defeated Bolt by pinfall in a Ladder Match \(1-0\)/, t1);
        assert.match(t1, /1 not logged yet/, t1);
    });
    await t('the recap posts by itself when the last match of the card is logged, once', async () => {
        const before = sent.length;
        await log('Cruz', 'Dane');
        const posts = sent.slice(before).filter((m) => /wrap/.test(m.payload?.content || ''));
        assert.strictEqual(posts.length, 1, JSON.stringify(sent.slice(before).map((m) => m.payload?.content)));
        assert.strictEqual(posts[0].channelId, 'matches1');
        const desc = posts[0].payload.embeds[0].data.description;
        assert.match(desc, /Cruz defeated Dane/); assert.match(desc, /main event|Closing the show/i, desc);
        assert.ok((posts[0].payload.files || []).length >= 0);
        // logging another match does not repost
        const n = sent.length;
        await log('Cruz', 'Dane');
        assert.ok(!sent.slice(n).some((m) => /wrap/.test(m.payload?.content || '')));
    });
    await t('rematches mention the series and a title match mentions the belt', async () => {
        const WH = await f.titleId(G, 'World Heavyweight Championship');
        await run('championship', 'backfill-reign', { title: WH, character: C.Ace, won_date: '2026-01-01' }, ADM).catch(() => {});
        await run('card', 'new', { brand: 'smackdown', division: 'mens' }, ADM);
        await run('card', 'add', { brand: 'smackdown', division: 'mens', match_type: 'singles', wrestler1: C.Ace, wrestler2: C.Bolt, title: WH }, ADM);
        const i0 = await run('championship', 'log-singles-title-match', { title: WH, champion_or_p1: C.Ace, challenger_or_p2: C.Bolt, winner: 1 }, ADM);
        const rec = await run('card', 'recap', { brand: 'smackdown', division: 'mens' }, ADM);
        assert.match(text(rec), /World Heavyweight Championship/, text(rec) + text(i0));
        assert.match(text(rec), /meeting/, text(rec));
    });
    await t('auto-recap can be turned off', async () => {
        await run('card', 'auto-recap', { enabled: false }, ADM);
        await run('card', 'new', { brand: 'raw', division: 'womens' }, ADM);
        await mk('Bria', 'u6', 'womens');
        await run('card', 'add', { brand: 'raw', division: 'womens', match_type: 'singles', wrestler1: C.Aria, wrestler2: C.Bria }, ADM);
        const n = sent.length;
        await log('Aria', 'Bria');
        assert.ok(!sent.slice(n).some((m) => /wrap/.test(m.payload?.content || '')));
        await run('card', 'auto-recap', { enabled: true }, ADM);
    });

    // ---------- contracts ----------
    let kid;
    await t('admin offers a contract; only the owner can accept; signing makes it active with a graphic', async () => {
        let i = await run('contract', 'offer', { character: C.Ace, months: 6, salary: 5000, clauses: 'Main event guarantee' }, ADM);
        assert.match(text(i), /Contract offer/, text(i));
        const { rows } = await f.pool.query(`select * from contracts`); kid = rows[0].id;
        assert.strictEqual(rows[0].status, 'offered');
        i = await click(`contract:accept:${kid}`, { admin: false, user: 'u2' });
        assert.match(text(i), /Only Ace's owner/, text(i));
        i = await click(`contract:accept:${kid}`, { admin: false, user: 'u1' });
        assert.ok(hasFile(i), JSON.stringify(i.responses.map((r) => r.p?.content)));
        assert.match(text(i), /signed a 6-month deal/, text(i));
        const { rows: r2 } = await f.pool.query(`select status, end_date - start_date as d from contracts where id=$1`, [kid]);
        assert.strictEqual(r2[0].status, 'active'); assert.ok(r2[0].d >= 180 && r2[0].d <= 184);
    });
    await t('players cannot offer; answered offers cannot be answered twice', async () => {
        let i = await run('contract', 'offer', { character: C.Bolt, months: 3, salary: 100 }, P('u2'));
        assert.ok(isErr(i, /Only admins/), text(i));
        i = await click(`contract:accept:${kid}`, { admin: false, user: 'u1' });
        assert.match(text(i), /already answered/, text(i));
    });
    await t('profile shows the contract line; wrestlers without a contract are fine', async () => {
        let i = await run('character', 'profile', { character: C.Ace });
        assert.match(JSON.stringify(i.responses.map((r) => r.p?.content)), /Contract through/, 'no contract line');
        i = await run('character', 'profile', { character: C.Bolt });
        assert.ok(!/Contract through/.test(JSON.stringify(i.responses.map((r) => r.p?.content))));
        i = await run('contract', 'view', { character: C.Bolt });
        assert.match(text(i), /no contract/, text(i));
    });
    await t('earnings = salary for days under contract + win and title-win bonuses (recomputed from matches)', async () => {
        // pretend the deal started 60 days ago
        const today = await cu.todayFor(G);
        await f.pool.query(`update contracts set start_date = $2::date - 60, end_date = $2::date + 120 where id=$1`, [kid, today]);
        await f.pool.query(`update matches set created_at = now() - interval '5 days'`);
        const e = (await cu.earningsMap(G, { characterId: C.Ace })).get(String(C.Ace));
        const aceWins = (await f.pool.query(`select count(*)::int n from match_participants mp join matches m on m.id=mp.match_id where mp.character_id=$1 and mp.is_winner and m.result_type='decisive'`, [C.Ace])).rows[0].n;
        const titleWins = (await f.pool.query(`select count(*)::int n from match_participants mp join matches m on m.id=mp.match_id where mp.character_id=$1 and mp.is_winner and m.is_title_match`, [C.Ace])).rows[0].n;
        assert.strictEqual(e.salary, 10000);
        assert.strictEqual(e.wins, aceWins); assert.strictEqual(e.titleWins, titleWins);
        assert.strictEqual(e.total, 10000 + aceWins * 500 + titleWins * 2000);
        const i = await run('contract', 'view', { character: C.Ace });
        assert.match(text(i), /Career earnings/, text(i)); assert.ok(hasFile(i));
    });
    await t('bonuses can be changed by admins only', async () => {
        let i = await run('contract', 'bonuses', { win: 1000 }, P('u1'));
        assert.ok(isErr(i, /Only admins/), text(i));
        i = await run('contract', 'bonuses', { win: 1000, title_win: 3000 }, ADM);
        assert.match(text(i), /\$1,000.*\$3,000/, text(i));
        const e = (await cu.earningsMap(G, { characterId: C.Ace })).get(String(C.Ace));
        assert.strictEqual(e.total, e.salary + e.wins * 1000 + e.titleWins * 3000);
        await run('contract', 'bonuses', { win: 500, title_win: 2000 }, ADM);
    });
    await t('leaderboard, list and free agents', async () => {
        let i = await run('contract', 'earnings', {});
        assert.match(text(i), /Ace/, text(i));
        i = await run('contract', 'list', {});
        assert.match(text(i), /Ace/, text(i)); assert.match(text(i), /\$5,000\/mo/);
        i = await run('contract', 'free-agents', {});
        assert.ok(!/Ace/.test(text(i)) && /Bolt/.test(text(i)), text(i));
    });
    await t('a renewal request goes to admins; approving replaces the old deal', async () => {
        let i = await run('contract', 'request', { character: C.Bolt, months: 3, salary: 100 }, P('u1'));
        assert.ok(isErr(i, /your own/), text(i));
        i = await run('contract', 'request', { character: C.Ace, months: 12, salary: 9000 }, P('u1'));
        assert.match(text(i), /asking for a new deal/, text(i));
        const { rows } = await f.pool.query(`select id from contracts where status='requested'`);
        i = await click(`contract:approve:${rows[0].id}`, { admin: false, user: 'u1' });
        assert.match(text(i), /Only admins/, text(i));
        i = await click(`contract:approve:${rows[0].id}`, { admin: true, user: 'admin1' });
        assert.match(text(i), /signed a 12-month deal/, text(i));
        const { rows: all } = await f.pool.query(`select status from contracts where character_id=$1 order by id`, [C.Ace]);
        assert.deepStrictEqual(all.map((r) => r.status), ['replaced', 'active']);
        // earnings keep the replaced deal's pay
        const e = (await cu.earningsMap(G, { characterId: C.Ace })).get(String(C.Ace));
        assert.ok(e.salary >= 10000, JSON.stringify(e));
    });
    await t('declining and rejecting work; a new offer withdraws an older waiting one', async () => {
        await run('contract', 'offer', { character: C.Bolt, months: 2, salary: 700 }, ADM);
        let { rows } = await f.pool.query(`select id from contracts where character_id=$1 and status='offered'`, [C.Bolt]);
        let i = await click(`contract:decline:${rows[0].id}`, { admin: false, user: 'u2' });
        assert.match(text(i), /declined/, text(i));
        await run('contract', 'offer', { character: C.Cruz, months: 2, salary: 700 }, ADM);
        await run('contract', 'offer', { character: C.Cruz, months: 4, salary: 900 }, ADM);
        ({ rows } = await f.pool.query(`select status, months from contracts where character_id=$1 order by id`, [C.Cruz]));
        assert.deepStrictEqual(rows.map((r) => r.status), ['withdrawn', 'offered']);
    });
    await t('release ends the deal, keeps earnings', async () => {
        await run('contract', 'offer', { character: C.Dane, months: 6, salary: 3000 }, ADM);
        const { rows } = await f.pool.query(`select id from contracts where character_id=$1 and status='offered'`, [C.Dane]);
        await click(`contract:accept:${rows[0].id}`, { admin: false, user: 'u4' });
        const i = await run('contract', 'release', { character: C.Dane }, ADM);
        assert.match(text(i), /released/, text(i));
        assert.strictEqual(await cu.getActive(C.Dane), null);
        const e = await run('contract', 'release', { character: C.Dane }, ADM);
        assert.ok(isErr(e, /no active/), text(e));
    });
    await t('expiry watch warns 14 days ahead once, then marks expired and tells staff', async () => {
        const today2 = await cu.todayFor(G);
        await f.pool.query(`update contracts set end_date = $2::date + 5 where character_id=$1 and status='active'`, [C.Ace, today2]);
        const posts = [];
        const client = { channels: { fetch: async () => ({ isTextBased: () => true, send: async (p) => { posts.push(p); } }) } };
        const g = (await f.pool.query(`select * from guilds where guild_id=$1`, [G])).rows[0];
        await cu.runContractWatch(client, g);
        assert.strictEqual(posts.length, 1); assert.match(posts[0].content, /contract ends/);
        await cu.runContractWatch(client, g);
        assert.strictEqual(posts.length, 1, 'warned only once');
        await f.pool.query(`update contracts set end_date = $2::date - 1 where character_id=$1 and status='active'`, [C.Ace, today2]);
        await cu.runContractWatch(client, g);
        assert.strictEqual(posts.length, 2); assert.match(posts[1].content, /expired/);
        const { rows } = await f.pool.query(`select status from contracts where character_id=$1 order by id desc limit 1`, [C.Ace]);
        assert.strictEqual(rows[0].status, 'expired');
    });
    await t('contracts never affect booking: an expired/absent contract can still wrestle', async () => {
        const i = await log('Ace', 'Bolt');
        assert.ok(hasFile(i), text(i));
    });

    // ---------- report ----------
    await t('staff report covers idle, divisions, titles and more; admins only', async () => {
        await f.pool.query(`update matches set created_at = now() - interval '50 days' where id in (select m.id from matches m join match_participants mp on mp.match_id=m.id where mp.character_id=$1)`, [C.Cruz]);
        let i = await run('report', 'now', {}, ADM);
        const tx = text(i);
        assert.match(tx, /Weekly staff report/, tx); assert.match(tx, /Idle/); assert.match(tx, /Divisions/); assert.match(tx, /thin/); assert.match(tx, /Titles needing attention/);
        i = await run('report', 'now', {}, P('u1'));
        assert.ok(isErr(i, /Only admins/), text(i));
    });
    await t('weekly report posts on Monday morning once per week, only with a staff channel', async () => {
        const { runWeeklyReport } = require('../src/utils/reportUtils');
        const posts = [];
        const client = { channels: { fetch: async () => ({ isTextBased: () => true, send: async (p) => { posts.push(p); } }) }, guilds: { cache: new Map() } };
        const RealDate = Date;
        const fake = (iso) => { global.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(iso); } static now() { return new RealDate(iso).getTime(); } }; };
        try {
            const g = (await f.pool.query(`select * from guilds where guild_id=$1`, [G])).rows[0];
            fake('2026-11-02T15:00:00Z'); // Monday 9am Chicago? tz is UTC here: 15:00 UTC Monday
            await runWeeklyReport(client, { ...g, tz: 'UTC' });
            await runWeeklyReport(client, { ...g, tz: 'UTC' });
            assert.strictEqual(posts.length, 1);
            fake('2026-11-03T15:00:00Z'); // Tuesday
            await f.pool.query(`update guilds set report_last = null`);
            await runWeeklyReport(client, { ...g, tz: 'UTC' });
            assert.strictEqual(posts.length, 1, 'not on Tuesday');
            fake('2026-11-02T05:00:00Z'); // Monday before 9
            await runWeeklyReport(client, { ...g, tz: 'UTC' });
            assert.strictEqual(posts.length, 1, 'not before 9am');
            fake('2026-11-02T15:00:00Z');
            await runWeeklyReport(client, { ...g, tz: 'UTC', admin_channel_id: null });
            assert.strictEqual(posts.length, 1, 'no staff channel, no post');
        } finally { global.Date = RealDate; }
    });
    await t('help lists contract for everyone and report for admins only', async () => {
        const a = await run('help', null, {}, ADM);
        assert.match(text(a), /\/report 🔒:/); assert.match(text(a), /\/contract:/);
        const p = await run('help', null, {}, P('u1'));
        assert.match(text(p), /\/contract:/); assert.ok(!/\/report[ :]/.test(text(p)), text(p));
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end(); process.exit(failed ? 1 : 0);
})();
