// 3.16.0: LuchaDerpy sign-ups are separate from the normal ones (Men's, Women's, Custom, Custom Women's).
const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, ids, sent } = require('./mock');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 6).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const P = (u) => ({ admin: false, user: u });
const G = 'g1';
const q = async (sql, a) => (await f.pool.query(sql, a)).rows;
const priv = (o) => ({ ...o, private: true });
const embedOf = (m) => { const e = m.payload.embeds[0]; return e.data || e; };

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const A = await f.makeChar(G, 'u1', 'Ace', 'mens'), B = await f.makeChar(G, 'u2', 'Bolt', 'mens'), W = await f.makeChar(G, 'u1', 'Nova', 'womens');
    for (const n of ['Rey Mysterio', 'Dragon Lee', 'Penta']) await run('character', 'open', { name: n, division: 'mens' }, ADM);
    const id = async (n) => (await q(`select id from characters where name=$1 and division='mens'`, [n]))[0].id;
    const ld = async (n) => (await q(`select id from characters where name=$1 and division='luchaderpy'`, [n]))[0].id;
    await run('character', 'give', { character: await id('Rey Mysterio'), player: 'u1', slot: 'luchaderpy' }, ADM);
    await run('character', 'give', { character: await id('Dragon Lee'), player: 'u2', slot: 'luchaderpy' }, ADM);
    await run('character', 'give', { character: await id('Penta'), player: 'u3', slot: 'luchaderpy' }, ADM);
    const REY = await ld('Rey Mysterio'), DL = await ld('Dragon Lee'), PEN = await ld('Penta');
    let MAIN, LD;

    await t('a normal and a LuchaDerpy sign-up can be open at the same time', async () => {
        await run('booking', 'signup-open', { title: 'RAW - Nov 20' }, ADM);
        let i = await click('ui:bk:h:luchaderpy', priv(ADM));
        assert.match(text(i), /No LuchaDerpy signup yet/);
        assert.ok(ids(i).includes('ui:bk:op:luchaderpy'), ids(i).join(' '));
        const s0 = sent.length;
        i = await click('ui:bkm:op:luchaderpy', priv({ ...ADM, fields: { title: 'LuchaDerpy - Nov 21', deadline: '' } }));
        assert.match(text(i), /🟣 LuchaDerpy signup \*\*LuchaDerpy - Nov 21\*\* is posted/, text(i));
        const rows = await q(`select id, kind, status from signups order by id`);
        assert.deepStrictEqual(rows.map((r) => [r.kind, r.status]), [['main', 'open'], ['luchaderpy', 'open']]);
        MAIN = rows[0].id; LD = rows[1].id;
        const post = embedOf(sent.slice(s0).find((m) => m.payload.embeds?.length));
        assert.match(post.title, /🟣 LuchaDerpy - Nov 21/);
        assert.match(post.description, /\*\*LuchaDerpy\*\* \(0\)/);
        assert.ok(!/Men's|Women's|Custom/.test(post.description), post.description);
        const su = require('../src/utils/signupUtils');
        const main = await su.buildSignupMessage(await su.getSignup(MAIN, G));
        assert.ok(!/LuchaDerpy/.test(embedOf({ payload: main }).description), 'the normal post has no LuchaDerpy line');
    });

    await t('players: the normal picker has no 🟣 characters, the LuchaDerpy picker only has them', async () => {
        let i = await click(`signup:join:${MAIN}`, P('u1'));
        let j = JSON.stringify(i.responses.at(-1).p.components.map((r) => r.toJSON()));
        assert.ok(j.includes('Ace') && j.includes('Nova') && !j.includes('Rey Mysterio'), j);
        i = await click(`signup:join:${LD}`, P('u1'));
        j = JSON.stringify(i.responses.at(-1).p.components.map((r) => r.toJSON()));
        assert.ok(j.includes('Rey Mysterio') && !j.includes('Ace') && !j.includes('Nova'), j);
        i = await click(`signup:pick:${LD}`, { ...P('u1'), values: [String(A)] });
        assert.match(text(i), /can't sign up right now/);
        i = await click(`signup:pick:${MAIN}`, { ...P('u1'), values: [String(REY)] });
        assert.match(text(i), /can't sign up right now/);
        await click(`signup:pick:${LD}`, { ...P('u1'), values: [String(REY)] });
        await click(`signup:pick:${MAIN}`, { ...P('u1'), values: [String(A), String(W)] });
        assert.deepStrictEqual((await q(`select signup_id::int s, division from signup_entries order by 1, 2`)).map((r) => `${r.s === Number(MAIN) ? 'main' : 'ld'}:${r.division}`), ['main:mens', 'main:womens', 'ld:luchaderpy']);
        // no 🟣 character yet → told to request one
        i = await click(`signup:join:${LD}`, P('u9'));
        assert.match(text(i), /LuchaDerpy\*\* characters only, and you don't have one yet/);
        assert.ok(ids(i).includes('ui:rq:h:luchaderpy'));
    });

    await t('staff can\'t put a wrestler on the wrong kind of sign-up', async () => {
        let i = await run('booking', 'signup-add', { signup: LD, character: B }, ADM);
        assert.match(text(i), /only LuchaDerpy characters can join/, text(i));
        i = await run('booking', 'signup-add', { signup: MAIN, character: DL }, ADM);
        assert.match(text(i), /LuchaDerpy has its own sign-up/, text(i));
        i = await run('booking', 'signup-add', { signup: LD, character: DL }, ADM);
        assert.match(text(i), /Signed \*\*Dragon Lee\*\* up/);
        await run('booking', 'signup-add', { signup: MAIN, character: B }, ADM);
    });

    await t('⚡ Auto-build: the LuchaDerpy card books from the LuchaDerpy sign-up, RAW from the normal one', async () => {
        let i = await run('card', 'auto', { brand: 'luchaderpy', matches: 2 }, ADM);
        assert.match(text(i), /Booked only from the \*\*LuchaDerpy - Nov 21\*\* signup/, text(i));
        const ldIds = (await q(`select unnest(character_ids) c from card_draft_matches m join card_drafts d on d.id=m.draft_id where d.brand='luchaderpy'`)).map((r) => String(r.c)).sort();
        assert.deepStrictEqual(ldIds, [String(REY), String(DL)].sort(), 'Penta did not sign up');
        i = await run('card', 'auto', { brand: 'raw', matches: 2 }, ADM);
        assert.match(text(i), /Booked only from the \*\*RAW - Nov 20\*\* signup/, text(i));
        void PEN;
    });

    await t('the panel has a tab for each kind; finishing or reopening one leaves the other alone', async () => {
        let i = await click('ui:bk:h', priv(ADM));
        assert.match(text(i), /Latest signup: RAW - Nov 20/);
        assert.ok(ids(i).includes('ui:bk:h:luchaderpy') && ids(i).includes('ui:bk:op:main'));
        i = await click('ui:bk:h:luchaderpy', priv(ADM));
        assert.match(text(i), /Latest LuchaDerpy signup: LuchaDerpy - Nov 21\*\* · 🟢 open · 2 wrestlers/, text(i));
        i = await click(`ui:bk:cl:${LD}`, priv(ADM));
        assert.match(text(i), /LuchaDerpy signups & booking/);
        assert.deepStrictEqual((await q(`select kind, status from signups order by id`)).map((r) => `${r.kind}:${r.status}`), ['main:open', 'luchaderpy:closed']);
        await click('ui:bkm:op:main', priv({ ...ADM, fields: { title: 'SmackDown - Nov 22', deadline: '' } }));
        assert.deepStrictEqual((await q(`select kind, status from signups order by id`)).map((r) => `${r.kind}:${r.status}`), ['main:done', 'luchaderpy:closed', 'main:open']);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exitCode = 1;
    await f.pool.end();
    process.exit();
})();
