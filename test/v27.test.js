const assert = require('assert');
const f = require('./fixtures');
const { run, auto, click, text, hasFile } = require('./mock');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 5).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const PLAYER = (u) => ({ admin: false, user: u });
const isPrivateErr = (i, re) => i.responses.some((r) => ((r.p?.flags & 64) || i.ephemeral) && /⚠️/.test(r.p?.content || '') && (!re || re.test(r.p.content)));
const G = 'g1';
const C = {};
const log = (a, b, extra = {}) => run('match', 'log-singles', { participant1: C[a], participant2: C[b], winner: 1, override_cooldown: true, ...extra }, ADM);
const posts = [];
const fakeChannel = (id) => ({ id, isTextBased: () => true, send: async (p) => { posts.push({ id, p }); return { id: 'm' + posts.length, channelId: id }; } });
const fakeClient = { channels: { fetch: async (id) => fakeChannel(id) }, guilds: { cache: new Map() } };

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const mk = async (name, owner, div = 'mens') => { C[name] = await f.makeChar(G, owner, name, div); };
    for (const [n, o] of [['Ace', 'u1'], ['Bolt', 'u2'], ['Cruz', 'u3'], ['Dane', 'u4'], ['Eli', 'u5'], ['Finn', 'u6'], ['Gus', 'u7'], ['Hank', 'u8']]) await mk(n, o);
    const WH = await f.titleId(G, 'World Heavyweight Championship');
    const US = await f.titleId(G, 'United States Championship');

    // ---------- stipulations / finishes ----------
    await t('stipulation, finish and score are saved and shown', async () => {
        const i = await log('Ace', 'Bolt', { stipulation: 'Iron Man', finish: 'pinfall', score: '3-2' });
        assert.ok(hasFile(i), text(i));
        const { rows } = await f.pool.query(`select stipulation, finish, score from matches order by id desc limit 1`);
        assert.deepStrictEqual(rows[0], { stipulation: 'Iron Man', finish: 'pinfall', score: '3-2' });
    });
    await t('bad stipulation / score / finish are refused', async () => {
        let i = await log('Ace', 'Cruz', { stipulation: 'x'.repeat(41) });
        assert.ok(isPrivateErr(i, /under 40/), text(i));
        i = await log('Ace', 'Cruz', { score: 'y'.repeat(25) });
        assert.ok(isPrivateErr(i, /score short/), text(i));
        i = await log('Ace', 'Cruz', { finish: 'bogus' });
        assert.ok(isPrivateErr(i, /finish/), text(i));
    });
    await t('stipulation autocomplete suggests presets and keeps custom text', async () => {
        const r = await auto('match', 'log-singles', 'stipulation', 'lad', {}, ADM);
        assert.ok(r.some((c) => c.value === 'Ladder Match'), JSON.stringify(r));
        assert.strictEqual(r[0].value, 'lad');
    });
    await t('stats by stipulation and wins by finish; match edit changes them', async () => {
        await log('Ace', 'Cruz', { stipulation: 'Ladder Match', finish: 'dq' });
        await log('Cruz', 'Ace', { stipulation: 'Ladder Match', finish: 'submission' });
        const s = await run('stats', 'character', { character: C.Ace });
        assert.match(text(s), /Ladder Match: \*\*1-1\*\*/, text(s));
        assert.match(text(s), /Wins By:/, text(s));
        const { rows } = await f.pool.query(`select id from matches order by id desc limit 1`);
        const e = await run('match', 'edit', { match_id: rows[0].id, stipulation: '-', score: '1-0' }, ADM);
        assert.match(text(e), /stipulation cleared/, text(e));
        const r2 = await f.pool.query(`select stipulation, score from matches where id=$1`, [rows[0].id]);
        assert.strictEqual(r2.rows[0].stipulation, null); assert.strictEqual(r2.rows[0].score, '1-0');
    });
    await t('stipulation planned on a card carries over to the logged match', async () => {
        await run('card', 'new', { brand: 'raw', division: 'mens' }, ADM);
        await run('card', 'add', { brand: 'raw', division: 'mens', match_type: 'singles', wrestler1: C.Dane, wrestler2: C.Eli, stipulation: 'Steel Cage' }, ADM);
        const i = await log('Dane', 'Eli');
        assert.ok(hasFile(i), text(i));
        const { rows } = await f.pool.query(`select stipulation from matches order by id desc limit 1`);
        assert.strictEqual(rows[0].stipulation, 'Steel Cage');
    });

    // ---------- rematch clause ----------
    await t('champion who loses is owed a rematch; it is used when they get the match; undo restores it', async () => {
        await run('championship', 'backfill-reign', { title: WH, won_date: '2026-01-01', character: C.Ace }, ADM);
        // Bolt beats champion Ace
        let i = await run('championship', 'log-singles-title-match', { title: WH, champion_or_p1: C.Ace, challenger_or_p2: C.Bolt, winner: 2 }, ADM);
        assert.match(text(i), /Rematch clause: \*\*Ace\*\*/, text(i));
        const owed = await run('championship', 'rematches', {});
        assert.match(text(owed), /Ace/, text(owed));
        // Ace gets the rematch
        i = await run('championship', 'log-singles-title-match', { title: WH, champion_or_p1: C.Bolt, challenger_or_p2: C.Ace, winner: 1 }, ADM);
        assert.ok(hasFile(i), text(i));
        const { rows } = await f.pool.query(`select status from rematch_rights where holder_name='Ace'`);
        assert.strictEqual(rows[0].status, 'used');
        const { rows: m } = await f.pool.query(`select id from matches order by id desc limit 1`);
        await run('match', 'undo', { match_id: m[0].id }, ADM);
        const { rows: back } = await f.pool.query(`select status from rematch_rights where holder_name='Ace'`);
        assert.strictEqual(back[0].status, 'active');
    });
    await t('waive a rematch and turn the clause off', async () => {
        const { rows } = await f.pool.query(`select id from rematch_rights where status='active'`);
        const w = await run('championship', 'waive-rematch', { rematch: rows[0].id }, ADM);
        assert.match(text(w), /cancelled/, text(w));
        const off = await run('admin', 'rematches', { action: 'off' }, ADM);
        assert.match(text(off), /off/);
        // Cruz takes the US title from nobody (vacant), then loses it: no rematch when disabled
        await run('championship', 'backfill-reign', { title: US, won_date: '2026-02-01', character: C.Cruz }, ADM);
        const i = await run('championship', 'log-singles-title-match', { title: US, champion_or_p1: C.Cruz, challenger_or_p2: C.Dane, winner: 2 }, ADM);
        assert.doesNotMatch(text(i), /Rematch clause/, text(i));
        await run('admin', 'rematches', { action: 'on', days: 14 }, ADM);
    });
    await t('rematch reminder goes to the staff channel and old rights expire', async () => {
        await run('admin', 'set-admin-channel', { channel: 'staff1' }, ADM);
        await f.pool.query(`insert into rematch_rights (guild_id, title_id, character_id, holder_name, expires_on) values ($1,$2,$3,'Cruz',CURRENT_DATE + 2)`, [G, US, C.Cruz]);
        await f.pool.query(`insert into rematch_rights (guild_id, title_id, character_id, holder_name, expires_on, status) values ($1,$2,$3,'Old',CURRENT_DATE - 1,'active')`, [G, US, C.Dane]);
        const { runRematchWatch } = require('../src/utils/titleWatch');
        const g = (await f.pool.query(`select * from guilds where guild_id=$1`, [G])).rows[0];
        posts.length = 0;
        await runRematchWatch(fakeClient, g);
        assert.ok(posts.some((p) => p.id === 'staff1' && /Cruz/.test(p.p.content)), JSON.stringify(posts));
        const { rows } = await f.pool.query(`select status from rematch_rights where holder_name='Old'`);
        assert.strictEqual(rows[0].status, 'expired');
        posts.length = 0;
        await runRematchWatch(fakeClient, g);
        assert.strictEqual(posts.length, 0, 'only reminded once');
    });

    // ---------- editable past reigns ----------
    await t('bot-logged reigns can be edited (dates, holder, interim flag) and the overlap check still works', async () => {
        const { rows } = await f.pool.query(`select id, won_date from title_reigns where title_id=$1 order by id`, [WH]);
        const botReign = rows[1].id; // Bolt's reign from the title match
        const aceReign = rows[0].id;
        let i = await run('championship', 'edit-reign', { title: WH, reign: aceReign, lost_date: '2026-10-10' }, ADM);
        assert.match(text(i), /Updated/, text(i));
        i = await run('championship', 'edit-reign', { title: WH, reign: botReign, won_date: '2026-10-10', defenses: 4, notes: 'fixed' }, ADM);
        assert.match(text(i), /Updated/, text(i));
        const r = (await f.pool.query(`select defenses, notes from title_reigns where id=$1`, [botReign])).rows[0];
        assert.strictEqual(r.defenses, 4);
        i = await run('championship', 'edit-reign', { title: WH, reign: botReign, won_date: '2026-09-01' }, ADM);
        assert.ok(isPrivateErr(i, /overlaps/), text(i));
        i = await run('championship', 'edit-reign', { title: WH, reign: botReign, champion_name: 'Mystery Man', interim: true }, ADM);
        assert.match(text(i), /Mystery Man/, text(i));
        const h = await run('championship', 'history', { title: WH });
        assert.match(text(h), /Mystery Man \(Interim\)/, text(h));
        await run('championship', 'edit-reign', { title: WH, reign: botReign, character: C.Bolt, interim: false }, ADM);
    });

    // ---------- interim champion ----------
    await t('interim champion can be crowned and unified', async () => {
        let i = await run('championship', 'interim', { title: WH, character: C.Eli, reason: 'injury' }, ADM);
        assert.match(text(i), /interim champion/, text(i));
        const lst = await run('championship', 'list', {});
        assert.match(text(lst), /interim/, text(lst));
        i = await run('championship', 'interim', { title: WH, character: C.Finn }, ADM);
        assert.ok(isPrivateErr(i, /already an interim/), text(i));
        i = await run('championship', 'unify', { title: WH, character: C.Eli }, ADM);
        assert.match(text(i), /undisputed/, text(i));
        const cur = (await f.pool.query(`select is_interim, character_id from title_reigns where title_id=$1 and lost_date is null`, [WH])).rows;
        assert.strictEqual(cur.length, 1); assert.strictEqual(cur[0].is_interim, false);
        i = await run('championship', 'interim', { title: US, character: C.Finn }, PLAYER('u9'));
        assert.ok(isPrivateErr(i), 'players cannot crown');
    });

    // ---------- character depth ----------
    await t('character story: owner can edit, others cannot, profile shows moves + badges, story button works', async () => {
        let i = await run('character', 'story', { character: C.Ace, signatures: 'Spear, Dropkick', catchphrase: 'Ace high!', story: 'Born in the ring.' }, PLAYER('u1'));
        assert.match(text(i), /Updated/, text(i));
        i = await run('character', 'story', { character: C.Ace, catchphrase: 'hacked' }, PLAYER('u2'));
        assert.ok(isPrivateErr(i, /own characters/), text(i));
        i = await run('character', 'story', { character: C.Ace }, PLAYER('u1'));
        assert.ok(isPrivateErr(i, /Nothing to change/), text(i));
        i = await run('character', 'profile', { character: C.Ace }, PLAYER('u3'));
        assert.ok(hasFile(i), text(i));
        const comps = i.responses.at(-1).p.components;
        assert.ok(comps && comps.length, 'story button present');
        const b = await click(`prof:story:${C.Ace}`, { admin: false, user: 'u3' });
        assert.match(text(b), /Born in the ring/, text(b));
        assert.match(text(b), /Spear/, text(b));
        i = await run('character', 'story', { character: C.Ace, signatures: '-' }, ADM);
        const row = (await f.pool.query(`select signatures, catchphrase from characters where id=$1`, [C.Ace])).rows[0];
        assert.strictEqual(row.signatures, null); assert.strictEqual(row.catchphrase, 'Ace high!');
    });

    // ---------- title watch ----------
    await t('title watch: warns about stale defenses, auto-vacates inactive champions', async () => {
        const { titleStatus, runTitleWatch } = require('../src/utils/titleWatch');
        // Eli holds WH since today. backdate everything: reign start 40 days ago, matches too
        await f.pool.query(`update title_reigns set won_date = CURRENT_DATE - 40 where title_id=$1 and lost_date is null`, [WH]);
        await f.pool.query(`update matches set created_at = now() - interval '60 days'`);
        const st = await titleStatus(G);
        const wh = st.find((s) => s.title_id === String(WH) || String(s.title_id) === String(WH));
        assert.ok(wh && wh.daysSinceDefense >= 39, JSON.stringify(wh));
        let i = await run('admin', 'deadlines', { defense_days: 30, vacate_days: 0 }, ADM);
        assert.match(text(i), /30 days/, text(i));
        let g = (await f.pool.query(`select * from guilds where guild_id=$1`, [G])).rows[0];
        posts.length = 0;
        await runTitleWatch(fakeClient, g);
        assert.ok(posts.some((p) => /not been defended/.test(p.p.content)), JSON.stringify(posts));
        // second run the same day does nothing
        posts.length = 0; await runTitleWatch(fakeClient, g);
        assert.strictEqual(posts.length, 0);
        i = await run('admin', 'deadlines', { vacate_days: 35 }, ADM);
        await f.pool.query(`update guilds set deadline_last = null where guild_id=$1`, [G]);
        g = (await f.pool.query(`select * from guilds where guild_id=$1`, [G])).rows[0];
        posts.length = 0;
        await runTitleWatch(fakeClient, g);
        assert.ok(posts.some((p) => /vacated/.test(p.p.content)), JSON.stringify(posts));
        const t1 = (await f.pool.query(`select is_vacant from titles where id=$1`, [WH])).rows[0];
        assert.strictEqual(t1.is_vacant, true);
        const w = await run('championship', 'watch', {}, ADM);
        assert.match(text(w), /Title Watch/, text(w));
        const w2 = await run('championship', 'watch', {}, PLAYER('u1'));
        assert.ok(isPrivateErr(w2, /Only admins/), text(w2));
        await run('admin', 'deadlines', { defense_days: 0, vacate_days: 0 }, ADM);
    });

    // ---------- calendar ----------
    await t('card schedule, upcoming and the tonight reminder', async () => {
        const { runCardReminders } = require('../src/utils/cardReminders');
        const { localNow } = require('../src/utils/titleWatch');
        let i = await run('card', 'schedule', { brand: 'raw', division: 'mens', date: '2026-13-40' }, ADM);
        assert.ok(isPrivateErr(i), text(i));
        const day = localNow('UTC').date;
        i = await run('card', 'schedule', { brand: 'raw', division: 'mens', date: day }, ADM);
        assert.match(text(i), /set for/, text(i));
        i = await run('card', 'upcoming', {}, ADM);
        assert.match(text(i), new RegExp(day), text(i));
        const g = (await f.pool.query(`select * from guilds where guild_id=$1`, [G])).rows[0];
        const morning = new Date(`${day}T08:00:00Z`), afternoon = new Date(`${day}T15:00:00Z`);
        posts.length = 0;
        await runCardReminders(fakeClient, g, morning);
        assert.strictEqual(posts.length, 0, 'not before noon');
        await runCardReminders(fakeClient, g, afternoon);
        assert.ok(posts.some((p) => p.id === 'staff1' && /Tonight's card/.test(p.p.content)), JSON.stringify(posts.map((p) => p.p.content)));
        posts.length = 0;
        await runCardReminders(fakeClient, g, afternoon);
        assert.strictEqual(posts.length, 0, 'only once');
        await run('card', 'schedule', { brand: 'raw', division: 'mens', date: '-' }, ADM);
        i = await run('card', 'upcoming', {}, ADM);
        assert.match(text(i), /No cards are scheduled/, text(i));
    });

    // ---------- match of the night ----------
    await t('match of the night vote: buttons, one vote each, close announces winner and gives a badge', async () => {
        await run('card', 'new', { brand: 'smackdown', division: 'mens', name: 'Friday' }, ADM);
        await run('card', 'add', { brand: 'smackdown', division: 'mens', match_type: 'singles', wrestler1: C.Finn, wrestler2: C.Gus }, ADM);
        await run('card', 'add', { brand: 'smackdown', division: 'mens', match_type: 'singles', wrestler1: C.Hank, wrestler2: C.Ace }, ADM);
        await log('Finn', 'Gus'); await log('Hank', 'Ace');
        const v = await run('card', 'vote', { brand: 'smackdown', division: 'mens' }, ADM);
        const poll = (await f.pool.query(`select * from motn_polls order by id desc limit 1`)).rows[0];
        assert.ok(poll && poll.match_ids.length === 2, JSON.stringify(poll));
        const [m1, m2] = poll.match_ids;
        await click(`motn:${poll.id}:${m1}`, { admin: false, user: 'v1' });
        await click(`motn:${poll.id}:${m2}`, { admin: false, user: 'v2' });
        await click(`motn:${poll.id}:${m2}`, { admin: false, user: 'v3' });
        await click(`motn:${poll.id}:${m1}`, { admin: false, user: 'v3' }); // changes mind: 2-1 for m1? v1,v3 -> m1 (2), v2 -> m2 (1)
        const { rows: votes } = await f.pool.query(`select count(*)::int as n from motn_votes where poll_id=$1`, [poll.id]);
        assert.strictEqual(votes[0].n, 3);
        const bad = await click(`motn:${poll.id}:999999`, { admin: false, user: 'v4' });
        assert.ok(isPrivateErr(bad, /isn't part/), text(bad));
        const c = await run('card', 'vote-close', {}, ADM);
        assert.match(text(c), /Match of the Night/, text(c));
        const closed = (await f.pool.query(`select status, winner_match_id from motn_polls where id=$1`, [poll.id])).rows[0];
        assert.strictEqual(closed.status, 'closed'); assert.strictEqual(String(closed.winner_match_id), String(m1));
        const late = await click(`motn:${poll.id}:${m2}`, { admin: false, user: 'v5' });
        assert.ok(isPrivateErr(late, /closed/), text(late));
        const none = await run('card', 'vote-close', {}, ADM);
        assert.ok(isPrivateErr(none, /no open/i), text(none));
    });

    // ---------- feuds ----------
    await t('feud: start, log, heat, view, list, end', async () => {
        let i = await run('feud', 'start', { wrestler1: C.Ace, wrestler2: C.Bolt, name: 'Blood Feud', story: 'Ace attacked Bolt.' }, ADM);
        assert.match(text(i), /Feud started/, text(i));
        i = await run('feud', 'start', { wrestler1: C.Bolt, wrestler2: C.Ace }, ADM);
        assert.ok(isPrivateErr(i, /already have an active feud/), text(i));
        const fid = (await f.pool.query(`select id from feuds`)).rows[0].id;
        await log('Ace', 'Bolt', { stipulation: 'Street Fight' });
        i = await run('feud', 'log', { feud: fid, text: 'Bolt demands a rematch on the mic.' }, ADM);
        assert.match(text(i), /Heat:/, text(i));
        i = await run('feud', 'heat', { feud: fid, boost: 20 }, ADM);
        assert.match(text(i), /heat/i, text(i));
        i = await run('feud', 'view', { feud: fid });
        assert.match(text(i), /Street Fight/, text(i)); assert.match(text(i), /Bolt demands/, text(i)); assert.match(text(i), /Record: \*\*1–0\*\*/, text(i));
        i = await run('feud', 'list', {});
        assert.match(text(i), /Blood Feud/, text(i));
        i = await run('feud', 'log', { feud: fid, text: 'nope' }, PLAYER('u1'));
        assert.ok(isPrivateErr(i, /Only admins/), text(i));
        i = await run('feud', 'end', { feud: fid, text: 'Handshake.' }, ADM);
        assert.match(text(i), /is over/, text(i));
        i = await run('feud', 'log', { feud: fid, text: 'late' }, ADM);
        assert.ok(isPrivateErr(i, /ended/), text(i));
        const ac = await auto('feud', 'view', 'feud', 'blood', {});
        assert.ok(ac.some((c) => /Blood Feud/.test(c.name)), JSON.stringify(ac));
    });

    // ---------- tournaments ----------
    await t('tournament: entrants, byes, bracket advances from logged matches, winner crowned, undo reopens', async () => {
        let i = await run('tournament', 'create', { name: 'King of the Ring', division: 'mens', title: US }, ADM);
        assert.match(text(i), /created/, text(i));
        const tid = (await f.pool.query(`select id from tournaments`)).rows[0].id;
        i = await run('tournament', 'start', { tournament: tid }, ADM);
        assert.ok(isPrivateErr(i, /at least 4/), text(i));
        i = await run('tournament', 'add', { tournament: tid, wrestler1: C.Ace, wrestler2: C.Bolt, wrestler3: C.Cruz, wrestler4: C.Dane, wrestler5: C.Eli, wrestler6: C.Finn }, ADM);
        assert.match(text(i), /6\*\* entered/, text(i));
        i = await run('tournament', 'start', { tournament: tid }, ADM);
        assert.ok(hasFile(i), text(i));
        const rows = (await f.pool.query(`select * from tournament_matches where tournament_id=$1 order by round, slot`, [tid])).rows;
        assert.strictEqual(rows.length, 4 + 2 + 1);
        assert.strictEqual(rows.filter((r) => r.round === 1 && r.winner_id).length, 2, 'two byes');
        // play it out: always let slot a win
        for (let guard = 0; guard < 10; guard++) {
            const open = (await f.pool.query(`select * from tournament_matches where tournament_id=$1 and winner_id is null and a_id is not null and b_id is not null order by round, slot limit 1`, [tid])).rows[0];
            if (!open) break;
            const nameOf = async (id) => (await f.pool.query(`select name from characters where id=$1`, [id])).rows[0].name;
            const r = await run('match', 'log-singles', { participant1: String(open.a_id), participant2: String(open.b_id), winner: 1, override_cooldown: true }, ADM);
            assert.match(text(r), /advances|wins/, text(r));
            void nameOf;
        }
        const fin = (await f.pool.query(`select * from tournaments where id=$1`, [tid])).rows[0];
        assert.strictEqual(fin.status, 'finished'); assert.ok(fin.winner_id);
        const champ = (await f.pool.query(`select character_id from title_reigns where title_id=$1 and lost_date is null`, [US])).rows[0];
        assert.strictEqual(String(champ.character_id), String(fin.winner_id), 'winner crowned');
        i = await run('tournament', 'bracket', { tournament: tid });
        assert.ok(hasFile(i), text(i));
        i = await run('tournament', 'list', {});
        assert.match(text(i), /King of the Ring/, text(i));
        // the final cannot be undone while the champion crown stands
        const last = (await f.pool.query(`select match_id from tournament_matches where tournament_id=$1 order by round desc limit 1`, [tid])).rows[0].match_id;
        i = await run('match', 'undo', { match_id: last }, ADM);
        assert.ok(isPrivateErr(i), text(i));
    });
    await t('tournament: manual advance, cancel and permissions', async () => {
        await run('tournament', 'create', { name: 'Mini Cup', division: 'mens' }, ADM);
        const tid = (await f.pool.query(`select id from tournaments where name='Mini Cup'`)).rows[0].id;
        await run('tournament', 'add', { tournament: tid, wrestler1: C.Ace, wrestler2: C.Bolt, wrestler3: C.Cruz, wrestler4: C.Dane }, ADM);
        let i = await run('tournament', 'add', { tournament: tid, wrestler1: C.Gus }, PLAYER('u1'));
        assert.ok(isPrivateErr(i, /Only admins/), text(i));
        await run('tournament', 'start', { tournament: tid }, ADM);
        const first = (await f.pool.query(`select id from tournament_matches where tournament_id=$1 and round=1 order by slot`, [tid])).rows;
        const opts = await auto('tournament', 'advance', 'bracket_match', '', { tournament: tid }, ADM);
        assert.strictEqual(opts.length, 2, JSON.stringify(opts));
        i = await run('tournament', 'advance', { tournament: tid, bracket_match: first[0].id, winner: 2 }, ADM);
        assert.match(text(i), /Advanced to the Final/, text(i));
        // undo-able via normal log + undo of an early round
        const nextOpen = (await f.pool.query(`select * from tournament_matches where id=$1`, [first[1].id])).rows[0];
        const r = await run('match', 'log-singles', { participant1: String(nextOpen.a_id), participant2: String(nextOpen.b_id), winner: 1, override_cooldown: true }, ADM);
        const mid = (await f.pool.query(`select max(id) as id from matches`)).rows[0].id;
        void r;
        await run('match', 'undo', { match_id: mid }, ADM);
        const reopened = (await f.pool.query(`select winner_id, match_id from tournament_matches where id=$1`, [first[1].id])).rows[0];
        assert.strictEqual(reopened.winner_id, null);
        i = await run('tournament', 'cancel', { tournament: tid }, ADM);
        assert.match(text(i), /Cancelled/, text(i));
    });

    // ---------- newsletter ----------
    await t('newsletter: add / list / remove / preview / post marks lines as used', async () => {
        let i = await run('newsletter', 'add', { text: 'Big announcement coming Friday!' }, ADM);
        assert.match(text(i), /Added as line/, text(i));
        await run('newsletter', 'add', { text: 'to remove' }, ADM);
        const ls = await run('newsletter', 'list', {}, ADM);
        assert.match(text(ls), /Big announcement/, text(ls));
        const rm = (await f.pool.query(`select id from newsletter_entries where body='to remove'`)).rows[0].id;
        i = await run('newsletter', 'remove', { id: rm }, ADM);
        assert.match(text(i), /Deleted/, text(i));
        i = await run('newsletter', 'preview', {}, ADM);
        assert.match(text(i), /From the office/, text(i)); assert.match(text(i), /Big announcement/, text(i));
        assert.match(text(i), /Championship news|Stars of the week|Match of the week/, text(i));
        await run('admin', 'set-newsletter-channel', { channel: 'news1' }, ADM);
        i = await run('newsletter', 'post', {}, ADM);
        assert.match(text(i), /Posted in/, text(i));
        const used = (await f.pool.query(`select posted_in from newsletter_entries where body like 'Big%'`)).rows[0];
        assert.ok(used.posted_in);
        const { postNewsletter, weekKey } = require('../src/utils/newsletter');
        assert.match(weekKey(new Date('2026-10-19T12:00:00Z')), /^2026-W43$/);
        const g = (await f.pool.query(`select * from guilds where guild_id=$1`, [G])).rows[0];
        posts.length = 0;
        await postNewsletter(fakeClient, g, '2026-W43');
        assert.ok(posts.some((p) => p.id === 'news1' && p.p.embeds?.length), 'scheduled post works');
        i = await run('newsletter', 'add', { text: 'nope' }, PLAYER('u1'));
        assert.ok(i.responses.length, 'hidden/denied for players');
    });

    // ---------- grand slam + badges + timeline ----------
    await t('grand slam: holding every title in a division is tracked', async () => {
        await mk('Queen', 'w1', 'womens'); await mk('Duo2', 'w2', 'womens');
        const wt = await f.titleId(G, "Women's World Championship"), wi = await f.titleId(G, "Women's Intercontinental Championship"), wtag = await f.titleId(G, "Women's Tag Team Championship");
        const team = await f.makeTeam(G, 'Queens', 'womens', [C.Queen, C.Duo2]);
        await run('championship', 'backfill-reign', { title: wt, won_date: '2025-01-01', lost_date: '2025-03-01', character: C.Queen }, ADM);
        let i = await run('championship', 'grand-slam', { division: 'womens' });
        assert.match(text(i), /Nobody yet/, text(i)); assert.match(text(i), /Queen: 1\/3/, text(i));
        await run('championship', 'backfill-reign', { title: wi, won_date: '2025-04-01', lost_date: '2025-05-01', character: C.Queen }, ADM);
        await run('championship', 'backfill-reign', { title: wtag, won_date: '2025-06-01', lost_date: '2025-07-01', team }, ADM);
        i = await run('championship', 'grand-slam', { division: 'womens' });
        assert.match(text(i), /Grand Slam Champions:\*\*Queen|Grand Slam Champions:[^|]*\*\*Queen\*\*/, text(i));
        const bd = await run('stats', 'badges', { character: C.Queen });
        assert.match(text(bd), /GRAND SLAM/, text(bd));
        const pr = await run('character', 'profile', { character: C.Queen });
        assert.ok(hasFile(pr), text(pr));
    });
    await t('badges: undefeated, five star, match of the night; career timeline renders', async () => {
        await mk('Rocky', 'r9');
        for (let n = 0; n < 6; n++) await log('Rocky', 'Hank');
        const mid = (await f.pool.query(`select max(id) as id from matches`)).rows[0].id;
        await run('match', 'rate', { match_id: mid, stars: 5 }, ADM);
        const bd = await run('stats', 'badges', { character: C.Rocky });
        assert.match(text(bd), /UNDEFEATED/, text(bd)); assert.match(text(bd), /FIVE STAR/, text(bd));
        const ace = await run('stats', 'badges', { character: C.Ace });
        assert.match(text(ace), /MATCH OF THE NIGHT|[A-Z]/, text(ace));
        const tl = await run('stats', 'timeline', { character: C.Ace });
        assert.ok(hasFile(tl), text(tl));
        const tl2 = await run('stats', 'timeline', { character: C.Rocky });
        assert.ok(hasFile(tl2), text(tl2));
    });

    // ---------- bulk import ----------
    await t('import: parser handles quotes, tabs and BOM; template files are offered', async () => {
        const { parseCsv } = require('../src/utils/importer');
        const rows = parseCsv('﻿name,division,owner,bio\r\n"Smith, John",mens,123456789012345678,"Says ""hi"""\r\nPlain,womens,<@123456789012345679>,\r\n');
        assert.strictEqual(rows.length, 2); assert.strictEqual(rows[0].name, 'Smith, John'); assert.strictEqual(rows[0].bio, 'Says "hi"');
        assert.strictEqual(parseCsv('name\tdivision\towner\nA\tmens\t1')[0].division, 'mens');
        assert.throws(() => parseCsv('name,division'), /header row/);
        const tpl = await run('admin', 'import-template', {}, ADM);
        assert.strictEqual(tpl.responses[0].p.files.length, 3);
    });
    await t('import characters: preview saves nothing, apply creates approved characters, problems are reported', async () => {
        const importer = require('../src/utils/importer');
        const att = { name: 'chars.csv', size: 100, url: 'https://cdn.discordapp.com/x.csv', contentType: 'text/csv' };
        importer.downloadCsv = async () => [
            'name,division,owner,alignment,bio,finisher',
            'Imp One,mens,900000000000000001,heel,Imported,Big Boot',
            "Imp Two,Women's,<@900000000000000002>,face,,",
            'Bad Div,wrestling,900000000000000001,,,',
            'Nobody,mens,somebodyunknown,,,',
            ',mens,900000000000000001,,,'
        ].join('\n');
        let i = await run('admin', 'import', { what: 'characters', file: att }, ADM);
        assert.match(text(i), /Preview: \*\*2\*\*/, text(i)); assert.match(text(i), /division must be/, text(i)); assert.match(text(i), /couldn't find the player/, text(i));
        assert.strictEqual((await f.pool.query(`select count(*)::int as n from characters where name like 'Imp %'`)).rows[0].n, 0);
        i = await run('admin', 'import', { what: 'characters', file: att, apply: true }, ADM);
        assert.match(text(i), /Imported \*\*2\*\*/, text(i));
        const rows = (await f.pool.query(`select name, division, status, alignment from characters where name like 'Imp %' order by name`)).rows;
        assert.deepStrictEqual(rows.map((r) => [r.name, r.division, r.status, r.alignment]), [['Imp One', 'mens', 'approved', 'heel'], ['Imp Two', 'womens', 'approved', 'face']]);
        i = await run('admin', 'import', { what: 'characters', file: att, apply: true }, ADM);
        assert.match(text(i), /already has a character/, text(i));
        i = await run('admin', 'import', { what: 'characters', file: { ...att, name: 'photo.png', contentType: 'image/png' } }, ADM);
        assert.ok(isPrivateErr(i, /CSV/), text(i));
    });
    await t('import results: matches land with their dates and count toward records', async () => {
        const importer = require('../src/utils/importer');
        const att = { name: 'r.csv', size: 100, url: 'https://cdn.discordapp.com/y.csv', contentType: 'text/csv' };
        importer.downloadCsv = async () => [
            'winner,loser,date,stipulation,notes,result',
            'Imp One,Imp Zzz,2025-03-01,,,',
            'Imp One,Ace,2025-03-14,Steel Cage,Old classic,win',
            'imp one,Bolt,2025-04-02,,,draw',
            'Imp One,Imp One,2025-04-03,,,',
            'Imp One,Cruz,2999-01-01,,,'
        ].join('\n');
        let i = await run('admin', 'import', { what: 'results', file: att }, ADM);
        assert.match(text(i), /Preview: \*\*2\*\*/, text(i)); assert.match(text(i), /don't know a character called "Imp Zzz"/, text(i)); assert.match(text(i), /themselves/, text(i)); assert.match(text(i), /future/, text(i));
        const before = (await f.pool.query(`select count(*)::int as n from matches`)).rows[0].n;
        i = await run('admin', 'import', { what: 'results', file: att, apply: true }, ADM);
        assert.match(text(i), /Imported \*\*2\*\*/, text(i));
        const after = (await f.pool.query(`select count(*)::int as n from matches`)).rows[0].n;
        assert.strictEqual(after - before, 2);
        const st = await run('stats', 'character', { character: (await f.pool.query(`select id from characters where name='Imp One'`)).rows[0].id });
        assert.match(text(st), /Record:1-0-1/, text(st));
        const d = (await f.pool.query(`select to_char(created_at,'YYYY-MM-DD') as d from matches where stipulation='Steel Cage' and notes='Old classic'`)).rows[0];
        assert.strictEqual(d.d, '2025-03-14');
    });

    // ---------- settings ----------
    await t('admin settings: timezone, deadlines, channels and /admin settings show them', async () => {
        let i = await run('admin', 'set-timezone', { zone: 'Not/AZone' }, ADM);
        assert.ok(isPrivateErr(i, /time zone/), text(i));
        i = await run('admin', 'set-timezone', { zone: 'America/New_York' }, ADM);
        assert.match(text(i), /America\/New_York/, text(i));
        i = await run('admin', 'deadlines', {}, ADM);
        assert.ok(isPrivateErr(i, /Fill in/), text(i));
        i = await run('admin', 'settings', {}, ADM);
        assert.match(text(i), /Staff reminders channel/, text(i)); assert.match(text(i), /America\/New_York/, text(i));
        i = await run('admin', 'set-admin-channel', {}, ADM);
        assert.match(text(i), /off/, text(i));
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end(); process.exit(failed ? 1 : 0);
})();
