// 3.20.0: book someone twice on a card (with a button), #1 contender card matches, ✏️ Edit bracket.
const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, ids } = require('./mock');
const { logMatch } = require('../src/utils/matchService');
const svc = require('../src/utils/cardService');
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
const slots = async () => q(`select m.position, m.character_ids::text[] c, m.contender_title_id::text ct, m.title_id::text tt from card_draft_matches m join card_drafts d on d.id=m.draft_id where d.brand='raw' and d.division='mens' order by position`);

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const W = [];
    for (let k = 0; k < 12; k++) W.push(String(await f.makeChar(G, `p${k}`, `W${String(k).padStart(2, '0')}`, 'mens')));
    const WH = await f.titleId(G, 'World Heavyweight Championship');
    const US = await f.titleId(G, 'United States Championship');
    const TAG = await f.titleId(G, "Men's Tag Team Championship");

    await t('double booking: a warning with ✅ Book anyway; pressing it books them twice', async () => {
        await run('card', 'add', { brand: 'raw', match_type: 'singles', wrestler1: W[0], wrestler2: W[1] }, ADM);
        let i = await run('card', 'add', { brand: 'raw', match_type: 'singles', wrestler1: W[0], wrestler2: W[2], stipulation: 'No DQ' }, ADM);
        assert.match(text(i), /\*\*W00\*\* is already booked on this card/);
        const b = ids(i).find((x) => x.startsWith('ui:ct:dbl:raw:'));
        assert.ok(b, ids(i).join(' '));
        assert.ok(ids(i).includes('ui:ct:dbn:raw'));
        assert.strictEqual((await slots()).length, 1, 'nothing booked yet');
        i = await click(b, priv(ADM));
        assert.match(text(i), /Added as \*\*Men's\*\* match \*\*2\*\*/, text(i));
        assert.match(text(i), /W00\*\* is now booked twice/);
        const s = await slots();
        assert.deepStrictEqual(s[1].c, [W[0], W[2]]);
        // the button only works once
        i = await click(b, priv(ADM));
        assert.match(text(i), /expired/);
        i = await click('ui:ct:dbn:raw', priv(ADM));
        assert.match(text(i), /nothing was changed/);
    });

    await t('double booking also asks on /card edit swaps and /card request', async () => {
        let i = await run('card', 'edit', { brand: 'raw', division: 'mens', number: 1, swap_out: W[1], swap_in: W[2] }, ADM);
        const b = ids(i).find((x) => x.startsWith('ui:ct:dbl:raw:'));
        assert.ok(b, text(i));
        i = await click(b, priv(ADM));
        assert.match(text(i), /Updated Men's match \*\*1\*\*/, text(i));
        assert.deepStrictEqual((await slots())[0].c, [W[0], W[2]]);
        // request
        await f.pool.query(`insert into pending_requests (guild_id, request_type, status, character_id, challenger_character_id, requested_by, payload) values ($1,'match_request','approved',$2,$3,'p0','{}')`, [G, W[0], W[5]]).catch(async () => {
            await f.pool.query(`insert into pending_requests (guild_id, request_type, status, character_id, challenger_character_id, payload) values ($1,'match_request','approved',$2,$3,'{}')`, [G, W[0], W[5]]);
        });
        const rid = (await q(`select id from pending_requests order by id desc limit 1`))[0].id;
        i = await run('card', 'request', { brand: 'raw', request: String(rid) }, ADM);
        assert.ok(ids(i).some((x) => x.startsWith('ui:ct:dbl:raw:')), text(i));
        // from the card screen picker the button shows up too
        i = await click(`ui:ct:rqs:raw`, priv({ ...ADM, values: [String(rid)] }));
        assert.ok(ids(i).some((x) => x.startsWith('ui:ct:dbl:raw:')), text(i));
        i = await click(ids(i).find((x) => x.startsWith('ui:ct:dbl:raw:')), priv(ADM));
        assert.match(text(i), /Added the request/);
        await run('card', 'clear', { brand: 'raw' }, ADM);
    });

    await t('#1 contender match on the card: shown, checked, and the winner becomes #1 contender', async () => {
        let i = await run('card', 'add', { brand: 'raw', match_type: 'singles', wrestler1: W[3], wrestler2: W[4], contender_for: WH }, ADM);
        assert.match(text(i), /🎯 #1 Contender: World Heavyweight Championship/, text(i));
        assert.strictEqual((await slots())[0].ct, WH);
        await assert.rejects(svc.addMatchToCard(G, 'raw', { matchType: 'singles', characterIds: [W[5], W[6]], titleId: US, contenderTitleId: WH }), /title match or a #1 contender match, not both/);
        await assert.rejects(svc.addMatchToCard(G, 'raw', { matchType: 'singles', characterIds: [W[5], W[6]], contenderTitleId: TAG }), /tag title/);
        // edit: setting a title clears the contender spot and the other way round; "-" removes it
        await run('card', 'edit', { brand: 'raw', division: 'mens', number: 1, title: US }, ADM);
        assert.deepStrictEqual([(await slots())[0].tt, (await slots())[0].ct], [US, null]);
        await run('card', 'edit', { brand: 'raw', division: 'mens', number: 1, contender_for: WH }, ADM);
        assert.deepStrictEqual([(await slots())[0].tt, (await slots())[0].ct], [null, WH]);
        await run('card', 'edit', { brand: 'raw', division: 'mens', number: 1, contender_for: '-' }, ADM);
        assert.strictEqual((await slots())[0].ct, null);
        await run('card', 'edit', { brand: 'raw', division: 'mens', number: 1, contender_for: WH }, ADM);
        const draft = await svc.requireDraft(G, 'raw', 'mens');
        assert.match(await svc.describeCard(draft), /🎯 #1 Contender: World Heavyweight Championship/);
        // logged straight with /match log (no contender option): it still counts, because the card says so
        const r = await logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [W[4], W[3]], winnerIndex: 0, actor: 'adm' });
        assert.strictEqual(r.effect?.kind, 'contender');
        assert.strictEqual((await q(`select character_id::text c from contenders where title_id=$1 and status='active'`, [WH]))[0].c, W[4]);
        assert.strictEqual((await q(`select is_contender_match from matches where id=$1`, [r.matchId]))[0].is_contender_match, true);
        await run('card', 'clear', { brand: 'raw' }, ADM);
    });

    await t('auto-build: a belt without a #1 contender gets a #1 contender match (no Open Challenge)', async () => {
        await run('reign', 'add', { title: US, won_date: '2026-01-01', character: W[7] }, ADM);
        const plan = await svc.planCard(G, 'mens', 5, { rematches: true });
        const cm = plan.find((m) => String(m.contender_title_id) === US);
        assert.ok(cm, JSON.stringify(plan));
        assert.ok(!cm.title_id);
        assert.ok(!cm.character_ids.includes(W[7]), 'not the champion');
        assert.ok(!plan.some((m) => m.stipulation === 'Open Challenge'));
        // the WH has a #1 contender (W04) but no champion: nothing for it
        assert.ok(!plan.some((m) => String(m.title_id) === WH));
        // once there is a #1 contender, it's a title match again
        await f.pool.query(`insert into contenders (guild_id, title_id, character_id, status, earned_via) values ($1,$2,$3,'active','manual')`, [G, US, W[9]]).catch(() => null);
        if ((await q(`select 1 from contenders where title_id=$1 and status='active'`, [US])).length) {
            const p2 = await svc.planCard(G, 'mens', 5, { rematches: true });
            const tm = p2.find((m) => String(m.title_id) === US);
            assert.ok(tm && tm.character_ids.includes(W[9]), JSON.stringify(p2));
            assert.ok(!p2.some((m) => String(m.contender_title_id) === US));
        }
        // saved on the card when auto-built
        await f.pool.query(`update contenders set status='fulfilled' where title_id=$1`, [US]).catch(() => null);
        await run('card', 'auto', { brand: 'raw', matches: 5, use_signup: false }, ADM);
        assert.ok((await slots()).some((s) => s.ct === US), JSON.stringify(await slots()));
    });

    // ---- ✏️ Edit bracket
    await run('tournament', 'create', { name: 'Cup', division: 'mens' }, ADM);
    const TID = String((await q(`select id from tournaments where name='Cup'`))[0].id);
    const add = { tournament: TID }; W.slice(0, 8).forEach((c, k) => (add[`wrestler${k + 1}`] = c));
    await run('tournament', 'add', add, ADM);
    await run('tournament', 'start', { tournament: TID }, ADM);
    const tm = async () => q(`select id::text, round, slot, a_id::text a, b_id::text b, winner_id::text w, match_id from tournament_matches where tournament_id=$1 order by round, slot`, [TID]);

    await t('✏️ Edit bracket button for staff on a running tournament', async () => {
        const i = await click(`ui:tn:v:${TID}`, priv(ADM));
        assert.ok(ids(i).includes(`ui:tn:e:${TID}`), ids(i).join(' '));
        const e = await click(`ui:tn:e:${TID}`, priv(ADM));
        for (const x of ['er', 'es', 'eu']) assert.ok(ids(e).includes(`ui:tn:${x}:${TID}`), ids(e).join(' '));
        assert.match(JSON.stringify(e.responses.at(-1).p.embeds[0]), /edit the bracket/);
        const p = await click(`ui:tn:e:${TID}`, priv({ admin: false, user: 'p1' }));
        assert.match(text(p), /admin|staff|permission/i);
    });

    await t('replace a wrestler: someone new takes their spot and their place in the tournament', async () => {
        const m1 = (await tm())[0];
        let i = await click(`ui:tn:er:${TID}`, priv(ADM));
        assert.ok(ids(i).includes(`ui:tn:er1:${TID}`));
        i = await click(`ui:tn:er1:${TID}`, priv({ ...ADM, values: [`${m1.id}.a`] }));
        assert.ok(ids(i).includes(`ui:tn:er2:${TID}:${m1.id}.a`), ids(i).join(' '));
        i = await click(`ui:tn:er2:${TID}:${m1.id}.a`, priv({ ...ADM, values: [W[10]] }));
        assert.match(text(i), /W10\*\* replaces/, text(i));
        assert.strictEqual((await tm())[0].a, W[10]);
        const ent = (await q(`select character_id::text c from tournament_entrants where tournament_id=$1`, [TID])).map((r) => r.c);
        assert.ok(ent.includes(W[10]) && !ent.includes(m1.a));
        // someone already in it can't be put in again
        await assert.rejects(T.replaceInBracket(G, TID, `${m1.id}.b`, W[10]), /already in this tournament/);
    });

    await t('swap two spots', async () => {
        const [m1, m2] = await tm();
        const i = await click(`ui:tn:es2:${TID}`, priv({ ...ADM, values: [`${m1.id}.b`, `${m2.id}.a`] }));
        assert.match(text(i), /↔️ Swapped/, text(i));
        const [n1, n2] = await tm();
        assert.deepStrictEqual([n1.b, n2.a], [m2.a, m1.b]);
        await assert.rejects(T.swapInBracket(G, TID, `${m1.id}.a`, `${m1.id}.b`), /same match/);
    });

    await t('undo a result, and change who advanced', async () => {
        let [m1] = await tm();
        await run('tournament', 'advance', { tournament: TID, bracket_match: m1.id, winner: 1 }, ADM);
        let rows = await tm();
        const semi = rows.find((r) => r.round === 2 && r.slot === 1);
        assert.strictEqual(semi.a, m1.a);
        let i = await click(`ui:tn:eu:${TID}`, priv(ADM));
        assert.ok(ids(i).includes(`ui:tn:eu1:${TID}`));
        i = await click(`ui:tn:eu1:${TID}`, priv({ ...ADM, values: [m1.id] }));
        assert.ok(ids(i).includes(`ui:tn:eux:${TID}:${m1.id}:0`));
        assert.ok(ids(i).includes(`ui:tn:eux:${TID}:${m1.id}:${m1.b}`), ids(i).join(' '));
        // change who advanced
        i = await click(`ui:tn:eux:${TID}:${m1.id}:${m1.b}`, priv(ADM));
        assert.match(text(i), /advances to the .* instead/, text(i));
        rows = await tm();
        assert.strictEqual(rows[0].w, m1.b);
        assert.strictEqual(rows.find((r) => r.round === 2 && r.slot === 1).a, m1.b);
        // undo
        i = await click(`ui:tn:eux:${TID}:${m1.id}:0`, priv(ADM));
        assert.match(text(i), /back to not decided/);
        rows = await tm();
        assert.strictEqual(rows[0].w, null);
        assert.strictEqual(rows.find((r) => r.round === 2 && r.slot === 1).a, null);
        // a result the next round already used can't be undone
        [m1] = await tm();
        const m2 = rows[1];
        await run('tournament', 'advance', { tournament: TID, bracket_match: m1.id, winner: 1 }, ADM);
        await run('tournament', 'advance', { tournament: TID, bracket_match: m2.id, winner: 1 }, ADM);
        const s1 = (await tm()).find((r) => r.round === 2 && r.slot === 1);
        await run('tournament', 'advance', { tournament: TID, bracket_match: s1.id, winner: 1 }, ADM);
        await assert.rejects(T.redoBracketResult(G, TID, m1.id), /next round/);
        // a logged match keeps its record; only the bracket changes
        const s2 = (await tm()).find((r) => r.round === 1 && r.slot === 3);
        const res = await logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [s2.a, s2.b], winnerIndex: 0, actor: 'adm' });
        assert.strictEqual((await tm()).find((r) => r.id === s2.id).w, s2.a);
        const r = await T.redoBracketResult(G, TID, s2.id, s2.b);
        assert.strictEqual(String(r.loggedMatch), String(res.matchId));
        assert.strictEqual((await tm()).find((x) => x.id === s2.id).w, s2.b);
        assert.strictEqual((await q(`select count(*)::int n from matches where id=$1`, [res.matchId]))[0].n, 1);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exitCode = 1;
    await f.pool.end();
    process.exit();
})();
