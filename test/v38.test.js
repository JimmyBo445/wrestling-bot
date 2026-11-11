// 2.20.0: staff role, /admin channels and rules, /title holds the reign tools, tag reigns with partners
const assert = require('assert');
const f = require('./fixtures');
const { run, auto, text } = require('./mock');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 5).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const PLAYER = { admin: false, user: 'u9' };
const G = 'g1';
const q = async (sql, a) => (await f.pool.query(sql, a)).rows;
const isErr = (i) => i.responses.some((r) => /⚠️/.test(r.p?.content || ''));
const profileReigns = async (charId) => (await q(
    `SELECT COUNT(DISTINCT tr.id)::int AS n FROM title_reigns tr
     WHERE (tr.team_id IS NULL AND tr.character_id = $1) OR EXISTS (SELECT 1 FROM title_reign_members m WHERE m.reign_id = tr.id AND m.character_id = $1)`, [charId]))[0].n;

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const BRON = await f.makeChar(G, 'u1', 'Bron', 'custom');
    const JEY = await f.makeChar(G, 'u2', 'Jey', 'custom');
    const SAMI = await f.makeChar(G, 'u3', 'Sami', 'custom');
    const ACE = await f.makeChar(G, 'u4', 'Ace', 'mens');
    const CTAG = await f.titleId(G, 'Customs Tag Team Championship');
    const WH = await f.titleId(G, 'World Heavyweight Championship');

    await t('a tag reign takes character + partner + partner2, links every member and credits every player', async () => {
        const i = await run('title', 'reign-add', { title: CTAG, won_date: '2025-04-12', lost_date: '2025-06-28', character: BRON, partner: JEY, team_name: 'Black Air Force Energy', defenses: 1 }, ADM);
        assert.ok(!isErr(i), text(i));
        assert.match(text(i), /Black Air Force Energy/);
        assert.strictEqual(await profileReigns(BRON), 1);
        assert.strictEqual(await profileReigns(JEY), 1);
        const own = await q(`select u.discord_id from reign_owners ro join users u on u.id=ro.user_id order by 1`);
        assert.deepStrictEqual(own.map((r) => r.discord_id), ['u1', 'u2']);
        const three = await run('title', 'reign-add', { title: CTAG, won_date: '2025-06-28', lost_date: '2025-08-04', character: SAMI, partner: BRON, partner2: JEY }, ADM);
        assert.match(text(three), /Sami & Bron & Jey/);
        assert.strictEqual(await profileReigns(SAMI), 1);
    });

    await t('tag mistakes get clear messages', async () => {
        let i = await run('title', 'reign-add', { title: CTAG, won_date: '2025-09-01', character: BRON }, ADM);
        assert.match(text(i), /pick `character` \*\*and\*\* `partner`/i);
        i = await run('title', 'reign-add', { title: CTAG, won_date: '2025-09-01', character: BRON, partner: BRON }, ADM);
        assert.match(text(i), /listed twice/);
        i = await run('title', 'reign-add', { title: CTAG, won_date: '2025-09-01', character: BRON, partner: ACE }, ADM);
        assert.match(text(i), /different division/);
        i = await run('title', 'reign-add', { title: WH, won_date: '2025-09-01', character: ACE, partner: BRON }, ADM);
        assert.match(text(i), /only for tag titles/);
        i = await run('title', 'reign-add', { title: CTAG, won_date: '2025-09-01', partner: JEY, champion_name: 'X' }, ADM);
        assert.match(text(i), /Pick the first wrestler/);
    });

    await t('reign-edit adds partners to an old tag reign and keeps the player credit it already had', async () => {
        const id = (await q(`insert into title_reigns (guild_id,title_id,reign_char_name,won_date,lost_date,is_backfilled,entered_by) values ($1,$2,'D Squared','2025-08-24','2025-08-27',true,'t') returning id`, [G, CTAG]))[0].id;
        const old = (await q(`insert into users (guild_id, discord_id) values ($1,'u9') on conflict (guild_id, discord_id) do update set discord_id = excluded.discord_id returning id`, [G]))[0].id;
        await q(`insert into reign_owners values ($1,$2)`, [id, old]);
        const i = await run('title', 'reign-edit', { title: CTAG, reign: Number(id), character: SAMI, partner: JEY, team_name: 'D Squared' }, ADM);
        assert.ok(!isErr(i), text(i));
        assert.strictEqual(await profileReigns(JEY), 3);
        const own = (await q(`select u.discord_id from reign_owners ro join users u on u.id=ro.user_id where ro.reign_id=$1 order by 1`, [id])).map((r) => r.discord_id);
        assert.deepStrictEqual(own, ['u2', 'u3', 'u9']);
        const label = await run('title', 'reign-edit', { title: CTAG, reign: Number(id), team_name: 'D-Squared' }, ADM);
        assert.ok(!isErr(label), text(label));
        assert.strictEqual((await q('select reign_char_name n from title_reigns where id=$1', [id]))[0].n, 'D-Squared');
    });

    await t('partner autocomplete lists wrestlers', async () => {
        const c = await auto('title', 'reign-add', 'partner', 'je', { title: CTAG }, ADM);
        assert.ok(c.some((x) => x.value === JEY));
    });

    await t('/reign is gone; its tools live in /title', async () => {
        const names = require('../src/registerCommands').loadCommandData();
        assert.ok(!names.some((c) => c.name === 'reign'));
        const title = names.find((c) => c.name === 'title').options.map((o) => o.name);
        assert.deepStrictEqual(title, ['manage', 'belt-image']); // 3.9: the reign tools are forms in /title manage
    });

    await t('/admin channels sets several at once, turns one off, and shows them all', async () => {
        let i = await run('admin', 'channels', { pending: 'p1', staff: 's1', matches: 'm1' }, ADM);
        assert.match(text(i), /Channels saved.*Approvals & streak prompts:\*\* <#p1>.*Staff reminders:\*\* <#s1>.*Match results copy:\*\* <#m1>/s);
        i = await run('admin', 'channels', { turn_off: 'matches' }, ADM);
        assert.match(text(i), /Match results copy:\*\* off/);
        const st = (await q('select pending_channel_id, admin_channel_id, matches_channel_id from guilds where guild_id=$1', [G]))[0];
        assert.deepStrictEqual(st, { pending_channel_id: 'p1', admin_channel_id: 's1', matches_channel_id: null });
        i = await run('admin', 'channels', {}, ADM);
        assert.match(text(i), /Bot channels/);
    });

    await t('/admin rules changes only what is filled in and checks the time zone', async () => {
        let i = await run('admin', 'rules', { cooldown_hours: 48, cooldown_by: 'character', streak_wins: 4, rematches: 'on', rematch_days: 14 }, ADM);
        assert.match(text(i), /48h \(same two characters\).*every 4 wins.*on \(14 days\)/s);
        i = await run('admin', 'rules', { timezone: 'Mars/Base' }, ADM);
        assert.match(text(i), /don't know that time zone/);
        i = await run('admin', 'rules', { timezone: 'America/Chicago', milestones: 'off' }, ADM);
        assert.match(text(i), /48h.*Milestone shout-outs:\*\* off.*America\/Chicago/s);
    });

    await t('a staff role lets members without Manage Server use the admin tools', async () => {
        const staffMember = { admin: false, user: 'u5', member: { roles: ['role-staff'] } };
        let i = await run('title', 'vacate', { title: WH }, staffMember);
        assert.match(text(i), /Only admins and staff/);
        i = await run('admin', 'staff-role', { role: 'role-staff' }, ADM);
        assert.match(text(i), /<@&role-staff>.*Integrations/s);
        i = await run('title', 'reign-add', { title: WH, won_date: '2025-01-01', character: ACE }, staffMember);
        assert.ok(!isErr(i), text(i));
        i = await run('title', 'reign-add', { title: WH, won_date: '2024-01-01', lost_date: '2024-02-01', character: ACE }, { admin: false, user: 'u6', member: { roles: ['other'] } });
        assert.match(text(i), /Only admins and staff/);
        i = await run('admin', 'staff-role', { remove: true }, ADM);
        assert.match(text(i), /staff role is \*\*off\*\*/);
        i = await run('title', 'vacate', { title: WH }, staffMember);
        assert.match(text(i), /Only admins and staff/);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end();
    process.exit(failed ? 1 : 0);
})();
