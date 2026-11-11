// 3.0.0: award voting, PLE tags, /match log, power rankings, staff error alerts
const assert = require('assert');
const f = require('./fixtures');
const { run, auto, click, text, sent } = require('./mock');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 5).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const P = (u) => ({ admin: false, user: u });
const G = 'g1';
const q = async (sql, a) => (await f.pool.query(sql, a)).rows;
const isErr = (i) => i.responses.some((r) => /⚠️/.test(r.p?.content || ''));
const ids = (i) => JSON.stringify((i.responses.at(-1)?.p?.components || []).map((r) => (r.toJSON ? r.toJSON() : r)));
const posts = (ch, from) => sent.slice(from).filter((m) => m.channelId === ch);

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const A = await f.makeChar(G, 'u1', 'Ace', 'mens');
    const B = await f.makeChar(G, 'u2', 'Bolt', 'mens');
    const C = await f.makeChar(G, 'u3', 'Cruz', 'mens');
    const D = await f.makeChar(G, 'u4', 'Dax', 'mens');
    const E = await f.makeChar(G, 'u5', 'Eve', 'womens');
    const WH = await f.titleId(G, 'World Heavyweight Championship');
    await run('admin', 'channels', { legacy: 'legch', staff: 'staffch' }, ADM);

    // ---------------- /match log ----------------
    await t('/match log logs singles, tags and multi-person matches like the old commands', async () => {
        let i = await run('match', 'log', { type: 'singles', wrestler1: A, wrestler2: B, winner: 1 }, ADM);
        assert.ok(!isErr(i), text(i));
        i = await run('match', 'log', { type: 'tag2v2', wrestler1: A, wrestler2: B, wrestler3: C, wrestler4: D, winner: 2, stipulation: 'Tables Match', finish: 'pinfall' }, ADM);
        assert.ok(!isErr(i), text(i));
        const m = (await q(`select match_type, stipulation, finish from matches order by id desc limit 1`))[0];
        assert.deepStrictEqual(m, { match_type: 'tag2v2', stipulation: 'Tables Match', finish: 'pinfall' });
        const win = await q(`select c.name from match_participants mp join characters c on c.id=mp.character_id where mp.is_winner and mp.match_id=(select max(id) from matches) order by c.name`);
        assert.deepStrictEqual(win.map((r) => r.name), ['Cruz', 'Dax']);
        i = await run('match', 'log', { type: 'triple_threat', wrestler1: A, wrestler2: B, wrestler3: C, winner: 3 }, ADM);
        assert.ok(!isErr(i), text(i));
    });

    await t('/match log explains a wrong number of wrestlers or a bad winner', async () => {
        let i = await run('match', 'log', { type: 'tag2v2', wrestler1: A, wrestler2: B, winner: 1 }, ADM);
        assert.match(text(i), /has \*\*4\*\* wrestlers.*Team 1 is wrestler1-2, Team 2 is wrestler3-4/s);
        i = await run('match', 'log', { type: 'singles', wrestler1: A, wrestler2: B, wrestler3: C, winner: 1 }, ADM);
        assert.match(text(i), /and nothing after that/);
        i = await run('match', 'log', { type: 'tag2v2', wrestler1: A, wrestler2: B, wrestler3: C, wrestler4: D, winner: 3 }, ADM);
        assert.match(text(i), /winning team: 1 or 2/);
        i = await run('match', 'log', { type: 'singles', wrestler1: A, wrestler2: B, winner: 1 }, P('u9'));
        assert.match(text(i), /Only admins and staff/);
    });

    await t('the old /match log-... commands are retired from Discord (3.5) but old clicks still work', async () => {
        const i = await run('match', 'log-singles', { participant1: C, participant2: D, winner: 2, finish: 'dq' }, ADM);
        assert.ok(!isErr(i), text(i));
        const c = await auto('match', 'log-singles', 'finish', 'disq', {}, ADM);
        assert.deepStrictEqual(c.map((x) => x.value), ['dq']);
        const json = require('../src/commands/match').data.toJSON();
        assert.ok(!json.options.some((o) => o.name.startsWith('log-')));
        assert.deepStrictEqual(json.options.map((o) => o.name), ['log', 'ple', 'rate', 'undo', 'edit', 'recent', 'report']);
    });

    // ---------------- PLE ----------------
    await t('/match log ple: tags the match; a MITB win at a PLE gives the Legacy accolade and announces it', async () => {
        const before = sent.length;
        const i = await run('match', 'log', { type: 'fatal4way', wrestler1: A, wrestler2: B, wrestler3: C, wrestler4: D, winner: 2, stipulation: 'Money in the Bank Ladder', ple: 'Money in the Bank 2026' }, ADM);
        assert.ok(!isErr(i), text(i));
        assert.match(text(i), /Part of \*\*Money in the Bank \d{4}\*\*.*Bolt earned \*\*Money in the Bank \(Men's\) \d{4}\*\*/s);
        assert.strictEqual((await q(`select ple from matches order by id desc limit 1`))[0].ple, 'Money in the Bank', 'the year is not stored in the name');
        const l = await q(`select kind, division, holder_name, notes from legacy`);
        assert.deepStrictEqual(l.map((x) => [x.kind, x.division, x.holder_name]), [['mitb', 'mens', 'Bolt']]);
        assert.ok(posts('legch', before).length === 1);
    });

    await t('/match ple tags every match logged today; clear removes it; a plain PLE match gives no accolade', async () => {
        let i = await run('match', 'ple', { event: 'WrestleMania' }, ADM);
        assert.match(text(i), /Tagged \d+ matches as \*\*WrestleMania\*\*/);
        assert.doesNotMatch(text(i), /earned/);
        const n = (await q(`select count(*)::int n from matches where ple='WrestleMania'`))[0].n;
        assert.ok(n >= 4);
        const last = (await q(`select id from matches order by id desc limit 1`))[0].id;
        i = await run('match', 'ple', { match_id: Number(last), clear: true }, ADM);
        assert.match(text(i), /Removed the PLE tag from 1 match/);
        i = await run('match', 'ple', { event: 'Backlash', date: '2001-01-01' }, ADM);
        assert.match(text(i), /No matches were logged on 2001-01-01/);
        const c = await auto('match', 'ple', 'event', 'wrest', {}, ADM);
        assert.ok(c.some((x) => x.value === 'WrestleMania'));
    });

    await t('PLE history, PLE record on stats, and "won at" on title reigns', async () => {
        let i = await run('match', 'ple', {}, ADM);
        assert.match(text(i), /Premium Live Events.*WrestleMania \d{4}.*Most PLE wins/s);
        i = await run('stats', 'character', { character: B }, P('u9'));
        assert.match(text(i), /At PLEs:\d+-\d+/);
        i = await run('match', 'log', { type: 'singles', wrestler1: A, wrestler2: C, winner: 1, title: WH, ple: 'SummerSlam' }, ADM);
        assert.ok(!isErr(i), text(i));
        const all = (await require('../src/utils/historyChannel').renderHistory(G)).join('\n');
        assert.match(all, /\(won at SummerSlam \d{4}\)/);
        i = await run('championship', 'records', { title: WH }, P('u9'));
        assert.match(text(i), /won at SummerSlam/);
    });

    // ---------------- award voting ----------------
    let pollId;
    await t('vote-open: admins only; posts a nominations message; one open vote per award', async () => {
        let i = await run('legacy', 'vote-open', { accolade: 'award', award_name: 'Rookie of the Year', year: 2025 }, P('u1'));
        assert.match(text(i), /Only admins and staff/);
        const before = sent.length;
        i = await run('legacy', 'vote-open', { accolade: 'award', award_name: 'rookie of the year', year: 2025, nominees_by: 'everyone' }, ADM);
        assert.match(text(i), /Opened \*\*Rookie of the Year 2025\*\* in <#legch>.*anyone can/s);
        assert.match(posts('legch', before)[0].payload.embeds[0].data.title, /Rookie of the Year 2025: nominations/);
        pollId = (await q(`select id from award_polls`))[0].id;
        i = await run('legacy', 'vote-open', { accolade: 'award', award_name: 'Rookie of the Year', year: 2025 }, ADM);
        assert.match(text(i), /already an open vote/);
    });

    await t('nominate: anyone when the vote allows it; duplicates refused; rivalries can name two wrestlers', async () => {
        let i = await run('legacy', 'nominate', { vote: Number(pollId), character: A }, P('u9'));
        assert.match(text(i), /Ace\*\* is nominated/);
        i = await run('legacy', 'nominate', { vote: Number(pollId), character: A }, P('u8'));
        assert.match(text(i), /already nominated/);
        i = await run('legacy', 'nominate', { vote: Number(pollId), character: B, character2: C, label: 'Bolt vs Cruz' }, ADM);
        assert.match(text(i), /Bolt vs Cruz\*\* is nominated/);
        const c = await auto('legacy', 'nominate', 'vote', 'rook', {}, P('u9'));
        assert.strictEqual(c[0].value, Number(pollId));
    });

    await t('admins-only nominations refuse members', async () => {
        await run('legacy', 'vote-open', { accolade: 'mvp', year: 2025 }, ADM);
        const mvp = (await q(`select id from award_polls where kind='mvp'`))[0].id;
        const i = await run('legacy', 'nominate', { vote: Number(mvp), character: E }, P('u9'));
        assert.match(text(i), /Only admins and staff/);
        await run('legacy', 'vote-close', { vote: Number(mvp), cancel: true }, ADM);
    });

    await t('vote-start needs 2 nominees, then posts a secret vote dropdown; votes can change; totals stay hidden', async () => {
        let i = await run('legacy', 'vote-start', { vote: Number(pollId) }, ADM);
        assert.match(text(i), /Voting is open/);
        const nominees = await q(`select id, label from award_nominees where poll_id=$1 order by id`, [pollId]);
        const ace = nominees.find((n) => n.label === 'Ace').id, rival = nominees.find((n) => n.label === 'Bolt vs Cruz').id;
        i = await click(`ui:av:${pollId}`, { values: [String(ace)], admin: false, user: 'v1' });
        assert.match(text(i), /Your vote for \*\*Ace\*\* is saved\. It's secret/);
        assert.strictEqual(i.responses[0].p.flags & 64, 64, 'private');
        await click(`ui:av:${pollId}`, { values: [String(rival)], admin: false, user: 'v2' });
        await click(`ui:av:${pollId}`, { values: [String(rival)], admin: false, user: 'v3' });
        await click(`ui:av:${pollId}`, { values: [String(ace)], admin: false, user: 'v3' }); // changed their mind
        await click(`ui:av:${pollId}`, { values: [String(rival)], admin: false, user: 'v4' });
        await click(`ui:av:${pollId}`, { values: [String(rival)], admin: false, user: 'v5' });
        assert.strictEqual((await q(`select count(*)::int n from award_votes where poll_id=$1`, [pollId]))[0].n, 5);
        i = await run('legacy', 'nominate', { vote: Number(pollId), character: D }, ADM);
        assert.match(text(i), /Nominations for that vote are closed/);
    });

    await t('vote-close: the winner gets the accolade (both wrestlers of a rivalry); the public post shows only the winner', async () => {
        const before = sent.length;
        const i = await run('legacy', 'vote-close', { vote: Number(pollId) }, ADM);
        assert.match(text(i), /Bolt vs Cruz\*\* won.*Totals \(only you can see these\):.*3 · Bolt vs Cruz.*2 · Ace/s);
        assert.strictEqual(i.responses.at(-1).p.flags & 64, 64, 'totals are private');
        const l = await q(`select holder_name, award_name, year, notes from legacy where kind='award' order by holder_name`);
        assert.deepStrictEqual(l.map((x) => [x.holder_name, x.award_name, x.year]), [['Bolt', 'Rookie of the Year', 2025], ['Cruz', 'Rookie of the Year', 2025]]);
        const pub = posts('legch', before).map((m) => JSON.stringify(m.payload));
        assert.ok(pub.some((p) => /Bolt.*Rookie of the Year 2025.*Voted by the FNLW community/.test(p)), 'winner announced in the Legacy channel');
        assert.ok(pub.every((p) => !/\b3 ·|votes:/.test(p)), 'no totals in public');
        const again = await click(`ui:av:${pollId}`, { values: ['1'], admin: false, user: 'v9' });
        assert.match(text(again), /Voting for that award is closed/);
    });

    await t('a tie awards nothing; admins-only voting refuses members', async () => {
        await run('legacy', 'vote-open', { accolade: 'award', award_name: 'Match of the Year', year: 2025, voters: 'admins' }, ADM);
        const p = (await q(`select id from award_polls where award_name='Match of the Year'`))[0].id;
        await run('legacy', 'nominate', { vote: Number(p), character: A }, ADM);
        await run('legacy', 'nominate', { vote: Number(p), character: D }, ADM);
        await run('legacy', 'vote-start', { vote: Number(p) }, ADM);
        const [n1, n2] = (await q(`select id from award_nominees where poll_id=$1 order by id`, [p])).map((r) => r.id);
        let i = await click(`ui:av:${p}`, { values: [String(n1)], admin: false, user: 'v1' });
        assert.match(text(i), /Only admins and staff vote/);
        await click(`ui:av:${p}`, { values: [String(n1)], admin: true, user: 'a1' });
        await click(`ui:av:${p}`, { values: [String(n2)], admin: true, user: 'a2' });
        i = await run('legacy', 'vote-close', { vote: Number(p) }, ADM);
        assert.match(text(i), /tie/);
        assert.strictEqual((await q(`select count(*)::int n from legacy where award_name='Match of the Year'`))[0].n, 0);
    });

    // ---------------- power rankings ----------------
    await t('power rankings weigh wins, opponents, titles and form; arrows show movement week to week', async () => {
        const PR = require('../src/utils/powerRankings');
        const ranked = await PR.computePower(G, 'mens');
        assert.ok(ranked.length >= 4);
        assert.ok(ranked[0].score >= ranked[ranked.length - 1].score);
        assert.strictEqual(ranked.find((r) => r.name === 'Ace').champ, true);
        await PR.saveSnapshot(G, 'mens', '2026-W01', [...ranked].reverse());
        const { embed } = await PR.powerEmbed(G, 'mens', '2026-W02');
        assert.match(embed.data.description, /▲\d/);
        assert.match(embed.data.description, /▼\d/);
        const i = await run('standings', 'power', { division: 'mens' }, P('u9'));
        assert.match(text(i), /Men's Power Rankings/);
        const all = await run('standings', 'power', {}, P('u9'));
        assert.match(text(all), /Women's Power Rankings.*Eve|Women's Power Rankings.*Nobody/s);
    });

    await t('the weekly post goes to the power rankings channel once and saves the order', async () => {
        await run('admin', 'channels', { power: 'powch' }, ADM);
        const g = (await q(`select * from guilds where guild_id=$1`, [G]))[0];
        const before = sent.length;
        const n = await require('../src/utils/powerRankings').postWeekly(require('./mock').client, g, '2026-W03');
        assert.ok(n >= 1);
        assert.match(posts('powch', before)[0].payload.content, /Power Rankings/);
        assert.ok((await q(`select count(*)::int n from power_snapshots where week='2026-W03'`))[0].n >= 4);
    });

    // ---------------- error alerts ----------------
    await t('an unexpected error is reported to the staff channel once, not over and over', async () => {
        const { resetAlerts } = require('../src/utils/alerts');
        resetAlerts();
        const legacy = require('../src/commands/legacy');
        const orig = legacy.execute;
        legacy.execute = async () => { throw new Error('database hiccup'); };
        const before = sent.length;
        let i = await run('legacy', 'list', {}, P('u9'));
        assert.match(text(i), /Something went wrong on my side/);
        await new Promise((r) => setTimeout(r, 100)); // the alert is sent in the background
        i = await run('legacy', 'list', {}, P('u9'));
        await new Promise((r) => setTimeout(r, 100));
        legacy.execute = orig;
        const alerts = posts('staffch', before);
        assert.strictEqual(alerts.length, 1, 'only once');
        assert.match(alerts[0].payload.content, /Bot problem.*\/legacy list.*database hiccup/s);
        assert.deepStrictEqual(alerts[0].payload.allowedMentions, { parse: [] });
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end();
    process.exit(failed ? 1 : 0);
})();
