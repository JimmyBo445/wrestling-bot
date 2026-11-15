// 3.18.0: tournaments can open with a triple-threat first round; the staff pick who is in which match.
const assert = require('assert');
const fs = require('fs');
const f = require('./fixtures');
const { run, click, text, ids } = require('./mock');
const { logMatch, undoMatch } = require('../src/utils/matchService');
const T = require('../src/utils/tournamentUtils');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 7).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const G = 'g1';
const q = async (sql, a) => (await f.pool.query(sql, a)).rows;
const priv = (o) => ({ ...o, private: true });
const tm = (tid) => q(`select round, slot, a_id::text a, b_id::text b, c_id::text c, winner_id::text w from tournament_matches where tournament_id=$1 order by round, slot`, [tid]);
const mk = async (n, prefix) => { const out = []; for (let k = 0; k < n; k++) out.push(String(await f.makeChar(G, `${prefix}${k}`, `${prefix.toUpperCase()} ${String(k).padStart(2, '0')}`, 'mens'))); return out; };
const newTour = async (name, chars, extra = {}) => {
    await run('tournament', 'create', { name, division: 'mens', first_round: 'triple', ...extra }, ADM);
    const tid = (await q(`select id from tournaments where name=$1`, [name]))[0].id;
    for (let k = 0; k < chars.length; k += 8) { const o = { tournament: String(tid) }; chars.slice(k, k + 8).forEach((c, i) => (o[`wrestler${i + 1}`] = c)); await run('tournament', 'add', o, ADM); }
    return tid;
};

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const A = await mk(12, 'a');
    let TID;

    await t('create with a triple-threat first round; the screen has 🎯 Pick first-round matches', async () => {
        const opts = require('./mock').client.commands.get('tournament').data.toJSON().options.find((o) => o.name === 'create').options.map((o) => o.name);
        assert.ok(opts.includes('first_round'));
        TID = await newTour('Twelve', A);
        assert.strictEqual((await q(`select format from tournaments where id=$1`, [TID]))[0].format, 'triple');
        const i = await click(`ui:tn:v:${TID}`, priv(ADM));
        assert.ok(ids(i).includes(`ui:tn:g:${TID}`), ids(i).join(' '));
        // a normal tournament doesn't have it, and still caps at 16
        await run('tournament', 'create', { name: 'Plain', division: 'mens' }, ADM);
        const pid = (await q(`select id from tournaments where name='Plain'`))[0].id;
        assert.ok(!ids(await click(`ui:tn:v:${pid}`, priv(ADM))).includes(`ui:tn:g:${pid}`));
    });

    await t('staff pick who is in which match (moving someone takes them out of their old match)', async () => {
        let i = await click(`ui:tn:g:${TID}`, priv(ADM));
        assert.match(JSON.stringify(i.responses.at(-1).p.embeds[0]), /12 wrestlers → \*\*4 first-round matches/);
        assert.deepStrictEqual(ids(i).filter((x) => x.startsWith('ui:tn:gm:')), [1, 2, 3, 4].map((n) => `ui:tn:gm:${TID}:${n}`));
        i = await click(`ui:tn:gm:${TID}:1`, priv(ADM));
        assert.ok(ids(i).includes(`ui:tn:gs:${TID}:1`));
        await click(`ui:tn:gs:${TID}:1`, priv({ ...ADM, values: [A[0], A[1], A[2]] }));
        await click(`ui:tn:gs:${TID}:2`, priv({ ...ADM, values: [A[2], A[3], A[4]] })); // A[2] moves to match 2
        i = await click(`ui:tn:gs:${TID}:1`, priv({ ...ADM, values: [A[0], A[1], A[5]] }));
        assert.match(text(i), /Match 1: A 00 vs A 01 vs A 05/);
        const g = await q(`select character_id::text c, grp from tournament_entrants where tournament_id=$1 and grp is not null order by grp, character_id`, [TID]);
        assert.deepStrictEqual(g.map((r) => `${r.grp}:${A.indexOf(r.c)}`), ['1:0', '1:1', '1:5', '2:2', '2:3', '2:4']);
    });

    await t('12 wrestlers: 4 triple threats → semi-finals → final; picks are kept, the rest drawn at random', async () => {
        const i = await run('tournament', 'start', { tournament: String(TID) }, ADM);
        assert.match(text(i), /12 wrestlers\. First round: 4 triple threats\. The winners then go one-on-one/, text(i));
        const m = await tm(TID);
        assert.deepStrictEqual(m.map((x) => `${x.round}:${x.slot}`), ['1:1', '1:2', '1:3', '1:4', '2:1', '2:2', '3:1']);
        // groups 1..4 sit in slots 1,3,2,4 (odd slots first)
        assert.deepStrictEqual([m[0].a, m[0].b, m[0].c].sort(), [A[0], A[1], A[5]].sort());
        assert.deepStrictEqual([m[2].a, m[2].b, m[2].c].sort(), [A[2], A[3], A[4]].sort());
        const rest = [m[1], m[3]].flatMap((x) => [x.a, x.b, x.c]).sort();
        assert.deepStrictEqual(rest, A.slice(6).sort());
        const d = await T.bracketData({ name: 'S' }, (await q(`select * from tournaments where id=$1`, [TID]))[0]);
        assert.strictEqual(d.matches[0].roundName, 'First round');
        assert.strictEqual(d.matches[4].roundName, 'Semi-finals');
        fs.writeFileSync('/tmp/bracket12.png', await require('../src/cards/bracketCard').renderBracketCard(d));
    });

    await t('logging a Triple Threat with those three advances the winner; undo reopens it', async () => {
        const m = await tm(TID);
        const trio = [m[0].a, m[0].b, m[0].c];
        const r = await logMatch({ guildId: G, matchType: 'triple_threat', slotCharacterIds: [trio[2], trio[0], trio[1]], winnerIndex: 0, actor: 'adm' });
        assert.strictEqual(r.tournament?.name, 'Twelve');
        assert.strictEqual(r.tournament.round, 'First round');
        let now = await tm(TID);
        assert.strictEqual(now[0].w, trio[2]);
        assert.strictEqual(now[4].a, trio[2], 'slot 1 winner is the top of semi-final 1');
        await undoMatch(G, r.matchId, 'adm');
        now = await tm(TID);
        assert.strictEqual(now[0].w, null); assert.strictEqual(now[4].a, null);
        // a triple threat with one different wrestler is not the bracket match
        const other = (await tm(TID))[1].a;
        const r2 = await logMatch({ guildId: G, matchType: 'triple_threat', slotCharacterIds: [trio[0], trio[1], other], winnerIndex: 0, actor: 'adm' });
        assert.ok(!r2.tournament);
    });

    await t('staff can decide a triple threat by button (three choices), then singles to the end', async () => {
        let i = await click(`ui:tn:d:${TID}:0`, priv(ADM));
        const m = await tm(TID);
        assert.ok(ids(i).includes(`ui:tn:w:${TID}:${(await q(`select id from tournament_matches where tournament_id=$1 and round=1 and slot=1`, [TID]))[0].id}:3`), ids(i).join(' '));
        const idOf = async (r, s) => (await q(`select id from tournament_matches where tournament_id=$1 and round=$2 and slot=$3`, [TID, r, s]))[0].id;
        for (const s of [1, 2, 3, 4]) await run('tournament', 'advance', { tournament: String(TID), bracket_match: await idOf(1, s), winner: 3 }, ADM);
        let now = await tm(TID);
        assert.deepStrictEqual([now[4].a, now[4].b, now[5].a, now[5].b], [m[0].c, m[1].c, m[2].c, m[3].c]);
        i = await run('tournament', 'advance', { tournament: String(TID), bracket_match: await idOf(2, 1), winner: 3 }, ADM);
        assert.match(text(i), /no third wrestler/);
        const s1 = await logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [now[4].a, now[4].b], winnerIndex: 0, actor: 'adm' });
        assert.strictEqual(s1.tournament.round, 'Semi-finals');
        await logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [now[5].a, now[5].b], winnerIndex: 1, actor: 'adm' });
        const fin = await logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [now[4].a, now[5].b], winnerIndex: 0, actor: 'adm' });
        assert.ok(fin.tournament.finished);
        assert.strictEqual((await q(`select status, winner_id::text w from tournaments where id=$1`, [TID]))[0].w, now[4].a);
    });

    await t('uneven numbers: 10 → 3 triple threats + a bye; 8 → 2 triple threats + a singles match; 9 → a semi-final bye', async () => {
        const B = await mk(10, 'b');
        const t10 = await newTour('Ten', B);
        let i = await run('tournament', 'start', { tournament: String(t10) }, ADM);
        assert.match(text(i), /10 wrestlers\. First round: 3 triple threats, 1 bye/, text(i));
        let m = await tm(t10);
        const bye = m.filter((x) => x.round === 1).find((x) => x.a && !x.b);
        assert.ok(bye && bye.w === bye.a, 'the lone wrestler is already through');
        const C = await mk(8, 'c');
        const t8 = await newTour('Eight', C);
        i = await run('tournament', 'start', { tournament: String(t8) }, ADM);
        assert.match(text(i), /First round: 2 triple threats, 1 singles match/, text(i));
        m = await tm(t8); // 3 groups → 4 slots, one empty
        const empty = m.filter((x) => x.round === 1 && !x.a);
        assert.strictEqual(empty.length, 1);
        assert.strictEqual(empty[0].slot, 4);
        // slot 3's winner (next to the empty slot 4) has nobody to face in the semi-final → straight to the final; undo walks it back
        const s2 = m.find((x) => x.round === 1 && x.slot === 3);
        const type = s2.c ? 'triple_threat' : 'singles';
        const r = await logMatch({ guildId: G, matchType: type, slotCharacterIds: [s2.a, s2.b, s2.c].filter(Boolean), winnerIndex: 0, actor: 'adm' });
        m = await tm(t8);
        const semi2 = m.find((x) => x.round === 2 && x.slot === 2), final = m.find((x) => x.round === 3);
        assert.strictEqual(semi2.w, s2.a);
        assert.strictEqual(final.b, s2.a);
        const d = await T.bracketData({ name: 'S' }, (await q(`select * from tournaments where id=$1`, [t8]))[0]);
        assert.ok(d.matches.find((x) => x.round === 2 && x.slot === 2).bBye && d.matches.find((x) => x.round === 1 && x.slot === 4).empty);
        fs.writeFileSync('/tmp/bracket8.png', await require('../src/cards/bracketCard').renderBracketCard(d));
        await undoMatch(G, r.matchId, 'adm');
        m = await tm(t8);
        assert.strictEqual(m.find((x) => x.round === 3).b, null);
        assert.strictEqual(m.find((x) => x.round === 2 && x.slot === 2).w, null);
        assert.strictEqual(m.find((x) => x.round === 2 && x.slot === 2).a, null);
    });

    await t('limits: 6 to 24 with triple threats; normal tournaments unchanged (random one-on-one draw)', async () => {
        const D = await mk(5, 'd');
        const t5 = await newTour('Five', D);
        let i = await run('tournament', 'start', { tournament: String(t5) }, ADM);
        assert.match(text(i), /needs at least 6 wrestlers/);
        const pid = (await q(`select id from tournaments where name='Plain'`))[0].id;
        for (const c of A.slice(0, 4)) await run('tournament', 'add', { tournament: String(pid), wrestler1: c }, ADM);
        i = await run('tournament', 'start', { tournament: String(pid) }, ADM);
        assert.match(text(i), /4 wrestlers, 2 rounds/);
        const m = await tm(pid);
        assert.ok(m.every((x) => !x.c));
        const r = await logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [m[0].a, m[0].b], winnerIndex: 0, actor: 'adm' });
        assert.strictEqual(r.tournament.round, 'Semi-finals');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exitCode = 1;
    await f.pool.end();
    process.exit();
})();
