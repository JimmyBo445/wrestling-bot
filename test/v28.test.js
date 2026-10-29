const assert = require('assert');
const f = require('./fixtures');
const { run, click, text } = require('./mock');
const su = require('../src/utils/signupUtils');

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
const edits = [];

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const mk = async (n, o, d = 'mens') => { C[n] = await f.makeChar(G, o, n, d); };
    await mk('Ace', 'u1'); await mk('Bolt', 'u2'); await mk('Cruz', 'u3'); await mk('Dane', 'u4');
    await mk('Aria', 'u1', 'womens'); await mk('Bree', 'u5', 'womens'); await mk('Cleo', 'u6', 'womens');
    await mk('Zed', 'u7', 'custom');

    let sid;
    await t('admin opens a signup and the post is sent with buttons', async () => {
        const i = await run('signup', 'open', { title: 'RAW - Nov 3', deadline: '2026-11-03' }, ADM);
        assert.match(text(i), /is open/, text(i));
        const { rows } = await f.pool.query(`select * from signups`);
        assert.strictEqual(rows.length, 1); sid = rows[0].id;
        assert.ok(rows[0].message_id);
    });
    await t('bad deadline is refused', async () => {
        const i = await run('signup', 'open', { title: 'x', deadline: 'soon' }, ADM);
        assert.ok(isErr(i, /Deadline/), text(i));
    });
    await t('join button shows a picker with all their wrestlers and divisions', async () => {
        const i = await click(`signup:join:${sid}`, { admin: false, user: 'u1' });
        const p = i.responses[0].p;
        const opts = p.components[0].toJSON().components[0].options;
        assert.deepStrictEqual(opts.map((o) => o.label).sort(), ['Ace', 'Aria']);
        assert.ok(opts.some((o) => o.description === "Women's"));
    });
    await t('picking signs up several wrestlers across divisions; can change later', async () => {
        let i = await click(`signup:pick:${sid}`, { values: [C.Ace, C.Aria], admin: false, user: 'u1' });
        assert.match(JSON.stringify(i.responses[0].p), /signed up/, JSON.stringify(i.responses));
        let e = await su.getEntries(sid); assert.strictEqual(e.length, 2);
        i = await click(`signup:pick:${sid}`, { values: [C.Aria], admin: false, user: 'u1' });
        e = await su.getEntries(sid); assert.deepStrictEqual(e.map((x) => x.name), ['Aria']);
        await click(`signup:pick:${sid}`, { values: [C.Ace, C.Aria], admin: false, user: 'u1' });
    });
    await t('cannot pick someone else\'s wrestler', async () => {
        const before = (await su.getEntries(sid)).length;
        const i = await click(`signup:pick:${sid}`, { values: [C.Bolt], admin: false, user: 'u1' });
        assert.ok(isErr(i, /can't sign up/) || /can't sign up|couldn't/i.test(text(i)) || (await su.getEntries(sid)).length === before, text(i));
        assert.strictEqual((await su.getEntries(sid)).length, before);
    });
    await t('injured wrestlers are not offered', async () => {
        await f.pool.query(`insert into injuries (guild_id, character_id, returns_at, reason, created_by) values ($1,$2, CURRENT_DATE + 5, 'x', 't')`, [G, C.Ace]);
        const i = await click(`signup:join:${sid}`, { admin: false, user: 'u1' });
        const opts = i.responses[0].p.components[0].toJSON().components[0].options;
        assert.deepStrictEqual(opts.map((o) => o.label), ['Aria']);
        await f.pool.query(`delete from injuries`);
    });
    await t('withdraw button removes all entries', async () => {
        await click(`signup:pick:${sid}`, { values: [C.Bolt], admin: false, user: 'u2' });
        await click(`signup:leave:${sid}`, { admin: false, user: 'u2' });
        const e = await su.getEntries(sid);
        assert.ok(!e.some((x) => x.name === 'Bolt'));
    });
    await t('players without approved wrestlers get a hint', async () => {
        const i = await click(`signup:join:${sid}`, { admin: false, user: 'nobody' });
        assert.match(text(i), /no approved wrestlers/, text(i));
    });
    await t('admin list, add and remove', async () => {
        await run('signup', 'add', { character: C.Cruz }, ADM);
        await run('signup', 'add', { character: C.Bree }, ADM);
        let i = await run('signup', 'list', {}, ADM);
        assert.match(text(i), /Ace/, text(i)); assert.match(text(i), /Cruz/); assert.match(text(i), /Bree/);
        i = await run('signup', 'list', { division: 'womens' }, ADM);
        assert.ok(!/Cruz/.test(text(i)), text(i));
        i = await run('signup', 'remove', { character: C.Bree }, ADM);
        assert.match(text(i), /Removed/);
        i = await run('signup', 'remove', { character: C.Bree }, ADM);
        assert.ok(isErr(i, /isn't on/), text(i));
    });
    await t('while a signup is active, matchmaking only suggests signed-up wrestlers (include_everyone overrides)', async () => {
        // Ace's suggestions: Cruz is signed up, Bolt and Dane are not
        let i = await run('matchmaking', 'suggest', { character: C.Ace }, P('u1'));
        assert.ok(/Cruz/.test(text(i)) && !/Bolt/.test(text(i)) && !/Dane/.test(text(i)), text(i));
        assert.match(text(i), /📝/);
        i = await run('matchmaking', 'suggest', { character: C.Ace, include_everyone: true }, P('u1'));
        assert.ok(/Cruz/.test(text(i)) && /Bolt/.test(text(i)), text(i));
    });
    await t('card auto books ONLY signed-up wrestlers, books fewer matches rather than pulling in others, and refuses when under 2', async () => {
        await run('signup', 'add', { character: C.Dane }, ADM);
        let i = await run('card', 'auto', { brand: 'raw', matches: 3 }, ADM);
        assert.match(text(i), /Booked only from the \*\*RAW - Nov 3\*\* signup/, text(i));
        assert.match(text(i), /Men's:\*\* 1 match \(wanted 3\)/, text(i));
        assert.match(text(i), /Women's\*\* was skipped: Only 1 healthy Women's wrestler/, text(i));
        const { rows } = await f.pool.query(`select character_ids from card_draft_matches`);
        const used = new Set(rows.flatMap((r) => r.character_ids.map(String)));
        assert.ok(!used.has(String(C.Bolt)), 'Bolt never signed up');
        // women: Aria signed up (1 only) -> skipped, Bree/Cleo are not pulled in
        const wd = await f.pool.query(`select 1 from card_drafts where brand='raw' and division='womens'`);
        assert.strictEqual(wd.rows.length, 0, 'no women\'s matches were booked');
        i = await run('card', 'auto', { brand: 'smackdown', matches: 2, use_signup: false }, ADM);
        assert.ok(!/signup/.test(text(i)), text(i));
    });
    await t('an empty new signup never makes booking fall back to everyone', async () => {
        await run('signup', 'open', { title: 'Empty show' }, ADM);
        const i = await run('card', 'auto', { brand: 'raw', matches: 2 }, ADM);
        assert.ok(isErr(i, /Only 0 healthy/), text(i));
        const j = await run('matchmaking', 'suggest', { character: C.Ace }, P('u1'));
        assert.ok(isErr(j, /Nobody else has signed up/), text(j));
        // opening it finished the older one
        const { rows } = await f.pool.query(`select title, status from signups order by id`);
        assert.deepStrictEqual(rows.map((r) => r.status), ['done', 'done', 'open'].slice(-rows.length));
        // go back to the first signup for the remaining tests
        await f.pool.query(`delete from signups where title = 'Empty show'`);
        await f.pool.query(`update signups set status = 'open' where id = $1`, [sid]);
    });
    await t('closing posts the final list to the staff channel and locks the buttons', async () => {
        await f.pool.query(`update guilds set admin_channel_id = 'staff1' where guild_id=$1`, [G]);
        const i = await run('signup', 'close', {}, ADM);
        assert.match(text(i), /Closed/, text(i));
        const { rows } = await f.pool.query(`select status from signups`);
        assert.strictEqual(rows[0].status, 'closed');
        let j = await click(`signup:join:${sid}`, { admin: false, user: 'u1' });
        assert.match(text(j), /closed/, text(j));
        j = await run('signup', 'close', {}, ADM);
        assert.ok(isErr(j, /already closed/), text(j));
    });
    await t('a closed signup keeps guiding booking (no timer) until signup-done; then everyone is booked again', async () => {
        await f.pool.query(`update signups set closed_at = now() - interval '40 days'`);
        let i = await run('matchmaking', 'suggest', { character: C.Ace }, P('u1'));
        assert.ok(/Cruz/.test(text(i)) && !/Bolt/.test(text(i)), text(i));
        i = await run('signup', 'done', {}, ADM);
        assert.match(text(i), /finished/, text(i));
        i = await run('matchmaking', 'suggest', { character: C.Ace }, P('u1'));
        assert.ok(/Bolt/.test(text(i)), text(i));
        i = await run('signup', 'done', {}, ADM);
        assert.ok(isErr(i, /already finished/), text(i));
        await f.pool.query(`update signups set status = 'closed'`);
    });
    await t('wrestlers passed over are favored next time, until they wrestle', async () => {
        const p = await su.passedOverCounts(G, [C.Ace, C.Cruz]);
        assert.strictEqual(p.get(String(C.Ace)), 1); assert.strictEqual(p.get(String(C.Cruz)), 1);
        await run('match', 'log-singles', { participant1: C.Ace, participant2: C.Cruz, winner: 1, override_cooldown: true }, ADM);
        const p2 = await su.passedOverCounts(G, [C.Ace, C.Cruz, C.Dane]);
        assert.strictEqual(p2.get(String(C.Ace)) || 0, 0);
        assert.strictEqual(p2.get(String(C.Dane)), 1);
        const i = await run('signup', 'list', {}, ADM);
        assert.match(text(i), /passed over ×1/, text(i));
    });
    await t('scheduler auto-closes signups whose deadline day has passed', async () => {
        await f.pool.query(`insert into signups (guild_id, title, deadline) values ($1,'Old show','2020-01-01')`, [G]);
        const { tick } = require('../src/utils/scheduler');
        await tick({ channels: { fetch: async () => null }, guilds: { cache: new Map() } });
        const { rows } = await f.pool.query(`select status from signups where title='Old show'`);
        assert.strictEqual(rows[0].status, 'closed');
    });
    await t('help lists signup for admins only', async () => {
        const a = await run('help', null, {}, ADM);
        assert.match(text(a), /signup-open/, text(a));
        const pl = await run('help', null, {}, P('u1'));
        assert.ok(!/signup-open/.test(text(pl)), text(pl));
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end(); process.exit(failed ? 1 : 0);
})();
