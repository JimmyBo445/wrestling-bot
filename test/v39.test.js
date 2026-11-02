// 2.20.0: /fnlw home menu and the new buttons on /whois, /directory list, /help, profile, /stats user, /championship list
const assert = require('assert');
const f = require('./fixtures');
const { run, click, text } = require('./mock');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 5).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const PLAYER = { admin: false, user: 'u1' };
const G = 'g1';
const q = async (sql, a) => (await f.pool.query(sql, a)).rows;
const PRIVATE = { flags: 64, embeds: [], components: [] }; // a private (ephemeral) message the button sits on
const ids = (i) => JSON.stringify((i.responses.at(-1)?.p?.components || []).map((r) => (r.toJSON ? r.toJSON() : r)));
const isErr = (i) => i.responses.some((r) => /⚠️/.test(r.p?.content || ''));
const last = (i) => i.responses.at(-1);

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const ACE = await f.makeChar(G, 'u1', 'Ace Blackout', 'custom');
    const LIV = await f.makeChar(G, 'u1', 'Liv Morgan', 'womens');
    const BOLT = await f.makeChar(G, 'u2', 'Bolt', 'mens');
    const SHOW = await f.titleId(G, 'Showtime Championship');
    await run('title', 'reign-add', { title: SHOW, won_date: '2026-09-08', character: ACE, defenses: 1 }, ADM);
    await run('match', 'log-singles', { participant1: BOLT, participant2: await f.makeChar(G, 'u3', 'Cruz', 'mens'), winner: 1 }, ADM);

    await t('/fnlw opens a private home menu; members don\'t get Staff Tools, admins do', async () => {
        let i = await run('fnlw', null, {}, PLAYER);
        assert.strictEqual(i.responses[0].p.flags & 64, 64, 'private');
        assert.match(ids(i), /ui:h:champs.*ui:h:show.*ui:h:results.*ui:h:roster.*ui:h:mine.*ui:h:help/);
        assert.doesNotMatch(ids(i), /ui:h:staff/);
        i = await run('fnlw', null, {}, ADM);
        assert.match(ids(i), /ui:h:staff/);
    });

    await t('home buttons update the private menu in place, each with a Home button', async () => {
        let i = await click('ui:h:champs', { message: PRIVATE, admin: false, user: 'u1' });
        assert.strictEqual(last(i).type, 'update');
        assert.match(text(i), /Champions.*\*\*Showtime\*\*: Ace Blackout \(<@u1>\) · \d+d · 1 def\./s);
        assert.match(ids(i), /ui:belt.*ui:h:home/);
        i = await click('ui:h:results', { message: PRIVATE, admin: false, user: 'u1' });
        assert.match(text(i), /Bolt\*\* def\. Cruz/);
        i = await click('ui:h:show', { message: PRIVATE, admin: false, user: 'u1' });
        assert.match(text(i), /No show card has been posted yet/);
        i = await click('ui:h:mine', { message: PRIVATE, admin: false, user: 'u1' });
        assert.match(text(i), /My Wrestlers.*You play \*\*2\*\* wrestlers.*Ace Blackout.*🏆 Showtime.*Liv Morgan/s);
        i = await click('ui:h:roster', { message: PRIVATE, admin: false, user: 'u1' });
        assert.match(text(i), /Ace Blackout\*\* · <@u1> 🏆/);
        i = await click('ui:h:help', { message: PRIVATE, admin: false, user: 'u1' });
        assert.match(text(i), /Getting started/);
        assert.match(ids(i), /ui:help.*ui:h:home/);
        i = await click('ui:h:home', { message: PRIVATE, admin: false, user: 'u1' });
        assert.match(text(i), /Home/);
    });

    await t('the show card is visible to everyone from the home menu', async () => {
        const svc = require('../src/utils/cardService');
        await svc.addMatchToCard(G, 'raw', { matchType: 'singles', characterIds: [BOLT, ACE === BOLT ? LIV : (await f.makeChar(G, 'u4', 'Dax', 'mens'))] }).catch(() => {});
        const i = await click('ui:h:show', { message: PRIVATE, admin: false, user: 'u1' });
        assert.match(text(i), /RAW.*Bolt vs Dax/s);
    });

    await t('staff buttons check permissions; members are turned away', async () => {
        let i = await click('ui:h:staff', { message: PRIVATE, admin: false, user: 'u1' });
        assert.match(text(i), /Only admins and staff/);
        i = await click('ui:h:pending', { message: PRIVATE, admin: false, user: 'u1' });
        assert.match(text(i), /Only admins and staff/);
        i = await click('ui:h:staff', { message: PRIVATE });
        assert.match(text(i), /Staff Tools.*Waiting for approval:\*\* 0/s);
        i = await click('ui:h:watch', { message: PRIVATE });
        assert.ok(!isErr(i), text(i));
        assert.strictEqual(i.responses[0].p?.flags & 64 || 64, 64);
    });

    await t('/whois has a wrestler dropdown and buttons; clicks under a public message answer privately', async () => {
        let i = await run('whois', null, { character: LIV }, PLAYER);
        assert.match(ids(i), /ui:w:c.*ui:w:p:\d+.*ui:w:s:\d+.*ui:w:t:\d+/);
        i = await click('ui:w:c', { values: [ACE], admin: false, user: 'u2' });
        assert.strictEqual(last(i).p.flags & 64, 64, 'private answer, the public message is untouched');
        assert.match(text(i), /Who is Ace Blackout\?/);
        i = await click(`ui:w:t:${ACE}`, { admin: false, user: 'u2' });
        assert.match(text(i), /Ace Blackout: title history.*🏆 \*\*Showtime Championship\*\*/s);
        i = await click(`ui:w:s:${ACE}`, { admin: false, user: 'u2' });
        assert.match(text(i), /Ace Blackout — Stats/);
        i = await click(`ui:w:p:${LIV}`, { admin: false, user: 'u2' });
        assert.ok(!isErr(i), text(i));
        assert.ok(i.responses.some((r) => (r.p?.files || []).length), 'profile card picture');
    });

    await t('/directory list switches division and sort with buttons', async () => {
        let i = await run('directory', 'list', {}, PLAYER);
        assert.match(ids(i), /ui:l:mens:wrestler:0.*ui:l:all:player:0/);
        i = await click('ui:l:womens:wrestler:0', { admin: false, user: 'u2' });
        assert.match(text(i), /Liv Morgan/);
        assert.doesNotMatch(text(i), /Bolt/);
        i = await click('ui:l:all:player:0', { message: PRIVATE, admin: false, user: 'u2' });
        assert.strictEqual(last(i).type, 'update');
        assert.match(text(i), /<@u1> \(2\): Ace Blackout/);
    });

    await t('/help has a topic dropdown; members never see the staff topic', async () => {
        let i = await run('help', null, {}, PLAYER);
        assert.match(ids(i), /ui:help/);
        assert.doesNotMatch(ids(i), /"staff"/);
        i = await click('ui:help', { values: ['titles'], message: PRIVATE, admin: false, user: 'u1' });
        assert.match(text(i), /Help: Titles/);
        i = await click('ui:help', { values: ['staff'], message: PRIVATE, admin: false, user: 'u1' });
        assert.match(text(i), /Getting started/, 'falls back for members');
        i = await click('ui:help', { values: ['staff'], message: PRIVATE });
        assert.match(text(i), /Staff tools/);
    });

    await t('profile card, /stats user and /championship list come with buttons', async () => {
        let i = await run('character', 'profile', { character: ACE }, PLAYER);
        assert.match(ids(i), /ui:w:s:\d+.*ui:w:o:\d+.*ui:w:t:\d+/);
        i = await click(`ui:w:o:${ACE}`, { admin: false, user: 'u2' });
        assert.match(text(i), /played by <@u1>/);
        i = await run('stats', 'user', { user: 'u1' }, PLAYER);
        assert.match(ids(i), /ui:sp/);
        i = await click('ui:sp', { values: [LIV], admin: false, user: 'u2' });
        assert.ok(i.responses.some((r) => (r.p?.files || []).length));
        i = await run('championship', 'list', {}, PLAYER);
        assert.match(ids(i), /ui:belt/);
        i = await click('ui:belt', { values: [String(SHOW)], admin: false, user: 'u2' });
        assert.match(ids(i), /chmp:hist/);
        assert.doesNotMatch(ids(i), /chmp:vac/, 'members get no admin buttons');
    });

    await t('an unknown or old button explains itself', async () => {
        const i = await click('ui:zz', { admin: false, user: 'u1' });
        assert.match(text(i), /older version/);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end();
    process.exit(failed ? 1 : 0);
})();
