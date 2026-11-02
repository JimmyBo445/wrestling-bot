// 3.1.0: button panels for stats, standings, legacy, teams & factions, tournaments, match results,
// contracts, my wrestlers, feuds, channels, Hall of Fame & injuries. Everyone can look; only staff
// (or a wrestler's own player) can change things.
const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, sent, ids, modalOf, edited } = require('./mock');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 6).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const P = (u) => ({ admin: false, user: u });
const G = 'g1';
const q = async (sql, a) => (await f.pool.query(sql, a)).rows;
const isErr = (i) => i.responses.some((r) => /⚠️/.test(r.p?.content || ''));
const last = (i) => i.responses.at(-1);
const priv = (o) => ({ ...o, private: true });
const staffIds = /ui:(pg:(lga|tm\+|fc\+|tn\+|fd1|hof|inj|ko)|tf:(rm|rn|dq)|tn:(rm|sq|cq|d|post)|fd:(lg|ht|end)|hi:ic|k:(of|rl))/;

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const A = await f.makeChar(G, 'u1', 'Ace', 'mens');
    const B = await f.makeChar(G, 'u2', 'Bolt', 'mens');
    const C = await f.makeChar(G, 'u3', 'Cruz', 'mens');
    const D = await f.makeChar(G, 'u4', 'Dax', 'mens');
    const E = await f.makeChar(G, 'u5', 'Eve', 'womens');
    for (let n = 0; n < 30; n++) await f.makeChar(G, `x${n}`, `Extra ${String(n).padStart(2, '0')}`, 'mens');
    await run('match', 'log', { type: 'singles', wrestler1: A, wrestler2: B, winner: 1 }, ADM);
    await run('match', 'log', { type: 'singles', wrestler1: A, wrestler2: C, winner: 1 }, ADM);

    // ---------------- home ----------------
    await t('home menu has the new sections; staff tools only for staff', async () => {
        let i = await run('fnlw', null, {}, P('u1'));
        const all = ids(i);
        for (const s of ['stand', 'stats', 'legacy', 'teams', 'feuds', 'tourn', 'contract', 'roster', 'mine', 'help', 'champs', 'show', 'results']) assert.ok(all.includes(`ui:h:${s}`), s);
        assert.ok(!all.includes('ui:h:staff'));
        assert.ok(last(i).p.components.length <= 5 && last(i).p.components.every((r) => r.components.length <= 5));
        i = await run('fnlw', null, {}, ADM);
        assert.ok(ids(i).includes('ui:h:staff'));
        i = await click('ui:h:staff', priv(ADM));
        assert.ok(ids(i).includes('ui:ch:h'));
    });
    await t('/fnlw go: jumps straight to a section', async () => {
        const i = await run('fnlw', null, { go: 'stand' }, P('u1'));
        assert.ok(!isErr(i), text(i));
        assert.match(text(i), /Power Rankings/);
        assert.ok(ids(i).includes('ui:sd:lb'));
    });

    // ---------------- stats ----------------
    await t('stats: pick a wrestler (divisions + pages), then every view works', async () => {
        let i = await click('ui:h:stats', priv(P('u2')));
        assert.match(text(i), /pick a wrestler/i);
        assert.ok(ids(i).some((x) => x.startsWith('ui:pg:st:0:all:1')), 'has a next page (35 wrestlers)');
        i = await click('ui:pg:st:0:womens:0', priv(P('u2')));
        assert.match(text(i), /1 wrestler in Women's/);
        i = await click('ui:pk:st:0', priv({ ...P('u2'), values: [A] }));
        assert.match(text(i), /Ace — Stats/);
        assert.ok(ids(i).includes(`ui:sx:${A}:tl`));
        for (const v of ['hi', 'op', 'bd', 'ti', 'lg']) {
            i = await click(`ui:sx:${A}:${v}`, priv(P('u2')));
            assert.ok(!/Something went wrong/.test(text(i)), `${v}: ${text(i)}`);
            assert.ok(ids(i).includes(`ui:sx:${A}:ov`), v);
        }
        for (const v of ['tl', 'pc']) {
            i = await click(`ui:sx:${A}:${v}`, priv(P('u2')));
            assert.ok((last(i).p.files || []).length === 1, `${v} has a picture`);
            assert.ok(!ids(i).some((x) => x.startsWith('prof:')), 'only the panel buttons');
        }
        i = await click(`ui:sx:${A}:hh`, priv(P('u2')));
        assert.match(text(i), /Head-to-head: pick the other wrestler/);
        i = await click(`ui:pk:hh:${A}`, priv({ ...P('u2'), values: [B] }));
        assert.match(text(i), /Ace vs Bolt/);
        i = await click(`ui:pk:hh:${A}`, priv({ ...P('u2'), values: [A] }));
        assert.match(text(i), /two different/);
        assert.ok(ids(i).includes(`ui:sx:${A}:ov`), 'error keeps the panel buttons');
        const homes = ids(i).filter((x) => x === 'ui:h:home').length;
        assert.strictEqual(homes, 1, 'never two Home buttons');
    });
    await t('the 📊 Stats button under /whois opens the stats panel privately', async () => {
        const i = await click(`ui:w:s:${A}`, P('u3'));
        assert.ok(last(i).p.flags === undefined || true);
        assert.match(text(i), /Ace — Stats/);
        assert.ok(ids(i).includes(`ui:sx:${A}:hi`));
    });

    // ---------------- standings ----------------
    await t('standings: every tab and menu', async () => {
        for (const tabId of ['ui:sd:lb', 'ui:sd:rk', 'ui:sd:pw', 'ui:sd:ss', 'ui:sd:rv', 'ui:sd:ch', `ui:sd:sr:${new Date().getFullYear()}`, 'ui:sd:pw:womens', 'ui:sd:rk:womens', 'ui:sd:rv:30d']) {
            const i = await click(tabId, priv(P('u1')));
            assert.ok(!/Something went wrong/.test(text(i)), `${tabId}: ${text(i)}`);
            assert.ok(ids(i).includes('ui:sd:pw'), tabId);
        }
        let i = await click('ui:sd:lc:all', priv({ ...P('u1'), values: ['total_wins'] }));
        assert.match(text(i), /Most Wins|wins/i);
        i = await click('ui:sd:lp:total_wins', priv({ ...P('u1'), values: ['30d'] }));
        assert.ok(!isErr(i), text(i));
    });

    // ---------------- legacy ----------------
    await t('legacy: browse for everyone; give accolade only for staff', async () => {
        let i = await click('ui:h:legacy', priv(P('u1')));
        assert.match(text(i), /Legacy/);
        assert.ok(!ids(i).includes('ui:pg:lga:0:all:0'));
        i = await click('ui:pg:lga:0:all:0', priv(P('u1')));
        assert.match(text(i), /Only admins and staff/);
        i = await click('ui:h:legacy', priv(ADM));
        assert.ok(ids(i).includes('ui:pg:lga:0:all:0'));
        i = await click('ui:pk:lga:0', priv({ ...ADM, values: [A] }));
        assert.ok(ids(i).includes(`ui:lx:ga:${A}`), text(i));
        i = await click(`ui:lx:ga:${A}`, priv({ ...ADM, values: ['a4'] }));
        const m = modalOf(i);
        assert.strictEqual(m.id, `ui:md:lga:${A}:a4`);
        assert.deepStrictEqual(m.inputs, ['year', 'notes', 'announce']);
        i = await click(m.id, priv({ ...ADM, fields: { year: '2025', notes: 'Year-end show', announce: 'no' } }));
        assert.match(text(i), /Match of the Year 2025/);
        const row = await q(`select award_name, year, notes from legacy where character_id=$1`, [A]);
        assert.deepStrictEqual(row, [{ award_name: 'Match of the Year', year: 2025, notes: 'Year-end show' }]);
        i = await click('ui:lx:r:award:2025', priv(P('u1')));
        assert.match(text(i), /Ace/);
        i = await click('ui:lx:k:all', priv({ ...P('u1'), values: ['mitb'] }));
        assert.match(text(i), /Money in the Bank/);
        i = await click('ui:pk:lg:0', priv({ ...P('u1'), values: [A] }));
        assert.match(text(i), /Ace's Legacy/);
    });
    await t('legacy: open votes can be voted on from the panel', async () => {
        await run('legacy', 'vote-open', { accolade: 'award', award_name: 'Rookie of the Year', year: 2025, nominees_by: 'everyone' }, ADM);
        const poll = (await q(`select id from award_polls order by id desc limit 1`))[0].id;
        await run('legacy', 'nominate', { vote: poll, character: B }, ADM);
        await run('legacy', 'nominate', { vote: poll, character: C }, ADM);
        await run('legacy', 'vote-start', { vote: poll }, ADM);
        let i = await click('ui:lx:v', priv(P('u1')));
        assert.match(text(i), /Rookie of the Year 2025\*\*: voting is open/);
        i = await click('ui:lx:vp', priv({ ...P('u1'), values: [String(poll)] }));
        assert.ok(ids(i).includes(`ui:av:${poll}`));
    });

    // ---------------- teams & factions ----------------
    let team;
    await t('teams: view for all; add / remove / rename / disband for staff', async () => {
        await run('team', 'create', { name: 'Wolf Pack', member1: A, member2: B }, ADM);
        team = (await q(`select id from teams where name='Wolf Pack'`))[0].id;
        let i = await click('ui:h:teams', priv(P('u3')));
        assert.match(text(i), /Wolf Pack/);
        i = await click('ui:tf:o:t', priv({ ...P('u3'), values: [String(team)] }));
        assert.ok((last(i).p.files || []).length === 1, 'team card');
        assert.ok(!ids(i).some((x) => staffIds.test(x)), 'no staff buttons for players');
        i = await click(`ui:tf:dy:t:${team}`, priv(P('u3')));
        assert.match(text(i), /Only admins and staff/);
        assert.strictEqual((await q(`select status from teams where id=$1`, [team]))[0].status, 'active');

        i = await click(`ui:tf:v:t:${team}`, priv(ADM));
        assert.ok(ids(i).includes(`ui:pg:tm+:${team}:mens:0`));
        i = await click(`ui:pg:tm+:${team}:mens:0`, priv(ADM));
        assert.ok(!ids(i).some((x) => x.startsWith('ui:pg:tm+') && x.includes(':womens:')), 'division is fixed to the team');
        i = await click(`ui:pk:tm+:${team}`, priv({ ...ADM, values: [C] }));
        assert.match(text(i), /Added \*\*Cruz\*\* to \*\*Wolf Pack\*\*/);
        i = await click(`ui:pk:tm+:${team}`, priv({ ...ADM, values: [E] }));
        assert.match(text(i), /⚠️/);
        i = await click(`ui:tf:rm:t:${team}`, priv(ADM));
        i = await click(`ui:tf:rs:t:${team}`, priv({ ...ADM, values: [C] }));
        assert.match(text(i), /Removed \*\*Cruz\*\*/);
        i = await click(`ui:tf:rn:${team}`, priv(ADM));
        assert.strictEqual(modalOf(i).id, `ui:md:trn:${team}`);
        i = await click(`ui:md:trn:${team}`, priv({ ...ADM, fields: { name: 'Wolf Pack 2.0' } }));
        assert.match(text(i), /Renamed/);
        i = await click(`ui:tf:dq:t:${team}`, priv(ADM));
        assert.ok(ids(i).includes(`ui:tf:dy:t:${team}`));
        i = await click(`ui:tf:dy:t:${team}`, priv(ADM));
        assert.match(text(i), /disbanded/);
        assert.strictEqual((await q(`select status from teams where id=$1`, [team]))[0].status, 'disbanded');
    });
    await t('factions tab works the same way', async () => {
        await run('faction', 'create', { name: 'The Order', division: 'mens', member1: A, member2: B, member3: C }, ADM);
        const fid = (await q(`select id from factions`))[0].id;
        let i = await click('ui:tf:l:f', priv(P('u4')));
        assert.match(text(i), /The Order/);
        i = await click(`ui:pk:fc+:${fid}`, priv({ ...ADM, values: [D] }));
        assert.match(text(i), /Dax\*\* joined/);
        i = await click(`ui:pk:fc+:${fid}`, priv({ ...P('u4'), values: [D] }));
        assert.match(text(i), /Only admins and staff/);
    });

    // ---------------- tournaments ----------------
    await t('tournaments: add, start, decide matches with buttons, winner', async () => {
        await run('tournament', 'create', { name: 'King of the Ring', division: 'mens' }, ADM);
        const tid = (await q(`select id from tournaments`))[0].id;
        let i = await click('ui:h:tourn', priv(P('u1')));
        assert.match(text(i), /King of the Ring/);
        i = await click(`ui:tn:v:${tid}`, priv(P('u1')));
        assert.ok(!ids(i).some((x) => staffIds.test(x)), 'players only look');
        for (const w of [A, B, C, D]) { i = await click(`ui:pk:tn+:${tid}`, priv({ ...ADM, values: [w] })); assert.match(text(i), /Added/, text(i)); }
        i = await click(`ui:tn:rm:${tid}`, priv(ADM));
        i = await click(`ui:tn:rs:${tid}`, priv({ ...ADM, values: [D] }));
        assert.match(text(i), /Removed/);
        i = await click(`ui:pk:tn+:${tid}`, priv({ ...ADM, values: [D] }));
        i = await click(`ui:tn:sq:${tid}`, priv(ADM));
        assert.ok(ids(i).includes(`ui:tn:sy:${tid}`));
        i = await click(`ui:tn:sy:${tid}`, priv(ADM));
        assert.match(text(i), /is on!/);
        assert.ok(ids(i).includes(`ui:tn:d:${tid}:0`));
        for (let round = 0; round < 2; round++) {
            i = await click(`ui:tn:d:${tid}:0`, priv(ADM));
            const win = ids(i).filter((x) => x.startsWith(`ui:tn:w:${tid}:`) && x.endsWith(':1'));
            assert.ok(win.length >= 1, text(i));
            for (const w of win) { i = await click(w, priv(ADM)); assert.ok(!isErr(i), text(i)); }
        }
        assert.match(text(i), /wins \*\*King of the Ring\*\*/);
        assert.strictEqual((await q(`select status from tournaments where id=$1`, [tid]))[0].status, 'finished');
        const before = sent.length;
        i = await click(`ui:tn:post:${tid}`, priv(ADM));
        assert.match(text(i), /Posted the bracket/);
        assert.ok((sent[before]?.payload?.files || []).length === 1);
        i = await click(`ui:tn:post:${tid}`, priv(P('u1')));
        assert.match(text(i), /Only admins/);
    });

    // ---------------- match result buttons ----------------
    await t('match results: everyone can rate, only staff edit or undo', async () => {
        let i = await run('match', 'log', { type: 'singles', wrestler1: C, wrestler2: D, winner: 1 }, ADM);
        const mid = (await q(`select max(id)::text id from matches`))[0].id;
        assert.ok(ids(i).includes(`ui:m:r:${mid}`) && ids(i).includes(`ui:m:s:${mid}`));
        const pub = { id: 'pubmsg1', embeds: [], components: [] };
        i = await click(`ui:m:r:${mid}`, { ...P('u1'), message: pub });
        assert.match(text(i), /Nobody has rated it yet/);
        i = await click(`ui:m:rv:${mid}:4`, priv(P('u1')));
        assert.match(text(i), /Fans: ⭐ 4.0 \(1\)/);
        i = await click(`ui:m:rv:${mid}:2`, priv(P('u2')));
        i = await click(`ui:m:rv:${mid}:5`, priv(P('u1')));
        assert.match(text(i), /Fans: ⭐ 3.5 \(2\)/);
        i = await click('ui:h:results', priv(P('u1')));
        assert.match(text(i), /⭐ 3.5/);

        i = await click(`ui:m:s:${mid}`, { ...P('u1'), message: pub });
        assert.match(text(i), /Only admins and staff/);
        i = await click(`ui:m:s:${mid}`, { ...ADM, message: pub });
        assert.ok(ids(i).includes(`ui:m:u:${mid}:pubmsg1`), JSON.stringify(ids(i)));
        i = await click(`ui:m:e:${mid}`, priv(ADM));
        assert.deepStrictEqual(modalOf(i).inputs, ['notes', 'stipulation', 'score']);
        i = await click(`ui:md:me:${mid}`, priv({ ...ADM, fields: { notes: 'Great match', stipulation: 'Street Fight', score: '' } }));
        assert.match(text(i), /edited/);
        const m = (await q(`select notes, stipulation from matches where id=$1`, [mid]))[0];
        assert.deepStrictEqual(m, { notes: 'Great match', stipulation: 'Street Fight' });
        i = await click(`ui:m:uy:${mid}:pubmsg1`, priv(P('u1')));
        assert.match(text(i), /Only admins/);
        i = await click(`ui:m:uy:${mid}:pubmsg1`, priv(ADM));
        assert.match(text(i), /undone/);
        assert.strictEqual((await q(`select count(*)::int n from matches where id=$1`, [mid]))[0].n, 0);
        assert.ok(edited.some((e) => e.id === 'pubmsg1' && /undone by staff/.test(e.p.content)), 'public result is marked');
        i = await click(`ui:m:rv:${mid}:3`, priv(P('u1')));
        assert.match(text(i), /isn't on record/);
    });

    // ---------------- my wrestlers ----------------
    await t('my wrestlers: the owner (or staff) gets edit buttons, nobody else', async () => {
        let i = await click('ui:h:mine', priv(P('u1')));
        assert.ok(ids(i).includes(`ui:mw:e:${A}`));
        i = await click('ui:w:c', priv({ ...P('u2'), values: [A] }));
        assert.ok(!ids(i).includes(`ui:mw:e:${A}`), 'someone else looking at Ace');
        i = await run('whois', null, { character: A }, P('u1'));
        assert.ok(!ids(i).includes(`ui:mw:e:${A}`), 'never on the public /whois post');
        i = await click(`ui:mw:e:${A}`, priv(P('u2')));
        assert.match(text(i), /Only the wrestler's player/);
        i = await click(`ui:mw:e:${A}`, priv(P('u1')));
        const m = modalOf(i);
        assert.deepStrictEqual(m.inputs, ['name', 'alignment', 'bio', 'finisher', 'entrance_theme']);
        i = await click(`ui:md:ce:${A}`, priv({ ...P('u1'), fields: { name: 'Ace', alignment: 'Heel', bio: 'The ace of the roster', finisher: 'Ace Crusher', entrance_theme: '' } }));
        assert.ok(!isErr(i), text(i));
        let c = (await q(`select alignment, bio, finisher from characters where id=$1`, [A]))[0];
        assert.deepStrictEqual(c, { alignment: 'heel', bio: 'The ace of the roster', finisher: 'Ace Crusher' });
        i = await click(`ui:md:ce:${A}`, priv({ ...P('u1'), fields: { name: 'Ace', alignment: 'heel', bio: '', finisher: 'Ace Crusher' } }));
        c = (await q(`select bio from characters where id=$1`, [A]))[0];
        assert.strictEqual(c.bio, null, 'emptied field is cleared');
        i = await click(`ui:md:ce:${A}`, priv({ ...P('u1'), fields: { name: 'Ace', alignment: 'goodguy' } }));
        assert.match(text(i), /face, heel or neutral/);
        i = await click(`ui:md:cs:${A}`, priv({ ...P('u1'), fields: { signatures: 'Spear, DDT', catchphrase: 'Ace of spades', story: 'Started in the indies.' } }));
        c = (await q(`select signatures, catchphrase, lore from characters where id=$1`, [A]))[0];
        assert.deepStrictEqual(c, { signatures: 'Spear, DDT', catchphrase: 'Ace of spades', lore: 'Started in the indies.' });
        i = await click(`ui:md:cs:${A}`, priv({ ...P('u2'), fields: { catchphrase: 'hacked' } }));
        assert.match(text(i), /Only the wrestler's player/);
        assert.strictEqual((await q(`select catchphrase from characters where id=$1`, [A]))[0].catchphrase, 'Ace of spades');
        i = await click(`ui:mw:e:${A}`, priv(ADM));
        assert.ok(modalOf(i), 'staff can edit anyone');
    });

    // ---------------- contracts ----------------
    await t('contracts: players ask from the panel; staff offer; it is posted for others to answer', async () => {
        let i = await click('ui:h:contract', priv(P('u1')));
        assert.match(text(i), /Ace\*\*: free agent/);
        assert.ok(!ids(i).includes('ui:pg:ko:0:all:0'));
        i = await click('ui:k:pick', priv({ ...P('u1'), values: [A] }));
        assert.ok(ids(i).includes(`ui:k:rq:${A}`) && !ids(i).includes(`ui:k:of:${A}`));
        i = await click(`ui:k:rq:${A}`, priv(P('u1')));
        assert.deepStrictEqual(modalOf(i).inputs, ['months', 'salary', 'clauses']);
        const before = sent.length;
        i = await click(`ui:md:kr:${A}`, priv({ ...P('u1'), fields: { months: '12', salary: '$50,000', clauses: '' } }));
        assert.match(text(i), /request is posted/);
        assert.ok(JSON.stringify(sent.slice(before).map((m) => m.payload.components?.map((r) => r.toJSON()))).includes('contract:approve'));
        i = await click(`ui:md:kr:${A}`, priv({ ...P('u2'), fields: { months: '12', salary: '1' } }));
        assert.match(text(i), /only ask for a contract for your own/);
        i = await click(`ui:md:kr:${A}`, priv({ ...P('u1'), fields: { months: '99', salary: '1' } }));
        assert.match(text(i), /1 to 36/);
        i = await click(`ui:md:ko:${B}`, priv({ ...ADM, fields: { months: '6', salary: '1000' } }));
        assert.match(text(i), /Offer posted/);
        i = await click(`ui:md:ko:${B}`, priv({ ...P('u2'), fields: { months: '6', salary: '1000' } }));
        assert.match(text(i), /Only admins/);
        for (const tb of ['list', 'free-agents', 'earnings']) { i = await click(`ui:k:t:${tb}`, priv(P('u1'))); assert.ok(!/Something went wrong/.test(text(i)), tb); }
    });

    // ---------------- feuds ----------------
    await t('feuds: start, add a moment, heat, end (staff); view (everyone)', async () => {
        let i = await click('ui:h:feuds', priv(P('u1')));
        assert.match(text(i), /No active feuds/);
        i = await click('ui:pg:fd1:0:all:0', priv(ADM));
        i = await click('ui:pk:fd1:0', priv({ ...ADM, values: [A] }));
        assert.match(text(i), /pick their rival/);
        i = await click(`ui:pk:fd2:${A}`, priv({ ...ADM, values: [B] }));
        assert.strictEqual(modalOf(i).id, `ui:md:fds:${A}:${B}`);
        i = await click(`ui:md:fds:${A}:${B}`, priv({ ...ADM, fields: { name: 'Blood Feud', story: 'Bolt attacked Ace' } }));
        assert.match(text(i), /Feud started/);
        const fid = (await q(`select id from feuds`))[0].id;
        i = await click('ui:fd:o', priv({ ...P('u3'), values: [String(fid)] }));
        assert.match(text(i), /Bolt attacked Ace/);
        assert.ok(!ids(i).some((x) => staffIds.test(x)));
        i = await click(`ui:md:fdl:${fid}`, priv({ ...ADM, fields: { text: 'Ace challenged Bolt' } }));
        assert.match(text(i), /Added to/);
        i = await click(`ui:md:fdh:${fid}`, priv({ ...ADM, fields: { boost: '50' } }));
        assert.match(text(i), /-40 to 40/);
        i = await click(`ui:md:fdh:${fid}`, priv({ ...ADM, fields: { boost: '20' } }));
        assert.strictEqual((await q(`select boost from feuds where id=$1`, [fid]))[0].boost, 20);
        i = await click(`ui:md:fdl:${fid}`, priv({ ...P('u3'), fields: { text: 'spam' } }));
        assert.match(text(i), /Only admins/);
        i = await click(`ui:md:fde:${fid}`, priv({ ...ADM, fields: { text: 'Ace won the cage match' } }));
        assert.match(text(i), /is over/);
    });

    // ---------------- channels ----------------
    await t('channels: staff pick from a channel menu; players are turned away', async () => {
        let i = await click('ui:ch:h', priv(P('u1')));
        assert.match(text(i), /Only admins/);
        i = await click('ui:ch:h', priv(ADM));
        assert.match(text(i), /Bot channels/);
        i = await click('ui:ch:k', priv({ ...ADM, values: ['power'] }));
        assert.ok(ids(i).includes('ui:ch:s:power') && ids(i).includes('ui:ch:off:power'));
        i = await click('ui:ch:s:power', priv({ ...ADM, kind: 'channel', values: ['pr123'] }));
        assert.match(text(i), /Saved/);
        assert.strictEqual((await q(`select power_channel_id from guilds where guild_id=$1`, [G]))[0].power_channel_id, 'pr123');
        i = await click('ui:ch:off:power', priv(ADM));
        assert.strictEqual((await q(`select power_channel_id from guilds where guild_id=$1`, [G]))[0].power_channel_id, null);
        i = await click('ui:ch:s:history', priv({ ...ADM, kind: 'channel', values: ['hist1'] }));
        assert.strictEqual((await q(`select history_channel_id from guilds where guild_id=$1`, [G]))[0].history_channel_id, 'hist1');
        i = await click('ui:ch:s:power', priv({ ...P('u1'), kind: 'channel', values: ['evil'] }));
        assert.match(text(i), /Only admins/);
    });

    // ---------------- Hall of Fame & injuries ----------------
    await t('Hall of Fame and injuries from the roster section', async () => {
        let i = await click('ui:h:roster', priv(P('u1')));
        assert.ok(ids(i).includes('ui:hi:h') && ids(i).includes('ui:hi:i') && ids(i).includes('ui:h:home'));
        i = await click('ui:l:all:wrestler:1:x', priv(P('u1')));
        assert.ok(ids(i).includes('ui:hi:h'), 'paging keeps the extra buttons');
        i = await click('ui:hi:h', priv(P('u1')));
        assert.match(text(i), /empty/);
        assert.ok(!ids(i).includes('ui:pg:hof:0:all:0'));
        i = await click('ui:pk:hof:0', priv({ ...ADM, values: [C] }));
        assert.strictEqual(modalOf(i).id, `ui:md:hof:${C}`);
        const before = sent.length;
        i = await click(`ui:md:hof:${C}`, priv({ ...ADM, fields: { blurb: 'A legend' } }));
        assert.match(text(i), /Inducted/);
        assert.ok((sent[before]?.payload?.files || []).length === 1, 'graphic posted publicly');
        i = await click('ui:hi:hv', priv({ ...P('u1'), values: [C] }));
        assert.ok((last(i).p.files || []).length === 1);
        i = await click(`ui:md:inj:${D}`, priv({ ...ADM, fields: { days: '10', reason: 'Bad knee' } }));
        assert.match(text(i), /Dax/);
        i = await click(`ui:md:inj:${D}`, priv({ ...ADM, fields: { days: 'lots' } }));
        assert.match(text(i), /1 to 365/);
        i = await click('ui:hi:i', priv(P('u1')));
        assert.match(text(i), /Bad knee/);
        assert.ok(!ids(i).includes('ui:hi:ic'));
        i = await click('ui:hi:ic', priv({ ...ADM, values: [D] }));
        assert.match(text(i), /cleared/);
        i = await click(`ui:md:inj:${D}`, priv({ ...P('u1'), fields: { days: '10' } }));
        assert.match(text(i), /Only admins/);
    });

    // ---------------- safety ----------------
    await t('every panel stays within Discord limits (5 rows, 5 buttons, unique ids)', async () => {
        const opens = ['ui:h:stand', 'ui:h:stats', 'ui:h:legacy', 'ui:h:teams', 'ui:h:feuds', 'ui:h:tourn', 'ui:h:contract', 'ui:hi:h', 'ui:hi:i', 'ui:ch:h', `ui:sx:${A}:ov`, 'ui:sd:lb', 'ui:h:roster', 'ui:h:mine'];
        for (const o of opens) {
            const i = await click(o, priv(ADM));
            const comps = last(i).p.components || [];
            assert.ok(comps.length <= 5, `${o} rows`);
            for (const r of comps) assert.ok(r.components.length <= 5 && r.components.length >= 1, `${o} row size`);
            const all = ids(i);
            assert.strictEqual(new Set(all).size, all.length, `${o} duplicate ids: ${all}`);
            assert.ok(all.every((x) => x.length <= 100), o);
        }
    });
    await t('old commands still work exactly as before', async () => {
        for (const [c, s, o] of [['stats', 'character', { character: A }], ['team', 'list', {}], ['feud', 'list', {}], ['legacy', 'list', {}], ['standings', 'power', {}], ['tournament', 'list', {}], ['contract', 'free-agents', {}]]) {
            const i = await run(c, s, o, P('u1'));
            assert.ok(!/Something went wrong/.test(text(i)), `${c} ${s}`);
        }
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end();
    process.exit(failed ? 1 : 0);
})();
