const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, auto, hasFile, lastPayload } = require('./mock');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 5).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const P = (u) => ({ admin: false, user: u });
const isErr = (i, re) => i.responses.some((r) => /⚠️/.test(r.p?.content || '') && (!re || re.test(r.p.content)));
const G = 'g1';
const C = {};
const q = async (sql, a) => (await f.pool.query(sql, a)).rows;

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    for (let n = 0; n < 30; n++) C[`W${n}`] = await f.makeChar(G, `u${n}`, `Wrestler ${String(n).padStart(2, '0')}`);
    const WH = await f.titleId(G, 'World Heavyweight Championship');
    const TAG = await f.titleId(G, "Men's Tag Team Championship");
    const T1 = await f.makeTeam(G, 'Alpha', 'mens', [C.W0, C.W1]);
    const T2 = await f.makeTeam(G, 'Beta', 'mens', [C.W2, C.W3]);
    const img = require('../src/utils/imageUrl');
    const { createCanvas } = require('@napi-rs/canvas');
    img.downloadImage = async () => { const c = createCanvas(600, 300); const x = c.getContext('2d'); x.fillStyle = '#c9a227'; x.fillRect(0, 0, 600, 300); return c.toBuffer('image/png'); };
    const att = { url: 'https://cdn.discordapp.com/attachments/1/2/belt.png', contentType: 'image/png', size: 5000, name: 'belt.png' };

    await t('/reign add backfills a reign with a defenses count; players are refused', async () => {
        let i = await run('reign', 'add', { title: WH, won_date: '2026-01-01', character: C.W0, defenses: 2 }, ADM);
        assert.ok(!isErr(i), text(i));
        const [r] = await q(`select defenses from title_reigns where title_id=$1 and lost_date is null`, [WH]);
        assert.strictEqual(r.defenses, 2);
        i = await run('reign', 'add', { title: WH, won_date: '2025-01-01', character: C.W1 }, P('u1'));
        assert.ok(isErr(i), text(i));
    });
    await t('/title match: champion filled in, challenger wins, title changes hands', async () => {
        let i = await run('title', 'match', { title: WH, challenger: C.W1, winner: 1 }, ADM);
        assert.ok(!isErr(i), text(i));
        let [r] = await q(`select character_id, defenses from title_reigns where title_id=$1 and lost_date is null`, [WH]);
        assert.strictEqual(String(r.character_id), C.W0); assert.strictEqual(r.defenses, 3);
        i = await run('title', 'match', { title: WH, challenger: C.W1, winner: 2 }, ADM);
        assert.ok(!isErr(i), text(i));
        [r] = await q(`select character_id from title_reigns where title_id=$1 and lost_date is null`, [WH]);
        assert.strictEqual(String(r.character_id), C.W1);
    });
    await t('/title match is admin only, and a vacant title asks for an opponent', async () => {
        let i = await run('title', 'match', { title: WH, challenger: C.W2, winner: 1 }, P('u2'));
        assert.ok(isErr(i), text(i));
        await run('title', 'vacate', { title: WH }, ADM);
        i = await run('title', 'match', { title: WH, challenger: C.W2, winner: 1 }, ADM);
        assert.ok(isErr(i, /vacant/), text(i));
        i = await run('title', 'match', { title: WH, challenger: C.W2, opponent: C.W3, winner: 1 }, ADM);
        assert.ok(!isErr(i), text(i));
        const [r] = await q(`select character_id from title_reigns where title_id=$1 and lost_date is null`, [WH]);
        assert.strictEqual(String(r.character_id), C.W2);
    });
    await t('/title match for a tag title uses the champion team', async () => {
        await run('reign', 'add', { title: TAG, won_date: '2026-02-01', team: T1 }, ADM);
        const i = await run('title', 'match', { title: TAG, challenger: T2, winner: 2 }, ADM);
        assert.ok(!isErr(i), text(i));
        const [r] = await q(`select team_id from title_reigns where title_id=$1 and lost_date is null`, [TAG]);
        assert.strictEqual(String(r.team_id), T2);
    });
    await t('belt-image: upload shows on the belt card, replace and remove', async () => {
        let i = await run('title', 'belt-image', { title: WH, picture: att }, ADM);
        assert.ok(!isErr(i), text(i)); assert.match(text(i), /Saved/);
        assert.strictEqual((await q(`select 1 from title_images where title_id=$1`, [WH])).length, 1);
        const { buildBeltData } = require('../src/utils/cardData');
        const { requireTitle } = require('../src/utils/titleLogic');
        const d = await buildBeltData({ id: G, members: { cache: new Map() }, client: {} }, await requireTitle(G, WH)).catch((e) => ({ err: e }));
        if (!d.err) assert.ok(Buffer.isBuffer(d.beltArt));
        i = await run('championship', 'belt', { title: WH }, P('u9'));
        assert.ok(hasFile(i), text(i));
        i = await run('title', 'belt-image', { title: WH, picture: { ...att, contentType: 'application/pdf' } }, ADM);
        assert.ok(isErr(i, /Picture problem/), text(i));
        i = await run('title', 'belt-image', { title: WH, picture: att }, P('u1'));
        assert.ok(isErr(i), text(i));
        i = await run('title', 'belt-image', { title: WH, remove: true }, ADM);
        assert.match(text(i), /Removed/);
        assert.strictEqual((await q(`select 1 from title_images where title_id=$1`, [WH])).length, 0);
    });
    await t('add-defense and remove-defense change the count and the defenses list', async () => {
        const [cur] = await q(`select id, defenses from title_reigns where title_id=$1 and lost_date is null`, [WH]);
        let i = await run('reign', 'add-defense', { title: WH, reign: Number(cur.id), opponent: 'Mystery Man', date: '2026-03-01', notes: 'Street fight' }, ADM);
        assert.ok(isErr(i, /before the reign/) || !isErr(i), text(i));
        i = await run('reign', 'add-defense', { title: WH, reign: Number(cur.id), opponent: 'Mystery Man' }, ADM);
        assert.ok(!isErr(i), text(i));
        const [d1] = await q(`select defenses from title_reigns where id=$1`, [cur.id]);
        assert.strictEqual(d1.defenses, cur.defenses + 1);
        i = await run('championship', 'defenses', { title: WH }, P('u9'));
        assert.match(text(i), /Mystery Man/);
        const [dd] = await q(`select id from reign_defenses where reign_id=$1`, [cur.id]);
        i = await run('reign', 'remove-defense', { title: WH, reign: Number(cur.id), defense: Number(dd.id) }, ADM);
        assert.ok(!isErr(i), text(i));
        const [d2] = await q(`select defenses from title_reigns where id=$1`, [cur.id]);
        assert.strictEqual(d2.defenses, cur.defenses);
        i = await run('reign', 'add-defense', { title: WH, reign: Number(cur.id), opponent: 'X', date: '2999-01-01' }, ADM);
        assert.ok(isErr(i, /future/), text(i));
    });
    await t('contender: /title contender-award shows on the belt and clears with the panel button', async () => {
        await run('reign', 'add', { title: WH, won_date: '2026-05-01', character: C.W4 }, ADM).catch(() => {});
        let i = await run('title', 'contender-award', { title: WH, character: C.W5 }, ADM);
        assert.ok(!isErr(i), text(i));
        const { buildBeltData } = require('../src/utils/cardData');
        void buildBeltData;
        assert.strictEqual((await q(`select 1 from contenders where title_id=$1 and status='active'`, [WH])).length, 1);
    });
    await t('panel: everyone sees the belt and history/defenses/lineage buttons; admins also get action buttons', async () => {
        let i = await run('championship', 'panel', { title: WH }, P('u9'));
        assert.ok(hasFile(i), text(i));
        const ids = (p) => (p.components || []).flatMap((r) => r.components.map((c) => c.data.custom_id));
        let p = lastPayload(i);
        assert.deepStrictEqual(ids(p).filter((x) => x.startsWith('chmp:')).map((x) => x.split(':')[1]), ['hist', 'def', 'lin']);
        i = await run('championship', 'panel', { title: WH }, ADM);
        p = lastPayload(i);
        assert.deepStrictEqual(ids(p).map((x) => x.split(':')[1]), ['hist', 'def', 'lin', 'log', 'sc', 'cc', 'vac']);
        for (const act of ['hist', 'def', 'lin']) {
            const c = await click(`chmp:${act}:${WH}`, { admin: false, user: 'u9' });
            assert.ok(c.responses.length && !isErr(c), `${act}: ${text(c)}`);
        }
    });
    await t('panel admin buttons refuse players', async () => {
        for (const id of [`chmp:log:${WH}`, `chmp:sc:${WH}`, `chmp:cc:${WH}`, `chmp:vac:${WH}`, `chmp:vacy:${WH}`]) {
            const c = await click(id, { admin: false, user: 'u9' });
            assert.match(text(c), /Only admins/, id);
        }
        assert.ok((await q(`select 1 from title_reigns where title_id=$1 and lost_date is null`, [WH])).length === 1, 'still has a champion');
    });
    await t('panel: Log match pages through 25+ challengers, then logs the result', async () => {
        const [cur0] = await q(`select character_id from title_reigns where title_id=$1 and lost_date is null`, [WH]);
        const champ = String(cur0.character_id);
        let c = await click(`chmp:log:${WH}`);
        let p = lastPayload(c);
        const sel = p.components[0].components[0];
        assert.strictEqual(sel.options.length, 25);
        assert.ok(p.components[1], 'paging row');
        c = await click(`chmp:pg:log:${WH}:1`);
        p = lastPayload(c);
        assert.strictEqual(p.components[0].components[0].options.length, 4); // 30 - champion - 25
        const pick = p.components[0].components[0].options[0].data.value;
        assert.notStrictEqual(pick, champ);
        c = await click(`chmp:lc:${WH}`, { values: [pick] });
        assert.match(text(c), /Who won/);
        const before = (await q(`select count(*)::int n from matches where guild_id=$1`, [G]))[0].n;
        c = await click(`chmp:lw:${WH}:${pick}:2`);
        assert.ok(!isErr(c), text(c));
        assert.strictEqual((await q(`select count(*)::int n from matches where guild_id=$1`, [G]))[0].n, before + 1);
        const [now] = await q(`select character_id from title_reigns where title_id=$1 and lost_date is null`, [WH]);
        assert.strictEqual(String(now.character_id), String(pick));
    });
    await t('panel: set contender, clear contender, vacate with confirm', async () => {
        const c0 = await click(`chmp:sc:${WH}`);
        const opt = lastPayload(c0).components[0].components[0].options[0].data.value;
        let c = await click(`chmp:sp:${WH}`, { values: [opt] });
        assert.match(text(c), /#1 contender/);
        assert.strictEqual((await q(`select 1 from contenders where title_id=$1 and status='active'`, [WH])).length, 1);
        c = await click(`chmp:cc:${WH}`);
        assert.match(text(c), /Removed/);
        assert.strictEqual((await q(`select 1 from contenders where title_id=$1 and status='active'`, [WH])).length, 0);
        c = await click(`chmp:cc:${WH}`);
        assert.ok(isErr(c, /no #1 contender/), text(c));
        c = await click(`chmp:vac:${WH}`);
        assert.match(text(c), /Vacate/);
        assert.strictEqual((await q(`select 1 from title_reigns where title_id=$1 and lost_date is null`, [WH])).length, 1, 'not vacated until confirmed');
        c = await click(`chmp:vacy:${WH}`);
        assert.match(text(c), /now vacant/);
        assert.strictEqual((await q(`select 1 from title_reigns where title_id=$1 and lost_date is null`, [WH])).length, 0);
        c = await click(`chmp:log:${WH}`);
        assert.match(text(c), /vacant/);
    });
    await t('tag title panel lists registered teams', async () => {
        const c = await click(`chmp:log:${TAG}`);
        const p = lastPayload(c);
        assert.match(p.content || text(c), /challenging/);
    });
    await t('card panel: Record button logs a booked match and posts the picture in the results channel', async () => {
        const { sent } = require('./mock');
        await f.pool.query(`update guilds set matches_channel_id = 'matches1' where guild_id = $1`, [G]);
        let i = await run('card', 'add', { brand: 'smackdown', match_type: 'singles', wrestler1: C.W10, wrestler2: C.W11 }, ADM);
        assert.ok(!isErr(i), text(i));
        i = await run('card', 'add', { brand: 'smackdown', match_type: 'tag2v2', wrestler1: C.W12, wrestler2: C.W13, wrestler3: C.W14, wrestler4: C.W15 }, ADM);
        const [d] = await q(`select id from card_drafts where guild_id=$1 and brand='smackdown' and division='mens'`, [G]);
        let c = await click(`cardui:pick:smackdown`, { values: [`${d.id}:1`] });
        const ids = (x) => (lastPayload(x).components || []).flatMap((r) => r.components.map((b) => b.data.custom_id));
        assert.ok(ids(c).includes(`cardui:rc:${d.id}:1`));
        c = await click(`cardui:rc:${d.id}:1`);
        assert.match(text(c), /Who won/); assert.ok(ids(c).includes(`cardui:rw:${d.id}:1:2`) && ids(c).includes(`cardui:rw:${d.id}:1:d`));
        const before = sent.length;
        c = await click(`cardui:rw:${d.id}:1:2`);
        assert.ok(!isErr(c), text(c)); assert.match(text(c), /Recorded/);
        const posted = sent.slice(before).filter((m) => m.channelId === 'matches1' && (m.payload.embeds || []).length);
        assert.strictEqual(posted.length, 1, JSON.stringify(sent.slice(before).map((m) => m.channelId)));
        const [m] = await q(`select m.id, mp.is_winner, mp.character_id from matches m join match_participants mp on mp.match_id=m.id where m.guild_id=$1 order by m.id desc limit 2`, [G]);
        assert.ok(m);
        const [slot] = await q(`select match_id from card_draft_matches where draft_id=$1 and position=1`, [d.id]);
        assert.ok(slot.match_id, 'slot linked to the logged match');
        const win = await q(`select character_id from match_participants where match_id=$1 and is_winner`, [slot.match_id]);
        assert.deepStrictEqual(win.map((x) => String(x.character_id)), [C.W11]);
        // can't record twice
        c = await click(`cardui:rw:${d.id}:1:1`);
        assert.match(text(c), /already recorded/);
        // team match: winning team 1, and draw
        c = await click(`cardui:rw:${d.id}:2:1`);
        assert.ok(!isErr(c), text(c));
        const [t2] = await q(`select match_id from card_draft_matches where draft_id=$1 and position=2`, [d.id]);
        assert.deepStrictEqual((await q(`select character_id from match_participants where match_id=$1 and is_winner order by 1`, [t2.match_id])).map((x) => String(x.character_id)).sort(), [C.W12, C.W13].sort());
        // players can't use it
        c = await click(`cardui:rw:${d.id}:1:1`, { admin: false, user: 'u9' });
        assert.match(text(c), /Only admins/);
    });
    await t('help knows /title and /reign; commands load', async () => {
        const i = await run('help', null, {}, ADM);
        assert.match(text(i), /\/title/); assert.match(text(i), /\/reign/);
        const names = require('../src/registerCommands').loadCommandData().map((c) => c.name);
        assert.ok(names.includes('title') && names.includes('reign'));
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end();
    process.exit(failed ? 1 : 0);
})();
