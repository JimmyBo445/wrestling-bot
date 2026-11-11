// 3.2.0: unfinished card matches: staff list + ping button, daily pings (from the day after the show,
// up to 6 days in a row), "you have unfinished matches" in My Wrestlers.
const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, sent, ids } = require('./mock');

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
const U = require('../src/utils/unfinished');
const svc = require('../src/utils/cardService');
const { client } = require('./mock');
const ymd = (d) => d.toISOString().slice(0, 10);
const day = (offset, hour = 13) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); d.setUTCHours(hour, 0, 0, 0); return d; };
const guildRow = async () => (await q(`select * from guilds where guild_id=$1`, [G]))[0];

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    await f.pool.query(`UPDATE guilds SET tz = 'UTC' WHERE guild_id = $1`, [G]);
    const A = await f.makeChar(G, 'u1', 'Ace', 'mens');
    const B = await f.makeChar(G, 'u2', 'Bolt', 'mens');
    const C = await f.makeChar(G, 'u3', 'Cruz', 'mens');
    const D = await f.makeChar(G, 'u4', 'Dax', 'mens');
    const E = await f.makeChar(G, 'u5', 'Eve', 'womens');
    const F = await f.makeChar(G, 'u6', 'Fay', 'womens');
    await svc.addMatchToCard(G, 'raw', { matchType: 'singles', characterIds: [A, B] });
    await svc.addMatchToCard(G, 'raw', { matchType: 'singles', characterIds: [C, D] });
    await svc.addMatchToCard(G, 'raw', { matchType: 'singles', characterIds: [E, F] });
    const showDay = ymd(day(-1));
    await f.pool.query(`INSERT INTO card_shows (guild_id, brand, show_date) VALUES ($1,'raw',$2::date) ON CONFLICT (guild_id, brand) DO UPDATE SET show_date = EXCLUDED.show_date`, [G, showDay]);

    await t('a match counts as unfinished once its show date has passed and it has no result', async () => {
        let list = await U.listUnfinished(G, ymd(day(-1)));
        assert.strictEqual(list.length, 0, 'not on show day itself');
        list = await U.listUnfinished(G, ymd(day(0)));
        assert.strictEqual(list.length, 3);
        await run('match', 'log', { type: 'singles', wrestler1: C, wrestler2: D, winner: 1 }, ADM);
        list = await U.listUnfinished(G, ymd(day(0)));
        assert.deepStrictEqual(list.map((m) => m.people.map((p) => p.name).join(' vs ')), ['Ace vs Bolt', 'Eve vs Fay']);
        assert.deepStrictEqual(list[0].players.sort(), ['u1', 'u2']);
        assert.strictEqual(list[0].days_late, 1);
    });

    await t('staff see the list in Staff Tools and can ping from it; players can\'t', async () => {
        let i = await click('ui:h:staff', priv(ADM));
        assert.ok(ids(i).includes('ui:uf:h'));
        assert.match(JSON.stringify(i.responses.at(-1).p.components.map((r) => r.toJSON())), /Unfinished matches \(2\)/);
        i = await click('ui:uf:h', priv(ADM));
        assert.match(text(i), /Unfinished matches \(2\)/);
        assert.match(text(i), /Ace\*\* vs \*\*Bolt/);
        assert.match(text(i), /1 day late/);
        assert.match(text(i), /Daily pings: off/);
        assert.ok(ids(i).includes('ui:ch:k:reminders'));
        const before = sent.length;
        i = await click('ui:uf:p', priv(ADM));
        assert.match(text(i), /Pinged the players of 2 matches/);
        const post = sent[before];
        assert.match(post.payload.content, /<@u1> \(Ace\) vs <@u2> \(Bolt\)/);
        assert.deepStrictEqual(post.payload.allowedMentions.users.sort(), ['u1', 'u2', 'u5', 'u6']);
        i = await click('ui:uf:h', priv(P('u1')));
        assert.match(text(i), /Only admins and staff/);
        i = await click('ui:uf:p', priv(P('u1')));
        assert.match(text(i), /Only admins and staff/);
        assert.strictEqual(sent.length, before + 1);
    });

    await t('daily pings: off without a channel; once a day from noon; 6 days in a row, then they stop', async () => {
        let before = sent.length;
        await U.runUnfinishedReminders(client, await guildRow(), day(0));
        assert.strictEqual(sent.length, before, 'no channel, no pings');
        let i = await click('ui:ch:k:reminders', priv(ADM));
        assert.ok(ids(i).includes('ui:ch:s:reminders'));
        await click('ui:ch:s:reminders', priv({ ...ADM, kind: 'channel', values: ['remch'] }));
        assert.strictEqual((await guildRow()).reminders_channel_id, 'remch');

        before = sent.length;
        await U.runUnfinishedReminders(client, await guildRow(), day(0, 12));
        assert.strictEqual(sent.length, before, 'not before 1 pm');
        const counts = [];
        for (let n = 0; n < 8; n++) {
            const b = sent.length;
            await U.runUnfinishedReminders(client, await guildRow(), day(n, 13));
            await U.runUnfinishedReminders(client, await guildRow(), day(n, 18)); // a second check the same day does nothing
            const posts = sent.slice(b).filter((m) => m.channelId === 'remch');
            counts.push(posts.length);
            if (n === 0) assert.match(posts[0].payload.content, /reminder 1\/6/);
            if (n === 5) assert.match(posts[0].payload.content, /last reminder/);
        }
        assert.deepStrictEqual(counts, [1, 1, 1, 1, 1, 1, 0, 0]);
        const rows = await q(`select sent from match_reminders order by match_key`);
        assert.deepStrictEqual(rows.map((r) => r.sent), [6, 6]);
    });

    await t('a match played after a reminder drops off the list; moving it on the card doesn\'t reset its count', async () => {
        await run('match', 'log', { type: 'singles', wrestler1: E, wrestler2: F, winner: 2 }, ADM);
        const list = await U.listUnfinished(G, ymd(day(0)));
        assert.deepStrictEqual(list.map((m) => m.people[0].name), ['Ace']);
        const draft = (await q(`select id from card_drafts where division='mens'`))[0].id;
        await svc.moveMatchOnCard(G, 'raw', 'mens', 1, 2);
        const after = await U.listUnfinished(G, ymd(day(0)));
        assert.strictEqual(after[0].position, 2);
        assert.ok(draft);
        const b = sent.length;
        await f.pool.query(`UPDATE guilds SET unfinished_last = NULL WHERE guild_id = $1`, [G]);
        await U.runUnfinishedReminders(client, await guildRow(), day(9));
        assert.strictEqual(sent.length, b, 'still counted as already pinged 6 times');
    });

    await t('a new show date starts fresh reminders (new card, new matches)', async () => {
        await f.pool.query(`UPDATE card_shows SET show_date = $2::date WHERE guild_id = $1`, [G, ymd(day(8))]);
        await f.pool.query(`UPDATE guilds SET unfinished_last = NULL WHERE guild_id = $1`, [G]);
        const b = sent.length;
        await U.runUnfinishedReminders(client, await guildRow(), day(9));
        assert.strictEqual(sent.slice(b).length, 1);
        assert.match(sent[b].payload.content, /reminder 1\/6/);
    });

    await t('players see their own unfinished matches in My Wrestlers', async () => {
        await f.pool.query(`UPDATE card_shows SET show_date = $2::date WHERE guild_id = $1`, [G, showDay]);
        let i = await click('ui:h:mine', priv(P('u1')));
        assert.match(text(i), /You have 1 unfinished match/);
        i = await click('ui:h:mine', priv(P('u5')));
        assert.ok(!/unfinished/.test(text(i)), 'Eve played hers');
    });

    await t('/admin unfinished opens the same list privately', async () => {
        const i = await run('admin', 'unfinished', {}, ADM);
        assert.match(text(i), /Unfinished matches \(1\)/);
        assert.ok(ids(i).includes('ui:uf:p:all'));
        const j = await run('admin', 'unfinished', {}, P('u1'));
        assert.match(text(j), /Only admins and staff/);
    });

    await t('pick the RAW or SmackDown card: list and ping only that card', async () => {
        const X = await f.makeChar(G, 'u7', 'Xena', 'mens');
        const Y = await f.makeChar(G, 'u8', 'Yuri', 'mens');
        await svc.addMatchToCard(G, 'smackdown', { matchType: 'singles', characterIds: [X, Y] });
        await f.pool.query(`INSERT INTO card_shows (guild_id, brand, show_date) VALUES ($1,'smackdown',$2::date) ON CONFLICT (guild_id, brand) DO UPDATE SET show_date = EXCLUDED.show_date`, [G, showDay]);
        let i = await run('admin', 'unfinished', {}, ADM);
        assert.match(text(i), /Unfinished matches \(2\)/);
        assert.ok(ids(i).includes('ui:uf:h:raw') && ids(i).includes('ui:uf:h:smackdown'));
        i = await run('admin', 'unfinished', { card: 'smackdown' }, ADM);
        assert.match(text(i), /Unfinished matches: SmackDown \(1\)/);
        assert.match(text(i), /Xena/);
        assert.ok(!/Ace/.test(text(i)));
        i = await click('ui:uf:h:raw', priv(ADM));
        assert.match(text(i), /RAW \(1\)/);
        assert.ok(!/Xena/.test(text(i)));
        const before = sent.length;
        i = await click('ui:uf:p:smackdown', priv(ADM));
        assert.match(text(i), /Pinged the players of 1 SmackDown match/);
        assert.deepStrictEqual(sent[before].payload.allowedMentions.users.sort(), ['u7', 'u8']);
        assert.strictEqual(sent.length, before + 1);
        i = await click('ui:uf:p:smackdown', priv(P('u7')));
        assert.match(text(i), /Only admins/);
        await f.pool.query(`DELETE FROM card_shows WHERE brand = 'smackdown'`);
    });

    await t('a card with no show date (never scheduled) counts from the day it was made', async () => {
        await svc.startShow(G, 'smackdown', 'admin1', 'Friday Night');
        const X = (await q(`select id::text from characters where name='Xena'`))[0].id;
        const Y = (await q(`select id::text from characters where name='Yuri'`))[0].id;
        await svc.addMatchToCard(G, 'smackdown', { matchType: 'singles', characterIds: [X, Y] });
        assert.strictEqual((await q(`select show_date from card_shows where brand='smackdown'`))[0].show_date, null);
        let i = await run('admin', 'unfinished', { card: 'smackdown' }, ADM);
        assert.match(text(i), /Nothing unfinished on the SmackDown card/, 'made today: not late yet');
        await f.pool.query(`UPDATE card_drafts SET created_at = now() - interval '2 days' WHERE brand = 'smackdown'`);
        i = await run('admin', 'unfinished', { card: 'smackdown' }, ADM);
        assert.match(text(i), /SmackDown \(1\)/);
        assert.match(text(i), /card from .*2 days late.*Xena/s);
        await run('match', 'log', { type: 'singles', wrestler1: X, wrestler2: Y, winner: 1 }, ADM);
        i = await run('admin', 'unfinished', { card: 'smackdown' }, ADM);
        assert.match(text(i), /Nothing unfinished/, 'gone once the result is in');
        await f.pool.query(`DELETE FROM card_shows WHERE brand = 'smackdown'`);
    });

    await t('/admin channels has reminders and can turn them off', async () => {
        let i = await run('admin', 'channels', {}, ADM);
        assert.match(text(i), /Unfinished match pings:\*\* <#remch>/);
        i = await run('admin', 'channels', { turn_off: 'reminders' }, ADM);
        assert.strictEqual((await guildRow()).reminders_channel_id, null);
    });

    await t('nothing unfinished = a clear message and no ping button to press', async () => {
        await f.pool.query(`DELETE FROM card_shows`);
        const i = await click('ui:uf:h', priv(ADM));
        assert.match(text(i), /Nothing unfinished/);
        const btn = i.responses.at(-1).p.components[1].toJSON().components.find((c) => c.custom_id === 'ui:uf:p:all');
        assert.strictEqual(btn.disabled, true);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end();
    process.exit(failed ? 1 : 0);
})();
