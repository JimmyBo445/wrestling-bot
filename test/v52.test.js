// 3.11.0 / 3.12.0: live roster channel(s) ("Wrestler (91 Overall) : @player") and the staff-set overall rating.
process.env.ROSTER_DEBOUNCE_MS = '30';
const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, sent, edited, deleted, ids, modalOf, client } = require('./mock');

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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RB = require('../src/utils/rosterBoard');
const desc = (m) => (m.payload ? m.payload.content : m.p.content);
const inRoster = () => sent.filter((m) => m.channelId === 'rosterch');

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const J = await f.makeChar(G, 'u1', 'Jey Uso', 'mens');
    const A = await f.makeChar(G, 'u2', 'Aaron *Star*', 'mens');
    const L = await f.makeChar(G, 'u3', 'Liv Morgan', 'womens');
    const O = await f.makeChar(G, 'ph1', 'Open Guy', 'mens');
    await f.pool.query(`UPDATE users SET is_placeholder = true WHERE discord_id = 'ph1'`);
    await f.makeChar(G, 'u4', 'Retired Ron', 'mens', 'retired');
    await f.makeChar(G, 'u5', 'Pending Pat', 'mens', 'pending');

    await t('📺 Channels has "Live roster"; picking a channel posts one post per division plus the how-to post', async () => {
        let i = await click('ui:ch:h', priv(ADM));
        assert.match(JSON.stringify(i.responses.at(-1).p.components.map((r) => r.toJSON())), /"value":"roster"/);
        const before = sent.length;
        i = await click('ui:ch:s:roster', priv({ ...ADM, kind: 'channel', values: ['rosterch'] }));
        assert.match(text(i), /live roster is in <#rosterch>/, text(i));
        const posts = sent.slice(before).filter((m) => m.channelId === 'rosterch');
        assert.strictEqual(posts.length, 5, 'mens, womens, custom, custom womens, how-to');
        const mens = desc(posts[0]);
        assert.match(mens, /\*\*Aaron \\\*Star\\\*\*\* : <@u2>/, 'names are escaped');
        assert.match(mens, /\*\*Jey Uso\*\* : <@u1>/);
        assert.ok(mens.indexOf('Aaron') < mens.indexOf('Jey Uso'), 'A to Z');
        assert.match(mens, /Open — nobody plays them yet[\s\S]*\*\*Open Guy\*\* : _open_/); assert.match(mens, /^📋 \*\*Men's Division\*\* · 2 taken · 1 open/);
        assert.ok(!/Retired Ron|Pending Pat/.test(mens), 'only approved wrestlers');
        assert.match(mens, /Updated <t:\d+:R>/);
        assert.deepStrictEqual(posts[0].payload.allowedMentions, { parse: [] }, 'never pings');
        assert.match(desc(posts[1]), /Liv Morgan\*\* : <@u3>/);
        assert.match(desc(posts[2]), /Nobody yet/);
        const how = posts[4].payload.components[0].toJSON().components.map((c) => c.custom_id);
        assert.deepStrictEqual(how, ['ui:rq:h:mw:rb', 'ui:sw:h:mw:rb', 'ui:mk:h:rb', 'ui:mr:h:rb', 'ui:h:roster:rb']); // main channel has every division
        assert.strictEqual((await q(`select count(*)::int n from roster_board_posts`))[0].n, 5);
    });

    await t('staff set an overall on the wrestler\'s 🛠 Staff screen; only that division\'s post is edited', async () => {
        let i = await click(`ui:ws:v:${J}`, priv(ADM));
        assert.ok(ids(i).includes(`ui:ov:${J}`));
        i = await click(`ui:ov:${J}`, priv(ADM));
        assert.deepStrictEqual(modalOf(i).inputs, ['overall']);
        const e0 = edited.length, s0 = sent.length;
        i = await click(`ui:ovm:${J}`, priv({ ...ADM, fields: { overall: '91' } }));
        assert.match(text(i), /91 Overall/);
        assert.strictEqual((await q(`select overall from characters where id=$1`, [J]))[0].overall, 91);
        await wait(250);
        const ed = edited.slice(e0);
        assert.strictEqual(ed.length, 1, 'one post edited');
        assert.match(desc(ed[0]), /\*\*Jey Uso\*\* \(91 Overall\) : <@u1>/);
        assert.strictEqual(sent.length, s0, 'nothing new posted');
        i = await click(`ui:ovm:${J}`, priv({ ...ADM, fields: { overall: '120' } }));
        assert.match(text(i), /1 to 99/);
        i = await click(`ui:ovm:${J}`, priv({ ...P('u1'), fields: { overall: '99' } }));
        assert.match(text(i), /Only admins|staff/i);
        assert.strictEqual((await q(`select overall from characters where id=$1`, [J]))[0].overall, 91);
        i = await click(`ui:h:mine`, priv(P('u1')));
        assert.match(text(i), /91 Overall/, 'shows on My Wrestlers');
    });

    await t('a transfer / new wrestler updates it by itself; nothing changes = no edits', async () => {
        await run('character', 'transfer', { character: L, new_owner: 'u9' }, ADM);
        await wait(200);
        let last = edited.at(-1);
        assert.match(desc(last), /Liv Morgan\*\* : <@u9>/);
        const e0 = edited.length;
        assert.strictEqual(await RB.refresh(client, G), 'unchanged');
        assert.strictEqual(edited.length, e0);
        await run('character', 'retire', { character: A }, ADM);
        await wait(200);
        assert.ok(!/Aaron/.test(desc(edited.at(-1))));
    });

    await t('a deleted roster post is put back (all posts again, in order)', async () => {
        const first = (await q(`select message_id from roster_board_posts where position=0`))[0].message_id;
        deleted.push(first);
        await f.pool.query(`UPDATE characters SET overall = 80 WHERE id = $1`, [O]);
        const s0 = sent.length;
        assert.strictEqual(await RB.refresh(client, G), 'posted');
        assert.strictEqual(sent.slice(s0).filter((m) => m.channelId === 'rosterch').length, 5);
        assert.match(desc(sent.slice(s0)[0]), /Open Guy\*\* \(80 Overall\) : _open_/);
    });

    await t('the hourly check puts back a deleted post even if nothing changed', async () => {
        const first = (await q(`select message_id from roster_board_posts where position=1`))[0].message_id;
        deleted.push(first);
        assert.strictEqual(await RB.refresh(client, G), 'unchanged');
        const s0 = sent.length;
        await RB.refreshAll(client);
        assert.strictEqual(sent.slice(s0).filter((m) => m.channelId === 'rosterch').length, 5);
    });

    await t('a very big division splits over several posts', async () => {
        for (let k = 0; k < 120; k++) await f.makeChar(G, `b${k}`, `Big Roster Wrestler Number ${String(k).padStart(3, '0')}`, 'mens');
        const s0 = sent.length;
        assert.strictEqual(await RB.refresh(client, G), 'posted');
        const posts = sent.slice(s0);
        assert.ok(posts.length >= 6, `got ${posts.length}`);
        for (const p of posts) assert.ok(desc(p).length <= 2000, `${desc(p).length} chars`);
        assert.match(desc(posts[0]), /^📋 \*\*Men's Division\*\* \(1\/\d\)/);
    });

    await t('3.12: a division can have its own channel; it gets that division + the how-to post', async () => {
        const s0 = sent.length;
        let i = await click('ui:ch:s:roster_womens', priv({ ...ADM, kind: 'channel', values: ['womensch'] }));
        assert.match(text(i), /Women's roster is in <#womensch>/, text(i));
        const w = sent.slice(s0).filter((m) => m.channelId === 'womensch');
        assert.strictEqual(w.length, 2);
        assert.match(desc(w[0]), /^📋 \*\*Women's Division\*\* · 1 taken · 0 open/);
        assert.match(desc(w[0]), /Liv Morgan\*\* : <@u9>/);
        assert.match(desc(w[1]), /Want a character/);
        const main = (await q(`select slot from roster_board_posts where channel_id='rosterch' order by position`)).map((r) => r.slot);
        assert.ok(!main.some((x) => x.startsWith('womens')), main.join(','));
        assert.ok(main.includes('info'));
        // turning the division channel off sends it back to the main channel
        i = await click('ui:ch:off:roster_womens', priv(ADM));
        assert.match(text(i), /uses the main roster channel again/, text(i));
        assert.strictEqual((await q(`select count(*)::int n from roster_board_posts where channel_id='womensch'`))[0].n, 0);
        const main2 = (await q(`select slot from roster_board_posts where channel_id='rosterch' order by position`)).map((r) => r.slot);
        assert.ok(main2.includes('womens:0'));
    });

    await t('only division channels (no main): divisions without a channel are not posted', async () => {
        await click('ui:ch:off:roster', priv(ADM));
        await click('ui:ch:s:roster_mens', priv({ ...ADM, kind: 'channel', values: ['mensch'] }));
        const slots = await q(`select channel_id, slot from roster_board_posts order by channel_id, position`);
        assert.ok(slots.every((r) => r.channel_id === 'mensch'), JSON.stringify(slots));
        assert.ok(slots.some((r) => r.slot === 'info'));
        await click('ui:ch:off:roster_mens', priv(ADM));
        await click('ui:ch:s:roster', priv({ ...ADM, kind: 'channel', values: ['rosterch'] }));
    });

    await t('turn it off removes the posts', async () => {
        const i = await click('ui:ch:off:roster', priv(ADM));
        assert.ok(!/⚠️/.test(text(i)), text(i));
        assert.strictEqual((await q(`select roster_channel_id from guilds where guild_id=$1`, [G]))[0].roster_channel_id, null);
        assert.strictEqual((await q(`select count(*)::int n from roster_board_posts`))[0].n, 0);
        assert.strictEqual(await RB.refresh(client, G), 'off');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end(); process.exit(failed ? 1 : 0);
})();
