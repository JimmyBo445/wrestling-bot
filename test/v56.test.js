// 3.15.0: the LuchaDerpy division. One roster (Men's) with 🟢 / 🟣 / 🟢🟣 / ⚪, an extra 🟣 slot per player,
// separate records, its own belt, show card, channel and standings; A–Z ignores a leading "The".
process.env.ROSTER_DEBOUNCE_MS = '30';
const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, ids, sent, client } = require('./mock');

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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const owner = async (id) => (await q(`select u.discord_id, u.is_placeholder from characters c join users u on u.id=c.owner_id where c.id=$1`, [id]))[0];
const lucha = async (menId) => (await q(`select c.*, u.discord_id, u.is_placeholder from characters c join users u on u.id=c.owner_id where c.base_character_id=$1`, [menId]))[0];
const desc = (m) => m.payload.content || '';
const json = (i) => JSON.stringify(i.responses.at(-1).p.components.map((r) => (r.toJSON ? r.toJSON() : r)));

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    await f.pool.query(`UPDATE guilds SET switch_cooldown_days = 14 WHERE guild_id = $1`, [G]);
    for (const n of ['Roman Reigns', 'Randy Orton', 'The Rock', 'Seth Rollins', 'Rey Mysterio', 'Sami Zayn']) await run('character', 'open', { name: n, division: 'mens' }, ADM);
    await run('character', 'open', { name: 'Roman Overall', division: 'mens', overall: 70 }, ADM);
    const id = async (n, div = 'mens') => (await q(`select id from characters where name=$1 and division=$2`, [n, div]))[0]?.id;
    const ROMAN = await id('Roman Reigns'), RANDY = await id('Randy Orton'), ROCK = await id('The Rock'), SETH = await id('Seth Rollins'), REY = await id('Rey Mysterio'), SAMI = await id('Sami Zayn');
    const JEY = await f.makeChar(G, 'u1', 'Jey Uso', 'mens');

    await t('the LuchaDerpy belt exists and the division is labelled everywhere', async () => {
        const b = await q(`select division, is_tag_title from titles where name = 'Super Fuego Mega Lucha Derpy El Campeon'`);
        assert.deepStrictEqual(b[0], { division: 'luchaderpy', is_tag_title: false });
        assert.strictEqual(require('../src/utils/discordHelpers').DIVISION_LABELS.luchaderpy, 'LuchaDerpy');
        assert.strictEqual(require('../src/utils/constants').CARD_BRANDS.luchaderpy.showName, 'Ova Tha MF Breaking Point B!tch Card');
    });

    await t('staff "Give to a player" on a Men\'s superstar asks 🟢 Normal or 🟣 LuchaDerpy', async () => {
        let i = await click(`ui:ws:to:${ROMAN}`, priv({ ...ADM, kind: 'select', values: ['u2'] }));
        assert.match(text(i), /Give \*\*Roman Reigns\*\* to <@u2> as their/);
        assert.ok(ids(i).includes(`ui:ws:sl:${ROMAN}:u2:n`) && ids(i).includes(`ui:ws:sl:${ROMAN}:u2:l`), ids(i).join(' '));
        i = await click(`ui:ws:sl:${ROMAN}:u2:l`, priv(ADM));
        assert.match(text(i), /Gave 🟣 \*\*Roman Reigns\*\* \(LuchaDerpy\) to <@u2>/, text(i));
        const l = await lucha(ROMAN);
        assert.strictEqual(l.division, 'luchaderpy');
        assert.strictEqual(l.discord_id, 'u2');
        assert.strictEqual(l.name, 'Roman Reigns');
        assert.strictEqual((await owner(ROMAN)).is_placeholder, true, 'the Men\'s version is still nobody\'s');
    });

    await t('one superstar = one player: nobody else can have Roman 🟢; the same player can (🟢🟣)', async () => {
        let i = await run('character', 'transfer', { character: ROMAN, new_owner: 'u3', slot: 'normal' }, ADM);
        assert.match(text(i), /already <@u2>'s 🟣 LuchaDerpy character/, text(i));
        assert.strictEqual((await owner(ROMAN)).is_placeholder, true);
        i = await run('character', 'transfer', { character: ROMAN, new_owner: 'u2' }, ADM);
        assert.match(text(i), /Gave \*\*Roman Reigns\*\* to <@u2>/, text(i));
        assert.strictEqual((await owner(ROMAN)).discord_id, 'u2');
    });

    await t('1 LuchaDerpy slot per player, on top of the normal limit', async () => {
        let i = await click(`ui:ws:sl:${RANDY}:u2:l`, priv(ADM));
        assert.match(text(i), /already has a 🟣 LuchaDerpy character/, text(i));
        for (let k = 0; k < 3; k++) await f.makeChar(G, 'u2', `Filler ${k}`, 'mens');
        const { canAddCharacter } = require('../src/utils/characterUtils');
        const uid = (await q(`select id from users where discord_id='u2'`))[0].id;
        assert.strictEqual(await canAddCharacter(G, uid), false, '4 normal (Roman 🟢 + 3), the 🟣 one doesn\'t count');
        await f.pool.query(`DELETE FROM characters WHERE name LIKE 'Filler %'`);
    });

    await t('assign makes a new superstar and can put it straight into the 🟣 slot', async () => {
        const opts = client.commands.get('character').data.toJSON().options.find((o) => o.name === 'assign').options.map((o) => o.name);
        assert.ok(opts.includes('slot'));
        let i = await run('character', 'assign', { user: 'u4', name: 'Dragon Lee', division: 'womens', slot: 'luchaderpy' }, ADM);
        assert.match(text(i), /Only Men's superstars/);
        i = await run('character', 'assign', { user: 'u4', name: 'Dragon Lee', division: 'mens', slot: 'luchaderpy' }, ADM);
        assert.match(text(i), /Assigned 🟣 \*\*Dragon Lee\*\* \(LuchaDerpy slot\)/, text(i));
        const DL = await id('Dragon Lee');
        assert.strictEqual((await owner(DL)).is_placeholder, true);
        assert.strictEqual((await lucha(DL)).discord_id, 'u4');
    });

    await t('🙋 Request a character has a 🟣 LuchaDerpy tab with ⚪ open superstars only', async () => {
        let i = await click('ui:rq:h:mw', priv(P('u5')));
        assert.ok(ids(i).includes('ui:rq:l:mw:luchaderpy'), ids(i).join(' '));
        i = await click('ui:rq:l:mw:luchaderpy', priv(P('u5')));
        const j = json(i);
        assert.match(text(i), /LuchaDerpy uses the Men's roster/);
        assert.ok(j.includes('Seth Rollins') && j.includes('The Rock'), j);
        assert.ok(!j.includes('Roman Reigns') && !j.includes('Dragon Lee') && !j.includes('Jey Uso'), 'taken superstars are not offered');
        // Men's tab: Roman and Dragon Lee aren't open either (someone has them in 🟣)
        i = await click('ui:rq:l:mw:mens', priv(P('u5')));
        assert.ok(!json(i).includes('Dragon Lee') && !json(i).includes('Roman Reigns'));
        assert.ok(json(i).includes('Seth Rollins'));
    });

    let REQ;
    await t('request Seth 🟣 → staff card says LuchaDerpy slot → approve → it\'s theirs; Men\'s Seth is not open anymore', async () => {
        let i = await click('ui:rq:p:mw:luchaderpy', priv({ ...P('u5'), values: [String(SETH)] }));
        assert.match(text(i), /for your 🟣 \*\*LuchaDerpy\*\* slot/);
        const lid = (await lucha(SETH)).id;
        assert.ok(ids(i).includes(`ui:rq:y:${lid}`));
        i = await click(`ui:rq:y:${lid}`, priv(P('u5')));
        assert.match(text(i), /Request sent/);
        i = await click(`ui:rq:y:${lid}`, priv(P('u5')));
        assert.match(text(i), /already asked for a 🟣/);
        REQ = (await q(`select * from pending_requests where request_type='character_claim' and requested_by='u5'`))[0];
        const card = await require('../src/handlers/pendingQueue').buildPendingMessage(REQ);
        assert.match(card.embeds[0].data.description, /for their 🟣 \*\*LuchaDerpy\*\* slot/);
        i = await click(`pending_approve_${REQ.id}`, ADM);
        assert.ok(!/⚠️/.test(text(i)), text(i));
        assert.strictEqual((await lucha(SETH)).discord_id, 'u5');
        i = await click('ui:rq:l:mw:mens', priv(P('u6')));
        assert.ok(!json(i).includes('Seth Rollins'));
        i = await click('ui:mr:h', priv(P('u5')));
        assert.match(text(i), /Seth Rollins\*\*: 🟣 LuchaDerpy claim/);
    });

    await t('same superstar in both colors: the player sees it, staff get the details', async () => {
        await f.makeChar(G, 'u5', 'Some Women', 'womens');
        let i = await click('ui:rq:l:mw:mens', priv(P('u5')));
        assert.match(json(i), /Seth Rollins[^}]*You have them in the other color/);
        i = await click('ui:rq:p:mw:mens', priv({ ...P('u5'), values: [String(SETH)] }));
        assert.match(text(i), /already have \*\*Seth Rollins\*\* as 🟣 LuchaDerpy[\s\S]*up to staff/);
        await click(`ui:rq:y:${SETH}`, priv(P('u5')));
        const r = (await q(`select * from pending_requests where request_type='character_claim' and requested_by='u5' and character_id=$1`, [SETH]))[0];
        const d = (await require('../src/handlers/pendingQueue').buildPendingMessage(r)).embeds[0].data.description;
        assert.match(d, /Already their 🟣 LuchaDerpy character/);
        assert.match(d, /Had Seth Rollins in LuchaDerpy since: <t:\d+:D>/);
        assert.match(d, /LuchaDerpy record with Seth Rollins: 0-0/);
        assert.match(d, /Currently holds: no titles/);
        assert.match(d, /Their other characters: Some Women \(Women's\)/);
        assert.match(d, /Last switch: never/);
        await click(`pending_approve_${r.id}`, ADM);
        assert.strictEqual((await owner(SETH)).discord_id, 'u5');
    });

    await t('roster channel: 🟢 / 🟣 / 🟢🟣 in the Men\'s post, ⚪ open, own LuchaDerpy post + standings; "The" sorts by the next word', async () => {
        const s0 = sent.length;
        await click('ui:ch:s:roster_luchaderpy', priv({ ...ADM, kind: 'channel', values: ['ldch'] }));
        await click('ui:ch:s:roster_mens', priv({ ...ADM, kind: 'channel', values: ['mensch'] }));
        await wait(150);
        const mensPost = sent.slice(s0).filter((m) => m.channelId === 'mensch').map(desc).find((d) => /Men's Division/.test(d));
        assert.match(mensPost, /\*\*Roman Reigns\*\* 🟢🟣 : <@u2>/);
        assert.match(mensPost, /\*\*Dragon Lee\*\* 🟣 : <@u4>/);
        assert.match(mensPost, /\*\*Seth Rollins\*\* 🟢🟣 : <@u5>/);
        assert.match(mensPost, /\*\*Jey Uso\*\* 🟢 : <@u1>/);
        assert.match(mensPost, /⚪ \*\*Open/);
        const open = mensPost.slice(mensPost.indexOf('⚪'));
        assert.ok(open.indexOf('Randy Orton') < open.indexOf('The Rock') && open.indexOf('The Rock') < open.indexOf('Roman Overall') && open.indexOf('Roman Overall') < open.indexOf('Sami Zayn'), open);
        const ld = sent.slice(s0).filter((m) => m.channelId === 'ldch').map(desc);
        assert.match(ld[0], /^📋 \*\*🟣 LuchaDerpy Division\*\* · 3 taken · \d+ open/);
        assert.match(ld[0], /\*\*Roman Reigns\*\* 🟣 : <@u2>/);
        assert.ok(!/Jey Uso/.test(ld[0]), 'Men\'s-only characters are not in the LuchaDerpy post');
        assert.match(ld[1], /LuchaDerpy Standings/);
        const info = sent.slice(s0).filter((m) => m.channelId === 'ldch').at(-1).payload.components[0].toJSON().components.map((c) => c.custom_id);
        assert.ok(info.includes('ui:rq:h:luchaderpy:rb'), info.join(' '));
    });

    await t('cards: 🟣 matches only on the LuchaDerpy show (default name), never mixed with Men\'s', async () => {
        const svc = require('../src/utils/cardService');
        const romanL = (await lucha(ROMAN)).id, sethL = (await lucha(SETH)).id;
        await assert.rejects(svc.addMatchToCard(G, 'raw', { matchType: 'singles', characterIds: [romanL, sethL] }), /go on the \*\*LuchaDerpy\*\* card/);
        await assert.rejects(svc.addMatchToCard(G, 'luchaderpy', { matchType: 'singles', characterIds: [ROMAN, JEY] }), /only for 🟣 LuchaDerpy matches/);
        await assert.rejects(svc.addMatchToCard(G, 'luchaderpy', { matchType: 'singles', characterIds: [romanL, JEY] }), /mix divisions/);
        const r = await svc.addMatchToCard(G, 'luchaderpy', { matchType: 'singles', characterIds: [romanL, sethL] });
        assert.strictEqual(r.division, 'luchaderpy');
        assert.strictEqual((await svc.getShow(G, 'luchaderpy')).name, 'Ova Tha MF Breaking Point B!tch Card');
        const v = await require('../src/utils/cardUi').viewMessage(G, 'raw');
        const btns = v.components[0].toJSON().components.map((c) => c.custom_id);
        assert.ok(btns.includes('ui:ct:v:luchaderpy') && btns.includes('ui:ct:v:smackdown'), btns.join(' '));
    });

    await t('the LuchaDerpy card posts to its own channel', async () => {
        await click('ui:ch:s:lucha_card', priv({ ...ADM, kind: 'channel', values: ['ldcard'] }));
        const s0 = sent.length;
        const i = await click('cardui:po:luchaderpy', ADM);
        assert.match(text(i), /Posted the LuchaDerpy card in <#ldcard>/, text(i));
        const p = sent.slice(s0).filter((m) => m.channelId === 'ldcard');
        assert.ok(p.length >= 1);
        assert.match(p[0].payload.content, /LuchaDerpy · LuchaDerpy\*\* — Ova Tha MF/);
    });

    await t('match logging: 🟣 can\'t face Men\'s; 🟣 records and the belt stay separate', async () => {
        const romanL = (await lucha(ROMAN)).id, sethL = (await lucha(SETH)).id;
        let i = await run('match', 'log', { type: 'singles', wrestler1: romanL, wrestler2: JEY, winner: 1 }, ADM);
        assert.match(text(i), /can only be in LuchaDerpy matches/);
        const belt = (await q(`select id from titles where division='luchaderpy'`))[0].id;
        i = await run('match', 'log', { type: 'singles', wrestler1: romanL, wrestler2: sethL, winner: 1, title: belt }, ADM);
        assert.ok(!/⚠️/.test(text(i)), text(i));
        const { characterSummary } = require('../src/utils/statsQueries');
        assert.strictEqual((await characterSummary(romanL)).wins, 1);
        assert.strictEqual((await characterSummary(ROMAN)).wins, 0, 'Men\'s Roman has no LuchaDerpy wins');
        const champs = await require('../src/utils/rosterBoard').championPosts(G);
        const ld = champs.find((p) => p.slot === 'champ:luchaderpy');
        assert.match(ld.header, /🟣 LuchaDerpy Champions/);
        assert.match(ld.body, /Super Fuego Mega Lucha Derpy El Campeon\*\*\n- \*\*Roman Reigns\*\* \(<@u2>\)/);
        const st = await require('../src/utils/rosterBoard').luchaStandings(G);
        assert.match(st.body, /\*\*1\.\*\* Roman Reigns · \*\*1-0\*\* : <@u2>/);
        // same superstar may hold a Men's title and El Campeon at the same time
        const wh = (await q(`select id from titles where name='World Heavyweight Championship'`))[0].id;
        i = await run('match', 'log', { type: 'singles', wrestler1: ROMAN, wrestler2: JEY, winner: 1, title: wh }, ADM);
        assert.ok(!/⚠️/.test(text(i)), text(i));
    });

    await t('🔄 Switch your 🟣: same rules, own 14-day timer separate from Men\'s', async () => {
        // u5's 🟣 Seth → 🟣 Rey
        const sethL = (await lucha(SETH)).id;
        let i = await click(`ui:sw:o:${sethL}`, priv(P('u5')));
        assert.match(text(i), /🟣 LuchaDerpy \(Men's roster\)/, text(i));
        assert.ok(!json(i).includes('Roman Reigns'));
        i = await click(`ui:sw:t:${sethL}`, priv({ ...P('u5'), values: [String(REY)] }));
        const reyL = (await lucha(REY)).id;
        assert.ok(ids(i).includes(`ui:sw:y:${sethL}:${reyL}`), ids(i).join(' '));
        await click(`ui:sw:y:${sethL}:${reyL}`, priv(P('u5')));
        const r = (await q(`select * from pending_requests where request_type='character_switch' and requested_by='u5'`))[0];
        i = await click(`pending_approve_${r.id}`, ADM);
        assert.ok(!/⚠️/.test(text(i)), text(i));
        assert.strictEqual((await lucha(REY)).discord_id, 'u5');
        assert.strictEqual((await lucha(SETH)).is_placeholder, true);
        assert.strictEqual((await owner(SETH)).discord_id, 'u5', 'their Men\'s Seth is untouched');
        // 🟣 timer running, Men's timer free
        i = await click(`ui:sw:o:${reyL}`, priv(P('u5')));
        assert.match(text(i), /switch your 🟣 LuchaDerpy character once every 14 days/);
        i = await click(`ui:sw:o:${SETH}`, priv(P('u5')));
        assert.ok(!/once every/.test(text(i)), text(i));
    });

    await t('Men\'s edits follow to the 🟣 version (name, overall), unless staff gave it its own', async () => {
        const reyL = (await lucha(REY)).id;
        await run('character', 'overall', { character: REY, overall: 88 }, ADM);
        assert.strictEqual((await q(`select overall from characters where id=$1`, [reyL]))[0].overall, 88);
        await run('character', 'overall', { character: reyL, overall: 60 }, ADM);
        await run('character', 'overall', { character: REY, overall: 90 }, ADM);
        assert.strictEqual((await q(`select overall from characters where id=$1`, [reyL]))[0].overall, 60, 'own overall kept');
        let i = await run('character', 'edit', { character: reyL, name: 'Rey Two' }, ADM);
        assert.match(text(i), /always has its superstar's name/);
        await run('character', 'edit', { character: REY, name: 'Rey Mysterio Jr' }, ADM);
        assert.strictEqual((await q(`select name from characters where id=$1`, [reyL]))[0].name, 'Rey Mysterio Jr');
        i = await run('character', 'swap-division', { character: REY, division: 'custom' }, ADM);
        assert.match(text(i), /LuchaDerpy version/);
    });

    await t('/whois: a Men\'s superstar used only in 🟣 shows its player; tabs fit in rows of 5', async () => {
        let i = await run('whois', null, { character: await id('Dragon Lee') }, P('u1'));
        assert.match(text(i), /Dragon Lee\*\* is played by <@u4>/);
        assert.match(text(i), /🟣 LuchaDerpy/);
        i = await click('ui:sd:pw:all', priv(P('u1')));
        for (const r of i.responses.at(-1).p.components) assert.ok(r.toJSON().components.length <= 5);
        i = await click('ui:pg:st:0:all:t', priv(P('u1')));
        for (const r of i.responses.at(-1).p.components) assert.ok(r.toJSON().components.length <= 5);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exitCode = 1;
    await f.pool.end();
    process.exit();
})();
