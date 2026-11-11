// 3.6.0: unfinished match pings go out around 1 pm in the server's time zone.
const assert = require('assert');
const f = require('./fixtures');
const { sent, client } = require('./mock');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 6).join('\n       ')); }
}
const G = 'g1';
const q = async (sql, a) => (await f.pool.query(sql, a)).rows;
const U = require('../src/utils/unfinished');
const svc = require('../src/utils/cardService');
// a fixed winter day (Central time is UTC-6)
const at = (utcHour, day = 10) => new Date(Date.UTC(2026, 10, day, utcHour, 5));

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const A = await f.makeChar(G, 'u1', 'Ace', 'mens');
    const B = await f.makeChar(G, 'u2', 'Bolt', 'mens');
    await svc.addMatchToCard(G, 'raw', { matchType: 'singles', characterIds: [A, B] });
    await f.pool.query(`UPDATE card_shows SET show_date = '2026-11-08' WHERE guild_id = $1`, [G]);
    await f.pool.query(`UPDATE guilds SET reminders_channel_id = 'remch', tz = 'America/Chicago' WHERE guild_id = $1`, [G]);
    const g = async () => (await q(`select * from guilds where guild_id=$1`, [G]))[0];
    const posts = (b) => sent.slice(b).filter((m) => m.channelId === 'remch').length;

    await t('Chicago time: nothing at 6:05 am or 12:05 pm, the ping goes out at 1:05 pm', async () => {
        let b = sent.length;
        await U.runUnfinishedReminders(client, await g(), at(12)); // 6:05 am Central
        await U.runUnfinishedReminders(client, await g(), at(18)); // 12:05 pm Central
        assert.strictEqual(posts(b), 0);
        await U.runUnfinishedReminders(client, await g(), at(19)); // 1:05 pm Central
        assert.strictEqual(posts(b), 1);
        b = sent.length;
        await U.runUnfinishedReminders(client, await g(), at(23)); // 5:05 pm, same day
        assert.strictEqual(posts(b), 0, 'once a day');
    });
    await t('the next day: again at 1 pm Central (not at midnight UTC)', async () => {
        const b = sent.length;
        await U.runUnfinishedReminders(client, await g(), at(1, 11)); // 7:05 pm Nov 10 Central
        assert.strictEqual(posts(b), 0);
        await U.runUnfinishedReminders(client, await g(), at(19, 11)); // 1:05 pm Nov 11 Central
        assert.strictEqual(posts(b), 1);
    });
    await t('the scheduler lines up with the top of the hour', async () => {
        const src = require('fs').readFileSync(require.resolve('../src/utils/scheduler.js'), 'utf8');
        assert.match(src, /HOUR - \(Date\.now\(\) % HOUR\)/);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end();
    process.exit(failed ? 1 : 0);
})();
