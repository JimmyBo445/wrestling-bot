const assert = require('assert');
const f = require('./fixtures');
const { run, auto, sent, text, hasFile } = require('./mock');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const PLAYER = (u) => ({ admin: false, user: u });
const isPrivateErr = (i, re) => i.responses.some((r) => ((r.p?.flags & 64) || i.ephemeral) && /⚠️/.test(r.p?.content || '') && (!re || re.test(r.p.content)));
const C = {};
const G = 'g1';
const base = { brand: 'raw', division: 'mens' };

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const mk = async (name, owner, div = 'mens') => { C[name] = await f.makeChar(G, owner, name, div); };
    for (const [n, o] of [['M1', 'u1'], ['M2', 'u2'], ['M3', 'u1'], ['M4', 'u2'], ['M5', 'u3'], ['M6', 'u4'], ['M7', 'u3'], ['M8', 'u4']]) await mk(n, o);
    await mk('W1', 'u5', 'womens'); await mk('W2', 'u6', 'womens');
    const T = {};
    for (const n of ['World Heavyweight Championship', "Men's Tag Team Championship", "Women's World Championship"]) T[n] = await f.titleId(G, n);

    // ---------- character finisher / entrance theme ----------
    await t('finisher + entrance theme are saved, shown on the profile card, and can be edited/cleared', async () => {
        const a = await run('character', 'assign', { user: 'u9', name: 'Showman', division: 'mens', finisher: 'Gold Rush', entrance_theme: 'Thunder Road' }, ADM);
        assert.match(text(a), /Assigned/, text(a));
        const { rows } = await f.pool.query(`select id, finisher, entrance_theme from characters where name='Showman'`);
        assert.strictEqual(rows[0].finisher, 'Gold Rush');
        assert.strictEqual(rows[0].entrance_theme, 'Thunder Road');
        const p = await run('character', 'profile', { character: rows[0].id }, ADM);
        assert.ok(hasFile(p), text(p));
        const e = await run('character', 'edit', { character: rows[0].id, finisher: 'Silver Spike', entrance_theme: '-' }, ADM);
        assert.match(text(e), /finisher/, text(e));
        const { rows: r2 } = await f.pool.query(`select finisher, entrance_theme from characters where id=$1`, [rows[0].id]);
        assert.strictEqual(r2[0].finisher, 'Silver Spike');
        assert.strictEqual(r2[0].entrance_theme, null);
        const s = await run('character', 'submit', { name: 'Newbie', division: 'mens', finisher: '  ', entrance_theme: 'Hello' }, PLAYER('u10'));
        assert.match(text(s), /submitted/, text(s));
        const { rows: r3 } = await f.pool.query(`select finisher, entrance_theme from characters where name='Newbie'`);
        assert.strictEqual(r3[0].finisher, null, 'blank finisher is stored as nothing');
        assert.strictEqual(r3[0].entrance_theme, 'Hello');
    });

    // ---------- permissions ----------
    await t('only admins can use /card', async () => {
        const i = await run('card', 'new', base, PLAYER('u1'));
        assert.ok(isPrivateErr(i, /Only admins/), text(i));
    });

    // ---------- manual card ----------
    await t('add before new says to start a card', async () => {
        const i = await run('card', 'add', { ...base, match_type: 'singles', wrestler1: C.M1, wrestler2: C.M2 }, ADM);
        assert.ok(isPrivateErr(i, /no RAW Men's card/), text(i));
    });
    await t('new + add singles', async () => {
        const n = await run('card', 'new', { ...base, name: 'Monday Night Mayhem' }, ADM);
        assert.match(text(n), /Started a fresh \*\*RAW Men's\*\*/, text(n));
        const i = await run('card', 'add', { ...base, match_type: 'singles', wrestler1: C.M1, wrestler2: C.M2 }, ADM);
        assert.match(text(i), /match \*\*1\*\*/, text(i));
        assert.match(text(i), /M1 vs M2/, text(i));
    });
    await t('same wrestler cannot be booked twice on one card', async () => {
        const i = await run('card', 'add', { ...base, match_type: 'singles', wrestler1: C.M1, wrestler2: C.M3 }, ADM);
        assert.ok(isPrivateErr(i, /already booked/), text(i));
    });
    await t('wrong wrestler count, duplicate in a match, and other-division wrestlers are refused', async () => {
        let i = await run('card', 'add', { ...base, match_type: 'tag2v2', wrestler1: C.M3, wrestler2: C.M4 }, ADM);
        assert.ok(isPrivateErr(i, /needs exactly \*\*4\*\*/), text(i));
        assert.match(text(i), /Team 1 first/);
        i = await run('card', 'add', { ...base, match_type: 'singles', wrestler1: C.M3, wrestler2: C.M3 }, ADM);
        assert.ok(isPrivateErr(i, /twice/), text(i));
        i = await run('card', 'add', { ...base, match_type: 'singles', wrestler1: C.M3, wrestler2: C.W1 }, ADM);
        assert.ok(isPrivateErr(i, /different division/), text(i));
    });
    await t('title rules: tag title needs tag match, singles title needs non-tag match, champion warning', async () => {
        let i = await run('card', 'add', { ...base, match_type: 'singles', wrestler1: C.M3, wrestler2: C.M4, title: T["Men's Tag Team Championship"] }, ADM);
        assert.ok(isPrivateErr(i, /tag title/), text(i));
        i = await run('card', 'add', { ...base, match_type: 'tag2v2', wrestler1: C.M3, wrestler2: C.M4, wrestler3: C.M5, wrestler4: C.M6, title: T['World Heavyweight Championship'] }, ADM);
        assert.ok(isPrivateErr(i, /singles title/), text(i));
        i = await run('card', 'add', { ...base, match_type: 'singles', wrestler1: C.M3, wrestler2: C.W1, title: T['World Heavyweight Championship'] }, ADM);
        assert.ok(isPrivateErr(i, /different division/), text(i));
        i = await run('card', 'add', { ...base, match_type: 'singles', wrestler1: C.M3, wrestler2: C.M4, title: T["Women's World Championship"] }, ADM);
        assert.ok(isPrivateErr(i, /Women's title/), text(i));
        // champion check: make M5 champion, book M3 vs M4 for it -> allowed but warned
        await run('championship', 'backfill-reign', { title: T['World Heavyweight Championship'], won_date: '2026-01-01', character: C.M5 }, ADM);
        i = await run('card', 'add', { ...base, match_type: 'singles', wrestler1: C.M3, wrestler2: C.M4, title: T['World Heavyweight Championship'] }, ADM);
        assert.match(text(i), /match \*\*2\*\*/, text(i));
        assert.match(text(i), /champion \(\*\*M5\*\*\) isn't in this match/, text(i));
    });
    await t('tag match + registered team name; move, remove, view', async () => {
        await f.makeTeam(G, 'Duo', 'mens', [C.M5, C.M6]);
        let i = await run('card', 'add', { ...base, match_type: 'tag2v2', wrestler1: C.M5, wrestler2: C.M6, wrestler3: C.M7, wrestler4: C.M8, stipulation: 'No DQ' }, ADM);
        assert.match(text(i), /match \*\*3\*\*/, text(i));
        assert.match(text(i), /No DQ/);
        i = await run('card', 'move', { ...base, from: 3, to: 1 }, ADM);
        assert.match(text(i), /\*\*1\.\*\* Tag Team \(2v2\): M5 & M6 vs M7 & M8/, text(i));
        i = await run('card', 'view', base, ADM);
        assert.ok(hasFile(i), text(i));
        const draft = (await f.pool.query(`select id from card_drafts`)).rows[0];
        const { rows } = await f.pool.query(`select position, match_type from card_draft_matches where draft_id=$1 order by position`, [draft.id]);
        assert.deepStrictEqual(rows.map((r) => r.match_type), ['tag2v2', 'singles', 'singles']);
        i = await run('card', 'remove', { ...base, number: 2 }, ADM);
        assert.match(text(i), /Removed match 2/, text(i));
        i = await run('card', 'remove', { ...base, number: 9 }, ADM);
        assert.ok(isPrivateErr(i, /1 to 2/), text(i));
    });
    await t('post: here (public) and to another channel', async () => {
        let i = await run('card', 'post', base, ADM);
        assert.ok(hasFile(i) && !i.ephemeral, 'public post with image');
        const before = sent.length;
        i = await run('card', 'post', { ...base, channel: 'showchan' }, ADM);
        assert.match(text(i), /Posted the RAW Men's card in <#showchan>/, text(i));
        const msg = sent.slice(before).find((m) => m.channelId === 'showchan');
        assert.ok(msg && msg.payload.files.length >= 1, 'image sent to channel');
        const empty = await run('card', 'new', { brand: 'smackdown', division: 'womens' }, ADM);
        assert.match(text(empty), /Started/);
        const e = await run('card', 'post', { brand: 'smackdown', division: 'womens' }, ADM);
        assert.ok(isPrivateErr(e, /no matches yet/), text(e));
    });
    await t('RAW and SmackDown cards for the same division are separate; clear deletes one', async () => {
        await run('card', 'new', { brand: 'smackdown', division: 'mens' }, ADM);
        const i = await run('card', 'add', { brand: 'smackdown', division: 'mens', match_type: 'singles', wrestler1: C.M1, wrestler2: C.M2 }, ADM);
        assert.match(text(i), /SmackDown Men's card/, text(i));
        const c = await run('card', 'clear', { brand: 'smackdown', division: 'mens' }, ADM);
        assert.match(text(c), /Deleted/);
        const again = await run('card', 'clear', { brand: 'smackdown', division: 'mens' }, ADM);
        assert.ok(isPrivateErr(again, /no SmackDown/), text(again));
        const { rows } = await f.pool.query(`select count(*)::int n from card_draft_matches`);
        assert.ok(rows[0].n > 0, 'the RAW card is untouched');
    });
    await t('a card holds at most 10 matches', async () => {
        const ch = [];
        for (let i = 1; i <= 22; i++) { const id = await f.makeChar(G, `u${20 + (i % 5)}`, `Cu${i}`, 'custom'); ch.push(id); }
        await run('card', 'new', { brand: 'raw', division: 'custom' }, ADM);
        for (let i = 0; i < 10; i++) {
            const r = await run('card', 'add', { brand: 'raw', division: 'custom', match_type: 'singles', wrestler1: ch[i * 2], wrestler2: ch[i * 2 + 1] }, ADM);
            assert.match(text(r), new RegExp(`match \\*\\*${i + 1}\\*\\*`), text(r));
        }
        const eleven = await run('card', 'add', { brand: 'raw', division: 'custom', match_type: 'singles', wrestler1: ch[20], wrestler2: ch[21] }, ADM);
        assert.ok(isPrivateErr(eleven, /max/), text(eleven));
        const v = await run('card', 'view', { brand: 'raw', division: 'custom' }, ADM);
        assert.ok(hasFile(v), 'a full 10-match card renders');
    });
    await t('a deleted wrestler shows as TBD instead of breaking the card', async () => {
        await run('card', 'new', { brand: 'raw', division: 'womens' }, ADM);
        const x = await f.makeChar(G, 'u30', 'Ghost', 'womens');
        await run('card', 'add', { brand: 'raw', division: 'womens', match_type: 'singles', wrestler1: C.W1, wrestler2: x }, ADM);
        await f.pool.query(`delete from characters where id=$1`, [x]);
        const v = await run('card', 'view', { brand: 'raw', division: 'womens' }, ADM);
        assert.ok(hasFile(v), text(v));
        assert.match(text(v), /TBD/);
    });
    await t('autocomplete only offers wrestlers/titles from the chosen division', async () => {
        const w = await auto('card', 'add', 'wrestler1', 'W', { division: 'womens' }, ADM);
        assert.ok(w.length === 2 && w.every((c) => /Women's/.test(c.name)), JSON.stringify(w));
        const m = await auto('card', 'add', 'wrestler1', 'W1', { division: 'mens' }, ADM);
        assert.strictEqual(m.length, 0, 'no mens wrestler named W');
        const ti = await auto('card', 'add', 'title', 'World', { division: 'womens' }, ADM);
        assert.deepStrictEqual(ti.map((c) => c.name), ["Women's World Championship (Vacant)"], JSON.stringify(ti));
    });

    // ---------- auto generator ----------
    await t('auto: title shot, rematches and fresh matchups, nobody booked twice', async () => {
        // history: M1 beat M2, M3 beat M4 (both recent)
        await run('match', 'log-singles', { participant1: C.M1, participant2: C.M2, winner: 1, override_cooldown: true }, ADM);
        await run('match', 'log-singles', { participant1: C.M3, participant2: C.M4, winner: 1, override_cooldown: true }, ADM);
        await run('contender', 'award', { title: T['World Heavyweight Championship'], character: C.M6 }, ADM);
        const i = await run('card', 'auto', { brand: 'smackdown', division: 'mens', matches: 5, name: 'Friday Fights' }, ADM);
        assert.ok(hasFile(i), text(i));
        const draft = (await f.pool.query(`select id, name from card_drafts where brand='smackdown' and division='mens'`)).rows[0];
        assert.strictEqual(draft.name, 'Friday Fights');
        const { rows } = await f.pool.query(`select * from card_draft_matches where draft_id=$1 order by position`, [draft.id]);
        assert.ok(rows.length >= 3 && rows.length <= 5, `got ${rows.length}`);
        const all = rows.flatMap((r) => r.character_ids.map(String));
        assert.strictEqual(new Set(all).size, all.length, 'nobody booked twice');
        const last = rows[rows.length - 1];
        assert.strictEqual(String(last.title_id), T['World Heavyweight Championship'], `title match closes the card: ${JSON.stringify(rows)}`);
        assert.deepStrictEqual(last.character_ids.map(String), [C.M5, C.M6], 'champion vs #1 contender');
        const stips = rows.map((r) => r.stipulation);
        assert.ok(stips.includes('Rematch'), `expected a rematch, got ${stips}`);
        const rem = rows.find((r) => r.stipulation === 'Rematch' && r.character_ids.map(String).includes(C.M1));
        assert.deepStrictEqual(rem.character_ids.map(String), [C.M2, C.M1], 'loser faces winner again');
        assert.match(text(i), /Booked a \*\*SmackDown Men's\*\* card/, text(i));
    });
    await t('auto: brand-new server with no history still books fresh matchups (different players first)', async () => {
        const i = await run('card', 'auto', { brand: 'raw', division: 'mens', matches: 3 }, ADM);
        assert.ok(hasFile(i), text(i));
        const d = (await f.pool.query(`select id from card_drafts where brand='raw' and division='mens'`)).rows[0];
        const { rows } = await f.pool.query(`select character_ids from card_draft_matches where draft_id=$1`, [d.id]);
        assert.ok(rows.length >= 1);
    });
    await t('auto: not enough wrestlers is a friendly error', async () => {
        await f.makeChar(G, 'u40', 'Solo', 'custom_womens');
        const i = await run('card', 'auto', { brand: 'raw', division: 'custom_womens' }, ADM);
        assert.ok(isPrivateErr(i, /at least 2/), text(i));
    });
    await t('auto: replaces an existing card and tag champions get a tag title defence', async () => {
        const tm = await f.makeTeam(G, 'Pair B', 'womens', [C.W1, C.W2]);
        void tm;
        const tt = await f.titleId(G, "Women's Tag Team Championship");
        const w3 = await f.makeChar(G, 'u50', 'W3', 'womens'); const w4 = await f.makeChar(G, 'u51', 'W4', 'womens');
        const team2 = await f.makeTeam(G, 'Pair C', 'womens', [w3, w4]);
        await run('championship', 'backfill-reign', { title: tt, won_date: '2026-02-01', team: tm }, ADM);
        await run('contender', 'award', { title: tt, team: team2 }, ADM);
        const i = await run('card', 'auto', { brand: 'raw', division: 'womens', matches: 2 }, ADM);
        assert.ok(hasFile(i), text(i));
        const d = (await f.pool.query(`select id from card_drafts where brand='raw' and division='womens'`)).rows[0];
        const { rows } = await f.pool.query(`select * from card_draft_matches where draft_id=$1 order by position`, [d.id]);
        const tagM = rows.find((r) => r.match_type === 'tag2v2');
        assert.ok(tagM && String(tagM.title_id) === tt, JSON.stringify(rows));
        assert.deepStrictEqual(tagM.character_ids.map(String), [C.W1, C.W2, w3, w4]);
    });


    // ---------- v2.4: results, recap, tape, lineage, defenses ----------
    const sb = { brand: 'smackdown', division: 'mens' };
    const WH = T['World Heavyweight Championship'];
    await t('logging a booked match fills its slot, brands the result, and undo unlinks it', async () => {
        await run('card', 'clear', sb, ADM);
        await run('card', 'new', { ...sb, name: 'Friday Night' }, ADM);
        await run('card', 'add', { ...sb, match_type: 'singles', wrestler1: C.M3, wrestler2: C.M4 }, ADM);
        await run('card', 'add', { ...sb, match_type: 'singles', wrestler1: C.M5, wrestler2: C.M6, title: WH }, ADM);
        let i = await run('card', 'recap', sb, ADM);
        assert.ok(isPrivateErr(i, /logged|result/i), text(i));
        i = await run('match', 'log-singles', { participant1: C.M3, participant2: C.M4, winner: 1, override_cooldown: true }, ADM);
        assert.ok(hasFile(i), text(i));
        const { rows } = await f.pool.query(`select position, match_id from card_draft_matches order by position`);
        const mine = (await f.pool.query(`select cdm.position, cdm.match_id from card_draft_matches cdm join card_drafts d on d.id=cdm.draft_id where d.brand='smackdown' order by 1`)).rows;
        assert.ok(mine[0].match_id, 'slot 1 linked');
        assert.ok(!mine[1].match_id, 'slot 2 still open');
        i = await run('card', 'recap', sb, ADM);
        assert.ok(hasFile(i), text(i));
        const u = await run('match', 'undo', { match_id: Number(mine[0].match_id) }, ADM);
        assert.match(text(u), /undone/, text(u));
        const after = (await f.pool.query(`select cdm.match_id from card_draft_matches cdm join card_drafts d on d.id=cdm.draft_id where d.brand='smackdown' and cdm.position=1`)).rows[0];
        assert.strictEqual(after.match_id, null, 'unlinked after undo');
    });
    await t('tale of the tape: /stats tape and /card tape', async () => {
        let i = await run('stats', 'tape', { character1: C.M1, character2: C.M2 }, ADM);
        assert.ok(hasFile(i), text(i));
        i = await run('card', 'tape', { ...sb, number: 2 }, ADM);
        assert.ok(hasFile(i), text(i));
        i = await run('card', 'tape', { ...sb, number: 9 }, ADM);
        assert.ok(isPrivateErr(i), text(i));
    });
    await t('defense log, ordinals, and lineage graphic', async () => {
        let i = await run('match', 'log-singles', { participant1: C.M5, participant2: C.M8, winner: 1, title: WH, override_cooldown: true }, ADM);
        assert.ok(hasFile(i), text(i));
        i = await run('match', 'log-singles', { participant1: C.M5, participant2: C.M1, winner: 1, title: WH, override_cooldown: true }, ADM);
        i = await run('championship', 'defenses', { title: WH }, ADM);
        const body = JSON.stringify(i.responses.map((r) => r.p));
        assert.match(body, /M8/); assert.match(body, /M1/);
        assert.match(body, /\*\*2\*\* defenses/);
        i = await run('championship', 'defenses', { title: WH, reign: 7 }, ADM);
        assert.ok(isPrivateErr(i, /only has/), text(i));
        i = await run('championship', 'lineage', { title: WH }, ADM);
        assert.ok(hasFile(i), text(i));
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end();
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
