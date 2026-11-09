// 3.4.0: "Don't see your wrestler?" in the sign-up picker: request a new wrestler (form) or claim one
// with no player (staff room request). Approving signs them up automatically while signups are open.
const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, sent, ids, modalOf, dms, edited } = require('./mock');

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
const allText = (i) => i.responses.map((r) => r.p?.content || '').join('\n') + text(i);

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    await f.pool.query(`UPDATE guilds SET pending_channel_id = 'pendch', admin_channel_id = 'staffch' WHERE guild_id = $1`, [G]);
    const A = await f.makeChar(G, 'u1', 'Ace', 'mens');
    const L1 = await f.makeChar(G, 'u9', 'Lost Legend', 'mens');
    const L2 = await f.makeChar(G, 'u9', 'Old Queen', 'womens');
    await run('character', 'unclaim', { character: L1 }, ADM);
    await run('character', 'unclaim', { character: L2 }, ADM);
    await run('booking', 'signup-open', { title: 'RAW Week 9' }, ADM);
    const sid = (await q(`select id from signups order by id desc limit 1`))[0].id;

    await t('the picker shows the "don\'t see your wrestler?" message and both buttons', async () => {
        const i = await click(`signup:join:${sid}`, P('u1'));
        assert.match(allText(i), /Don't see your wrestler\?/);
        assert.match(allText(i), /\/character submit/);
        assert.match(allText(i), /signed up automatically/);
        assert.ok(ids(i).includes(`signup:new:${sid}`) && ids(i).includes(`signup:claim:${sid}`));
        assert.ok(ids(i).includes(`signup:pick:${sid}`), 'the normal picker is still there');
    });
    await t('someone with no wrestlers gets the message too (instead of a dead end)', async () => {
        const i = await click(`signup:join:${sid}`, P('u2'));
        assert.match(allText(i), /no approved wrestlers yet/);
        assert.match(allText(i), /Don't see your wrestler\?/);
        assert.ok(ids(i).includes(`signup:new:${sid}`));
    });

    await t('request a new wrestler: division → form → normal approval request, linked to the signup', async () => {
        let i = await click(`signup:new:${sid}`, priv(P('u2')));
        assert.ok(ids(i).includes(`signup:newdiv:${sid}:womens`));
        i = await click(`signup:newdiv:${sid}:womens`, priv(P('u2')));
        const m = modalOf(i);
        assert.deepStrictEqual(m.inputs, ['name', 'finisher', 'alignment', 'bio', 'image_url']);
        assert.deepStrictEqual(m.json.components.map((r) => r.components[0].required), [true, false, false, false, false], 'only the name is required');
        const before = sent.length;
        i = await click(`signup:newform:${sid}:womens`, priv({ ...P('u2'), fields: { name: 'Nova Storm', finisher: 'Supernova', alignment: 'Face' } }));
        assert.match(allText(i), /Nova Storm.*submitted/s);
        assert.match(allText(i), /signed up for \*\*RAW Week 9\*\* automatically/);
        const c = (await q(`select id, status, division, finisher, alignment from characters where name='Nova Storm'`))[0];
        assert.deepStrictEqual([c.status, c.division, c.finisher, c.alignment], ['pending', 'womens', 'Supernova', 'face']);
        const req = (await q(`select * from pending_requests where character_id=$1`, [c.id]))[0];
        assert.strictEqual(String(req.payload.signup_id), String(sid));
        assert.ok(sent.slice(before).find((x) => x.channelId === 'pendch'), 'approval card posted');
        const redrawn = edited.filter((x) => x.id === req.message_id).at(-1);
        assert.match(redrawn.p.embeds[0].data.description, /From the signup \*\*RAW Week 9\*\*/);
    });
    await t('a bad alignment is refused without sending anything', async () => {
        const n = (await q(`select count(*)::int n from characters`))[0].n;
        const i = await click(`signup:newform:${sid}:mens`, priv({ ...P('u3'), fields: { name: 'Bad Guy', alignment: 'villain' } }));
        assert.match(allText(i), /face, heel or neutral/);
        assert.strictEqual((await q(`select count(*)::int n from characters`))[0].n, n);
    });
    await t('approving the new wrestler signs them up and DMs the player', async () => {
        const req = (await q(`select r.id from pending_requests r join characters c on c.id=r.character_id where c.name='Nova Storm'`))[0];
        const i = await click(`pending_approve_${req.id}`, ADM);
        assert.match(JSON.stringify(i.responses.at(-1).p.embeds[0].toJSON()), /signed up for RAW Week 9/);
        const e = await q(`select c.name from signup_entries e join characters c on c.id=e.character_id where e.signup_id=$1`, [sid]);
        assert.deepStrictEqual(e.map((r) => r.name), ['Nova Storm']);
        assert.ok(dms.some((d) => d.id === 'u2' && /Nova Storm\*\* was approved and is signed up for \*\*RAW Week 9/.test(d.content)));
    });

    await t('claim: only wrestlers with no player are listed, by division', async () => {
        let i = await click(`signup:claim:${sid}`, priv(P('u3')));
        const opts = i.responses.at(-1).p.components[1].toJSON().components[0].options.map((o) => o.label);
        assert.deepStrictEqual(opts, ['Lost Legend', 'Old Queen']);
        i = await click(`signup:claimdiv:${sid}:womens`, priv(P('u3')));
        assert.deepStrictEqual(i.responses.at(-1).p.components[1].toJSON().components[0].options.map((o) => o.label), ['Old Queen']);
        i = await click(`signup:claimdiv:${sid}:custom`, priv(P('u3')));
        assert.match(allText(i), /No wrestlers in Custom are without a player/);
        i = await click(`signup:claimpick:${sid}`, priv({ ...P('u3'), values: [String(A)] }));
        assert.match(allText(i), /isn't available to claim/, 'can\'t claim someone else\'s wrestler');
    });
    await t('claim request goes to the staff room; asking twice is stopped', async () => {
        let i = await click(`signup:claimpick:${sid}`, priv({ ...P('u3'), values: [String(L1)] }));
        assert.ok(ids(i).includes(`signup:claimgo:${sid}:${L1}`));
        const before = sent.length;
        i = await click(`signup:claimgo:${sid}:${L1}`, priv(P('u3')));
        assert.match(allText(i), /Request sent/);
        const post = sent.slice(before).find((x) => x.channelId === 'staffch');
        assert.ok(post, 'posted in the staff room');
        assert.match(post.payload.embeds[0].data.title, /Claim a Wrestler/);
        assert.match(post.payload.embeds[0].data.description, /<@u3> wants to take over \*\*Lost Legend\*\*/);
        i = await click(`signup:claimgo:${sid}:${L1}`, priv(P('u3')));
        assert.match(allText(i), /already asked/);
        await click(`signup:claimgo:${sid}:${L1}`, priv(P('u4')));
    });
    await t('players can\'t approve; staff approve → wrestler moves, signed up, DM; the second claim can\'t be approved', async () => {
        const reqs = await q(`select id, requested_by from pending_requests where request_type='character_claim' order by id`);
        let i = await click(`pending_approve_${reqs[0].id}`, P('u3'));
        assert.match(allText(i), /Only admins|staff/i);
        i = await click(`pending_approve_${reqs[0].id}`, ADM);
        const owner = (await q(`select u.discord_id from characters c join users u on u.id=c.owner_id where c.id=$1`, [L1]))[0].discord_id;
        assert.strictEqual(owner, 'u3');
        assert.ok((await q(`select 1 from signup_entries where signup_id=$1 and character_id=$2`, [sid, L1])).length === 1);
        assert.ok(dms.some((d) => d.id === 'u3' && /Lost Legend\*\* is now yours and is signed up/.test(d.content)));
        i = await click(`pending_approve_${reqs[1].id}`, ADM);
        assert.match(allText(i), /already has a player now/);
        assert.strictEqual((await q(`select status from pending_requests where id=$1`, [reqs[1].id]))[0].status, 'pending');
        i = await click(`pending_deny_${reqs[1].id}`, ADM);
        assert.ok(dms.some((d) => d.id === 'u4' && /denied/.test(d.content)));
    });
    await t('at the wrestler limit: buttons still show, with a note; requests are refused', async () => {
        for (let n = 0; n < 4; n++) await f.makeChar(G, 'u5', `Full ${n}`, 'mens');
        let i = await click(`signup:join:${sid}`, P('u5'));
        assert.match(allText(i), /most wrestlers allowed \(4/);
        assert.ok(ids(i).includes(`signup:new:${sid}`));
        i = await click(`signup:new:${sid}`, priv(P('u5')));
        assert.match(allText(i), /retire one/);
        i = await click(`signup:claimgo:${sid}:${L2}`, priv(P('u5')));
        assert.match(allText(i), /retire one/);
    });
    await t('approved after signups closed: approved, but not signed up', async () => {
        await click(`signup:claimgo:${sid}:${L2}`, priv(P('u6')));
        await run('booking', 'signup-close', {}, ADM);
        const r = (await q(`select id from pending_requests where request_type='character_claim' and requested_by='u6'`))[0];
        await click(`pending_approve_${r.id}`, ADM);
        assert.strictEqual((await q(`select u.discord_id from characters c join users u on u.id=c.owner_id where c.id=$1`, [L2]))[0].discord_id, 'u6');
        assert.ok(!(await q(`select 1 from signup_entries where character_id=$1`, [L2])).length);
        assert.ok(dms.some((d) => d.id === 'u6' && /Old Queen\*\* is now yours\.$/.test(d.content)));
    });
    await t('normal /character submit and /admin pending still work', async () => {
        let i = await run('character', 'submit', { name: 'Plain Joe', division: 'mens' }, P('u7'));
        assert.match(text(i), /submitted for approval/);
        i = await run('admin', 'pending', {}, ADM);
        assert.ok(!/Something went wrong/.test(allText(i)));
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end();
    process.exit(failed ? 1 : 0);
})();
