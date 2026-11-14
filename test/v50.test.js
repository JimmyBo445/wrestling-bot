// 3.9.0: the rest of the commands shrink to one screen (or a couple of typed parts) with buttons.
const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, sent, ids, modalOf, auto, client } = require('./mock');

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
const bad = (i) => /Something went wrong|older version/.test(text(i));
const opts = (name) => (client.commands.get(name).data.toJSON().options || []).map((o) => o.name);
const eph = (i) => i.ephemeral === true || i.responses.some((r) => (Number(r.p?.flags) || 0) & 64);

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const A = await f.makeChar(G, 'u1', 'Ace', 'mens');
    const B = await f.makeChar(G, 'u2', 'Bolt', 'mens');
    const C = await f.makeChar(G, 'u3', 'Cruz', 'mens');
    const WH = (await q(`select id from titles where guild_id=$1 and division='mens' and not is_tag_title order by id limit 1`, [G]))[0].id;

    await t('what Discord lists now', async () => {
        assert.deepStrictEqual(opts('character'), ['submit', 'profile', 'picture', 'assign', 'open', 'overall']);
        assert.deepStrictEqual(opts('stats'), ['wrestler', 'player', 'show_everyone']);
        assert.deepStrictEqual(opts('standings'), ['board', 'show_everyone']);
        assert.deepStrictEqual(opts('legacy'), ['wrestler', 'player', 'show_everyone']);
        assert.deepStrictEqual(opts('directory'), ['page', 'division', 'show_everyone']);
        assert.deepStrictEqual(opts('feud'), ['feud', 'show_everyone']);
        assert.deepStrictEqual(opts('contract'), ['wrestler', 'show_everyone']);
        assert.deepStrictEqual(opts('team'), ['create', 'view']);
        assert.deepStrictEqual(opts('tournament'), ['create', 'view']);
        assert.deepStrictEqual(opts('match'), ['log', 'report']);
        assert.deepStrictEqual(opts('title'), ['manage', 'belt-image']);
        assert.strictEqual(require('../src/registerCommands').loadCommandData().length, 18);
    });

    // ---------------- /stats ----------------
    await t('/stats wrestler: opens the tabs, privately unless show_everyone', async () => {
        let i = await run('stats', null, { wrestler: A }, P('u1'));
        assert.ok(ids(i).includes(`ui:sx:${A}:hi`), ids(i).join(' '));
        assert.ok(eph(i), 'private by default');
        i = await run('stats', null, { wrestler: 'Ace', show_everyone: true }, P('u1'));
        assert.ok(ids(i).includes(`ui:sx:${A}:ov`));
        assert.ok(!eph(i), 'public when asked');
        i = await run('stats', null, {}, P('u1'));
        assert.ok(ids(i).includes('ui:pk:st:0'));
        const ac = await auto('stats', null, 'wrestler', 'ac', {}, P('u1'));
        assert.ok(ac.some((c) => String(c.value) === String(A)));
    });
    await t('/stats player: shows their card with a compare menu', async () => {
        let i = await run('stats', null, { player: 'u1' }, P('u2'));
        assert.ok(!bad(i), text(i));
        assert.ok(ids(i).includes('ui:sv:u1'));
        i = await click('ui:sv:u1', priv({ ...P('u2'), values: ['u2'] }));
        assert.ok(!bad(i) && i.responses.length, text(i));
    });
    await t('/standings board: opens that tab', async () => {
        const i = await run('standings', null, { board: 'lb' }, P('u1'));
        assert.ok(ids(i).includes('ui:sd:ch'), ids(i).join(' '));
        const p = await run('standings', null, {}, P('u1'));
        assert.ok(ids(p).includes('ui:sd:pw:all'));
    });

    // ---------------- /legacy ----------------
    let pollId;
    await t('/legacy: honor roll; staff get Open a vote and Award names', async () => {
        let i = await run('legacy', null, {}, P('u1'));
        assert.ok(!ids(i).includes('ui:lz:vo'));
        i = await run('legacy', null, {}, ADM);
        assert.ok(ids(i).includes('ui:lz:vo') && ids(i).includes('ui:lz:an'));
    });
    await t('award names: add, rename, remove from buttons', async () => {
        let i = await click('ui:lzm:add', priv({ ...ADM, fields: { name: 'Comeback of the Year' } }));
        assert.match(text(i), /Comeback of the Year/);
        const names = await require('../src/utils/legacy').awardNames(G);
        const idx = names.indexOf('Comeback of the Year');
        i = await click(`ui:lzm:ren:${idx}`, priv({ ...ADM, fields: { name: 'Return of the Year' } }));
        assert.match(text(i), /Renamed/);
        const idx2 = (await require('../src/utils/legacy').awardNames(G)).indexOf('Return of the Year');
        i = await click('ui:lz:anx', priv({ ...ADM, values: [String(idx2)] }));
        assert.ok(!(await require('../src/utils/legacy').awardNames(G)).includes('Return of the Year'));
    });
    await t('open a vote, nominate from the post, give and take back an accolade', async () => {
        let i = await click('ui:lz:vk', priv({ ...ADM, values: ['mvp'] }));
        assert.deepStrictEqual(modalOf(i).inputs, ['year', 'nominees', 'voters']);
        const before = sent.length;
        i = await click('ui:lzm:vo:mvp', priv({ ...ADM, fields: { year: '2026', nominees: 'everyone', voters: 'everyone' } }));
        assert.match(text(i), /Opened/, text(i));
        pollId = (await q(`select id, nominate_who from award_polls order by id desc limit 1`))[0];
        assert.strictEqual(pollId.nominate_who, 'everyone');
        const post = sent.slice(before).find((m) => JSON.stringify(m.payload.components?.map((r) => r.toJSON())).includes(`ui:pg:nom:${pollId.id}`));
        assert.ok(post, 'vote post has the nominate button');
        i = await click(`ui:pk:nom:${pollId.id}`, priv({ ...P('u3'), values: [String(C)] }));
        assert.ok(ids(i).includes(`ui:nm:y:${pollId.id}:${C}`));
        i = await click(`ui:nm:y:${pollId.id}:${C}`, priv(P('u3')));
        assert.match(text(i), /nominated/);
        i = await click(`ui:pk:nom2:${pollId.id}.${A}`, priv({ ...P('u1'), values: [String(B)] }));
        assert.match(text(i), /nominated/);
        assert.strictEqual((await q(`select count(*)::int n from award_nominees where poll_id=$1`, [pollId.id]))[0].n, 2);
        await run('legacy', 'award', { accolade: 'mitb', character: A, year: 2025, announce: false }, ADM);
        i = await run('legacy', null, { wrestler: A }, ADM);
        assert.ok(ids(i).includes(`ui:lz:rm:${A}`));
        const acc = (await q(`select id from legacy where character_id=$1`, [A]))[0].id;
        i = await click(`ui:lz:rm:${A}`, priv({ ...ADM, values: [String(acc)] }));
        assert.strictEqual((await q(`select count(*)::int n from legacy where character_id=$1`, [A]))[0].n, 0);
        const p = await click(`ui:lz:rm:${A}`, priv({ ...P('u1'), values: [String(acc)] }));
        assert.match(text(p), /Only admins|staff/i);
    });

    // ---------------- /directory ----------------
    await t('/directory: roster list with roster cards / Hall of Fame / injuries buttons', async () => {
        let i = await run('directory', null, {}, P('u1'));
        for (const x of ['ui:dr:p', 'ui:hi:h', 'ui:hi:i']) assert.ok(ids(i).includes(x), x);
        i = await click('ui:dr:mens', priv(P('u1')));
        assert.ok(i.responses.length && !bad(i), text(i));
        i = await run('directory', null, { page: 'hof' }, ADM);
        assert.ok(ids(i).includes('ui:pg:hof:0:all:0'));
        await run('directory', 'hof-induct', { character: B }, ADM);
        i = await click('ui:hi:h', priv(ADM));
        assert.ok(ids(i).includes('ui:hi:hx'));
        i = await click('ui:hi:hx', priv({ ...ADM, values: [String(B)] }));
        assert.strictEqual((await q(`select count(*)::int n from hall_of_fame`))[0].n, 0);
        i = await run('directory', null, { page: 'injuries' }, P('u1'));
        assert.ok(!bad(i));
    });

    // ---------------- /feud, /contract, /team, /tournament ----------------
    await t('/feud and /contract open their screens; staff set contract bonuses with a form', async () => {
        let i = await run('feud', null, {}, ADM);
        assert.ok(ids(i).includes('ui:pg:fd1:0:all:0'));
        await run('feud', 'start', { wrestler1: A, wrestler2: B }, ADM);
        const fid = (await q(`select id from feuds`))[0].id;
        i = await run('feud', null, { feud: fid }, P('u1'));
        assert.ok(!bad(i) && ids(i).includes('ui:fd:l'), text(i));
        i = await run('contract', null, {}, ADM);
        assert.ok(ids(i).includes('ui:kb'));
        i = await click('ui:kbm', priv({ ...ADM, fields: { win: '500', title_win: '2000' } }));
        const bo = (await q(`select contract_win_bonus w, contract_title_bonus t from guilds where guild_id=$1`, [G]))[0]; assert.deepStrictEqual([Number(bo.w), Number(bo.t)], [500, 2000]);
        i = await run('contract', null, { wrestler: A }, P('u1'));
        assert.ok(!bad(i), text(i));
    });
    await t('/team view and /tournament view', async () => {
        await run('team', 'create', { kind: 'tag', name: 'Wolves', member1: A, member2: B }, ADM);
        let i = await run('team', 'view', {}, P('u1'));
        assert.ok(ids(i).includes('ui:tf:o:t'));
        const tid = (await q(`select id from teams`))[0].id;
        i = await run('team', 'view', { group: `t:${tid}` }, ADM);
        assert.ok(ids(i).includes(`ui:tf:rm:t:${tid}`));
        i = await run('team', 'view', { group: 'Wolves' }, P('u1'));
        assert.ok(!bad(i) && !ids(i).includes(`ui:tf:rm:t:${tid}`));
        await run('tournament', 'create', { name: 'King of the Ring', division: 'mens' }, ADM);
        i = await run('tournament', 'view', {}, P('u1'));
        assert.ok(ids(i).includes('ui:tn:o'));
        const tn = (await q(`select id from tournaments`))[0].id;
        i = await run('tournament', 'view', { tournament: tn }, ADM);
        assert.ok(ids(i).some((x) => x.startsWith(`ui:pg:tn+:${tn}`)));
    });

    // ---------------- Results: PLEs ----------------
    await t('Results screen: 🎆 PLEs for everyone, staff tag a PLE with a form', async () => {
        await run('match', 'log', { type: 'singles', wrestler1: A, wrestler2: C, winner: 1 }, ADM);
        let i = await click('ui:h:results', priv(P('u1')));
        assert.ok(ids(i).includes('ui:pl:h') && !ids(i).includes('ui:pl:q'));
        i = await click('ui:h:results', priv(ADM));
        assert.ok(ids(i).includes('ui:pl:q'));
        i = await click('ui:plm', priv({ ...ADM, fields: { event: 'WrestleMania', date: '' } }));
        assert.ok(!/⚠️/.test(text(i)), text(i));
        assert.strictEqual((await q(`select count(*)::int n from matches where ple is not null`))[0].n, 1);
        i = await click('ui:pl:h', priv(P('u1')));
        assert.match(text(i), /WrestleMania/);
    });

    // ---------------- /title manage ----------------
    let reign;
    await t('/title manage: pick a belt; add an old reign with a form', async () => {
        let i = await run('title', 'manage', {}, ADM);
        assert.ok(ids(i).includes('ui:tt:o'));
        i = await run('title', 'manage', { title: WH }, ADM);
        for (const x of [`chmp:log:${WH}`, `ui:tt:in:${WH}`, `ui:tt:un:${WH}`, `ui:tt:ra:${WH}`]) assert.ok(ids(i).includes(x), x);
        const p = await run('title', 'manage', { title: WH }, P('u1'));
        assert.match(text(p), /Only admins|staff/i);
        i = await click(`ui:tt:ra:${WH}`, priv(ADM));
        assert.deepStrictEqual(modalOf(i).inputs, ['champion', 'won', 'lost', 'defenses', 'notes']);
        i = await click(`ui:ttm:ra:${WH}`, priv({ ...ADM, fields: { champion: 'Old Legend', won: '2020-01-01', lost: '2020-06-01', defenses: '3', notes: '' } }));
        assert.match(text(i), /Old Legend/, text(i));
        i = await click(`ui:ttm:ra:${WH}`, priv({ ...ADM, fields: { champion: 'Bolt', won: '2021-01-01', lost: '2021-02-01', defenses: '0' } }));
        reign = (await q(`select * from title_reigns where title_id=$1 and character_id=$2`, [WH, B]))[0];
        assert.ok(reign, 'a typed wrestler name links the wrestler');
        i = await click(`ui:ttm:ra:${WH}`, priv({ ...ADM, fields: { champion: 'X', won: '2020-03-01', defenses: '0' } }));
        assert.match(text(i), /⚠️/, 'overlapping reign refused');
    });
    await t('fix a reign: dates, champion, defenses, delete', async () => {
        let i = await click(`ui:tt:rg:${WH}`, priv({ ...ADM, values: [String(reign.id)] }));
        for (const x of [`ui:tt:re:${reign.id}`, `ui:tt:rc:${reign.id}`, `ui:tt:da:${reign.id}`, `ui:tt:rx:${reign.id}`]) assert.ok(ids(i).includes(x), x);
        i = await click(`ui:tt:re:${reign.id}`, priv(ADM));
        assert.deepStrictEqual(modalOf(i).inputs, ['won', 'lost', 'defenses', 'notes', 'interim']);
        i = await click(`ui:ttm:re:${reign.id}`, priv({ ...ADM, fields: { won: '2021-01-05', lost: '2021-03-01', defenses: '2', notes: 'Fixed by hand', interim: 'no' } }));
        let r = (await q(`select * from title_reigns where id=$1`, [reign.id]))[0];
        assert.strictEqual(r.defenses, 2); assert.strictEqual(r.notes, 'Fixed by hand');
        i = await click(`ui:ttm:rc:${reign.id}`, priv({ ...ADM, fields: { champion: 'Cruz' } }));
        r = (await q(`select * from title_reigns where id=$1`, [reign.id]))[0];
        assert.strictEqual(String(r.character_id), String(C));
        i = await click(`ui:ttm:da:${reign.id}`, priv({ ...ADM, fields: { opponent: 'Ace', date: '2021-02-01', notes: '' } }));
        const d = (await q(`select id from reign_defenses where reign_id=$1`, [reign.id]))[0];
        assert.ok(d);
        i = await click(`ui:tt:dx:${reign.id}`, priv({ ...ADM, values: [String(d.id)] }));
        assert.strictEqual((await q(`select count(*)::int n from reign_defenses where reign_id=$1`, [reign.id]))[0].n, 0);
        i = await click(`ui:tt:rx:${reign.id}`, priv(ADM));
        assert.ok(ids(i).includes(`ui:tt:rxy:${reign.id}`));
        i = await click(`ui:tt:rxy:${reign.id}`, priv(ADM));
        assert.strictEqual((await q(`select count(*)::int n from title_reigns where id=$1`, [reign.id]))[0].n, 0);
    });
    await t('interim champion from the wrestler picker, then unify', async () => {
        let i = await click(`ui:tt:in:${WH}`, priv(ADM));
        assert.ok(ids(i).includes(`ui:pk:tin:${WH}`), ids(i).join(' '));
        i = await click(`ui:pk:tin:${WH}`, priv({ ...ADM, values: [String(A)] }));
        assert.match(text(i), /interim champion/);
        i = await click(`ui:pk:tun:${WH}`, priv({ ...ADM, values: [String(A)] }));
        assert.match(text(i), /undisputed/);
        i = await click('ui:tt:rw:0', priv(ADM));
        assert.ok(!bad(i));
        i = await click('ui:tt:w', priv(ADM));
        assert.ok(!bad(i), text(i));
    });

    await t('old subcommands still work inside the bot', async () => {
        let i = await run('stats', 'character', { character: A }, P('u1'));
        assert.ok(!bad(i) && i.responses.length);
        i = await run('character', 'retire', { character: C }, ADM);
        assert.strictEqual((await q(`select status from characters where id=$1`, [C]))[0].status, 'retired');
        i = await run('standings', 'power', {}, P('u1'));
        assert.ok(!bad(i));
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end(); process.exit(failed ? 1 : 0);
})();
