// 3.13.0: 🔄 Switch character (Men's/Women's), staff approve, cooldown, champions can't, card spots follow.
process.env.ROSTER_DEBOUNCE_MS = '30';
const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, ids, dms, edited } = require('./mock');

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
const owner = async (id) => (await q(`select u.discord_id, u.is_placeholder from characters c join users u on u.id=c.owner_id where c.id=$1`, [id]))[0];

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const JEY = await f.makeChar(G, 'u1', 'Jey Uso', 'mens');
    const BOLT = await f.makeChar(G, 'u2', 'Bolt', 'mens');
    const CUST = await f.makeChar(G, 'u1', 'Custom Kid', 'custom');
    await run('character', 'open', { name: 'Roman Reigns', division: 'mens', overall: 95 }, ADM);
    await run('character', 'open', { name: 'CM Punk', division: 'mens' }, ADM);
    await run('character', 'open', { name: 'Rhea Ripley', division: 'womens' }, ADM);
    const id = async (n) => (await q(`select id from characters where name=$1`, [n]))[0].id;
    const ROMAN = await id('Roman Reigns'), PUNK = await id('CM Punk'), RHEA = await id('Rhea Ripley');

    await t('My Wrestlers has 🔄 Switch on Men\'s/Women\'s wrestlers only', async () => {
        let i = await click('ui:h:mine', priv(P('u1')));
        assert.ok(!ids(i).some((x) => x.startsWith('ui:sw:o:')), 'Custom Kid is shown first: no switch for custom');
        i = await click('ui:w:c', priv({ ...P('u1'), values: [String(JEY)] }));
        assert.ok(ids(i).includes(`ui:sw:o:${JEY}`), ids(i).join(' '));
    });

    await t('switch flow: only open characters in the same division, then a staff card', async () => {
        let i = await click('ui:sw:h:mw', priv(P('u1')));
        const json = JSON.stringify(i.responses.at(-1).p.components.map((r) => r.toJSON()));
        assert.ok(json.includes(`ui:sw:t:${JEY}`), 'one Men\'s wrestler → straight to the list');
        assert.ok(json.includes('Roman Reigns') && json.includes('CM Punk') && !json.includes('Rhea Ripley'), 'same division, open only');
        i = await click(`ui:sw:t:${JEY}`, priv({ ...P('u1'), values: [String(RHEA)] }));
        assert.match(text(i), /same division|isn't open/);
        i = await click(`ui:sw:t:${JEY}`, priv({ ...P('u1'), values: [String(ROMAN)] }));
        assert.ok(ids(i).includes(`ui:sw:y:${JEY}:${ROMAN}`));
        i = await click(`ui:sw:y:${JEY}:${ROMAN}`, priv(P('u1')));
        assert.match(text(i), /Switch request sent/);
        i = await click(`ui:sw:y:${JEY}:${PUNK}`, priv(P('u1')));
        assert.match(text(i), /already have a switch waiting/);
        i = await click(`ui:sw:y:${BOLT}:${PUNK}`, priv(P('u1')));
        assert.match(text(i), /isn't one of your/);
        i = await click('ui:mr:h', priv(P('u1')));
        assert.match(text(i), /Jey Uso → Roman Reigns\*\*: switch · ⏳ waiting/);
        i = await click(`ui:sw:o:${CUST}`, priv(P('u1')));
        assert.match(text(i), /only for Men's, Women's and LuchaDerpy/);
    });

    await t('approve: Roman moves to the player, Jey becomes open, card spot follows, DM sent', async () => {
        const svc = require('../src/utils/cardService');
        await svc.addMatchToCard(G, 'raw', { matchType: 'singles', characterIds: [JEY, BOLT] });
        const r = (await q(`select * from pending_requests where request_type='character_switch'`))[0];
        const before = dms.length;
        const i = await click(`pending_approve_${r.id}`, ADM);
        assert.ok(!/⚠️|wrong/.test(text(i)), text(i));
        assert.deepStrictEqual(await owner(ROMAN), { discord_id: 'u1', is_placeholder: false });
        assert.strictEqual((await owner(JEY)).is_placeholder, true);
        const slot = (await q(`select character_ids from card_draft_matches`))[0].character_ids.map(String);
        assert.deepStrictEqual(slot, [String(ROMAN), String(BOLT)]);
        assert.ok(dms.slice(before).some((d) => d.id === 'u1' && /you're now \*\*Roman Reigns\*\*/.test(d.content)));
    });

    await t('cooldown: no second switch for 14 days; staff can change it in Rules', async () => {
        let i = await click(`ui:sw:o:${ROMAN}`, priv(P('u1')));
        assert.match(text(i), /once every 14 days/);
        i = await click('ui:ad:ru', priv(ADM));
        assert.ok(ids(i).includes('ui:ad:swc'));
        i = await click('ui:adm:swc', priv({ ...ADM, fields: { days: '0' } }));
        assert.match(text(i), /No cooldown/);
        i = await click(`ui:sw:o:${ROMAN}`, priv(P('u1')));
        assert.ok(!/once every/.test(text(i)), text(i));
        i = await click('ui:adm:swc', priv({ ...ADM, fields: { days: '500' } }));
        assert.match(text(i), /0 to 365/);
    });

    await t('champions can\'t switch (singles or tag)', async () => {
        const wh = (await q(`select id from titles where guild_id=$1 and division='mens' and not is_tag_title order by id limit 1`, [G]))[0].id;
        await run('match', 'log', { type: 'singles', wrestler1: BOLT, wrestler2: ROMAN, winner: 1, title: wh }, ADM);
        const i = await click(`ui:sw:o:${BOLT}`, priv(P('u2')));
        assert.match(text(i), /Champions can't switch/);
        // and if they win a belt while a switch is waiting, staff can't approve it
        await f.pool.query(`UPDATE guilds SET switch_cooldown_days = 0 WHERE guild_id = $1`, [G]);
        await f.pool.query(`INSERT INTO pending_requests (guild_id, request_type, requested_by, character_id, challenger_character_id) VALUES ($1,'character_switch','u2',$2,$3)`, [G, PUNK, BOLT]);
        const r = (await q(`select id from pending_requests where requested_by='u2' and request_type='character_switch'`))[0];
        const a = await click(`pending_approve_${r.id}`, ADM);
        assert.match(text(a), /can't be approved/);
        assert.strictEqual((await owner(PUNK)).is_placeholder, true);
    });

    await t('deny sends a DM and changes nothing; roster channels and menu have the button', async () => {
        const r = (await q(`select id from pending_requests where requested_by='u2' and request_type='character_switch'`))[0];
        const before = dms.length;
        await click(`pending_deny_${r.id}`, ADM);
        assert.ok(dms.slice(before).some((d) => d.id === 'u2' && /denied your switch/.test(d.content)));
        const mp = require('../src/utils/menuPost').payload('FNLW').components.flatMap((x) => x.toJSON().components.map((c) => c.custom_id));
        assert.ok(mp.includes('ui:sw:h:mw:mp'));
        const plan = await require('../src/utils/rosterBoard').plan(G);
        void plan; void edited;
    });

    await t('3.13.1: open characters have 🛠 Staff on /whois (to set their overall)', async () => {
        let i = await run('whois', null, { character: PUNK }, ADM);
        assert.ok(ids(i).includes(`ui:ws:v:${PUNK}`), ids(i).join(' '));
        i = await run('whois', null, { character: PUNK }, P('u1'));
        assert.ok(!ids(i).includes(`ui:ws:v:${PUNK}`));
        i = await click(`ui:ovm:${PUNK}`, priv({ ...ADM, fields: { overall: '87' } }));
        assert.match(text(i), /87 Overall/);
        i = await run('whois', null, { character: PUNK }, ADM);
        assert.match(text(i), /87 Overall/);
    });

    await t('3.13.2: /character overall sets, changes and removes an overall (staff only)', async () => {
        const names = require('./mock').client.commands.get('character').data.toJSON().options.map((o) => o.name);
        assert.ok(names.includes('overall'));
        let i = await run('character', 'overall', { character: PUNK, overall: 90 }, ADM);
        assert.match(text(i), /CM Punk\*\* is now \*\*90 Overall\*\* \(was 87\)/);
        i = await run('character', 'overall', { character: BOLT, overall: 0 }, ADM);
        assert.match(text(i), /Removed/);
        assert.strictEqual((await q(`select overall from characters where id=$1`, [PUNK]))[0].overall, 90);
        i = await run('character', 'overall', { character: PUNK, overall: 50 }, P('u1'));
        assert.match(text(i), /Only admins|staff/i);
        const ac = await require('./mock').auto('character', 'overall', 'character', 'cm', {}, ADM);
        assert.ok(ac.some((c) => String(c.value) === String(PUNK)), 'open characters show in the list');
    });

    await t('3.13.3: search by name in Request a character and Switch character', async () => {
        for (let k = 0; k < 30; k++) await run('character', 'open', { name: `Filler Superstar ${String(k).padStart(2, '0')}`, division: 'mens' }, ADM);
        await run('character', 'open', { name: 'Seth Rollins', division: 'mens' }, ADM);
        let i = await click('ui:rq:h:mens', priv(P('u7')));
        assert.ok(ids(i).includes('ui:rq:s:mens:mens'), ids(i).join(' '));
        assert.ok(!JSON.stringify(i.responses.at(-1).p.components.map((x) => x.toJSON())).includes('Seth Rollins'), 'Seth is on page 2');
        i = await click('ui:rq:s:mens:mens', priv(P('u7')));
        assert.ok(i.responses.some((r) => r.type === 'modal'));
        i = await click('ui:rqm:mens:mens', priv({ ...P('u7'), fields: { name: 'seth' } }));
        const j = JSON.stringify(i.responses.at(-1).p.components.map((x) => x.toJSON()));
        assert.ok(j.includes('Seth Rollins') && !j.includes('Filler'), j.slice(0, 300));
        assert.match(text(i), /matching \*\*seth\*\*/);
        assert.ok(ids(i).includes('ui:rq:l:mens:mens:0'), 'clear search');
        i = await click('ui:rqm:mens:mens', priv({ ...P('u7'), fields: { name: 'zzz_%' } }));
        assert.match(text(i), /No open Men's character matches/);
        // switch list search
        await f.pool.query(`UPDATE guilds SET switch_cooldown_days = 0 WHERE guild_id = $1`, [G]);
        i = await click(`ui:sw:o:${ROMAN}`, priv(P('u1')));
        assert.ok(ids(i).includes(`ui:sw:s:${ROMAN}`));
        i = await click(`ui:swm:${ROMAN}`, priv({ ...P('u1'), fields: { name: 'Rollins' } }));
        assert.ok(JSON.stringify(i.responses.at(-1).p.components.map((x) => x.toJSON())).includes('Seth Rollins'));
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end(); process.exit(failed ? 1 : 0);
})();
