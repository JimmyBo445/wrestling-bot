// 3.17.0: easier Request / Switch: letter buttons instead of arrows, the name box opens first, search results are
// buttons you tap, and "add another character" vs "switch" is spelled out for the player and for staff.
const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, ids } = require('./mock');

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
const comps = (i) => i.responses.at(-1).p.components.map((r) => r.toJSON());
const labels = (i) => comps(i).flatMap((r) => r.components.map((c) => c.label)).filter(Boolean);
const owner = async (id) => (await q(`select u.discord_id, u.is_placeholder from characters c join users u on u.id=c.owner_id where c.id=$1`, [id]))[0];
const card = async (r) => (await require('../src/handlers/pendingQueue').buildPendingMessage(r)).embeds[0].data.description;

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    await f.pool.query(`UPDATE guilds SET switch_cooldown_days = 0 WHERE guild_id = $1`, [G]);
    const names = [];
    for (const L of 'ABCDEFGHIJKLMNOPRSTW') for (let k = 0; k < 3; k++) names.push(`${L}name ${k}`);
    names.push('The Rock', 'Roman Reigns', 'Seth Rollins'); // 63 open → 3 pages
    for (let k = 0; k < names.length; k += 20) await run('character', 'open', { name: names.slice(k, k + 20).join(', '), division: 'mens' }, ADM);
    const id = async (n) => (await q(`select id from characters where name=$1`, [n]))[0].id;
    const JEY = await f.makeChar(G, 'u1', 'Jey Uso', 'mens');
    const ROMAN = await id('Roman Reigns'), SETH = await id('Seth Rollins'), ROCK = await id('The Rock');

    await t('letter buttons replace ◀ ▶: one tap jumps to that part of the A–Z list', async () => {
        let i = await click('ui:rq:l:mw:mens:0', priv(P('u2')));
        const l = labels(i);
        assert.ok(!l.includes('◀') && !l.includes('▶'), l.join(' | '));
        assert.deepStrictEqual(l.filter((x) => /^[A-Z#](–[A-Z#])?$/.test(x)), ['A–I', 'I–R', 'R–W'], l.join(' | '));
        assert.ok(ids(i).includes('ui:rq:l:mw:mens:2:j'));
        assert.strictEqual(new Set(ids(i)).size, ids(i).length, 'no duplicate ids');
        i = await click('ui:rq:l:mw:mens:2:j', priv(P('u2')));
        const j = JSON.stringify(comps(i));
        assert.ok(j.includes('Seth Rollins') && j.includes('The Rock') && !j.includes('Aname 0'), 'page 3 has R–W ("The Rock" sorts under R)');
        // switch list too
        i = await click(`ui:sw:l:${JEY}:0`, priv(P('u1')));
        assert.ok(labels(i).includes('A–I') && ids(i).includes(`ui:sw:l:${JEY}:1:j`), labels(i).join(' | '));
    });

    await t('3.17.1: the list comes first; the name box only opens from 🔎 Search by name (empty = full list)', async () => {
        let i = await click('ui:rq:h:mens', priv(P('u2')));
        assert.ok(!i.responses.some((r) => r.type === 'modal'));
        assert.match(text(i), /Request a Men's character/);
        assert.ok(labels(i).includes('A–I') && ids(i).includes('ui:rq:s:mens:mens'));
        i = await click('ui:rq:s:mens:mens', priv(P('u2')));
        assert.ok(i.responses.some((r) => r.type === 'modal'));
        i = await click('ui:rqm:mens:mens', priv({ ...P('u2'), fields: { name: '' } }));
        assert.ok(labels(i).includes('A–I'));
        for (const b of ['ui:sw:h:mens', `ui:sw:o:${JEY}`]) {
            i = await click(b, priv(P('u1')));
            assert.ok(!i.responses.some((r) => r.type === 'modal'), b);
            assert.ok(ids(i).includes(`ui:sw:s:${JEY}`) && labels(i).includes('A–I'), b);
        }
    });

    await t('search results are buttons: tap the name', async () => {
        let i = await click('ui:rqm:mens:mens', priv({ ...P('u2'), fields: { name: 'ro' } }));
        assert.ok(ids(i).includes(`ui:rq:b:mens:mens:${ROMAN}`) && ids(i).includes(`ui:rq:b:mens:mens:${ROCK}`) && ids(i).includes(`ui:rq:b:mens:mens:${SETH}`), ids(i).join(' '));
        assert.ok(!comps(i).some((r) => r.components.some((c) => c.type === 3)), 'no dropdown');
        assert.match(text(i), /Tap the one you want/);
        i = await click(`ui:rq:b:mens:mens:${ROMAN}`, priv(P('u2')));
        assert.match(text(i), /Ask staff to give you \*\*Roman Reigns\*\*/);
        i = await click('ui:rqm:mens:mens', priv({ ...P('u2'), fields: { name: 'name' } }));
        assert.match(text(i), /first 15 of 60/);
        assert.ok(comps(i).length <= 5);
        i = await click(`ui:swm:${JEY}`, priv({ ...P('u1'), fields: { name: 'seth' } }));
        assert.ok(ids(i).includes(`ui:sw:tb:${JEY}:${SETH}`), ids(i).join(' '));
    });

    let ADD;
    await t('requesting when you already have one: ➕ add (keep mine) or 🔄 switch, and staff see which', async () => {
        let i = await click(`ui:rq:b:mens:mens:${ROMAN}`, priv(P('u1')));
        assert.match(text(i), /You already have \*\*Jey Uso\*\* \(Men's\)/);
        assert.match(text(i), /➕ Add:\*\* you keep \*\*Jey Uso\*\*/);
        assert.match(text(i), /🔄 Switch:\*\* you give up one character/);
        assert.ok(ids(i).includes(`ui:rq:y:${ROMAN}`) && ids(i).includes(`ui:sw:tb:${JEY}:${ROMAN}`), ids(i).join(' '));
        i = await click(`ui:rq:y:${ROMAN}`, priv(P('u1')));
        assert.match(text(i), /Request sent to \*\*add Roman Reigns\*\* as another character\. You keep \*\*Jey Uso\*\*/);
        ADD = (await q(`select * from pending_requests where request_type='character_claim' and requested_by='u1'`))[0];
        const d = await card(ADD);
        assert.match(d, /ADD ANOTHER CHARACTER\*\* \(not a switch\)/);
        assert.match(d, /They already have: \*\*Jey Uso\*\*/);
        assert.match(d, /adds Roman Reigns to their characters\*\*\. They \*\*keep\*\* \*\*Jey Uso\*\*/);
        await click(`pending_approve_${ADD.id}`, ADM);
        assert.strictEqual((await owner(ROMAN)).discord_id, 'u1');
        assert.strictEqual((await owner(JEY)).discord_id, 'u1', 'kept');
    });

    await t('a switch says so: the player gives the old one up, staff card is marked SWITCH, the old one becomes open', async () => {
        let i = await click(`ui:sw:tb:${JEY}:${SETH}`, priv(P('u1')));
        assert.match(text(i), /This is a switch:\*\* you \*\*give up Jey Uso\*\* and get \*\*Seth Rollins\*\*/);
        assert.ok(ids(i).includes(`ui:sw:y:${JEY}:${SETH}`) && ids(i).includes(`ui:rq:y:${SETH}`), ids(i).join(' '));
        i = await click(`ui:sw:y:${JEY}:${SETH}`, priv(P('u1')));
        assert.match(text(i), /Switch request sent!.*\*\*Jey Uso\*\* becomes open/);
        const r = (await q(`select * from pending_requests where request_type='character_switch' and requested_by='u1'`))[0];
        const d = await card(r);
        assert.match(d, /🔄 \*\*SWITCH\*\* \(they do not keep the old one\)/);
        assert.match(d, /wants to switch from \*\*Jey Uso\*\* to \*\*Seth Rollins\*\*/);
        assert.match(d, /takes Jey Uso away from them/);
        await click(`pending_approve_${r.id}`, ADM);
        assert.strictEqual((await owner(SETH)).discord_id, 'u1');
        assert.strictEqual((await owner(JEY)).is_placeholder, true);
        // a first character is a plain request
        await click(`ui:rq:y:${ROCK}`, priv(P('u5')));
        const first = (await q(`select * from pending_requests where requested_by='u5'`))[0];
        assert.match(await card(first), /wants to take over \*\*The Rock\*\*/);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exitCode = 1;
    await f.pool.end();
    process.exit();
})();
