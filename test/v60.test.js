// 3.19.0: ⚡ Auto-build switches: rematches on/off (21 days), other match types (up to 1/3), pair by records.
const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, ids } = require('./mock');
const { logMatch } = require('../src/utils/matchService');
const svc = require('../src/utils/cardService');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 7).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const G = 'g1';
const q = async (sql, a) => (await f.pool.query(sql, a)).rows;
const priv = (o) => ({ ...o, private: true });
const pk = (a, b) => [String(a), String(b)].sort().join(':');

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const W = [];
    for (let k = 0; k < 12; k++) W.push(String(await f.makeChar(G, `p${k}`, `W${String(k).padStart(2, '0')}`, 'mens')));
    // recent history: W0-W1, W2-W3, W4-W5 met; W0..W3 have strong records, W8..W11 weak
    const log = (a, b, win = 0) => logMatch({ guildId: G, matchType: 'singles', slotCharacterIds: [a, b], winnerIndex: win, actor: 'adm' });
    await log(W[0], W[1]); await log(W[2], W[3]); await log(W[4], W[5]);
    for (const [a, b] of [[W[0], W[8]], [W[1], W[9]], [W[2], W[10]], [W[3], W[11]], [W[0], W[9]], [W[1], W[8]]]) await log(a, b, 0);
    const meetsRecent = async () => new Set((await q(`select distinct a.character_id a, b.character_id b from match_participants a join match_participants b on b.match_id=a.match_id and a.character_id<b.character_id`)).map((r) => pk(r.a, r.b)));

    await t('saved defaults: rematches on, other match types off, pair by records on', async () => {
        assert.deepStrictEqual(await svc.autoSettings(G), { rematches: true, matchTypes: false, records: true });
    });

    await t('rematches OFF: nobody faces someone they met in the last 21 days, no Rematch/Rivalry', async () => {
        const met = await meetsRecent();
        for (let k = 0; k < 15; k++) {
            const plan = await svc.planCard(G, 'mens', 6, { rematches: false, records: true });
            for (const m of plan) {
                assert.ok(!['Rematch', 'Rivalry'].includes(m.stipulation));
                const c = m.character_ids;
                for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) assert.ok(!met.has(pk(c[i], c[j])), `repeat ${c}`);
            }
        }
        // a match older than 21 days doesn't count
        await f.pool.query(`update matches set created_at = now() - interval '25 days'`);
        const plan = await svc.planCard(G, 'mens', 6, { rematches: false });
        assert.strictEqual(plan.length, 6);
        await f.pool.query(`update matches set created_at = now() - interval '1 day'`);
        // with rematches on, recent matches are run back
        const on = await svc.planCard(G, 'mens', 6, { rematches: true });
        assert.ok(on.some((m) => ['Rematch', 'Rivalry'].includes(m.stipulation)));
    });

    await t('pair by records: strong records face strong ones', async () => {
        let close = 0;
        for (let k = 0; k < 10; k++) {
            const plan = await svc.planCard(G, 'mens', 6, { rematches: false, records: true });
            for (const m of plan.filter((x) => x.match_type === 'singles')) {
                const strong = m.character_ids.map((id) => W.indexOf(id) <= 3);
                const weak = m.character_ids.map((id) => W.indexOf(id) >= 8);
                if (!(strong.includes(true) && weak.includes(true))) close++; else close -= 3;
            }
        }
        assert.ok(close > 0, `strong vs weak happened too often (${close})`);
    });

    await t('other match types: up to a third of the card; tag teams only from real teams', async () => {
        const team = async (name, a, b) => { await run('team', 'create', { name, division: 'mens', member1: a, member2: b }, ADM); };
        await team('Alpha', W[6], W[7]); await team('Beta', W[10], W[11]);
        const seen = new Set();
        for (let k = 0; k < 20; k++) {
            const plan = await svc.planCard(G, 'mens', 6, { matchTypes: true, rematches: true });
            const multi = plan.filter((m) => m.match_type !== 'singles' && !m.title_id && !['Rematch', 'Rivalry'].includes(m.stipulation));
            assert.ok(multi.length <= 2, `at most 6/3 = 2, got ${multi.length}`);
            for (const m of multi) {
                seen.add(m.match_type);
                if (m.match_type === 'tag2v2') assert.deepStrictEqual([...m.character_ids].sort(), [W[6], W[7], W[10], W[11]].sort());
                if (m.match_type === 'triple_threat') assert.strictEqual(m.character_ids.length, 3);
                if (m.match_type === 'fatal4way') assert.strictEqual(m.character_ids.length, 4);
            }
        }
        for (const x of ['tag2v2', 'triple_threat', 'fatal4way']) assert.ok(seen.has(x), `never booked ${x}: ${[...seen]}`);
        const off = await svc.planCard(G, 'mens', 6, { matchTypes: false, rematches: false });
        assert.ok(off.every((m) => m.match_type === 'singles'));
        const two = await svc.planCard(G, 'mens', 2, { matchTypes: true, rematches: false });
        assert.ok(two.every((m) => m.match_type === 'singles'), '2 matches → a third rounds down to 0');
    });

    await t('the ⚡ Auto-build screen: switches, count, build, save as default', async () => {
        let i = await click('ui:ct:au:raw', priv(ADM));
        assert.ok(ids(i).includes('ui:ct:ab:raw:3:1011'), ids(i).join(' '));
        i = await click('ui:ct:ap:raw:3:1011:r', priv(ADM));
        assert.ok(ids(i).includes('ui:ct:ab:raw:3:0011'));
        assert.match(JSON.stringify(i.responses.at(-1).p.embeds[0]), /last 21 days/);
        i = await click('ui:ct:apn:raw:3:0011', priv({ ...ADM, values: ['4'] }));
        assert.ok(ids(i).includes('ui:ct:ab:raw:4:0011'));
        i = await click('ui:ct:ab:raw:4:0010', priv(ADM));
        assert.match(text(i), /Booked the \*\*RAW\*\* card/, text(i));
        assert.match(text(i), /Rematches \*\*off \(no one faces someone they met in the last 21 days\)\*\*/);
        assert.strictEqual((await q(`select count(*)::int n from card_draft_matches m join card_drafts d on d.id=m.draft_id where d.brand='raw' and d.division='mens'`))[0].n, 4);
        assert.deepStrictEqual(await svc.autoSettings(G), { rematches: true, matchTypes: false, records: true }, 'one build does not change the defaults');
        await click('ui:ct:as:raw:3:0101', priv(ADM));
        assert.deepStrictEqual(await svc.autoSettings(G), { rematches: false, matchTypes: true, records: false });
        i = await click('ui:ct:abn:raw:3:0101', priv(ADM));
        assert.ok(i.responses.some((r) => r.type === 'modal'));
        i = await click('ui:ctm:ab:raw:3:0101', priv({ ...ADM, fields: { name: 'Big Night' } }));
        assert.strictEqual((await q(`select name from card_shows where brand='raw'`))[0].name, 'Big Night');
        // /card auto with no switches uses the saved ones
        i = await run('card', 'auto', { brand: 'raw', matches: 3, use_signup: false }, ADM);
        assert.match(text(i), /Rematches \*\*off.*Other match types \*\*on\*\* · Pair by records \*\*off\*\*/);
    });

    await t('3.19.2: a separate private message lists who was left off the card, and why', async () => {
        let i = await click('ui:ct:ab:raw:2:0010', priv(ADM));
        const fu = i.responses.filter((r) => r.type === 'followUp').at(-1);
        assert.ok(fu, JSON.stringify(i.responses.map((r) => r.type)));
        assert.strictEqual(fu.p.flags, 64);
        assert.match(fu.p.content, /^🪑 \*\*Left off the RAW card:\*\*/);
        assert.match(fu.p.content, /\*\*Men's\*\* \(8\)/, fu.p.content);
        assert.match(fu.p.content, /• W\d\d \(<@p\d+>\): no room on the card/);
        assert.deepStrictEqual(fu.p.allowedMentions, { parse: [] }, 'nobody gets pinged');
        assert.match(text({ responses: i.responses.filter((r) => r.type !== 'followUp') }), /Booked the \*\*RAW\*\* card/);
        // the slash command sends it too; with a full card there is no message
        i = await run('card', 'auto', { brand: 'raw', matches: 2, use_signup: false, rematches: false, match_types: false }, ADM);
        assert.ok(i.responses.some((r) => r.type === 'followUp' && /Left off the RAW card/.test(r.p.content)));
        i = await run('card', 'auto', { brand: 'raw', matches: 10, use_signup: false, rematches: true, match_types: false }, ADM);
        assert.ok(!i.responses.some((r) => r.type === 'followUp' && /Left off/.test(r.p.content || '')), 'everyone fits');
        // injured signed-up wrestlers are listed as injured
        await run('booking', 'signup-open', { title: 'RAW Night' }, ADM);
        const sid = (await q(`select id from signups order by id desc limit 1`))[0].id;
        for (const c of W.slice(0, 4)) await run('booking', 'signup-add', { signup: sid, character: c }, ADM);
        await f.pool.query(`insert into injuries (guild_id, character_id, returns_at, created_by) values ($2, $1, current_date + 7, 'adm')`, [W[3], G]);
        i = await run('card', 'auto', { brand: 'raw', matches: 1, rematches: true }, ADM);
        const m = i.responses.filter((r) => r.type === 'followUp').at(-1).p.content;
        assert.match(m, /signed up for \*\*RAW Night\*\*/);
        assert.match(m, /W03 \(<@p3>\): injured/);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exitCode = 1;
    await f.pool.end();
    process.exit();
})();
