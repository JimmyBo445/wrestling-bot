// 3.10.0: 📌 menu post, 📨 My requests, 📈 bot usage report.
process.env.MENU_QUIET_MS = '50';
const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, sent, ids, edited, client } = require('./mock');

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
const bad = (i) => /Something went wrong|older version/.test(text(i));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const btnIds = (payload) => (payload.components || []).flatMap((r) => (r.toJSON ? r.toJSON() : r).components.map((c) => c.custom_id));

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const A = await f.makeChar(G, 'u1', 'Ace', 'mens');
    const B = await f.makeChar(G, 'u2', 'Bolt', 'mens');
    const MP = require('../src/utils/menuPost');
    client.user = { id: 'bot1' };

    // ---------------- 📌 menu post ----------------
    await t('admin panel has 📌 Menu post and 📈 Bot usage; players are refused', async () => {
        const i = await run('admin', 'panel', {}, ADM);
        assert.ok(ids(i).includes('ui:mp:h') && ids(i).includes('ui:us:7'));
        const p = await click('ui:mp:h', P('u1'));
        assert.match(text(p), /Only admins|staff/i);
    });
    await t('pick a channel → the menu is posted there with every button', async () => {
        const before = sent.length;
        const i = await click('ui:mp:s', priv({ ...ADM, kind: 'channel', values: ['startch'] }));
        assert.match(text(i), /Posted the menu in <#startch>/, text(i));
        const post = sent.slice(before).find((m) => m.channelId === 'startch');
        assert.ok(post);
        const b = btnIds(post.payload);
        for (const x of ['ui:mk:h:mp', 'ui:h:mine:mp', 'ui:rp:h:mp', 'ui:mr:h:mp', 'ui:h:champs:mp', 'ui:h:show:mp', 'ui:h:results:mp', 'ui:h:roster:mp', 'ui:h:stats:mp', 'ui:h:stand:mp', 'ui:h:legacy:mp', 'ui:h:help:mp']) assert.ok(b.includes(x), x);
        const g = (await q(`select menu_channel_id, menu_message_id from guilds where guild_id=$1`, [G]))[0];
        assert.strictEqual(g.menu_channel_id, 'startch');
        assert.strictEqual(g.menu_message_id, post.id);
    });
    await t('it moves back to the bottom after people chat (and only in that channel)', async () => {
        let before = sent.length;
        MP.onMessage(client, { guildId: G, channelId: 'otherch', author: { id: 'u1' } });
        MP.onMessage(client, { guildId: G, channelId: 'startch', author: { id: 'bot1' } }); // its own posts don't count
        await wait(150);
        assert.strictEqual(sent.length, before, 'nothing moved');
        MP.onMessage(client, { guildId: G, channelId: 'startch', author: { id: 'u1' } });
        MP.onMessage(client, { guildId: G, channelId: 'startch', author: { id: 'u2' } });
        await wait(250);
        const moved = sent.slice(before).filter((m) => m.channelId === 'startch');
        assert.strictEqual(moved.length, 1, 'posted once after the chat went quiet');
        assert.strictEqual((await q(`select menu_message_id from guilds where guild_id=$1`, [G]))[0].menu_message_id, moved[0].id);
        before = sent.length;
        MP.onDelete(client, { guildId: G, id: moved[0].id });
        await wait(2300);
        assert.strictEqual(sent.slice(before).filter((m) => m.channelId === 'startch').length, 1, 'deleted menu comes back');
    });
    await t('menu buttons work for players and answer only them', async () => {
        for (const id of ['ui:h:champs:mp', 'ui:h:mine:mp', 'ui:mr:h:mp', 'ui:h:stats:mp', 'ui:h:help:mp', 'ui:mk:h:mp', 'ui:rp:h:mp']) {
            const i = await click(id, P('u1'));
            assert.ok(i.responses.length && !bad(i), `${id}: ${text(i)}`);
            assert.ok(i.responses.every((r) => r.type !== 'update'), `${id} must not change the public post`);
        }
    });
    await t('🆕 Make a wrestler from the menu sends it to staff', async () => {
        let i = await click('ui:mk:d:custom_womens', P('u5'));
        assert.ok(i.responses.some((r) => r.type === 'modal'));
        i = await click('ui:mkm:custom_womens', priv({ ...P('u5'), fields: { name: 'Zara Blaze', finisher: '', alignment: 'heel', bio: '', image_url: '' } }));
        assert.ok(!/⚠️/.test(text(i)), text(i));
        const c = (await q(`select status from characters where name='Zara Blaze'`))[0];
        assert.strictEqual(c.status, 'pending');
        i = await click('ui:mkm:custom_womens', priv({ ...P('u5'), fields: { name: 'Bad Align', alignment: 'evil' } }));
        assert.match(text(i), /face, heel or neutral/);
    });
    await t('turn it off removes it', async () => {
        const i = await click('ui:mp:x', priv(ADM));
        assert.match(text(i), /off/);
        assert.strictEqual((await q(`select menu_channel_id from guilds where guild_id=$1`, [G]))[0].menu_channel_id, null);
        const before = sent.length;
        MP.onMessage(client, { guildId: G, channelId: 'startch', author: { id: 'u1' } });
        await wait(150);
        assert.strictEqual(sent.length, before);
    });

    // ---------------- 📨 My requests ----------------
    await t('My requests lists every kind with its status; only your own', async () => {
        await run('booking', 'request', { character: A, opponent: B, note: 'Ladder match' }, P('u1'));
        const WH = (await q(`select id from titles where guild_id=$1 and division='mens' and not is_tag_title order by id limit 1`, [G]))[0].id;
        await click(`chmp:chp:${WH}`, { ...P('u1'), values: [String(A)] });
        let i = await click('ui:mr:h', priv(P('u1')));
        const tx = text(i);
        assert.match(tx, /Ace vs Bolt/); assert.match(tx, /Ladder match/); assert.match(tx, /waiting for staff/); assert.match(tx, /Title challenges/);
        assert.ok(ids(i).includes('ui:mr:c'));
        i = await click('ui:mr:h', priv(P('u5')));
        assert.match(text(i), /Zara Blaze/); assert.ok(!/Ace vs Bolt/.test(text(i)));
        i = await click('ui:h:mine', priv(P('u1')));
        assert.ok(ids(i).includes('ui:mr:h'));
        i = await click('ui:h:mine', priv(P('u9')));
        assert.ok(ids(i).includes('ui:mk:h'), 'no wrestlers yet: offer to make one');
    });
    await t('cancel a waiting request: staff card updated, staff can no longer approve it', async () => {
        const r = (await q(`select * from pending_requests where request_type='match_request' and requested_by='u1'`))[0];
        await f.pool.query(`UPDATE pending_requests SET channel_id='staffch', message_id='card99' WHERE id=$1`, [r.id]);
        let i = await click('ui:mr:c', priv({ ...P('u1'), values: [`p:${r.id}`] }));
        assert.ok(ids(i).includes(`ui:mr:y:p:${r.id}`));
        i = await click(`ui:mr:y:p:${r.id}`, priv(P('u2')));
        assert.match(text(i), /isn't waiting/, 'someone else can\'t cancel it');
        i = await click(`ui:mr:y:p:${r.id}`, priv(P('u1')));
        assert.match(text(i), /Cancelled/);
        assert.strictEqual((await q(`select status from pending_requests where id=$1`, [r.id]))[0].status, 'cancelled');
        assert.ok(edited.some((e) => e.id === 'card99' && /Cancelled by/.test(e.p.content)));
        assert.match(text(i), /you cancelled it/);
        const z = (await q(`select pr.id, pr.character_id from pending_requests pr where request_type='character_submission' and requested_by='u5'`))[0];
        await click(`ui:mr:y:p:${z.id}`, priv(P('u5')));
        assert.strictEqual((await q(`select status from characters where id=$1`, [z.character_id]))[0].status, 'denied');
    });
    await t('cancel a reported result', async () => {
        const svc = require('../src/utils/cardService');
        await svc.addMatchToCard(G, 'raw', { matchType: 'singles', characterIds: [A, B] });
        const draft = (await q(`select id from card_drafts where brand='raw'`))[0].id;
        await click(`ui:rpm:${draft}:1:1`, priv({ ...P('u1'), fields: { finish: '', score: '', notes: '' } }));
        const rep = (await q(`select id from match_reports where reporter='u1' and status='pending'`))[0];
        assert.ok(rep, 'report made');
        let i = await click('ui:mr:h', priv(P('u1')));
        assert.match(text(i), /Reported results/);
        i = await click(`ui:mr:y:r:${rep.id}`, priv(P('u1')));
        assert.match(text(i), /Cancelled your reported result/);
        const r = (await q(`select status, deny_reason from match_reports where id=$1`, [rep.id]))[0];
        assert.deepStrictEqual([r.status, r.deny_reason], ['closed', 'cancelled by the player']);
    });

    // ---------------- 📈 usage ----------------
    await t('usage is counted (commands, buttons, menu presses) and shown as totals only', async () => {
        const n = (await q(`select count(*)::int n from usage_events where guild_id=$1`, [G]))[0].n;
        assert.ok(n > 10, `counted ${n}`);
        const whats = (await q(`select distinct what from usage_events`)).map((r) => r.what);
        assert.ok(whats.includes('/admin panel'), whats.join(' | '));
        assert.ok(whats.includes('📌 Menu post → Champions'), whats.join(' | '));
        assert.ok(whats.includes('My requests'));
        let i = await click('ui:us:7', priv(ADM));
        assert.match(text(i), /Bot usage: last 7 days/);
        assert.match(text(i), /people/);
        assert.ok(!/u1|u2|admin1/.test(text(i)), 'no names or ids');
        i = await click('ui:us:30', priv(ADM));
        assert.match(text(i), /last 30 days/);
        const p = await click('ui:us:7', P('u1'));
        assert.match(text(p), /Only admins|staff/i);
        const rp = await run('admin', 'report', {}, ADM);
        assert.match(text(rp), /Bot usage \(7 days\)/);
        assert.match(text(rp), /Not used:/);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end(); process.exit(failed ? 1 : 0);
})();
