// 3.12.0: Men's/Women's characters are requested (open ones), custom ones are made; /character open adds open characters.
process.env.ROSTER_DEBOUNCE_MS = '30';
const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, sent, ids } = require('./mock');

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
const btns = (m) => (m.payload.components || []).flatMap((r) => r.toJSON().components.map((c) => c.custom_id));

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    await f.makeChar(G, 'u1', 'Jey Uso', 'mens');

    await t('/character open adds open characters (one with overall, or many at once)', async () => {
        assert.ok(require('./mock').client.commands.get('character').data.toJSON().options.map((o) => o.name).includes('open'));
        let i = await run('character', 'open', { name: 'Roman Reigns', division: 'mens', overall: 95 }, ADM);
        assert.match(text(i), /Added \*\*1\*\* open Men's character/, text(i));
        i = await run('character', 'open', { name: 'CM Punk, Seth Rollins ,  Jey Uso, CM Punk', division: 'mens' }, ADM);
        assert.match(text(i), /Added \*\*2\*\*/); assert.match(text(i), /Skipped.*Jey Uso/);
        i = await run('character', 'open', { name: 'Rhea Ripley', division: 'womens' }, ADM);
        const rows = await q(`select c.name, c.overall, c.status, u.is_placeholder from characters c join users u on u.id=c.owner_id where u.is_placeholder order by c.name`);
        assert.deepStrictEqual(rows.map((r) => r.name), ['CM Punk', 'Rhea Ripley', 'Roman Reigns', 'Seth Rollins']);
        assert.ok(rows.every((r) => r.status === 'approved'));
        assert.strictEqual(rows.find((r) => r.name === 'Roman Reigns').overall, 95);
        const p = await run('character', 'open', { name: 'Sneaky', division: 'mens' }, P('u1'));
        assert.match(text(p), /Only admins|staff/i);
    });

    await t('Make a wrestler only offers the custom divisions; Men\'s/Women\'s are refused', async () => {
        let i = await click('ui:mk:h', priv(P('u2')));
        assert.deepStrictEqual(ids(i).filter((x) => x.startsWith('ui:mk:d:')), ['ui:mk:d:custom', 'ui:mk:d:custom_womens']);
        assert.ok(ids(i).includes('ui:rq:h:mw'));
        i = await click('ui:mk:d:mens', priv(P('u2')));
        assert.match(text(i), /can't be made, only requested/);
        i = await click('ui:mkm:womens', priv({ ...P('u2'), fields: { name: 'Fake Lady' } }));
        assert.match(text(i), /can't be made/);
        assert.strictEqual((await q(`select count(*)::int n from characters where name='Fake Lady'`))[0].n, 0);
    });

    let reqId;
    await t('🙋 Request a character: pick an open one → staff card → approve → it\'s theirs', async () => {
        let i = await click('ui:rq:h:mw', priv(P('u2')));
        assert.ok(ids(i).includes('ui:rq:l:mw:womens'));
        assert.match(text(i), /Request a Men's character/);
        const roman = (await q(`select id from characters where name='Roman Reigns'`))[0].id;
        i = await click('ui:rq:p:mw', priv({ ...P('u2'), values: [String(roman)] }));
        assert.ok(ids(i).includes(`ui:rq:y:${roman}`));
        i = await click(`ui:rq:y:${roman}`, priv(P('u2')));
        assert.match(text(i), /Request sent/);
        i = await click(`ui:rq:y:${roman}`, priv(P('u2')));
        assert.match(text(i), /already asked/);
        const r = (await q(`select * from pending_requests where request_type='character_claim' and requested_by='u2'`))[0];
        assert.ok(r); reqId = r.id;
        i = await click('ui:mr:h', priv(P('u2')));
        assert.match(text(i), /Roman Reigns\*\*: claim · ⏳ waiting/);
        i = await click(`pending_approve_${r.id}`, ADM);
        const c = (await q(`select u.discord_id, u.is_placeholder from characters c join users u on u.id=c.owner_id where c.id=$1`, [roman]))[0];
        assert.deepStrictEqual([c.discord_id, c.is_placeholder], ['u2', false]);
        i = await click(`ui:rq:p:mw`, priv({ ...P('u3'), values: [String(roman)] }));
        assert.match(text(i), /isn't open anymore/);
        i = await click('ui:rq:l:mw:womens', priv(P('u3')));
        assert.match(text(i), /Women's/); assert.ok(JSON.stringify(i.responses.at(-1).p.components.map((x) => x.toJSON())).includes('Rhea Ripley'));
        i = await click('ui:rq:h:womens', priv(P('u3')));
        assert.ok(!ids(i).includes('ui:rq:l:womens:mens'), 'a Women\'s roster channel only offers Women\'s');
    });

    await t('roster channels: Men\'s/Women\'s get Request, custom gets Make', async () => {
        await click('ui:ch:s:roster_mens', priv({ ...ADM, kind: 'channel', values: ['mensch'] }));
        await click('ui:ch:s:roster_custom', priv({ ...ADM, kind: 'channel', values: ['customch'] }));
        const last = (ch) => sent.filter((m) => m.channelId === ch).at(-1);
        assert.deepStrictEqual(btns(last('mensch')), ['ui:rq:h:mens:rb', 'ui:mr:h:rb', 'ui:h:roster:rb']);
        assert.deepStrictEqual(btns(last('customch')), ['ui:mk:h:rb', 'ui:mr:h:rb', 'ui:h:roster:rb']);
        assert.match(last('mensch').payload.content, /Want a Men's character/);
        assert.ok(!/Make a custom/.test(last('mensch').payload.content));
        const before = sent.length;
        await run('character', 'open', { name: 'Drew McIntyre', division: 'mens' }, ADM);
        await wait(250);
        const ed = require('./mock').edited.filter((e) => /Drew McIntyre\*\* : _open_/.test(e.p.content || ''));
        assert.ok(ed.length >= 1, 'roster updated with the new open character');
        assert.strictEqual(sent.length, before);
    });

    await t('menu post and signup flow follow the same rule', async () => {
        const mp = require('../src/utils/menuPost').payload('FNLW');
        const b = mp.components.flatMap((r) => r.toJSON().components.map((c) => c.custom_id));
        assert.ok(b.includes('ui:rq:h:mw:mp') && b.includes('ui:mk:h:mp'));
        await run('booking', 'signup-open', { title: 'RAW' }, ADM);
        const s = (await q(`select id from signups order by id desc limit 1`))[0].id;
        let i = await click(`signup:new:${s}`, priv(P('u4')));
        assert.deepStrictEqual(ids(i).filter((x) => x.startsWith('signup:newdiv')), [`signup:newdiv:${s}:custom`, `signup:newdiv:${s}:custom_womens`]);
        i = await click(`signup:newdiv:${s}:mens`, priv(P('u4')));
        assert.match(text(i), /can't be made, only claimed/);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end(); process.exit(failed ? 1 : 0);
})();
