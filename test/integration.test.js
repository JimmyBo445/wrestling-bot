const assert = require('assert');
const f = require('./fixtures');
const { run, auto, click, sent, text, hasFile } = require('./mock');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const PLAYER = (u) => ({ admin: false, user: u });
const ids = {};
const isPrivateErr = (i) => i.responses.some((r) => (r.p?.flags & 64) && /⚠️/.test(r.p.content || ''));

(async () => {
    await f.resetDb();

    // ---------- characters ----------
    await t('admin assigns characters to players', async () => {
        for (const [u, name, div] of [['u1', 'Titan', 'mens'], ['u2', 'Fox', 'mens'], ['u3', 'Bull', 'mens'], ['u4', 'Wolf', 'mens'], ['u5', 'Hawk', 'mens'], ['u6', 'Wendy', 'womens'], ['u7', 'Xena', 'womens']]) {
            const i = await run('character', 'assign', { user: u, name, division: div }, ADM);
            assert.match(text(i), /Assigned/, text(i));
        }
        const { rows } = await f.pool.query(`select id, name from characters order by id`);
        rows.forEach((r) => (ids[r.name] = String(r.id)));
        assert.strictEqual(rows.length, 7);
    });
    await t('non-admin cannot assign', async () => {
        const i = await run('character', 'assign', { user: 'u9', name: 'Hack', division: 'mens' }, PLAYER('u2'));
        assert.ok(isPrivateErr(i), text(i));
    });
    await t('player submits a character; approval flow posts card and approve button activates it', async () => {
        await run('admin', 'set-pending-channel', { channel: 'pendch' }, ADM);
        const i = await run('character', 'submit', { name: 'Rookie', division: 'custom', alignment: 'face', bio: 'new kid' }, PLAYER('u8'));
        assert.match(text(i), /submitted/);
        const card = sent.filter((m) => m.channelId === 'pendch').pop();
        assert.ok(card, 'pending card posted');
        const customId = card.payload.components[0].components[0].data.custom_id;
        const nonAdmin = await click(customId, { admin: false, user: 'u8' });
        assert.match(text(nonAdmin), /Only admins/);
        const ok = await click(customId, { message: { embeds: [{ ...card.payload.embeds[0], data: card.payload.embeds[0].data, toJSON: () => card.payload.embeds[0].data }], components: [] } });
        assert.ok(ok.responses.some((r) => r.type === 'update'), text(ok));
        const again = await click(customId);
        assert.match(text(again), /already approved/);
        const { rows } = await f.pool.query(`select status from characters where name='Rookie'`);
        assert.strictEqual(rows[0].status, 'approved');
    });
    await t('5th character is refused (max 4)', async () => {
        for (const n of ['A1', 'A2', 'A3', 'A4']) await run('character', 'assign', { user: 'u10', name: n, division: 'mens' }, ADM);
        const i = await run('character', 'assign', { user: 'u10', name: 'A5', division: 'mens' }, ADM);
        assert.ok(isPrivateErr(i), text(i));
        assert.match(text(i), /already has 4/);
        const { rows } = await f.pool.query(`select id, name from characters where name in ('A1','A2','A3')`);
        rows.forEach((r) => (ids[r.name] = String(r.id)));
    });
    await t('profile card renders as an image', async () => {
        const i = await run('character', 'profile', { character: ids.Titan });
        assert.ok(hasFile(i), text(i));
    });
    await t('character list shows slots', async () => {
        const i = await run('character', 'list', { user: 'u10' });
        assert.match(text(i), /4\/4 slots/);
    });
    await t('character edit: owner ok, stranger refused', async () => {
        const ok = await run('character', 'edit', { character: ids.Titan, bio: 'The big one', alignment: 'heel' }, PLAYER('u1'));
        assert.match(text(ok), /Updated/, text(ok));
        const no = await run('character', 'edit', { character: ids.Titan, bio: 'hax' }, PLAYER('u2'));
        assert.ok(isPrivateErr(no));
    });
    await t('autocomplete returns choices with owner names', async () => {
        const c = await auto('character', 'profile', 'character', 'ti');
        assert.ok(c.length >= 1 && /Titan/.test(c[0].name) && /Nameu1/.test(c[0].name), JSON.stringify(c));
    });
    await t('autocomplete with weird characters does not crash', async () => {
        const c = await auto('character', 'profile', 'character', "%_'\";--");
        assert.ok(Array.isArray(c));
    });

    // ---------- matches ----------
    await t('log singles match: card + stats', async () => {
        const i = await run('match', 'log-singles', { participant1: ids.Titan, participant2: ids.Fox, winner: 1 }, ADM);
        assert.ok(hasFile(i), text(i));
        const s = await run('stats', 'character', { character: ids.Titan });
        assert.match(text(s), /Record:1-0/, text(s));
    });
    await t('cooldown message is private, override works', async () => {
        const i = await run('match', 'log-singles', { participant1: ids.Fox, participant2: ids.Titan, winner: 1 }, ADM);
        assert.ok(isPrivateErr(i)); assert.match(text(i), /override_cooldown/);
        const j = await run('match', 'log-singles', { participant1: ids.Fox, participant2: ids.Titan, winner: 1, override_cooldown: true }, ADM);
        assert.ok(hasFile(j), text(j));
    });
    await t('non-admin cannot log matches', async () => {
        const i = await run('match', 'log-singles', { participant1: ids.Titan, participant2: ids.Bull, winner: 1 }, PLAYER('u1'));
        assert.ok(isPrivateErr(i));
    });
    await t('every match type logs', async () => {
        const cfg = require('../src/utils/constants').MATCH_CONFIG;
        const pool = [ids.Titan, ids.Fox, ids.Bull, ids.Wolf, ids.Hawk, ids.Rookie, 'x1', 'x2'];
        // make 2 extra mens chars
        await run('character', 'assign', { user: 'u11', name: 'Ex1', division: 'mens' }, ADM);
        await run('character', 'assign', { user: 'u12', name: 'Ex2', division: 'mens' }, ADM);
        const { rows } = await f.pool.query(`select id,name from characters where name in ('Ex1','Ex2')`);
        rows.forEach((r) => (ids[r.name] = String(r.id)));
        const mens = [ids.Titan, ids.Fox, ids.Bull, ids.Wolf, ids.Hawk, ids.Ex1, ids.Ex2, ids.A1];
        void pool;
        for (const [key, c] of Object.entries(cfg)) {
            if (key === 'singles') continue;
            const opts = {};
            c.slots.forEach((s, idx) => (opts[s.name] = mens[idx]));
            if (c.winnerMode === 'single') opts.winner = 1; else opts.winning_team = 2;
            const i = await run('match', `log-${key.replace(/_/g, '-')}`, opts, ADM);
            assert.ok(hasFile(i), `${key}: ${text(i)}`);
        }
    });
    await t('draw and no contest log', async () => {
        const a = await run('match', 'log-triple-threat', { participant1: ids.Bull, participant2: ids.Wolf, participant3: ids.Hawk, winner: 1, result_type: 'draw' }, ADM);
        assert.ok(hasFile(a), text(a));
        const b = await run('match', 'log-fatal4way', { participant1: ids.Bull, participant2: ids.Wolf, participant3: ids.Hawk, participant4: ids.Ex1, winner: 1, result_type: 'no_contest' }, ADM);
        assert.ok(hasFile(b), text(b));
    });
    await t('recent + autocomplete match ids', async () => {
        const r = await run('match', 'recent', {}, ADM);
        assert.match(text(r), /Singles/);
        const c = await auto('match', 'undo', 'match_id', '', {}, ADM);
        assert.ok(c.length > 0 && typeof c[0].value === 'number', JSON.stringify(c));
    });
    await t('edit then undo a plain match', async () => {
        const { rows } = await f.pool.query(`select max(id) id from matches`);
        const id = rows[0].id;
        const e = await run('match', 'edit', { match_id: id, notes: 'Falls count anywhere' }, ADM);
        assert.match(text(e), /edited/, text(e));
        const u = await run('match', 'undo', { match_id: id }, ADM);
        assert.match(text(u), /undone/, text(u));
        const again = await run('match', 'undo', { match_id: id }, ADM);
        assert.ok(isPrivateErr(again));
    });

    // ---------- titles ----------
    const T = {};
    await t('titles seeded (13)', async () => {
        const { rows } = await f.pool.query(`select id,name from titles where guild_id='g1'`);
        assert.strictEqual(rows.length, 13);
        rows.forEach((r) => (T[r.name] = String(r.id)));
    });
    await t('title match crowns champion; list + belt + history work', async () => {
        const i = await run('championship', 'log-singles-title-match', { title: T['World Heavyweight Championship'], champion_or_p1: ids.Titan, challenger_or_p2: ids.Fox, winner: 1 }, ADM);
        assert.ok(hasFile(i), text(i));
        const l = await run('championship', 'list', {});
        assert.match(text(l), /Titan/);
        const b = await run('championship', 'belt', { title: T['World Heavyweight Championship'] });
        assert.ok(hasFile(b), text(b));
        const h = await run('championship', 'history', { title: T['World Heavyweight Championship'] });
        assert.match(text(h), /Titan/);
    });
    await t('contender via /match contender_for, then fulfilled by title match', async () => {
        const i = await run('match', 'log-singles', { participant1: ids.Bull, participant2: ids.Wolf, winner: 1, contender_for: T['World Heavyweight Championship'] }, ADM);
        assert.ok(hasFile(i), text(i));
        const l = await run('contender', 'list', {});
        assert.match(text(l), /Bull/);
        const m = await run('championship', 'log-singles-title-match', { title: T['World Heavyweight Championship'], champion_or_p1: ids.Titan, challenger_or_p2: ids.Bull, winner: 2 }, ADM);
        assert.ok(hasFile(m), text(m));
        const l2 = await run('contender', 'list', {});
        assert.match(text(l2), /No active/);
    });
    await t('team create, tag title match, belt card with 2 champs', async () => {
        const c = await run('team', 'create', { name: 'Wolf Pack', member1: ids.Wolf, member2: ids.Hawk }, ADM);
        assert.match(text(c), /Registered team/, text(c));
        await run('team', 'create', { name: 'Old Guard', member1: ids.Titan, member2: ids.Fox }, ADM);
        const m = await run('championship', 'log-tag-title-match', { title: T["Men's Tag Team Championship"], team1_p1: ids.Wolf, team1_p2: ids.Hawk, team2_p1: ids.Titan, team2_p2: ids.Fox, winning_team: 1 }, ADM);
        assert.ok(hasFile(m), text(m));
        const b = await run('championship', 'belt', { title: T["Men's Tag Team Championship"] });
        assert.ok(hasFile(b), text(b));
        const p = await run('team', 'profile', { team: (await f.pool.query(`select id from teams where name='Wolf Pack'`)).rows[0].id });
        assert.ok(hasFile(p));
        const l = await run('team', 'list', {});
        assert.match(text(l), /Wolf Pack/);
    });
    await t('removing a member vacates the tag title and disbands the team', async () => {
        const tid = (await f.pool.query(`select id from teams where name='Wolf Pack'`)).rows[0].id;
        const r = await run('team', 'remove-member', { team: tid, character: ids.Hawk }, ADM);
        assert.match(text(r), /vacant/, text(r));
        assert.match(text(r), /disbanded/);
        const { rows } = await f.pool.query(`select is_vacant from titles where id=$1`, [T["Men's Tag Team Championship"]]);
        assert.strictEqual(rows[0].is_vacant, true);
    });
    await t('retire is refused for a current champion, works otherwise', async () => {
        const no = await run('character', 'retire', { character: ids.Bull }, ADM);
        assert.ok(isPrivateErr(no), text(no));
        const ok = await run('character', 'retire', { character: ids.Ex2 }, ADM);
        assert.match(text(ok), /Retired/, text(ok));
        const back = await run('character', 'restore', { character: ids.Ex2 }, ADM);
        assert.match(text(back), /is back/, text(back));
    });
    await t('remove refuses characters with history, deletes clean ones; transfer works', async () => {
        const no = await run('character', 'remove', { character: ids.Titan }, ADM);
        assert.ok(isPrivateErr(no)); assert.match(text(no), /history/);
        const { rows } = await f.pool.query(`select id from characters where name='A3'`);
        const ok = await run('character', 'remove', { character: rows[0].id }, ADM);
        assert.match(text(ok), /Deleted/, text(ok));
        const tr = await run('character', 'transfer', { character: ids.Wendy, new_owner: 'u99' }, ADM);
        assert.match(text(tr), /Moved/, text(tr));
        const s = await run('stats', 'user', { user: 'u99', text: true });
        assert.match(text(s), /Wendy/);
    });
    await t('women division title + backfill + overlap detection + edit/remove', async () => {
        const wt = T["Women's World Championship"];
        const a = await run('championship', 'backfill-reign', { title: wt, champion_name: 'Legend Lily', won_date: '2024-01-01', lost_date: '2024-06-01', defenses: 3 }, ADM);
        assert.match(text(a), /Added/, text(a));
        const ov = await run('championship', 'backfill-reign', { title: wt, champion_name: 'Overlap', won_date: '2024-05-01', lost_date: '2024-07-01' }, ADM);
        assert.ok(isPrivateErr(ov), text(ov)); assert.match(text(ov), /overlaps/);
        const bad = await run('championship', 'backfill-reign', { title: wt, champion_name: 'Bad', won_date: '2024-13-45' }, ADM);
        assert.ok(isPrivateErr(bad));
        const none = await run('championship', 'backfill-reign', { title: wt, won_date: '2024-08-01', lost_date: '2024-09-01' }, ADM);
        assert.ok(isPrivateErr(none), 'needs a champion');
        const reigns = (await f.pool.query(`select id from title_reigns where title_id=$1`, [wt])).rows;
        const ed = await run('championship', 'edit-reign', { title: wt, reign: reigns[0].id, defenses: 5 }, ADM);
        assert.match(text(ed), /Updated/, text(ed));
        const rc = await auto('championship', 'edit-reign', 'reign', '', { title: wt }, ADM);
        assert.ok(rc.length === 1, JSON.stringify(rc));
        const win = await run('championship', 'log-singles-title-match', { title: wt, champion_or_p1: ids.Wendy, challenger_or_p2: ids.Xena, winner: 2 }, ADM);
        assert.ok(hasFile(win), text(win));
        const rm = await run('championship', 'remove-reign', { title: wt, reign: reigns[0].id }, ADM);
        assert.match(text(rm), /Deleted/, text(rm));
        const botReign = (await f.pool.query(`select id from title_reigns where title_id=$1 and not is_backfilled`, [wt])).rows[0].id;
        // reigns the bot logged can be edited too (v2.7)
        const ed2 = await run('championship', 'edit-reign', { title: wt, reign: botReign, defenses: 2, notes: 'edited later' }, ADM);
        assert.match(text(ed2), /Updated/, text(ed2));
        const row = (await f.pool.query(`select defenses, notes from title_reigns where id=$1`, [botReign])).rows[0];
        assert.strictEqual(row.defenses, 2); assert.strictEqual(row.notes, 'edited later');
        const rm2 = await run('championship', 'remove-reign', { title: wt, reign: botReign }, ADM);
        assert.match(text(rm2), /Deleted/, text(rm2));
    });
    await t('vacate title', async () => {
        const v = await run('championship', 'vacate', { title: T['World Heavyweight Championship'] }, ADM);
        assert.match(text(v), /vacant/, text(v));
        const v2 = await run('championship', 'vacate', { title: T['World Heavyweight Championship'] }, ADM);
        assert.ok(isPrivateErr(v2));
    });

    // ---------- win-streak prompt ----------
    await t('3 straight wins posts a streak prompt; admin picks a title via the select', async () => {
        // use a fresh pair of opponents each time to avoid cooldown
        const opp = [ids.Ex1, ids.A1, ids.A2];
        const before = sent.length;
        for (const o of opp) {
            const i = await run('match', 'log-singles', { participant1: ids.Hawk, participant2: o, winner: 1, override_cooldown: true }, ADM);
            assert.ok(hasFile(i), text(i));
        }
        const prompt = sent.slice(before).find((m) => m.payload.embeds?.[0]?.data?.title?.includes('Win Streak'));
        assert.ok(prompt, 'prompt posted: ' + JSON.stringify(sent.slice(before).map((m) => m.payload.embeds?.[0]?.data?.title)));
        const menu = prompt.payload.components[0].components[0];
        const opts = menu.options.map((o) => o.data);
        assert.ok(opts.length >= 2);
        const nonAdmin = await click(menu.data.custom_id, { values: [opts[0].value], admin: false, user: 'u5' });
        assert.match(text(nonAdmin), /Only admins/);
        const picked = await click(menu.data.custom_id, { values: [opts[0].value], message: { embeds: [{ data: prompt.payload.embeds[0].data, toJSON: () => prompt.payload.embeds[0].data }], components: [] } });
        assert.ok(picked.responses.some((r) => r.type === 'update'), text(picked));
        const { rows } = await f.pool.query(`select earned_via from contenders where status='active' and character_id=$1`, [ids.Hawk]);
        assert.strictEqual(rows[0]?.earned_via, 'win_streak');
        const dup = await click(menu.data.custom_id, { values: [opts[0].value] });
        assert.match(text(dup), /already handled/);
    });
    await t('streak threshold setting changes and can be disabled', async () => {
        const s = await run('admin', 'set-streak-threshold', { wins: 0 }, ADM);
        assert.match(text(s), /off/);
        await run('admin', 'set-streak-threshold', { wins: 3 }, ADM);
    });

    // ---------- contender challenge / award ----------
    await t('challenge -> admin approves; award/revoke work; wrong division refused', async () => {
        const pend = T['United States Championship'];
        const before = sent.length;
        const c = await run('contender', 'challenge', { title: pend, character: ids.Fox }, PLAYER('u2'));
        assert.match(text(c), /Challenge sent/, text(c));
        const card = sent.slice(before).find((m) => m.payload.embeds?.[0]?.data?.title === 'Title Contender Challenge');
        assert.ok(card);
        const dup = await run('contender', 'challenge', { title: pend, character: ids.Fox }, PLAYER('u2'));
        assert.ok(isPrivateErr(dup));
        const steal = await run('contender', 'challenge', { title: pend, character: ids.Wolf }, PLAYER('u2'));
        assert.ok(isPrivateErr(steal), 'cannot challenge with someone else\'s character');
        const ok = await click(card.payload.components[0].components[0].data.custom_id);
        assert.ok(ok.responses.some((r) => r.type === 'update'), text(ok));
        const bad = await run('contender', 'award', { title: pend, character: ids.Wendy }, ADM);
        assert.ok(isPrivateErr(bad), text(bad));
        const aw = await run('contender', 'award', { title: pend, character: ids.Wolf }, ADM);
        assert.match(text(aw), /Wolf/, text(aw));
        const rv = await run('contender', 'revoke', { title: pend }, ADM);
        assert.match(text(rv), /Removed/);
    });

    // ---------- stats / matchmaking / leaderboards ----------
    await t('stats: head-to-head, versus, opponents, history', async () => {
        assert.match(text(await run('stats', 'head-to-head', { character1: ids.Titan, character2: ids.Fox })), /Titan vs Fox/);
        assert.match(text(await run('stats', 'versus', { player1: 'u1', player2: 'u2' })), /Name/);
        assert.match(text(await run('stats', 'opponents', { character: ids.Titan })), /Fox/);
        assert.match(text(await run('stats', 'history', { character: ids.Titan })), /#\d+/);
        assert.match(text(await run('stats', 'character', { character: ids.Titan, period: '30d' })), /Last 30 days/);
    });
    await t('matchmaking suggest + request', async () => {
        const s = await run('matchmaking', 'suggest', { character: ids.Titan, count: 3 });
        assert.match(text(s), /Fresh matchups/, text(s));
        const r = await run('matchmaking', 'request', { character: ids.Titan, opponent: ids.Bull, note: 'rivalry' }, PLAYER('u1'));
        assert.match(text(r), /Request sent/, text(r));
        const bad = await run('matchmaking', 'request', { character: ids.Titan, opponent: ids.Bull }, PLAYER('u2'));
        assert.ok(isPrivateErr(bad));
        const p = await run('admin', 'pending', {}, ADM);
        assert.match(text(p), /Match Request/, text(p));
    });
    await t('leaderboard and rankings with dropdowns', async () => {
        const lb = await run('leaderboard', null, {});
        assert.match(text(lb), /Leaderboard/);
        const cats = Object.keys(require('../src/utils/leaderboardQueries').CATEGORY_LABELS);
        for (const c of cats) {
            for (const p of ['all', '30d']) {
                const i = await click(`lb_cat_${p}`, { values: [c], admin: false });
                assert.ok(i.responses.some((r) => r.type === 'update'), `${c}/${p}: ${text(i)}`);
            }
        }
        const per = await click('lb_period_total_wins', { values: ['90d'], admin: false });
        assert.match(text(per), /Last 90 days/);
        const rk = await run('rankings', null, {});
        assert.match(text(rk), /Rankings/);
        const rk2 = await click('rank_div', { values: ['womens'], admin: false });
        assert.match(text(rk2), /Women/);
    });
    await t('admin settings / cooldown / matches channel / audit', async () => {
        assert.match(text(await run('admin', 'set-cooldown', { hours: 48, scope: 'character' }, ADM)), /48h/);
        assert.match(text(await run('admin', 'set-matches-channel', { channel: 'matchch' }, ADM)), /matchch/);
        const before = sent.length;
        const m = await run('match', 'log-singles', { participant1: ids.Ex1, participant2: ids.A2, winner: 2, override_cooldown: true }, ADM);
        assert.ok(hasFile(m), text(m));
        assert.ok(sent.slice(before).some((x) => x.channelId === 'matchch'), 'mirrored to matches channel');
        assert.match(text(await run('admin', 'settings', {}, ADM)), /48h/);
        assert.match(text(await run('admin', 'audit', {}, ADM)), /match logged/);
        assert.match(text(await run('admin', 'set-cooldown', { hours: 0 }, ADM)), /off/);
    });
    await t('autocomplete works for every command that has it', async () => {
        const cmds = require('./mock').client.commands;
        for (const [name, cmd] of cmds) {
            if (!cmd.autocomplete) continue;
            const j = cmd.data.toJSON();
            for (const sub of (j.options || []).filter((o) => o.type === 1)) {
                for (const opt of (sub.options || []).filter((o) => o.autocomplete)) {
                    const c = await auto(name, sub.name, opt.name, '', { title: T['Showtime Championship'] }, ADM);
                    assert.ok(Array.isArray(c), `${name} ${sub.name} ${opt.name} returned ${JSON.stringify(c)}`);
                }
            }
        }
    });

    await t("Custom Women's division: characters, titles, tag team, rankings, belt", async () => {
        const mk = async (u, n) => { const i = await run('character', 'assign', { user: u, name: n, division: 'custom_womens' }, ADM); assert.match(text(i), /Custom Women's/, text(i)); };
        for (const [u, n] of [['c1', 'Aria'], ['c2', 'Bex'], ['c3', 'Cleo'], ['c4', 'Dani']]) await mk(u, n);
        const { rows } = await f.pool.query(`select id,name from characters where division='custom_womens'`);
        const cw = Object.fromEntries(rows.map((r) => [r.name, String(r.id)]));
        const { rows: ts } = await f.pool.query(`select id,name,is_tag_title from titles where division='custom_womens' order by name`);
        assert.deepStrictEqual(ts.map((x) => x.name), ['Custom Women\'s Air Force Championship', 'Custom Women\'s Tag Team Championship', 'Golden Global Kingdom Championship']);
        const air = String(ts[0].id), tag = String(ts[1].id), ggk = String(ts[2].id);
        const m = await run('championship', 'log-singles-title-match', { title: air, champion_or_p1: cw.Aria, challenger_or_p2: cw.Bex, winner: 1 }, ADM);
        assert.ok(hasFile(m), text(m));
        const wrong = await run('championship', 'log-singles-title-match', { title: ggk, champion_or_p1: cw.Aria, challenger_or_p2: ids.Wendy, winner: 1 }, ADM);
        assert.ok(isPrivateErr(wrong), text(wrong));
        const t1 = await run('team', 'create', { name: 'Sky Queens', member1: cw.Aria, member2: cw.Bex }, ADM);
        assert.match(text(t1), /Custom Women's/, text(t1));
        await run('team', 'create', { name: 'Gold Rush', member1: cw.Cleo, member2: cw.Dani }, ADM);
        const tm = await run('championship', 'log-tag-title-match', { title: tag, team1_p1: cw.Aria, team1_p2: cw.Bex, team2_p1: cw.Cleo, team2_p2: cw.Dani, winning_team: 2 }, ADM);
        assert.ok(hasFile(tm), text(tm));
        assert.ok(hasFile(await run('championship', 'belt', { title: tag })));
        assert.ok(hasFile(await run('character', 'profile', { character: cw.Aria })));
        assert.match(text(await run('championship', 'list', {})), /Custom Women's Division/);
        const rk = await click('rank_div', { values: ['custom_womens'], admin: false });
        assert.match(text(rk), /Custom Women's Division Rankings/, text(rk));
        const wrongDiv = await run('contender', 'award', { title: ggk, character: ids.Titan }, ADM);
        assert.ok(isPrivateErr(wrongDiv));
        const sub = await run('character', 'submit', { name: 'Fifth', division: 'custom_womens' }, PLAYER('c1'));
        assert.match(text(sub), /submitted/, text(sub));
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end();
    process.exit(failed ? 1 : 0);
})();
