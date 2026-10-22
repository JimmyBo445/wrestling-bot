const assert = require('assert');
const f = require('./fixtures');
const { logMatch, undoMatch, editMatch } = require('../src/utils/matchService');
const { getStreaks, getTeamStreaks } = require('../src/utils/streaks');

const G = 'g1';
let passed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { console.log('  FAIL', name, '\n      ', e.message); process.exitCode = 1; }
}
const rejects = async (p, re) => { try { await p; } catch (e) { assert.match(e.message, re); return; } assert.fail('expected an error matching ' + re); };

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const a = await f.makeChar(G, 'u1', 'Alpha');
    const b = await f.makeChar(G, 'u2', 'Bravo');
    const c = await f.makeChar(G, 'u3', 'Charlie');
    const d = await f.makeChar(G, 'u4', 'Delta');
    const e = await f.makeChar(G, 'u5', 'Echo');
    const w1 = await f.makeChar(G, 'u6', 'Wendy', 'womens');
    const wt = await f.titleId(G, 'World Heavyweight Championship');
    const usT = await f.titleId(G, 'United States Championship');
    const tagT = await f.titleId(G, "Men's Tag Team Championship");

    await t('regular singles logs and shows in streaks', async () => {
        const r = await logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [a, b], winnerIndex: 0, actor: 'adm' });
        assert.ok(r.matchId);
        assert.deepStrictEqual((await getStreaks(a)).current, 1);
        assert.deepStrictEqual((await getStreaks(b)).direction, 'loss');
    });
    await t('cooldown blocks same pair, override allows', async () => {
        await rejects(logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [a, b], winnerIndex: 1, actor: 'adm' }), /cooldown|Wait about/);
        const r = await logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [b, a], winnerIndex: 0, actor: 'adm', overrideCooldown: true });
        assert.ok(r.cooldownOverridden);
    });
    await t('cooldown does not apply to title matches', async () => {
        const r = await logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [a, b], winnerIndex: 0, actor: 'adm', titleValue: wt });
        assert.strictEqual(r.effect.type, 'new_reign');
    });
    await t('defense increments', async () => {
        const r = await logMatch({ guildId: G, matchType: 'triple_threat', slotCharacterIds: [a, c, d], winnerIndex: 0, actor: 'adm', titleValue: wt });
        assert.strictEqual(r.effect.type, 'defense');
        const { rows } = await f.pool.query('select defenses from title_reigns where title_id=$1 and lost_date is null', [wt]);
        assert.strictEqual(rows[0].defenses, 1);
    });
    await t('champion must be in match', async () => {
        await rejects(logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [c, d], winnerIndex: 0, actor: 'adm', titleValue: wt }), /isn't in this match/);
    });
    await t('wrong division rejected', async () => {
        await rejects(logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [a, w1], winnerIndex: 0, actor: 'adm', titleValue: wt }), /different division/);
    });
    await t('title change and undo restores previous champ', async () => {
        const r = await logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [a, c], winnerIndex: 1, actor: 'adm', titleValue: wt });
        assert.strictEqual(r.effect.type, 'title_change');
        await undoMatch(G, r.matchId, 'adm');
        const { rows } = await f.pool.query('select character_id, defenses from title_reigns where title_id=$1 and lost_date is null', [wt]);
        assert.strictEqual(String(rows[0].character_id), a);
        assert.strictEqual(rows[0].defenses, 1);
    });
    await t('undo refused when a later title match exists', async () => {
        const r1 = await logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [a, c], winnerIndex: 0, actor: 'adm', titleValue: wt });
        await logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [a, d], winnerIndex: 0, actor: 'adm', titleValue: wt });
        await rejects(undoMatch(G, r1.matchId, 'adm'), /later title match/);
    });
    await t('contender match sets contender, title match fulfills, undo restores', async () => {
        const r = await logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [d, e], winnerIndex: 1, actor: 'adm', contenderTitleValue: wt });
        assert.strictEqual(r.effect.kind, 'contender');
        const m = await logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [a, e], winnerIndex: 0, actor: 'adm', titleValue: wt });
        assert.ok(m.effect.fulfilled_contender_id);
        await undoMatch(G, m.matchId, 'adm');
        const { rows } = await f.pool.query(`select status from contenders where id=$1`, [m.effect.fulfilled_contender_id]);
        assert.strictEqual(rows[0].status, 'active');
    });
    await t('tag title needs registered teams', async () => {
        await rejects(logMatch({ guildId: G, matchType: 'tag2v2', slotCharacterIds: [a, b, c, d], winningTeam: 1, actor: 'adm', titleValue: tagT }), /registered team/);
    });
    await t('tag title with registered teams creates team reign + members', async () => {
        const t1 = await f.makeTeam(G, 'Alpha Bravo', 'mens', [a, b]);
        const t2 = await f.makeTeam(G, 'Char Delta', 'mens', [c, d]);
        const r = await logMatch({ guildId: G, matchType: 'tag2v2', slotCharacterIds: [a, b, c, d], winningTeam: 2, actor: 'adm', titleValue: tagT });
        assert.strictEqual(r.effect.type, 'new_reign');
        const { rows } = await f.pool.query('select tr.team_id, (select count(*) from title_reign_members where reign_id=tr.id)::int n from title_reigns tr where title_id=$1 and lost_date is null', [tagT]);
        assert.strictEqual(String(rows[0].team_id), t2);
        assert.strictEqual(rows[0].n, 2);
        assert.strictEqual((await getTeamStreaks(t2)).current, 1);
        assert.strictEqual((await getTeamStreaks(t1)).direction, 'loss');
        // swapped order of the same two people still detected as the same team
        const r2 = await logMatch({ guildId: G, matchType: 'tag2v2', slotCharacterIds: [d, c, b, a], winningTeam: 1, actor: 'adm', titleValue: tagT });
        assert.strictEqual(r2.effect.type, 'defense');
    });
    await t('singles title cannot be defended in a tag match', async () => {
        await rejects(logMatch({ guildId: G, matchType: 'tag2v2', slotCharacterIds: [a, b, c, d], winningTeam: 1, actor: 'adm', titleValue: wt }), /singles title/);
    });
    await t('edit notes and winner of a plain match; refuse for title match', async () => {
        const r = await logMatch({ guildId: G, matchType: 'triple_threat', slotCharacterIds: [c, d, e], winnerIndex: 0, actor: 'adm' });
        await editMatch(G, r.matchId, 'adm', { notes: 'steel cage', winnerIndex: 2 });
        const { rows } = await f.pool.query('select is_winner from match_participants where match_id=$1 order by id', [r.matchId]);
        assert.deepStrictEqual(rows.map((x) => x.is_winner), [false, false, true]);
        const tm = await logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [a, c], winnerIndex: 0, actor: 'adm', titleValue: wt });
        await rejects(editMatch(G, tm.matchId, 'adm', { winnerIndex: 1 }), /undo/);
    });
    await t('draw does not break streak', async () => {
        const x = await f.makeChar(G, 'u9', 'Xena'); const y = await f.makeChar(G, 'u10', 'Yara');
        await logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [x, y], winnerIndex: 0, actor: 'adm' });
        await logMatch({ guildId: G, matchType: 'triple_threat', slotCharacterIds: [x, c, d], winnerIndex: 0, actor: 'adm', resultType: 'draw' });
        const s = await getStreaks(x);
        assert.strictEqual(s.current, 1);
    });
    await t('non-numeric character id gives friendly error', async () => {
        await rejects(logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: ['hello', a], winnerIndex: 0, actor: 'adm' }), /dropdown/);
    });
    await t('pending/retired characters cannot be booked', async () => {
        const p = await f.makeChar(G, 'u11', 'Pend', 'mens', 'pending');
        await rejects(logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [p, a], winnerIndex: 0, actor: 'adm' }), /pending/);
    });
    console.log(`\n${passed} passed`);
    await f.pool.end();
})();
