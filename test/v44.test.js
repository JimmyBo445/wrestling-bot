// 3.3.0: signed-up wrestlers who get put on a card show as 🔴 BOOKED (crossed out) on the signup post
// and at the bottom of the staff booking list. The post updates by itself after card changes.
const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, sent, edited, client } = require('./mock');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 6).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const G = 'g1';
const q = async (sql, a) => (await f.pool.query(sql, a)).rows;
const su = require('../src/utils/signupUtils');
const svc = require('../src/utils/cardService');
const SB = require('../src/utils/signupBooked');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const postText = async (s) => { const p = await su.buildSignupMessage(s); return p.embeds[0].data.description + '\n' + p.embeds[0].data.footer.text; };

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const A = await f.makeChar(G, 'u1', 'Ace', 'mens');
    const B = await f.makeChar(G, 'u2', 'Bolt', 'mens');
    const C = await f.makeChar(G, 'u3', 'Cruz', 'mens');
    const D = await f.makeChar(G, 'u4', 'Dax', 'mens');
    const E = await f.makeChar(G, 'u5', 'Eve', 'womens');
    const F = await f.makeChar(G, 'u6', 'Fay', 'womens');
    // an old leftover card from before the signup: must NOT count
    await svc.addMatchToCard(G, 'raw', { matchType: 'singles', characterIds: [C, D] });
    await f.pool.query(`UPDATE card_drafts SET updated_at = now() - interval '3 days'`);

    let signup;
    await t('nothing is booked right after the signup opens (an old card doesn\'t count)', async () => {
        await run('booking', 'signup-open', { title: 'SmackDown Week 12' }, ADM);
        signup = (await q(`select * from signups order by id desc limit 1`))[0];
        for (const id of [A, B, C, D, E, F]) await su.addEntry(signup, (await q(`select * from characters where id=$1`, [id]))[0]);
        const txt = await postText(signup);
        assert.match(txt, /\*\*Men's\*\* \(4\): Ace, Bolt, Cruz, Dax/);
        assert.ok(!/Booked/.test(txt), txt);
    });

    await t('putting two wrestlers on a card marks them booked; the rest stay open', async () => {
        await svc.addMatchToCard(G, 'smackdown', { matchType: 'singles', characterIds: [A, B] });
        const txt = await postText(signup);
        assert.match(txt, /\*\*Men's\*\* \(4 · 2 still open\): Cruz, Dax/);
        assert.match(txt, /🔴 \*\*Booked:\*\* ~~Ace~~ \(SmackDown\), ~~Bolt~~ \(SmackDown\)/);
        assert.match(txt, /\*\*Women's\*\* \(2\): Eve, Fay/);
        assert.match(txt, /2 booked · 🔴 = already on a card/);
    });

    await t('everyone in a division booked says so', async () => {
        await svc.addMatchToCard(G, 'raw', { matchType: 'singles', characterIds: [E, F] });
        const txt = await postText(signup);
        assert.match(txt, /\*\*Women's\*\* \(2 · 0 still open\): _everyone is booked_/);
        assert.match(txt, /~~Eve~~ \(RAW\)/);
        assert.ok(!/~~Cruz~~/.test(txt), 'the leftover men\'s match from before the signup still doesn\'t count');
    });

    await t('taking a match off the card frees them again', async () => {
        await svc.clearCard(G, 'raw');
        const txt = await postText(signup);
        assert.match(txt, /\*\*Women's\*\* \(2\): Eve, Fay/);
        assert.ok(!/~~Eve~~/.test(txt));
        assert.match(txt, /~~Ace~~/, 'SmackDown card untouched');
    });

    await t('staff booking list puts booked wrestlers last and says where', async () => {
        const embed = (await su.buildBookingList(signup)).toJSON();
        const men = embed.fields.find((x) => x.name.startsWith("Men's"));
        assert.match(men.name, /4 · 2 open · 2 booked/);
        const lines = men.value.split('\n');
        assert.match(lines[0], /\*\*(Cruz|Dax)\*\*/);
        assert.match(lines[3], /🔴 ~~(Ace|Bolt)~~ .*booked\*\* on SmackDown #1/);
        const i = await run('booking', 'signup-list', {}, ADM);
        assert.match(text(i), /booked/);
    });

    await t('the public post updates by itself a few seconds after a card change', async () => {
        await f.pool.query(`UPDATE signups SET channel_id = 'sigch', message_id = 'sigmsg' WHERE id = $1`, [signup.id]);
        SB.setClient(client);
        const before = edited.length;
        await svc.addMatchToCard(G, 'raw', { matchType: 'singles', characterIds: [C, D] });
        await svc.addMatchToCard(G, 'raw', { matchType: 'singles', characterIds: [E, F] });
        await wait(3500);
        const mine = edited.slice(before).filter((x) => x.id === 'sigmsg');
        assert.strictEqual(mine.length, 1, 'two quick changes = one update');
        assert.match(mine[0].p.embeds[0].data.description, /~~Cruz~~ \(RAW\)/);
        SB.setClient(null);
    });

    await t('a finished signup (signup-done) shows no booked marks', async () => {
        await run('booking', 'signup-done', {}, ADM);
        const s = (await q(`select * from signups where id=$1`, [signup.id]))[0];
        assert.ok(!/Booked/.test(await postText(s)));
    });

    await t('card commands still work the same', async () => {
        const i = await run('card', 'view', { brand: 'smackdown' }, ADM);
        assert.ok(!/Something went wrong/.test(text(i)), text(i));
        assert.ok(sent.length >= 0);
        void click;
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end();
    process.exit(failed ? 1 : 0);
})();
