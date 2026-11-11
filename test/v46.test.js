// 3.5.0: combining. Old /match log-… retired; /faction folded into /team; staff buttons on the signup
// post, a wrestler, award vote posts and the bracket post; /standings season; /title contender;
// /admin data; /booking signup-edit.
const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, sent, ids, edited } = require('./mock');

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
const isErr = (i) => /⚠️|Only admins|can't|couldn't/i.test(allText(i));
const reg = () => require('../src/registerCommands').loadCommandData();
const subsOf = (name) => reg().find((c) => c.name === name).options.map((o) => o.name);

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const A = await f.makeChar(G, 'u1', 'Ace', 'mens');
    const B = await f.makeChar(G, 'u2', 'Bolt', 'mens');
    const C = await f.makeChar(G, 'u3', 'Cruz', 'mens');
    const D = await f.makeChar(G, 'u4', 'Dax', 'mens');
    const E = await f.makeChar(G, 'u5', 'Eve', 'womens');

    await t('what Discord shows: 18 commands, the merged subcommands, nothing old', async () => {
        const names = reg().map((c) => c.name);
        assert.strictEqual(names.length, 18);
        assert.ok(!names.includes('faction'));
        assert.deepStrictEqual(subsOf('match'), ['log', 'ple', 'rate', 'undo', 'edit', 'recent', 'report']);
        assert.deepStrictEqual(subsOf('team'), ['create', 'list', 'profile', 'add-member', 'remove-member', 'rename', 'disband']);
        assert.deepStrictEqual(subsOf('standings'), ['leaderboard', 'rankings', 'power', 'season']);
        assert.ok(subsOf('title').includes('contender') && !subsOf('title').some((s) => s.startsWith('contender-')));
        assert.deepStrictEqual(subsOf('booking'), ['request', 'signups']); // 3.8: the rest are buttons
        const admin = subsOf('admin');
        assert.deepStrictEqual(admin, ['pending', 'panel', 'data']); // 3.8: everything else is in /admin panel
    });

    // ---------------- /team ----------------
    await t('/team create: tag team (default) and faction (division from the first member; needs 3)', async () => {
        let i = await run('team', 'create', { kind: 'tag', name: 'Wolf Pack', member1: A, member2: B }, ADM);
        assert.ok(!isErr(i), allText(i));
        i = await run('team', 'create', { kind: 'faction', name: 'Duo', member1: C, member2: D }, ADM);
        assert.match(allText(i), /at least 3/);
        i = await run('team', 'create', { kind: 'faction', name: 'The Order', member1: A, member2: C, member3: D }, ADM);
        assert.ok(!isErr(i), allText(i));
        assert.strictEqual((await q(`select division from factions where name='The Order'`))[0].division, 'mens');
        i = await run('team', 'create', { kind: 'tag', name: 'Too Big', member1: A, member2: B, member3: C, member4: D, member5: E }, ADM);
        assert.match(allText(i), /up to 4/);
        i = await run('team', 'create', { kind: 'tag', name: 'Nope', member1: C, member2: D }, P('u3'));
        assert.match(allText(i), /Only admins/);
    });
    await t('/team list shows both; kind: narrows it', async () => {
        let i = await run('team', 'list', {}, P('u1'));
        assert.match(allText(i), /Wolf Pack/); assert.match(allText(i), /The Order/);
        i = await run('team', 'list', { kind: 'faction' }, P('u1'));
        assert.match(allText(i), /The Order/); assert.ok(!/Wolf Pack/.test(allText(i)));
    });
    await t('/team profile / add / remove / rename / disband work on a team or a faction from one list', async () => {
        const tid = (await q(`select id from teams`))[0].id, fid = (await q(`select id from factions`))[0].id;
        const ac = require('./mock');
        const opts = await ac.auto('team', 'profile', 'group', 'o', {}, P('u1'));
        assert.deepStrictEqual(opts.map((o) => o.name).sort(), ['The Order (Faction)', 'Wolf Pack (Tag team)']);
        let i = await run('team', 'profile', { group: `t:${tid}` }, P('u1'));
        assert.ok(!isErr(i), allText(i));
        i = await run('team', 'profile', { group: `f:${fid}` }, P('u1'));
        assert.ok(!isErr(i), allText(i));
        i = await run('team', 'add-member', { group: `f:${fid}`, character: B }, ADM);
        assert.match(allText(i), /Bolt\*\* joined/);
        i = await run('team', 'remove-member', { group: `f:${fid}`, character: B }, ADM);
        assert.match(allText(i), /Bolt/);
        i = await run('team', 'rename', { group: `t:${tid}`, name: 'Wolf Pack II' }, ADM);
        assert.match(allText(i), /Renamed/);
        i = await run('team', 'rename', { group: `f:${fid}`, name: 'X' }, ADM);
        assert.match(allText(i), /Only tag teams/);
        i = await run('team', 'profile', { group: 'the order' }, P('u1'));
        assert.ok(!isErr(i), 'typing the name works too');
        i = await run('team', 'disband', { group: `f:${fid}` }, P('u1'));
        assert.match(allText(i), /Only admins/);
        i = await run('team', 'disband', { group: `f:${fid}` }, ADM);
        assert.match(allText(i), /disbanded/);
        i = await run('team', 'profile', { team: String(tid) }, P('u1'));
        assert.ok(!isErr(i), 'the old team: option still works');
    });

    // ---------------- merged subcommands ----------------
    await t('/standings season (and picture:)', async () => {
        let i = await run('standings', 'season', {}, P('u1'));
        assert.ok(!/Something went wrong/.test(allText(i)), allText(i));
        i = await run('standings', 'season', { picture: true, year: new Date().getFullYear() }, P('u1'));
        assert.ok(!/Something went wrong/.test(allText(i)), allText(i));
    });
    await t('/title contender give / take away', async () => {
        await run('championship', 'list', {}, ADM);
        const tl = (await q(`select id, name from titles where not is_tag_title order by id limit 1`))[0];
        let i = await run('title', 'contender', { action: 'give', title: String(tl.id), character: C }, ADM);
        assert.ok(!isErr(i), allText(i));
        assert.strictEqual((await q(`select count(*)::int n from contenders where status='active'`))[0].n, 1);
        i = await run('title', 'contender', { action: 'take', title: String(tl.id) }, ADM);
        assert.ok(!isErr(i), allText(i));
        assert.strictEqual((await q(`select count(*)::int n from contenders where status='active'`))[0].n, 0);
        i = await run('title', 'contender', { action: 'give', title: String(tl.id), character: C }, P('u1'));
        assert.match(allText(i), /Only admins/);
    });
    await t('/admin data: import with no file sends the examples; backup choices still work', async () => {
        let i = await run('admin', 'data', { action: 'import' }, ADM);
        assert.match(allText(i), /example files/);
        assert.ok((i.responses.at(-1).p.files || []).length === 3);
        i = await run('admin', 'data', { action: 'import', file: { name: 'x.csv', url: 'http://x' } }, ADM);
        assert.match(allText(i), /Pick \*\*what\*\*/);
        i = await run('admin', 'data', { action: 'backup-off' }, ADM);
        assert.match(allText(i), /backups are \*\*off\*\*/);
        i = await run('admin', 'settings', {}, ADM);
        assert.match(allText(i), /\/admin data action:Backup/);
    });

    // ---------------- signup post buttons ----------------
    let sid;
    await t('/booking signup-edit add / remove', async () => {
        await run('booking', 'signup-open', { title: 'RAW 1' }, ADM);
        sid = (await q(`select id from signups`))[0].id;
        let i = await run('booking', 'signup-edit', { action: 'add', character: A }, ADM);
        assert.match(allText(i), /Signed \*\*Ace\*\* up/);
        i = await run('booking', 'signup-edit', { action: 'remove', character: A }, ADM);
        assert.ok(!isErr(i), allText(i));
        assert.strictEqual((await q(`select count(*)::int n from signup_entries`))[0].n, 0);
    });
    await t('signup post: 🔒 Close and ✅ Mark done are staff-only buttons', async () => {
        const su = require('../src/utils/signupUtils');
        let s = (await q(`select * from signups where id=$1`, [sid]))[0];
        let p = await su.buildSignupMessage(s);
        const pid = p.components[0].toJSON().components.map((c) => c.custom_id);
        assert.ok(pid.includes(`signup:close:${sid}`));
        let i = await click(`signup:close:${sid}`, P('u1'));
        assert.match(allText(i), /Only admins and staff/);
        assert.strictEqual((await q(`select status from signups`))[0].status, 'open');
        i = await click(`signup:close:${sid}`, ADM);
        assert.match(allText(i), /Closed \*\*RAW 1\*\*/);
        s = (await q(`select * from signups where id=$1`, [sid]))[0];
        p = await su.buildSignupMessage(s);
        assert.deepStrictEqual(p.components[0].toJSON().components.map((c) => c.custom_id), [`signup:done:${sid}`]);
        i = await click(`signup:done:${sid}`, ADM);
        assert.match(allText(i), /is finished/);
        s = (await q(`select * from signups where id=$1`, [sid]))[0];
        assert.strictEqual(s.status, 'done');
        assert.deepStrictEqual((await su.buildSignupMessage(s)).components, []);
    });

    // ---------------- wrestler staff panel ----------------
    await t('wrestler 🛠 Staff: only staff see it; retire, restore, division, transfer, unclaim, delete', async () => {
        let i = await click('ui:w:c', priv({ ...P('u2'), values: [B] }));
        assert.ok(!ids(i).includes(`ui:ws:v:${B}`), 'players never see it');
        i = await click('ui:w:c', priv({ ...ADM, values: [B] }));
        assert.ok(ids(i).includes(`ui:ws:v:${B}`));
        i = await click(`ui:ws:v:${B}`, priv(P('u2')));
        assert.match(allText(i), /Only admins/);
        i = await click(`ui:ws:v:${B}`, priv(ADM));
        assert.ok(ids(i).includes(`ui:ws:ret:${B}`) && ids(i).includes(`ui:ws:to:${B}`) && ids(i).includes(`ui:ws:dv:${B}:womens`) && !ids(i).includes(`ui:ws:dv:${B}:mens`));
        i = await click(`ui:ws:ret:${B}`, priv(ADM));
        assert.match(allText(i), /Retired \*\*Bolt\*\*/);
        assert.ok(ids(i).includes(`ui:ws:res:${B}`));
        i = await click(`ui:ws:res:${B}`, priv(ADM));
        assert.match(allText(i), /is back/);
        i = await click(`ui:ws:dv:${B}:custom`, priv(ADM));
        assert.strictEqual((await q(`select division from characters where id=$1`, [B]))[0].division, 'custom');
        i = await click(`ui:ws:to:${B}`, priv({ ...ADM, kind: 'select', values: ['u9'] }));
        assert.match(allText(i), /Moved \*\*Bolt\*\*/);
        assert.strictEqual((await q(`select u.discord_id from characters c join users u on u.id=c.owner_id where c.id=$1`, [B]))[0].discord_id, 'u9');
        i = await click(`ui:ws:unc:${B}`, priv(ADM));
        assert.match(allText(i), /unclaimed/);
        i = await click(`ui:ws:delq:${A}`, priv(ADM));
        assert.ok(ids(i).includes(`ui:ws:dely:${A}`));
        i = await click(`ui:ws:dely:${A}`, priv(ADM));
        assert.match(allText(i), /has history/, 'Ace has a team history, so it refuses');
        const Z = await f.makeChar(G, 'u8', 'Zed', 'mens');
        i = await click(`ui:ws:dely:${Z}`, priv(ADM));
        assert.match(allText(i), /Deleted \*\*Zed\*\*/);
    });

    // ---------------- vote post buttons ----------------
    await t('award vote post: ▶️ Start voting and 🔒 Close vote are staff-only, close asks first', async () => {
        await f.pool.query(`UPDATE guilds SET legacy_channel_id = 'legch' WHERE guild_id = $1`, [G]);
        await run('legacy', 'vote-open', { accolade: 'award', award_name: 'Rookie of the Year', year: 2025, nominees_by: 'admins' }, ADM);
        const poll = (await q(`select id from award_polls`))[0].id;
        const AV = require('../src/utils/awardVotes');
        let p = await AV.nominationsPayload((await q(`select * from award_polls`))[0]);
        assert.ok(JSON.stringify(p.components.map((r) => r.toJSON())).includes(`ui:vx:s:${poll}`));
        await run('legacy', 'nominate', { vote: poll, character: C }, ADM);
        await run('legacy', 'nominate', { vote: poll, character: D }, ADM);
        let i = await click(`ui:vx:s:${poll}`, P('u1'));
        assert.match(allText(i), /Only admins/);
        i = await click(`ui:vx:s:${poll}`, ADM);
        assert.match(allText(i), /Voting is open/);
        p = await AV.votingPayload((await q(`select * from award_polls`))[0]);
        assert.ok(JSON.stringify(p.components.map((r) => r.toJSON())).includes(`ui:vx:c:${poll}`));
        i = await click(`ui:vx:c:${poll}`, ADM);
        assert.ok(ids(i).includes(`ui:vx:cy:${poll}`));
        assert.strictEqual((await q(`select status from award_polls`))[0].status, 'voting', 'nothing happens until confirmed');
        i = await click(`ui:vx:cy:${poll}`, priv(ADM));
        assert.match(allText(i), /Totals \(only you can see these\)/);
        assert.strictEqual((await q(`select status from award_polls`))[0].status, 'closed');
    });

    // ---------------- bracket post ----------------
    await t('bracket post: 🏁 Decide a match (staff) while it runs', async () => {
        const M = []; for (let n = 0; n < 4; n++) M.push(await f.makeChar(G, `b${n}`, `Brk ${n}`, 'womens'));
        await run('tournament', 'create', { name: 'Queen Cup', division: 'womens' }, ADM);
        const tid = (await q(`select id from tournaments`))[0].id;
        for (const m of M) await run('tournament', 'add', { tournament: String(tid), wrestler1: m }, ADM);
        let i = await run('tournament', 'start', { tournament: String(tid) }, ADM);
        assert.ok(ids(i).includes(`ui:tn:d:${tid}:0`));
        i = await click(`ui:tn:d:${tid}:0`, P('u1'));
        assert.match(allText(i), /Only admins/);
        i = await click(`ui:tn:d:${tid}:0`, ADM);
        assert.ok(ids(i).some((x) => x.startsWith(`ui:tn:w:${tid}:`)));
        i = await click(`ui:tn:v:${tid}`, priv(ADM));
        const all = ids(i);
        assert.strictEqual(new Set(all).size, all.length, 'no duplicate buttons in the panel');
    });

    // ---------------- match ----------------
    await t('/match log still works; the old log-… code still answers old clicks', async () => {
        let i = await run('match', 'log', { type: 'singles', wrestler1: C, wrestler2: D, winner: 1 }, ADM);
        assert.ok(!isErr(i), allText(i));
        i = await run('match', 'log-singles', { participant1: C, participant2: D, winner: 2, override_cooldown: true }, ADM);
        assert.ok(!isErr(i), allText(i));
        void sent; void edited;
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end();
    process.exit(failed ? 1 : 0);
})();
