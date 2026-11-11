// 3.7.0: players report their card match results; staff approve / fix / deny in the staff room.
const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, sent, ids, modalOf, dms, auto, edited } = require('./mock');

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
const allText = (i) => i.responses.map((r) => [r.p?.content, ...(r.p?.embeds || []).map((e) => JSON.stringify(e.toJSON ? e.toJSON() : e))].join('\n')).join('\n');
const svc = require('../src/utils/cardService');
const staffPosts = (b) => sent.slice(b).filter((m) => m.channelId === 'staffch');

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    await f.pool.query(`UPDATE guilds SET admin_channel_id = 'staffch', matches_channel_id = 'resch' WHERE guild_id = $1`, [G]);
    const A = await f.makeChar(G, 'u1', 'Ace', 'mens');
    const B = await f.makeChar(G, 'u2', 'Bolt', 'mens');
    const C = await f.makeChar(G, 'u3', 'Cruz', 'mens');
    const D = await f.makeChar(G, 'u4', 'Dax', 'mens');
    const E = await f.makeChar(G, 'u5', 'Eli', 'mens');
    const F = await f.makeChar(G, 'u6', 'Fin', 'mens');
    await svc.addMatchToCard(G, 'smackdown', { matchType: 'singles', characterIds: [A, B] });
    await svc.addMatchToCard(G, 'smackdown', { matchType: 'tag2v2', characterIds: [C, D, E, F] });
    const draft = (await q(`select id from card_drafts`))[0].id;

    await t('/match is visible to players for report; every other /match subcommand stays staff-only', async () => {
        const json = require('../src/commands/match').data.toJSON();
        assert.strictEqual(json.default_member_permissions ?? null, null);
        for (const o of json.options.filter((x) => x.name !== 'report')) assert.match(o.description, /^\[Admin\]/, o.name);
        const i = await run('match', 'log', { type: 'singles', wrestler1: C, wrestler2: D, winner: 1 }, P('u3'));
        assert.match(allText(i), /Only admins/);
    });

    await t('My Wrestlers shows 📝 Report a result with how many matches can be reported', async () => {
        const i = await click('ui:h:mine', priv(P('u1')));
        assert.ok(ids(i).includes('ui:rp:h'));
        assert.match(JSON.stringify(i.responses.at(-1).p.components.map((r) => r.toJSON())), /Report a result \(1\)/);
    });

    let r1;
    await t('buttons: pick match → who won → optional form → posted in the staff room', async () => {
        let i = await click('ui:rp:h', priv(P('u1')));
        assert.match(allText(i), /1 of your card match still needs a result/);
        i = await click('ui:rp:m', priv({ ...P('u1'), values: [`${draft}:1`] }));
        assert.ok(ids(i).includes(`ui:rp:w:${draft}:1:1`) && ids(i).includes(`ui:rp:w:${draft}:1:d`));
        i = await click(`ui:rp:w:${draft}:1:1`, priv(P('u1')));
        assert.deepStrictEqual(modalOf(i).inputs, ['finish', 'score', 'notes']);
        assert.ok(modalOf(i).json.components.every((r) => !r.components[0].required), 'all optional');
        const b = sent.length;
        i = await click(`ui:rpm:${draft}:1:1`, priv({ ...P('u1'), fields: { finish: 'pin', score: '', notes: 'great match' } }));
        assert.match(allText(i), /Sent! \*\*Ace won\*\*/);
        const post = staffPosts(b)[0];
        assert.ok(post, 'staff room post');
        const d = JSON.stringify(post.payload.embeds[0].toJSON());
        assert.match(d, /Ace won/); assert.match(d, /Pinfall/); assert.match(d, /great match/); assert.match(d, /<@u1>/);
        assert.deepStrictEqual(post.payload.components[0].toJSON().components.map((c) => c.custom_id.split(':').slice(0, 3).join(':')), ['ui:rr:ok', 'ui:rr:fix', 'ui:rr:no']);
        r1 = (await q(`select * from match_reports`))[0];
        assert.strictEqual(r1.finish, 'pinfall');
        assert.strictEqual((await q(`select count(*)::int n from matches`))[0].n, 0, 'nothing recorded yet');
    });

    await t('only players in the match can report it', async () => {
        let i = await click(`ui:rp:w:${draft}:1:1`, priv(P('u3')));
        assert.match(allText(i), /only report matches your own wrestlers are in/);
        i = await click(`ui:rpm:${draft}:1:2`, priv({ ...P('u3'), fields: {} }));
        assert.match(allText(i), /only report matches your own wrestlers are in/);
    });

    await t('/match report: autocomplete shows only my matches and their outcomes; screenshot attached', async () => {
        let c = await auto('match', 'report', 'match', '', {}, P('u2'));
        assert.strictEqual(c.length, 1);
        c = await auto('match', 'report', 'winner', '', { match: `${draft}:1` }, P('u2'));
        assert.deepStrictEqual(c.map((x) => x.value), ['1', '2', 'd', 'n']);
        c = await auto('match', 'report', 'match', '', {}, P('u9'));
        assert.strictEqual(c.length, 0);
        const b = sent.length;
        const i = await run('match', 'report', { match: `${draft}:1`, winner: '2', finish: 'dq', screenshot: { url: 'https://cdn.example/x.png', name: 'x.png', contentType: 'image/png' } }, P('u2'));
        assert.match(allText(i), /Sent! \*\*Bolt won\*\*/);
        assert.match(allText(i), /Someone else in this match reported a different result/);
        const post = staffPosts(b)[0];
        const d = JSON.stringify(post.payload.embeds[0].toJSON());
        assert.match(d, /Different reports for this match/);
        assert.match(d, /x\.png/, 'screenshot shown to staff');
        const bad = await run('match', 'report', { match: `${draft}:1`, winner: '1', screenshot: { url: 'https://x/y.pdf', name: 'y.pdf', contentType: 'application/pdf' } }, P('u2'));
        assert.match(allText(bad), /has to be a picture/);
    });

    await t('reporting again replaces your own report (no duplicates)', async () => {
        await click(`ui:rpm:${draft}:1:1`, priv({ ...P('u1'), fields: { finish: 'submission' } }));
        const rows = await q(`select reporter, finish from match_reports where status='pending' order by id`);
        assert.deepStrictEqual(rows.map((r) => r.reporter), ['u1', 'u2']);
        assert.strictEqual(rows[0].finish, 'submission');
    });

    await t('players can\'t approve; staff approve → recorded like card view, the other report closes, DMs', async () => {
        let i = await click(`ui:rr:ok:${r1.id}`, P('u3'));
        assert.match(allText(i), /Only admins/);
        const b = sent.length;
        i = await click(`ui:rr:ok:${r1.id}`, { ...ADM, message: { id: 'staffpost', embeds: [], components: [] } });
        assert.match(allText(i), /Recorded as match #\d+/);
        const m = (await q(`select m.id, m.finish, m.notes, c.name from matches m join match_participants mp on mp.match_id=m.id and mp.is_winner join characters c on c.id=mp.character_id`))[0];
        assert.deepStrictEqual([m.name, m.finish, m.notes], ['Ace', 'submission', null], 'the newer report replaced the first one completely');
        assert.ok(sent.slice(b).some((x) => x.channelId === 'resch'), 'result picture posted in the results channel');
        assert.ok((await q(`select match_id from card_draft_matches where position=1 and draft_id=$1`, [draft]))[0].match_id, 'card slot is linked');
        const st = await q(`select reporter, status from match_reports order by id`);
        assert.deepStrictEqual(st.map((r) => r.status), ['approved', 'closed']);
        assert.ok(dms.some((d) => d.id === 'u1' && /approved/.test(d.content)));
        assert.ok(dms.some((d) => d.id === 'u2' && /another player's report/.test(d.content)));
        i = await click(`ui:rr:ok:${r1.id}`, { ...ADM, message: { id: 'staffpost', embeds: [], components: [] } });
        assert.match(allText(i), /already/);
        assert.strictEqual((await q(`select count(*)::int n from matches`))[0].n, 1, 'never recorded twice');
        void edited;
    });

    await t('fix & approve: staff change the winner and finish, then approve (tag match)', async () => {
        await click(`ui:rpm:${draft}:2:1`, priv({ ...P('u3'), fields: {} }));
        const r = (await q(`select * from match_reports where status='pending'`))[0];
        let i = await click(`ui:rr:fix:${r.id}`, ADM);
        assert.ok(ids(i).includes(`ui:rr:fw:${r.id}:2`) && ids(i).includes(`ui:rr:ff:${r.id}`));
        i = await click(`ui:rr:fw:${r.id}:2`, priv(ADM));
        assert.match(allText(i), /Result changed/);
        i = await click(`ui:rr:ff:${r.id}`, priv({ ...ADM, values: ['countout'] }));
        i = await click(`ui:rrm:${r.id}`, priv({ ...ADM, fields: { score: '2-1', notes: 'fixed by staff' } }));
        assert.match(allText(i), /Score and notes changed/);
        i = await click(`ui:rr:fa:${r.id}`, priv(ADM));
        assert.match(allText(i), /Recorded as match/);
        const m = (await q(`select m.finish, m.score, m.notes from matches m order by id desc limit 1`))[0];
        assert.deepStrictEqual(m, { finish: 'countout', score: '2-1', notes: 'fixed by staff' });
        const w = await q(`select c.name from match_participants mp join characters c on c.id=mp.character_id join matches m on m.id=mp.match_id where mp.is_winner order by m.id desc, c.name limit 2`);
        assert.deepStrictEqual(w.map((x) => x.name).sort(), ['Eli', 'Fin']);
    });

    await t('deny with a reason: player gets a DM; nothing recorded', async () => {
        await svc.addMatchToCard(G, 'raw', { matchType: 'singles', characterIds: [C, D] });
        const d2 = (await q(`select id from card_drafts where brand='raw'`))[0].id;
        await click(`ui:rpm:${d2}:1:1`, priv({ ...P('u4'), fields: {} }));
        const r = (await q(`select * from match_reports where status='pending'`))[0];
        let i = await click(`ui:rr:no:${r.id}`, ADM);
        assert.strictEqual(modalOf(i).id, `ui:rrd:${r.id}`);
        i = await click(`ui:rrd:${r.id}`, priv({ ...ADM, fields: { reason: 'No proof' } }));
        assert.match(allText(i), /Denied report/);
        assert.strictEqual((await q(`select status, deny_reason from match_reports where id=$1`, [r.id]))[0].deny_reason, 'No proof');
        assert.ok(dms.some((x) => x.id === 'u4' && /denied.*No proof/s.test(x.content)));
        const n = (await q(`select count(*)::int n from match_participants mp where mp.character_id=$1`, [C]))[0].n;
        assert.strictEqual(n, 1, 'only the earlier tag match');
    });

    await t('Staff Tools shows the count and a list to open reports', async () => {
        const d2 = (await q(`select id from card_drafts where brand='raw'`))[0].id;
        await click(`ui:rpm:${d2}:1:2`, priv({ ...P('u4'), fields: {} }));
        let i = await click('ui:h:staff', priv(ADM));
        assert.match(JSON.stringify(i.responses.at(-1).p.components.map((r) => r.toJSON())), /Reported results \(1\)/);
        i = await click('ui:rr:list', priv(ADM));
        assert.match(allText(i), /Reported results \(1\)/);
        const id = (await q(`select id from match_reports where status='pending'`))[0].id;
        i = await click('ui:rr:pick', priv({ ...ADM, values: [String(id)] }));
        assert.ok(ids(i).includes(`ui:rr:ok:${id}`));
        i = await click('ui:rr:list', priv(P('u4')));
        assert.match(allText(i), /Only admins/);
    });

    await t('a match taken off the card can\'t be approved (and the report stays to deny)', async () => {
        const id = (await q(`select id from match_reports where status='pending'`))[0].id;
        await svc.clearCard(G, 'raw');
        const i = await click(`ui:rr:ok:${id}`, { ...ADM, message: { id: 'p2', embeds: [], components: [] } });
        assert.match(allText(i), /isn't on the card anymore/);
        assert.strictEqual((await q(`select status from match_reports where id=$1`, [id]))[0].status, 'pending');
    });

    await t('finish words are understood', async () => {
        const { parseFinish } = require('../src/modules/reports');
        assert.deepStrictEqual(['pin', 'Submission', 'DQ', 'count out', 'KO', 'forfeit', 'banana', ''].map(parseFinish), ['pinfall', 'submission', 'dq', 'countout', 'knockout', 'forfeit', null, null]);
        void text;
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end();
    process.exit(failed ? 1 : 0);
})();
