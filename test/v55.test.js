// 3.14.0: live champions board — one post per division, wrestler + player, tag teams with both players, vacant belts.
process.env.ROSTER_DEBOUNCE_MS = '30';
const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, sent, edited, client } = require('./mock');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 6).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const G = 'g1';
const q = async (sql, a) => (await f.pool.query(sql, a)).rows;
const priv = (o) => ({ ...o, private: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RB = require('../src/utils/rosterBoard');
const inCh = (ch) => sent.filter((m) => m.channelId === ch);

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const JEY = await f.makeChar(G, 'u1', 'Jey Uso', 'mens');
    const BOLT = await f.makeChar(G, 'u2', 'Bolt', 'mens');
    const EVE = await f.makeChar(G, 'u5', 'Eve', 'womens');
    const FIA = await f.makeChar(G, 'u6', 'Fia', 'womens');
    const titles = await q(`select id, name, division, is_tag_title from titles where guild_id=$1 order by is_tag_title, id`, [G]);
    const mensBelt = titles.find((x) => x.division === 'mens' && !x.is_tag_title);
    const womensTag = titles.find((x) => x.division === 'womens' && x.is_tag_title);

    await t('📺 Channels → Live champions board posts one post per division with every belt', async () => {
        await run('match', 'log', { type: 'singles', wrestler1: JEY, wrestler2: BOLT, winner: 1, title: mensBelt.id }, ADM);
        const i = await click('ui:ch:s:champions', priv({ ...ADM, kind: 'channel', values: ['champch'] }));
        assert.match(text(i), /champions board is in <#champch>/, text(i));
        const posts = inCh('champch');
        const divs = [...new Set(titles.map((x) => x.division))];
        assert.strictEqual(posts.length, divs.length, 'one per division, no roster how-to post');
        const mens = posts[0].payload.content;
        assert.match(mens, /^🏆 \*\*Men's Champions\*\* · 1 of \d+ belts held/);
        assert.match(mens, new RegExp(`\\*\\*${mensBelt.name}\\*\\*\\n- \\*\\*Jey Uso\\*\\* \\(<@u1>\\) · won today`));
        assert.match(mens, /- _Vacant_/);
        assert.deepStrictEqual(posts[0].payload.allowedMentions, { parse: [] });
    });

    await t('a title change updates the post by itself; tag champions show team + both players', async () => {
        await run('match', 'log', { type: 'singles', wrestler1: BOLT, wrestler2: JEY, winner: 1, title: mensBelt.id }, ADM);
        await wait(200);
        const last = edited.filter((e) => /Men's Champions/.test(e.p.content || '')).at(-1);
        assert.match(last.p.content, /- \*\*Bolt\*\* \(<@u2>\) · won today/);
        if (womensTag) {
            await run('team', 'create', { kind: 'tag', name: 'Bloody Widows', member1: EVE, member2: FIA }, ADM);
            const team = (await q(`select id from teams where name='Bloody Widows'`))[0].id;
            await run('match', 'log', { type: 'tag', team1: team, team2: team, winner: 1, title: womensTag.id }, ADM).catch(() => {});
            await run('title', 'reign-add', { title: womensTag.id, team: String(team), won_date: '2026-11-01' }, ADM);
            await RB.refresh(client, G);
            const w = edited.filter((e) => /Women's Champions/.test(e.p.content || '')).at(-1) || inCh('champch').find((m) => /Women's Champions/.test(m.payload.content)).payload;
            const content = w.p ? w.p.content : w.content;
            assert.match(content, /- \*\*Bloody Widows\*\* \(<@u5>, <@u6>\) · \d+ days/, content);
        }
    });

    await t('same channel as the roster: champions first, then the roster', async () => {
        await click('ui:ch:s:roster', priv({ ...ADM, kind: 'channel', values: ['champch'] }));
        const slots = (await q(`select slot from roster_board_posts where channel_id='champch' order by position`)).map((r) => r.slot);
        assert.ok(slots[0].startsWith('champ:') && slots.includes('mens:0') && slots.at(-1) === 'info', slots.join(','));
        await click('ui:ch:off:roster', priv(ADM));
        const after = (await q(`select slot from roster_board_posts where channel_id='champch' order by position`)).map((r) => r.slot);
        assert.ok(after.every((s) => s.startsWith('champ:')), after.join(','));
    });

    await t('turning it off removes the posts', async () => {
        const i = await click('ui:ch:off:champions', priv(ADM));
        assert.match(text(i), /champions board is off/);
        assert.strictEqual((await q(`select count(*)::int n from roster_board_posts`))[0].n, 0);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end(); process.exit(failed ? 1 : 0);
})();
