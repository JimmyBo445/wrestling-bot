// 3.21.0: on the card, after the winner, pick how they won. Walkover = win for the winner, no loss for the no-show.
const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, ids } = require('./mock');
const { logMatch, editMatch } = require('../src/utils/matchService');
const svc = require('../src/utils/cardService');
const S = require('../src/utils/statsQueries');
const { getStreaks } = require('../src/utils/streaks');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 7).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const G = 'g1';
const q = async (sql, a) => (await f.pool.query(sql, a)).rows;
const rec = async (id) => { const s = await S.characterSummary(id); return `${s.wins ?? s.w}-${s.losses ?? s.l}`; };

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const W = [];
    for (let k = 0; k < 8; k++) W.push(String(await f.makeChar(G, `p${k}`, `W${k}`, 'mens')));
    const US = await f.titleId(G, 'United States Championship');
    const draftId = async () => (await svc.requireDraft(G, 'raw', 'mens')).id;

    await t('card: tapping the winner opens "How did they win?" with every finish, Skip and Back', async () => {
        await run('card', 'add', { brand: 'raw', match_type: 'singles', wrestler1: W[0], wrestler2: W[1] }, ADM);
        const d = await draftId();
        const i = await click(`cardui:rw:${d}:1:1`, ADM);
        assert.match(text(i), /How did they win\?/);
        assert.match(text(i), /W0\*\* won/);
        for (const x of ['pinfall', 'submission', 'dq', 'countout', 'knockout', 'interference', 'escape', 'forfeit', 'walkover', 'skip']) assert.ok(ids(i).includes(`cardui:rw:${d}:1:1:${x}`), x);
        assert.ok(ids(i).includes(`cardui:rc:${d}:1`));
        assert.strictEqual((await q(`select count(*)::int n from matches`))[0].n, 0, 'nothing logged yet');
    });

    await t('picking a finish logs it with that finish', async () => {
        const d = await draftId();
        const i = await click(`cardui:rw:${d}:1:1:submission`, ADM);
        assert.match(text(i), /Recorded Men's match 1/, text(i));
        const m = (await q(`select finish from matches order by id desc limit 1`))[0];
        assert.strictEqual(m.finish, 'submission');
    });

    await t('Walkover: win for the winner, no loss (and no broken streak) for the no-show', async () => {
        await run('card', 'add', { brand: 'raw', match_type: 'singles', wrestler1: W[2], wrestler2: W[3] }, ADM);
        const d = await draftId();
        await logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [W[3], W[4]], winnerIndex: 0, actor: 'a' }); // W3 1-0
        const i = await click(`cardui:rw:${d}:2:1:walkover`, ADM);
        assert.match(text(i), /Recorded Men's match 2/, text(i));
        const id = (await q(`select id from matches order by id desc limit 1`))[0].id;
        const parts = await q(`select character_id::text c, is_winner from match_participants where match_id=$1 order by id`, [id]);
        assert.deepStrictEqual(parts.map((p) => p.is_winner), [true, null]);
        assert.strictEqual(await rec(W[2]), '1-0');
        assert.strictEqual(await rec(W[3]), '1-0', 'no loss for the no-show');
        assert.strictEqual((await getStreaks(W[3])).direction, 'win');
        const lb = await require('../src/utils/leaderboardQueries');
        assert.ok(lb);
    });

    await t('Skip logs with no finish; draws and no contests still log straight away', async () => {
        await run('card', 'add', { brand: 'raw', match_type: 'singles', wrestler1: W[5], wrestler2: W[6] }, ADM);
        const d = await draftId();
        await click(`cardui:rw:${d}:3:2:skip`, ADM);
        assert.strictEqual((await q(`select finish from matches order by id desc limit 1`))[0].finish, null);
        await run('card', 'add', { brand: 'raw', match_type: 'singles', wrestler1: W[7], wrestler2: W[4] }, ADM);
        const i = await click(`cardui:rw:${d}:4:d`, ADM);
        assert.match(text(i), /Recorded/);
    });

    await t('Walkover on a title match: no belt change; not offered for tag matches', async () => {
        await run('reign', 'add', { title: US, won_date: '2026-01-01', character: W[0] }, ADM);
        const r = await logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [W[0], W[1]], winnerIndex: 1, titleValue: US, finish: 'walkover', overrideCooldown: true, actor: 'a' });
        assert.strictEqual(r.walkoverDropped, 'title');
        assert.strictEqual((await q(`select character_id::text c from title_reigns where title_id=$1 and lost_date is null`, [US]))[0].c, W[0], 'still champion');
        assert.strictEqual((await q(`select is_title_match from matches where id=$1`, [r.matchId]))[0].is_title_match, false);
        await assert.rejects(logMatch({ guildId: G, matchType: 'tag2v2', slotCharacterIds: [W[2], W[3], W[4], W[5]], winningTeam: 1, finish: 'walkover', actor: 'a' }), /not tag matches/);
        const X = []; for (let k = 0; k < 4; k++) X.push(String(await f.makeChar(G, `x${k}`, `X${k}`, 'mens')));
        await run('card', 'add', { brand: 'raw', match_type: 'tag2v2', wrestler1: X[0], wrestler2: X[1], wrestler3: X[2], wrestler4: X[3] }, ADM);
        const d = await draftId();
        const i = await click(`cardui:rw:${d}:5:1`, ADM);
        assert.ok(!ids(i).some((x) => x.endsWith(':walkover')));
        assert.ok(ids(i).some((x) => x.endsWith(':pinfall')));
    });

    await t('changing the finish later to or from Walkover fixes the record', async () => {
        const r = await logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [W[6], W[7]], winnerIndex: 0, finish: 'pinfall', overrideCooldown: true, actor: 'a' });
        const before = await rec(W[7]);
        await editMatch(G, r.matchId, 'a', { finish: 'walkover' });
        const [l, w] = before.split('-').reverse();
        assert.notStrictEqual(await rec(W[7]), before);
        assert.strictEqual((await q(`select is_winner from match_participants where match_id=$1 and character_id=$2`, [r.matchId, W[7]]))[0].is_winner, null);
        await editMatch(G, r.matchId, 'a', { finish: 'dq' });
        assert.strictEqual(await rec(W[7]), before);
        assert.ok(l !== undefined && w !== undefined);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exitCode = 1;
    await f.pool.end();
    process.exit();
})();
