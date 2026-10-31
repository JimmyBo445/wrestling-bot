// 2.19.0: /whois and the text roster (/directory list)
const assert = require('assert');
const f = require('./fixtures');
const { run, auto, text } = require('./mock');
const { buildRosterList, toMessages } = require('../src/modules/rosterList');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 5).join('\n       ')); }
}
const PLAYER = { admin: false, user: 'u9' };
const G = 'g1';
const q = async (sql, a) => (await f.pool.query(sql, a)).rows;

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const ACE = await f.makeChar(G, 'u1', 'Ace Blackout', 'custom');
    const LIV = await f.makeChar(G, 'u1', 'Liv Morgan', 'womens');
    await f.makeChar(G, 'u1', 'Old Timer', 'mens', 'retired');
    const BOLT = await f.makeChar(G, 'u2', 'Bolt', 'mens');
    await f.makeChar(G, 'u2', 'Zed', 'custom', 'pending');
    const SHOW = await f.titleId(G, 'Showtime Championship');
    await q(`insert into title_reigns (guild_id, title_id, character_id, won_date, entered_by) values ($1,$2,$3,'2026-09-08','t')`, [G, SHOW, ACE]);
    await q(`update titles set is_vacant=false where id=$1`, [SHOW]);

    await t('/whois character: who plays them, plus all that player\'s wrestlers (anyone can use it)', async () => {
        const i = await run('whois', null, { character: ACE }, PLAYER);
        const out = text(i);
        assert.match(out, /Who is Ace Blackout\? \*\*Ace Blackout\*\* is played by <@u1>/);
        assert.match(out, /All of .*'s wrestlers \(3\)/);
        assert.match(out, /\*\*Ace Blackout\*\* ◀\nCustom · 0-0 · 🏆 Showtime/);
        assert.match(out, /\*\*Liv Morgan\*\*\nWomen's · 0-0/);
        assert.match(out, /\*\*Old Timer\*\* _\(retired\)_/);
        assert.ok(out.indexOf('Old Timer') > out.indexOf('Liv Morgan'), 'retired wrestlers come last');
        assert.doesNotMatch(out, /Bolt/);
    });

    await t('/whois player: lists their wrestlers; pending ones are not shown', async () => {
        const i = await run('whois', null, { player: 'u2' }, PLAYER);
        assert.match(text(i), /<@u2> plays \*\*1\*\* wrestler\./);
        assert.match(text(i), /\*\*Bolt\*\*/);
        assert.doesNotMatch(text(i), /Zed/);
        const none = await run('whois', null, { player: 'u7' }, PLAYER);
        assert.match(text(none), /doesn't have any wrestlers yet/);
    });

    await t('/whois with nothing picked explains what to do; autocomplete finds wrestlers', async () => {
        const i = await run('whois', null, {}, PLAYER);
        assert.match(text(i), /Pick a `character`/);
        const choices = await auto('whois', null, 'character', 'ace', {}, PLAYER);
        assert.strictEqual(choices[0].value, ACE);
    });

    await t('/whois on an unclaimed wrestler says nobody plays them', async () => {
        await q(`update users set is_placeholder=true where discord_id='u2'`);
        const i = await run('whois', null, { character: BOLT }, PLAYER);
        assert.match(text(i), /no player\*\* right now/);
        await q(`update users set is_placeholder=false where discord_id='u2'`);
    });

    await t('/directory list: every division A to Z, wrestler and player, champions marked', async () => {
        const i = await run('directory', 'list', {}, PLAYER);
        const out = text(i);
        assert.match(out, /Men's \(1\) \*\*Bolt\*\* · <@u2>/);
        assert.match(out, /Custom \(1\) \*\*Ace Blackout\*\* · <@u1> 🏆/);
        assert.match(out, /Women's \(1\) \*\*Liv Morgan\*\* · <@u1>/);
        assert.match(out, /3 wrestlers · 2 players/);
        assert.doesNotMatch(out, /Old Timer|Zed/);
    });

    await t('/directory list sort:player groups by player; include_retired adds retired wrestlers', async () => {
        const i = await run('directory', 'list', { sort: 'player', include_retired: true }, PLAYER);
        const out = text(i);
        assert.match(out, /<@u1> \(3\): Ace Blackout _Custom_ 🏆, Liv Morgan _Women's_, Old Timer _Men's_ _\(retired\)_/);
        assert.match(out, /<@u2> \(1\): Bolt _Men's_/);
    });

    await t('/directory list division: only that division; an empty division says so', async () => {
        const i = await run('directory', 'list', { division: 'womens' }, PLAYER);
        assert.match(text(i), /Liv Morgan/);
        assert.doesNotMatch(text(i), /Bolt/);
        const e = await run('directory', 'list', { division: 'custom_womens' }, PLAYER);
        assert.match(text(e), /no active wrestlers in the Custom Women's division/);
    });

    await t('a big roster is split into pieces that fit Discord\'s limits', async () => {
        for (let n = 0; n < 160; n++) await f.makeChar(G, `p${n % 40}`, `Wrestler Number ${String(n).padStart(3, '0')} With A Long Name`, 'mens');
        const embeds = await buildRosterList(G, {});
        assert.ok(embeds.every((e) => e.data.description.length <= 4096));
        const msgs = toMessages(embeds);
        for (const m of msgs) {
            assert.ok(m.length <= 10);
            assert.ok(m.reduce((s, e) => s + (e.data.title || '').length + e.data.description.length + (e.data.footer?.text || '').length, 0) <= 6000);
        }
        const i = await run('directory', 'list', {}, PLAYER);
        assert.ok(i.responses.length >= 2, 'the rest is sent as follow-up messages');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end();
    process.exit(failed ? 1 : 0);
})();
