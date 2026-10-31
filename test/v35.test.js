// 2.17.0: title history import and the championship history channel
const assert = require('assert');
const f = require('./fixtures');
const { run, text, client } = require('./mock');
const titleImport = require('../src/utils/titleImport');
const importer = require('../src/utils/importer');
const history = require('../src/utils/historyChannel');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 5).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const G = 'g1';
const q = async (sql, a) => (await f.pool.query(sql, a)).rows;
const att = { name: 'titles.csv', size: 100, url: 'https://cdn.discordapp.com/t.csv', contentType: 'text/csv' };
const A = '900000000000000001', B = '900000000000000002', C = '900000000000000003';

// A fake channel that remembers its messages, so edits and deletes can be checked.
function fakeChannelClient() {
    const msgs = new Map(); let n = 0;
    const mk = (content) => {
        const m = { id: `h${++n}`, content, edit: async (p) => { m.content = p.content; m.edits = (m.edits || 0) + 1; }, delete: async () => { msgs.delete(m.id); } };
        msgs.set(m.id, m); return m;
    };
    const channel = {
        isTextBased: () => true,
        send: async (p) => { assert.deepStrictEqual(p.allowedMentions, { parse: [] }, 'history posts never ping'); return mk(p.content); },
        messages: { fetch: async (id) => { if (!msgs.has(id)) throw new Error('Unknown Message'); return msgs.get(id); } }
    };
    return { msgs, channel, client: { channels: { fetch: async () => channel } } };
}

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const WH = await f.titleId(G, 'World Heavyweight Championship');
    const TAG = await f.titleId(G, "Men's Tag Team Championship");

    await t('dates: 4/1/23, 4/1/2023 and 2023-04-01 all work; impossible dates are refused', async () => {
        assert.strictEqual(titleImport.parseFlexDate('4/1/23'), '2023-04-01');
        assert.strictEqual(titleImport.parseFlexDate('12/18/2025'), '2025-12-18');
        assert.strictEqual(titleImport.parseFlexDate('2023-04-01'), '2023-04-01');
        assert.strictEqual(titleImport.parseFlexDate('4/31/24'), false);
        assert.strictEqual(titleImport.parseFlexDate(''), null);
        assert.strictEqual(titleImport.normTitle('FNLW Women\'s World Champion'), titleImport.normTitle("Women's World Championship"));
        assert.strictEqual(titleImport.normTitle("FNLW Custom's Tag Team Champions"), titleImport.normTitle('Customs Tag Team Championship'));
    });

    importer.downloadCsv = async () => [
        'title,holder,members,won,lost,defenses,notes',
        `FNLW World Heavyweight Champion,Jey,${A},4/1/23,5/23/23,1,`,
        `World Heavyweight Championship,Bron,${B},8/12/23,9/10/23,0,`,
        `World Heavyweight Championship,Jey,<@${A}>,6/19/23,8/12/23,4,`,
        `World Heavyweight Championship,Seth,${C},2/19/26,,5,`,
        `Men's Tag Team Championship,Bloodline,${A} ${B},5/10/25,6/8/25,3,Dropped Titles`,
        `Men's Tag Team Championship,Bloodline,${A} & ${B} & ${C},6/30/25,9/20/25,4,`,
        'Unknown Belt,Someone,,1/1/24,,0,',
        `World Heavyweight Championship,Overlapper,${B},5/1/23,6/1/23,0,`,
        'World Heavyweight Championship,Bad Date,,4/31/24,6/31/24,0,',
        'World Heavyweight Championship,Future,,1/1/40,,0,'
    ].join('\n');

    await t('preview saves nothing and lists the problems', async () => {
        const i = await run('admin', 'import', { what: 'titles', file: att }, ADM);
        const out = text(i);
        assert.match(out, /Preview: \*\*6\*\* reigns/);
        assert.match(out, /don't know a title called "Unknown Belt"/);
        assert.match(out, /overlaps line/);
        assert.match(out, /isn't a real date/);
        assert.match(out, /future/);
        assert.strictEqual((await q('select count(*)::int n from title_reigns'))[0].n, 0);
    });

    await t('apply adds historical reigns in date order, credits every listed player, and sets the current champion', async () => {
        const i = await run('admin', 'import', { what: 'titles', file: att, apply: true }, ADM);
        assert.match(text(i), /Imported \*\*6\*\* reigns/);
        const wh = await q(`select reign_char_name n, won_date::text w, lost_date::text l, defenses d, is_backfilled b from title_reigns where title_id=$1 order by won_date`, [WH]);
        assert.deepStrictEqual(wh.map((r) => r.n), ['Jey', 'Jey', 'Bron', 'Seth']);
        assert.ok(wh.every((r) => r.b));
        assert.strictEqual(wh[3].l, null);
        assert.strictEqual((await q('select is_vacant from titles where id=$1', [WH]))[0].is_vacant, false);
        const credit = await q(`select tr.reign_char_name n, array_agg(u.discord_id order by u.discord_id) ids from reign_owners ro join users u on u.id=ro.user_id join title_reigns tr on tr.id=ro.reign_id where tr.title_id=$1 group by tr.id, tr.reign_char_name order by tr.won_date`, [TAG]);
        assert.deepStrictEqual(credit.map((r) => r.ids.length), [2, 3]);
        const h = await run('championship', 'history', { title: WH }, ADM);
        assert.match(text(h), /Seth.*played by <@900000000000000003>/s);
    });

    await t('importing the same file again changes nothing', async () => {
        const i = await run('admin', 'import', { what: 'titles', file: att, apply: true }, ADM);
        assert.match(text(i), /6 reign\(s\) were already in the bot/);
        assert.strictEqual((await q('select count(*)::int n from title_reigns'))[0].n, 6);
    });

    await t('a line that overlaps a reign already in the bot is skipped, never changed', async () => {
        importer.downloadCsv = async () => 'title,holder,won,lost\nWorld Heavyweight Championship,Sneaky,3/1/26,\n';
        const i = await run('admin', 'import', { what: 'titles', file: att, apply: true }, ADM);
        assert.match(text(i), /overlaps \*\*Seth\*\*/);
        assert.strictEqual((await q('select count(*)::int n from title_reigns'))[0].n, 6);
    });

    await t('the template download now has a title history file', async () => {
        const i = await run('admin', 'import-template', {}, ADM);
        assert.ok(i.responses[0].p.files.some((x) => x.name === 'import-titles.csv'));
    });

    await t('history text groups reigns by player (or team) like the hand-written post', async () => {
        const texts = await history.renderHistory(G);
        const all = texts.join('\n');
        assert.match(texts[0], /^# 🏆 CHAMPIONSHIP HISTORY\n# World Heavyweight Championship/);
        assert.match(all, /2x <@900000000000000001>\n\*1st Reign - 1 Defense\*\n4\/1\/23-5\/23\/23\n\*2nd Reign - 4 Defenses\*\n6\/19\/23-8\/12\/23/);
        assert.match(all, /1x <@900000000000000003>\n\*1st Reign - 5 Defenses\*\n2\/19\/26-\n/);
        assert.match(all, /2x Bloodline\n\*1st Reign - 3 Defenses\* \(Dropped Titles\)\n\( <@900000000000000001> and <@900000000000000002> \)/);
        assert.match(all, /\( <@900000000000000001>, <@900000000000000002>, and <@900000000000000003> \)/);
        assert.ok(texts.every((x) => x.length <= 2000));
    });

    await t('refresh posts once, then edits the same messages; a deleted message makes it repost in order', async () => {
        const fake = fakeChannelClient();
        await q(`update guilds set history_channel_id='hist' where guild_id=$1`, [G]);
        let r = await history.refreshHistory(fake.client, G);
        assert.strictEqual(r.posted, 2);
        assert.strictEqual(fake.msgs.size, 2);
        r = await history.refreshHistory(fake.client, G);
        assert.strictEqual(r.posted, 0);
        assert.strictEqual(fake.msgs.size, 2);
        const first = [...fake.msgs.keys()][0];
        fake.msgs.delete(first);
        r = await history.refreshHistory(fake.client, G);
        assert.strictEqual(r.posted, 2);
        assert.strictEqual(fake.msgs.size, 2, 'the leftover message was removed so the order stays right');
    });

    await t('a title change updates the channel by itself; with auto off it waits for /admin history', async () => {
        const fake = fakeChannelClient();
        await q('delete from history_posts');
        history.setClient(fake.client);
        await history.refreshHistory(fake.client, G);
        const before = [...fake.msgs.values()][0].content;
        const reign = (await q(`select id from title_reigns where title_id=$1 and reign_char_name='Seth'`, [WH]))[0].id;
        await run('reign', 'add-defense', { title: WH, reign: Number(reign), opponent: 'Someone' }, ADM);
        await new Promise((res) => setTimeout(res, 5600));
        const after = [...fake.msgs.values()][0].content;
        assert.notStrictEqual(after, before);
        assert.match(after, /1x <@900000000000000003>\n\*1st Reign - 6 Defenses\*/);

        await run('admin', 'history', { auto: 'off' }, ADM);
        await run('reign', 'add-defense', { title: WH, reign: Number(reign), opponent: 'Someone else' }, ADM);
        await new Promise((res) => setTimeout(res, 5600));
        assert.match([...fake.msgs.values()][0].content, /6 Defenses/, 'auto off: no update');
        const origFetch = client.channels.fetch;
        client.channels.fetch = fake.client.channels.fetch;
        const i = await run('admin', 'history', {}, ADM);
        client.channels.fetch = origFetch;
        assert.match(text(i), /up to date/);
        assert.match([...fake.msgs.values()][0].content, /7 Defenses/);
        history.setClient(null);
    });

    await t('/admin history auto:on shows the setting; /admin settings lists it', async () => {
        let i = await run('admin', 'history', { auto: 'off' }, ADM);
        assert.match(text(i), /<#hist>.*Automatic updates are \*\*off\*\*/);
        i = await run('admin', 'settings', {}, ADM);
        assert.match(text(i), /Championship history channel:<#hist> \(manual updates\)/);
    });

    await t('/admin history without a channel explains what to do', async () => {
        await q(`update guilds set history_channel_id=null where guild_id=$1`, [G]);
        const i = await run('admin', 'history', {}, ADM);
        assert.match(text(i), /No history channel yet/);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end();
    process.exit(failed ? 1 : 0);
})();
