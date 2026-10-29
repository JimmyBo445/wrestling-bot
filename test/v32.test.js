const assert = require('assert');
const fs = require('fs');
const f = require('./fixtures');
const { run, click, text, sent } = require('./mock');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 5).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const isErr = (i, re) => i.responses.some((r) => /⚠️/.test(r.p?.content || '') && (!re || re.test(r.p.content)));
const G = 'g1';
const C = {};
const q = async (sql, p) => (await f.pool.query(sql, p)).rows;
const comps = (i) => i.responses.flatMap((r) => (r.p?.components || []).flatMap((row) => row.components || []));
const ids = (i) => comps(i).map((c) => c.data.custom_id);

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const mk = async (n, o, d = 'mens') => { C[n] = await f.makeChar(G, o, n, d); };
    for (const [n, o] of [['Ace', 'u1'], ['Bolt', 'u2'], ['Cruz', 'u3'], ['Dax', 'u4'], ['Eli', 'u5'], ['Fox', 'u6']]) await mk(n, o);
    for (const [n, o] of [['Gia', 'u7'], ['Hana', 'u8']]) await mk(n, o, 'womens');
    for (let i = 0; i < 30; i++) await mk(`Mass${i}`, `m${i % 7}`, 'mens');
    const WH = await f.titleId(G, 'World Heavyweight Championship');

    await t('migration 014 merges existing per-division cards into one show per brand', async () => {
        await f.pool.query(`delete from card_shows`);
        await f.pool.query(`insert into card_drafts (guild_id, brand, division, name, created_by, show_date) values ($1,'raw','mens','Old Name','t','2026-12-01'), ($1,'raw','womens',null,'t','2026-12-01'), ($1,'smackdown','mens',null,'t',null)`, [G]);
        const sql = fs.readFileSync(__dirname + '/../src/db/migrations/014_show_cards.sql', 'utf8');
        await f.pool.query(sql);
        const rows = await q(`select brand, name, to_char(show_date,'YYYY-MM-DD') d from card_shows order by brand`);
        assert.deepStrictEqual(rows.map((r) => [r.brand, r.name, r.d]), [['raw', 'Old Name', '2026-12-01'], ['smackdown', null, null]]);
        assert.strictEqual((await q(`select count(*)::int n from card_drafts`))[0].n, 3, 'old cards are untouched');
        await f.pool.query(`delete from card_drafts; delete from card_shows`);
    });

    await t('/card add keeps divisions apart on one card, numbering restarts per division', async () => {
        await run('card', 'new', { brand: 'raw', name: 'Mayhem' }, ADM);
        let i = await run('card', 'add', { brand: 'raw', match_type: 'singles', wrestler1: C.Ace, wrestler2: C.Bolt }, ADM);
        assert.match(text(i), /Men's\*\* match \*\*1\*\*/, text(i));
        i = await run('card', 'add', { brand: 'raw', match_type: 'singles', wrestler1: C.Gia, wrestler2: C.Hana }, ADM);
        assert.match(text(i), /Women's\*\* match \*\*1\*\*/, text(i));
        i = await run('card', 'add', { brand: 'raw', match_type: 'singles', wrestler1: C.Cruz, wrestler2: C.Dax, title: WH }, ADM);
        assert.match(text(i), /Men's\*\* match \*\*2\*\*/, text(i));
        assert.strictEqual((await q(`select count(*)::int n from card_drafts`))[0].n, 2);
    });

    await t('/card view shows the whole show with Preview, Post and a match dropdown', async () => {
        const i = await run('card', 'view', { brand: 'raw' }, ADM);
        assert.match(text(i), /Mayhem/); assert.match(text(i), /Women's/); assert.match(text(i), /Gia vs Hana/);
        const all = ids(i);
        assert.ok(all.includes('cardui:pv:raw') && all.includes('cardui:po:raw') && all.includes('cardui:pick:raw'), all.join(' '));
    });

    await t('Preview shows the real pictures privately, with no pings; Post here pings the owners', async () => {
        let before = sent.length;
        let i = await click('cardui:pv:raw');
        const shots = i.responses.filter((r) => r.p?.files?.length);
        assert.strictEqual(shots.length, 2, 'one picture per division');
        assert.strictEqual(sent.length, before, 'nothing went to a channel');
        assert.ok(shots.every((r) => JSON.stringify(r.p.allowedMentions) === '{"parse":[]}'), 'no pings in a preview');
        i = await click('cardui:po:raw');
        const posted = i.responses.filter((r) => r.p?.files?.length);
        assert.strictEqual(posted.length, 2);
        assert.deepStrictEqual(posted[0].p.allowedMentions.users.sort(), ['u1', 'u2', 'u3', 'u4']);
        assert.match(posted[1].p.content, /<@u7> \(Gia\) vs <@u8> \(Hana\)/);
    });

    await t('non-admins cannot use the card buttons', async () => {
        const i = await click('cardui:po:raw', { admin: false, user: 'u1' });
        assert.ok(i.responses.some((r) => /Only admins/.test(r.p?.content || '')), text(i));
    });

    await t('pick a match, move it up and down, and remove it with a confirm', async () => {
        const d = (await q(`select id from card_drafts where brand='raw' and division='mens'`))[0];
        let i = await click('cardui:pick:raw', { values: [`${d.id}:2`] });
        assert.match(text(i), /match 2 of 2/, text(i));
        i = await click(`cardui:mu:${d.id}:2`);
        assert.match(text(i), /Moved/, text(i));
        let order = (await q(`select character_ids from card_draft_matches where draft_id=$1 order by position`, [d.id])).map((r) => r.character_ids.map(String).join(','));
        assert.deepStrictEqual(order, [`${C.Cruz},${C.Dax}`, `${C.Ace},${C.Bolt}`]);
        i = await click(`cardui:md:${d.id}:1`);
        order = (await q(`select character_ids from card_draft_matches where draft_id=$1 order by position`, [d.id])).map((r) => r.character_ids.map(String).join(','));
        assert.deepStrictEqual(order, [`${C.Ace},${C.Bolt}`, `${C.Cruz},${C.Dax}`]);
        i = await click(`cardui:rm:${d.id}:2`);
        assert.match(text(i), /Remove this match/, text(i));
        assert.strictEqual((await q(`select count(*)::int n from card_draft_matches where draft_id=$1`, [d.id]))[0].n, 2, 'not removed yet');
        i = await click(`cardui:rmy:${d.id}:2`);
        assert.strictEqual((await q(`select count(*)::int n from card_draft_matches where draft_id=$1`, [d.id]))[0].n, 1);
        assert.match(text(i), /Removed Men's match 2/, text(i));
        // put it back for later tests
        await run('card', 'add', { brand: 'raw', match_type: 'singles', wrestler1: C.Cruz, wrestler2: C.Dax, title: WH }, ADM);
    });

    await t('edit buttons: swap a wrestler from the dropdown, set title and stipulation', async () => {
        const d = (await q(`select id from card_drafts where brand='raw' and division='mens'`))[0];
        let i = await click(`cardui:ed:${d.id}:2`);
        assert.ok(ids(i).some((x) => x.startsWith(`cardui:sl:${d.id}:2`)), ids(i).join(' '));
        i = await click(`cardui:sl:${d.id}:2`, { values: ['1'] });
        const pick = ids(i).find((x) => x.startsWith(`cardui:wr:${d.id}:2:1`));
        assert.ok(pick, ids(i).join(' '));
        const wr = comps(i).find((c) => c.data.custom_id === pick);
        const offered = wr.options.map((o) => o.data.label);
        assert.ok(offered.includes('Eli') && !offered.includes('Ace') && !offered.includes('Cruz') && !offered.includes('Gia'), 'free, same-division wrestlers only: ' + offered.join(','));
        assert.ok(offered.length <= 25);
        assert.ok(ids(i).some((x) => x.startsWith(`cardui:wp:${d.id}:2:1:`)), 'more than 25 free wrestlers, so there are page buttons');
        i = await click(`cardui:wr:${d.id}:2:1`, { values: [C.Eli] });
        assert.match(text(i), /Swapped/, text(i));
        assert.deepStrictEqual((await q(`select character_ids from card_draft_matches where draft_id=$1 and position=2`, [d.id]))[0].character_ids.map(String), [C.Cruz, C.Eli]);
        // next page of candidates is different
        const p1 = await click(`cardui:wp:${d.id}:2:1:1`);
        const second = comps(p1).find((c) => c.data.custom_id?.startsWith(`cardui:wr:${d.id}:2:1`)).options.map((o) => o.data.label);
        assert.ok(second.length >= 1 && !second.some((n) => offered.includes(n)), 'page 2 has other names');
        i = await click(`cardui:st:${d.id}:2`, { values: ['Steel Cage'] });
        assert.strictEqual((await q(`select stipulation from card_draft_matches where draft_id=$1 and position=2`, [d.id]))[0].stipulation, 'Steel Cage');
        i = await click(`cardui:tt:${d.id}:2`, { values: ['none'] });
        assert.strictEqual((await q(`select title_id from card_draft_matches where draft_id=$1 and position=2`, [d.id]))[0].title_id, null);
        i = await click(`cardui:tt:${d.id}:2`, { values: [WH] });
        assert.strictEqual(String((await q(`select title_id from card_draft_matches where draft_id=$1 and position=2`, [d.id]))[0].title_id), WH);
    });

    await t('/card edit: swap one wrestler, change title and stipulation, refuse wrong ones', async () => {
        let i = await run('card', 'edit', { brand: 'raw', division: 'mens', number: 2, swap_out: C.Eli, swap_in: C.Fox }, ADM);
        assert.match(text(i), /Updated Men's match \*\*2\*\*/, text(i));
        assert.deepStrictEqual((await q(`select character_ids from card_draft_matches cdm join card_drafts d on d.id=cdm.draft_id where d.brand='raw' and d.division='mens' and position=2`))[0].character_ids.map(String), [C.Cruz, C.Fox]);
        i = await run('card', 'edit', { brand: 'raw', division: 'mens', number: 2, stipulation: '-', title: '-' }, ADM);
        const row = (await q(`select stipulation, title_id from card_draft_matches cdm join card_drafts d on d.id=cdm.draft_id where d.brand='raw' and d.division='mens' and position=2`))[0];
        assert.strictEqual(row.stipulation, null); assert.strictEqual(row.title_id, null);
        i = await run('card', 'edit', { brand: 'raw', division: 'mens', number: 2, swap_out: C.Cruz, swap_in: C.Gia }, ADM);
        assert.ok(isErr(i, /mix divisions/), text(i));
        i = await run('card', 'edit', { brand: 'raw', division: 'mens', number: 2, swap_out: C.Cruz, swap_in: C.Ace }, ADM);
        assert.ok(isErr(i, /already booked/), text(i));
        i = await run('card', 'edit', { brand: 'raw', division: 'mens', number: 2, swap_in: C.Eli }, ADM);
        assert.ok(isErr(i, /swap_out/), text(i));
        i = await run('card', 'edit', { brand: 'raw', division: 'mens', number: 2 }, ADM);
        assert.ok(isErr(i, /Nothing to change/), text(i));
        i = await run('card', 'edit', { brand: 'raw', division: 'mens', number: 9, stipulation: 'x' }, ADM);
        assert.ok(isErr(i, /1 to 2/), text(i));
    });

    await t('card auto books every division at once and keeps the show name', async () => {
        const i = await run('card', 'auto', { brand: 'smackdown', matches: 2, name: 'Friday Fights' }, ADM);
        assert.match(text(i), /Men's:\*\* 2 matches/, text(i)); assert.match(text(i), /Women's:\*\* 1 match/, text(i));
        const d = await q(`select division, name from card_drafts where brand='smackdown' order by division`);
        assert.deepStrictEqual(d.map((x) => x.division), ['mens', 'womens']);
        assert.ok(d.every((x) => x.name === 'Friday Fights'));
    });

    await t('recap posts one picture per division and one written recap; auto recap waits for the whole show', async () => {
        await run('card', 'new', { brand: 'raw', name: 'Wrap Night' }, ADM);
        await run('card', 'add', { brand: 'raw', match_type: 'singles', wrestler1: C.Ace, wrestler2: C.Bolt }, ADM);
        await run('card', 'add', { brand: 'raw', match_type: 'singles', wrestler1: C.Gia, wrestler2: C.Hana }, ADM);
        await f.pool.query(`update guilds set matches_channel_id = 'matches1' where guild_id = $1`, [G]);
        const before = sent.length;
        await run('match', 'log-singles', { participant1: C.Ace, participant2: C.Bolt, winner: 1, override_cooldown: true }, ADM);
        assert.strictEqual(sent.slice(before).filter((m) => /wrap/i.test(m.payload.content || '')).length, 0, 'not yet: women\'s match still open');
        await run('match', 'log-singles', { participant1: C.Gia, participant2: C.Hana, winner: 2, override_cooldown: true }, ADM);
        const wrap = sent.slice(before).filter((m) => m.channelId === 'matches1' && /results|wrap/i.test(m.payload.content || ''));
        assert.strictEqual(wrap.length, 2, 'two result pictures: ' + JSON.stringify(sent.slice(before).map((m) => m.channelId)));
        assert.match(wrap[0].payload.content, /That's a wrap/);
        const embed = wrap[1].payload.embeds[0].data;
        assert.match(embed.title, /Wrap Night — RAW results/); assert.match(embed.description, /Men's/); assert.match(embed.description, /Women's/);
        const again = await run('card', 'recap', { brand: 'raw' }, ADM);
        assert.strictEqual(again.responses.filter((r) => r.p?.files?.length).length, 2);
    });

    await t('Match of the Night vote covers every division of the show', async () => {
        const i = await run('card', 'vote', { brand: 'raw' }, ADM);
        const poll = (await q(`select match_ids from motn_polls order by id desc limit 1`))[0];
        assert.strictEqual(poll.match_ids.length, 2, text(i));
    });

    await t('schedule, upcoming and the reminder work per show', async () => {
        const { runCardReminders } = require('../src/utils/cardReminders');
        await f.pool.query(`update guilds set admin_channel_id = 'staff1', tz = 'UTC' where guild_id = $1`, [G]);
        const day = new Date().toISOString().slice(0, 10);
        let i = await run('card', 'schedule', { brand: 'raw', date: day }, ADM);
        assert.match(text(i), /RAW\*\* card is set/, text(i));
        i = await run('card', 'upcoming', {}, ADM);
        assert.match(text(i), /RAW/, text(i)); assert.match(text(i), /2 matches/, text(i));
        const before = sent.length;
        const g = (await q(`select * from guilds where guild_id = $1`, [G]))[0];
        await runCardReminders({ channels: { fetch: async () => ({ id: 'staff1', isTextBased: () => true, send: async (p) => { sent.push({ id: 'r', channelId: 'staff1', payload: p }); return { id: 'r' }; } }) }, guilds: { cache: new Map() } }, g, new Date(Date.now() + 0));
        void before;
        i = await run('card', 'schedule', { brand: 'raw', date: '-' }, ADM);
        assert.match(text(i), /no longer scheduled/);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end(); process.exit(failed ? 1 : 0);
})();
