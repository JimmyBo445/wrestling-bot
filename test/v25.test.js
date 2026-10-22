const assert = require('assert');
const f = require('./fixtures');
const { run, text, hasFile } = require('./mock');

let passed = 0, failed = 0;
async function t(name, fn) {
    try { await fn(); passed++; console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); }
}
const ADM = { admin: true, user: 'admin1' };
const PLAYER = (u) => ({ admin: false, user: u });
const isPrivateErr = (i, re) => i.responses.some((r) => ((r.p?.flags & 64) || i.ephemeral) && /⚠️/.test(r.p?.content || '') && (!re || re.test(r.p.content)));
const G = 'g1';
const C = {};
const log = (a, b, extra = {}) => run('match', 'log-singles', { participant1: C[a], participant2: C[b], winner: 1, override_cooldown: true, ...extra }, ADM);

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const mk = async (name, owner, div = 'mens') => { C[name] = await f.makeChar(G, owner, name, div); };
    await mk('WrestlerA', 'johnny'); await mk('WrestlerB', 'johnny'); await mk('Opp1', 'o1'); await mk('Opp2', 'o2');
    await mk('JWomen', 'johnny', 'womens'); await mk('OppW', 'o3', 'womens');

    // ---------- player records ----------
    await t("Johnny's record follows him when he switches characters (overall + per division)", async () => {
        for (let i = 0; i < 3; i++) await log('WrestlerA', 'Opp1');
        await log('JWomen', 'OppW');
        let s = await run('stats', 'user', { user: 'johnny', text: true });
        assert.match(text(s), /Record:4-0/, text(s));
        assert.match(text(s), /Men's: \*\*3-0\*\*/, text(s));
        // retire A, wrestle as B: nothing resets
        await run('character', 'retire', { character: C.WrestlerA }, ADM);
        await log('WrestlerB', 'Opp2');
        s = await run('stats', 'user', { user: 'johnny', text: true });
        assert.match(text(s), /Record:5-0/, text(s));
        assert.match(text(s), /Men's: \*\*4-0\*\*/, text(s));
        assert.match(text(s), /Women's: \*\*1-0\*\*/, text(s));
    });
    await t('transfer: new owner starts at 0-0, old owner keeps the record, character keeps history', async () => {
        const before = await run('stats', 'user', { user: 'johnny', text: true });
        await run('character', 'restore', { character: C.WrestlerA }, ADM);
        const tr = await run('character', 'transfer', { character: C.WrestlerA, new_owner: 'sam' }, ADM);
        assert.match(text(tr), /Moved/, text(tr));
        const sam = await run('stats', 'user', { user: 'sam', text: true });
        assert.ok(/WrestlerA/.test(text(sam)) && /0-0/.test(text(sam)), text(sam));
        const johnny = await run('stats', 'user', { user: 'johnny', text: true });
        assert.match(text(johnny), /Record:5-0/, text(johnny));
        assert.match(text(johnny), /former/, text(johnny));
        // character page: current owner 0-0, all owners 3-0
        const c = await run('stats', 'character', { character: C.WrestlerA });
        assert.match(text(c), /Record:0-0/, text(c));
        assert.match(text(c), /3-0/, text(c));
        assert.ok(hasFile(await run('character', 'profile', { character: C.WrestlerA }, ADM)));
        // Sam wins as A: counts for Sam, not Johnny
        await log('WrestlerA', 'Opp1');
        const s2 = await run('stats', 'user', { user: 'sam', text: true });
        assert.match(text(s2), /Record:1-0/, text(s2));
        const j2 = await run('stats', 'user', { user: 'johnny', text: true });
        assert.match(text(j2), /Record:5-0/, text(j2));
        const lb = await require('../src/utils/leaderboardQueries').buildLeaderboardEmbed(G, 'user_wins', 'all');
        assert.match(lb.data.description, /<@johnny> — \*\*5\*\* wins/, lb.data.description);
        assert.match(lb.data.description, /<@sam> — \*\*1\*\* wins/, lb.data.description);
    });


    // ---------- star ratings ----------
    await t('star ratings are admin only and 1-5', async () => {
        const { rows } = await f.pool.query(`select id from matches order by id limit 1`);
        const id = Number(rows[0].id);
        let i = await run('match', 'rate', { match_id: id, stars: 4 }, PLAYER('johnny'));
        assert.ok(isPrivateErr(i, /Only admins/), text(i));
        i = await run('match', 'rate', { match_id: id, stars: 5 }, ADM);
        assert.match(text(i), /⭐⭐⭐⭐⭐/, text(i));
        i = await run('match', 'rate', { match_id: 999999, stars: 3 }, ADM);
        assert.ok(isPrivateErr(i, /could not find/), text(i));
    });

    // ---------- milestones ----------
    await t('milestone shout-outs: win streak of 5 and title reign count', async () => {
        const { detectMilestones } = require('../src/utils/milestones');
        // WrestlerB: 1 win so far. give B 4 more wins -> 5 in a row
        let last;
        for (let n = 0; n < 4; n++) last = await log('WrestlerB', 'Opp2');
        assert.match(text(last), /5th\*\* match in a row/, text(last));
        const off = await run('admin', 'milestones', { action: 'off' }, ADM);
        assert.match(text(off), /off/, text(off));
        const quiet = await detectMilestones(G, { resultType: 'decisive', characters: [{ id: C.WrestlerB, name: 'WrestlerB' }], winnerIdx: [0], matchType: 'singles' });
        assert.deepStrictEqual(quiet, []);
        await run('admin', 'milestones', { action: 'on' }, ADM);
    });
    await t('title win shout-out says how many times champion', async () => {
        const wh = await f.titleId(G, 'World Heavyweight Championship');
        await run('championship', 'backfill-reign', { title: wh, won_date: '2026-01-01', lost_date: '2026-02-01', character: C.Opp1 }, ADM);
        await run('championship', 'backfill-reign', { title: wh, won_date: '2026-02-01', character: C.Opp2 }, ADM);
        let i = await log('Opp1', 'Opp2', { title: wh });
        assert.match(text(i), /2-time\*\* champion/, text(i));
    });

    // ---------- factions ----------
    await t('factions: create, shared record, add/remove, one faction per wrestler, disband', async () => {
        await mk('F1', 'f1'); await mk('F2', 'f2'); await mk('F3', 'f3'); await mk('F4', 'f4'); await mk('Rival', 'r1');
        let i = await run('faction', 'create', { name: 'The Order', division: 'mens', member1: C.F1, member2: C.F2 }, ADM);
        assert.ok(isPrivateErr(i, /at least 3/), text(i));
        i = await run('faction', 'create', { name: 'The Order', division: 'mens', member1: C.F1, member2: C.F2, member3: C.F3 }, ADM);
        assert.ok(hasFile(i), text(i));
        i = await run('faction', 'create', { name: 'Copycats', division: 'mens', member1: C.F1, member2: C.F4, member3: C.Rival }, ADM);
        assert.ok(isPrivateErr(i, /already in/), text(i));
        i = await run('faction', 'create', { name: 'Wrong', division: 'womens', member1: C.F4, member2: C.F2, member3: C.F3 }, ADM);
        assert.ok(isPrivateErr(i, /different division/), text(i));
        const { rows: [fa] } = await f.pool.query(`select id from factions where name='The Order'`);
        // F1 wins, F2 loses in separate matches, F3 not used
        await log('F1', 'Rival'); await log('Rival', 'F2');
        await mk('Rival2', 'r2'); await log('F2', 'Rival2');
        i = await run('faction', 'profile', { faction: String(fa.id) });
        assert.ok(hasFile(i), text(i));
        const { factionSummary } = require('../src/utils/factionUtils');
        const s = await factionSummary(fa.id);
        assert.strictEqual(s.wins, 2); assert.strictEqual(s.losses, 1);
        i = await run('faction', 'add-member', { faction: String(fa.id), character: C.F4 }, ADM);
        assert.match(text(i), /joined/, text(i));
        i = await run('faction', 'remove-member', { faction: String(fa.id), character: C.F4 }, ADM);
        assert.match(text(i), /left/, text(i));
        i = await run('faction', 'remove-member', { faction: String(fa.id), character: C.F3 }, ADM);
        assert.ok(isPrivateErr(i, /at least 3/), text(i));
        i = await run('faction', 'list', {});
        assert.match(text(i), /The Order/, text(i));
        i = await run('faction', 'create', { name: 'Nope', division: 'mens', member1: C.F4, member2: C.Rival, member3: C.Rival2 }, PLAYER('x'));
        assert.ok(isPrivateErr(i, /Only admins/), text(i));
        i = await run('faction', 'disband', { faction: String(fa.id) }, ADM);
        assert.match(text(i), /disbanded/, text(i));
        i = await run('faction', 'profile', { faction: String(fa.id) });
        assert.ok(hasFile(i), 'disbanded faction can still be viewed');
    });

    // ---------- hall of fame ----------
    await t('hall of fame: induct, list, view, remove (admin only to change)', async () => {
        let i = await run('halloffame', 'induct', { character: C.WrestlerA, blurb: 'The greatest of all time.' }, PLAYER('x'));
        assert.ok(isPrivateErr(i, /Only admins/), text(i));
        i = await run('halloffame', 'induct', { character: C.WrestlerA, blurb: 'The greatest of all time.' }, ADM);
        assert.ok(hasFile(i) && /inducted/i.test(text(i)), text(i));
        i = await run('halloffame', 'induct', { character: C.WrestlerA }, ADM);
        assert.ok(isPrivateErr(i, /already/), text(i));
        i = await run('halloffame', 'list', {});
        assert.match(text(i), /WrestlerA/, text(i));
        i = await run('halloffame', 'view', { character: C.WrestlerA });
        assert.ok(hasFile(i), text(i));
        i = await run('halloffame', 'view', { character: C.WrestlerB });
        assert.ok(isPrivateErr(i, /isn't in the Hall/), text(i));
        i = await run('halloffame', 'remove', { character: C.WrestlerA }, ADM);
        assert.match(text(i), /removed/, text(i));
    });

    // ---------- monthly awards, rivalries ----------
    await t('Wrestler of the Month, best match from star ratings, and rivalries', async () => {
        const { buildMonthlyEmbed, monthKey, rivalries } = require('../src/utils/monthly');
        const key = monthKey(new Date());
        const { embed, empty } = await buildMonthlyEmbed(G, key);
        assert.ok(!empty, 'someone qualifies');
        assert.match(embed.data.title, /Wrestler of the Month/);
        assert.match(embed.data.description, /WrestlerB|Johnny|johnny|F1|Rival/);
        const fields = JSON.stringify(embed.data.fields);
        assert.match(fields, /Match of the Month/);
        assert.match(fields, /⭐/, 'the 5-star match wins best match');
        const r = await rivalries(G, {});
        assert.ok(r.length >= 1 && r[0].meetings >= 2, JSON.stringify(r));
        let i = await run('stats', 'rivalries', {});
        assert.match(text(i), /Rivalries/, text(i));
        i = await run('admin', 'monthly-awards', { month: '2026-13' }, ADM);
        assert.ok(isPrivateErr(i, /YYYY|2026-09|like/), text(i));
        i = await run('admin', 'monthly-awards', {}, ADM);
        assert.ok(i.responses.length, 'ok');
    });

    // ---------- scheduler: monthly post + weekly backup ----------
    await t('scheduler posts the month once and sends the weekly backup DM', async () => {
        const { tick } = require('../src/utils/scheduler');
        const { prevMonthKey } = require('../src/utils/monthly');
        const posts = [], dms = [];
        const fakeClient = {
            channels: { fetch: async () => ({ isTextBased: () => true, send: async (p) => posts.push(p) }) },
            users: { fetch: async () => ({ send: async (p) => dms.push(p) }) },
            guilds: { cache: { get: () => ({ name: 'Test' }) } }
        };
        await f.pool.query(`update guilds set monthly_channel_id='chan', monthly_last=null, backup_user_id='admin1', backup_last=null where guild_id=$1`, [G]);
        // put a decisive match in LAST month so there is something to post
        const { rows: [m] } = await f.pool.query(`select id from matches order by id limit 1`);
        await f.pool.query(`update matches set created_at = (date_trunc('month', now()) - interval '10 days') where id in (select id from matches order by id limit 12)`);
        await tick(fakeClient);
        await tick(fakeClient); // second tick must not double post or double send
        assert.ok(posts.length <= 1, 'monthly post at most once');
        assert.strictEqual(dms.length, 1, 'one backup DM');
        assert.ok(dms[0].files.length >= 6, 'spreadsheets attached');
        const g = (await f.pool.query(`select monthly_last from guilds where guild_id=$1`, [G])).rows[0];
        assert.strictEqual(g.monthly_last, prevMonthKey());
        const csv = dms[0].files.find((x) => x.name === 'player-records.csv').attachment.toString();
        assert.match(csv, /johnny,mens/, csv);
        await f.pool.query(`update guilds set monthly_channel_id=null, backup_user_id=null where guild_id=$1`, [G]);
    });

    // ---------- match requests onto a card ----------
    await t('an approved match request can be put on a card, once', async () => {
        await run('card', 'new', { brand: 'raw', division: 'mens' }, ADM);
        const { rows: [req] } = await f.pool.query(
            `insert into pending_requests (guild_id, request_type, status, requested_by, character_id, challenger_character_id, payload)
             values ($1,'match_request','approved','johnny',$2,$3,'{"note":"Grudge match"}') returning id`, [G, C.WrestlerB, C.Opp1]);
        const base = { brand: 'raw', division: 'mens' };
        let i = await run('card', 'request', { ...base, request: String(req.id) }, ADM);
        assert.match(text(i), /Grudge match/, text(i));
        i = await run('card', 'request', { ...base, request: String(req.id) }, ADM);
        assert.ok(isPrivateErr(i, /already on a card/), text(i));
        i = await run('card', 'request', { ...base, request: '999999' }, ADM);
        assert.ok(isPrivateErr(i, /approved match requests/), text(i));
    });


    // ---------- roster pager ----------
    await t('/roster flips through a division A-Z, wraps around, and only the opener can click', async () => {
        const { click } = require('./mock');
        await mk('Zed', 'z1'); await mk('aaron', 'z2'); await mk('Mike', 'z3');
        const { rows } = await f.pool.query(`select count(*)::int as n from characters where division='mens' and status='approved'`);
        const total = rows[0].n;
        let i = await run('roster', null, { division: 'mens' }, PLAYER('viewer'));
        assert.ok(hasFile(i), text(i));
        assert.match(text(i), new RegExp(`1 of ${total}`), text(i));
        const comps = i.responses.find((r) => r.p?.components?.length).p.components[0].components;
        const prevId = comps[0].data.custom_id, nextId = comps[2].data.custom_id;
        const n = await click(nextId, { admin: false, user: 'viewer' });
        const np = n.responses.find((r) => r.type === 'edit').p;
        assert.ok(np.files.length === 1 && /2 of /.test(np.content), np.content);
        const stranger = await click(nextId, { admin: false, user: 'someone-else' });
        assert.ok(/someone else/.test(text(stranger)), text(stranger));
        const wrap = await click(prevId, { admin: false, user: 'viewer' });
        assert.match(wrap.responses.find((r) => r.type === 'edit').p.content, new RegExp(`${total} of ${total}`));
        const empty = await run('roster', null, { division: 'custom_womens' }, PLAYER('viewer'));
        assert.ok(isPrivateErr(empty, /no .*wrestlers/), text(empty));
        const names = (await f.pool.query(`select name from characters where division='mens' and status='approved' order by lower(name), id`)).rows.map((r) => r.name);
        assert.strictEqual(names[0].toLowerCase(), 'aaron');
    });


    // ---------- picture uploads ----------
    await t('picture upload: stored in the database, shows on cards, replaceable, validated', async () => {
        const img = require('../src/utils/imageUrl');
        const { createCanvas } = require('@napi-rs/canvas');
        const png = (w, h, color) => { const c = createCanvas(w, h); const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); return c.toBuffer('image/png'); };
        const realDownload = img.downloadImage;
        img.downloadImage = async (url) => { if (url.includes('bad')) throw new Error('nope'); return png(url.includes('huge') ? 3000 : 400, 600, '#33aa55'); };
        try {
            const att = (name, type, extra = {}) => ({ url: `https://cdn.discordapp.com/attachments/1/2/${name}`, contentType: type, size: 12345, name, ...extra });
            // assign with an uploaded picture
            let i = await run('character', 'assign', { user: 'pic1', name: 'Pictured', division: 'mens', picture: att('a.png', 'image/png') }, ADM);
            assert.match(text(i), /Assigned/, text(i));
            const { rows: [c] } = await f.pool.query(`select id, image_url from characters where name='Pictured'`);
            assert.strictEqual(c.image_url, `db:${c.id}`);
            const stored = (await f.pool.query(`select length(data) as n, content_type from character_images where character_id=$1`, [c.id])).rows[0];
            assert.ok(stored.n > 100 && stored.content_type === 'image/jpeg', JSON.stringify(stored));
            i = await run('character', 'profile', { character: c.id });
            assert.ok(hasFile(i), text(i));
            // the card renderer can actually load it
            const buf = await img.fetchImageBuffer(`db:${c.id}`);
            assert.ok(buf && buf.length === Number(stored.n));
            // big pictures are shrunk to 900 px
            i = await run('character', 'picture', { character: c.id, picture: att('huge.png', 'image/png') }, PLAYER('pic1'));
            assert.match(text(i), /Updated the picture/, text(i));
            const { loadImage } = require('@napi-rs/canvas');
            const re = await loadImage((await f.pool.query(`select data from character_images where character_id=$1`, [c.id])).rows[0].data);
            assert.ok(Math.max(re.width, re.height) <= 900, `${re.width}x${re.height}`);
            // someone else can't change it, admin can
            i = await run('character', 'picture', { character: c.id, picture: att('a.png', 'image/png') }, PLAYER('other'));
            assert.ok(isPrivateErr(i, /own characters/), text(i));
            // wrong file type / too big / download failure
            i = await run('character', 'picture', { character: c.id, picture: att('a.pdf', 'application/pdf') }, ADM);
            assert.ok(isPrivateErr(i, /not a PNG/), text(i));
            i = await run('character', 'picture', { character: c.id, picture: att('a.png', 'image/png', { size: 20 * 1024 * 1024 }) }, ADM);
            assert.ok(isPrivateErr(i, /too big/), text(i));
            i = await run('character', 'picture', { character: c.id, picture: att('bad.png', 'image/png') }, ADM);
            assert.ok(isPrivateErr(i, /Picture problem/), text(i));
            // edit with picture, then removing with "-" deletes the stored copy
            i = await run('character', 'edit', { character: c.id, picture: att('b.png', 'image/png'), bio: 'Has a pic' }, ADM);
            assert.match(text(i), /picture/, text(i));
            i = await run('character', 'edit', { character: c.id, image_url: '-' }, ADM);
            assert.strictEqual((await f.pool.query(`select count(*)::int as n from character_images where character_id=$1`, [c.id])).rows[0].n, 0);
            assert.strictEqual((await f.pool.query(`select image_url from characters where id=$1`, [c.id])).rows[0].image_url, null);
            // submit with a picture goes through the approval flow with the picture saved
            i = await run('character', 'submit', { name: 'SubmitPic', division: 'mens', picture: att('s.png', 'image/png') }, PLAYER('pic2'));
            assert.match(text(i), /submitted/, text(i));
            const sp = (await f.pool.query(`select id, image_url from characters where name='SubmitPic'`)).rows[0];
            assert.strictEqual(sp.image_url, `db:${sp.id}`);
        } finally { img.downloadImage = realDownload; }
    });


    // ---------- rankings graphic + player card + belt history ----------
    await t('rankings are a picture (with the dropdown), and the text fallback still works', async () => {
        const { click } = require('./mock');
        let i = await run('rankings', null, {});
        assert.ok(hasFile(i) && /Men's Division Rankings/.test(text(i)), text(i));
        const sel = await click('rank_div', { values: ['womens'], admin: false });
        const e = sel.responses.find((r) => r.type === 'edit');
        assert.ok(e, 'edited in place');
        assert.ok(/Women's Division Rankings/.test(e.p.content || '') || (e.p.embeds || []).length, JSON.stringify(e.p).slice(0, 200));
        const empty = await click('rank_div', { values: ['custom_womens'], admin: false });
        assert.match(text(empty), /Custom Women's Division Rankings/, text(empty));
    });
    await t('player card is the default for /stats user, text with text:true', async () => {
        let i = await run('stats', 'user', { user: 'johnny' });
        assert.ok(hasFile(i), text(i));
        i = await run('stats', 'user', { user: 'nobody-here' });
        assert.ok(isPrivateErr(i, /no approved characters/), text(i));
    });
    await t('belt card lists the previous champions', async () => {
        const { buildBeltData } = require('../src/utils/cardData');
        const { rows: [t] } = await f.pool.query(`select * from titles where guild_id=$1 and name='World Heavyweight Championship'`, [G]);
        const d = await buildBeltData({ id: G, name: 'X', members: { fetch: async () => new Map() } }, t);
        assert.ok(Array.isArray(d.previous));
        assert.ok(d.previous.length >= 1 && d.previous.every((p) => p.name && Number.isInteger(p.days)), JSON.stringify(d.previous));
        const i = await run('championship', 'belt', { title: String(t.id) });
        assert.ok(hasFile(i), text(i));
    });

    // ---------- injuries ----------
    await t('injuries: add, list, auto card skips them, match warns, profile badge, clear', async () => {
        await mk('Hurt1', 'h1'); await mk('Hurt2', 'h2'); await mk('Fit1', 'h3'); await mk('Fit2', 'h4');
        let i = await run('injury', 'add', { character: C.Hurt1, days: 14, reason: 'Torn ACL' }, PLAYER('x'));
        assert.ok(isPrivateErr(i, /Only admins/), text(i));
        i = await run('injury', 'add', { character: C.Hurt1, days: 14, reason: 'Torn ACL' }, ADM);
        assert.match(text(i), /injured until/, text(i));
        i = await run('injury', 'list', {});
        assert.match(text(i), /Hurt1/, text(i)); assert.match(text(i), /Torn ACL/, text(i));
        // the injured wrestler is booked in a match: the admin gets a heads-up
        i = await log('Hurt1', 'Hurt2');
        assert.match(text(i), /Hurt1\*\* is injured/, text(i));
        // card add warns too
        await run('card', 'new', { brand: 'smackdown', division: 'mens' }, ADM);
        i = await run('card', 'add', { brand: 'smackdown', division: 'mens', match_type: 'singles', wrestler1: C.Hurt1, wrestler2: C.Fit1 }, ADM);
        assert.match(text(i), /Hurt1\*\* is injured/, text(i));
        // the profile card knows
        const { buildProfileData } = require('../src/utils/cardData');
        const { rows: [ch] } = await f.pool.query(`select c.*, u.discord_id as owner_discord_id from characters c join users u on u.id=c.owner_id where c.id=$1`, [C.Hurt1]);
        const pd = await buildProfileData({ id: G, name: 'X', members: { fetch: async () => new Map() } }, ch);
        assert.ok(pd.injuredUntil, 'badge data present');
        // auto card never books the injured
        for (let k = 0; k < 3; k++) {
            await run('card', 'auto', { brand: 'raw', division: 'mens', matches: 10 }, ADM);
            const { rows } = await f.pool.query(`select character_ids from card_draft_matches cdm join card_drafts d on d.id=cdm.draft_id where d.brand='raw' and d.division='mens'`);
            const all = rows.flatMap((r) => r.character_ids.map(String));
            assert.ok(!all.includes(String(C.Hurt1)), 'injured wrestler booked by auto');
        }
        i = await run('injury', 'clear', { character: C.Hurt1 }, ADM);
        assert.match(text(i), /cleared/, text(i));
        i = await run('injury', 'clear', { character: C.Hurt1 }, ADM);
        assert.ok(isPrivateErr(i, /isn't injured/), text(i));
        i = await run('injury', 'list', {});
        assert.match(text(i), /Nobody is injured/, text(i));
    });
    await t('scheduler announces returns and marks them healthy', async () => {
        const { tick } = require('../src/utils/scheduler');
        await run('injury', 'add', { character: C.Hurt2, days: 3 }, ADM);
        await f.pool.query(`update injuries set returns_at = CURRENT_DATE - 1 where character_id=$1 and cleared_at is null`, [C.Hurt2]);
        await f.pool.query(`update guilds set matches_channel_id='mchan' where guild_id=$1`, [G]);
        const posts = [];
        const fake = { channels: { fetch: async () => ({ isTextBased: () => true, send: async (p) => posts.push(p) }) }, users: { fetch: async () => ({ send: async () => {} }) }, guilds: { cache: { get: () => null } } };
        await tick(fake); await tick(fake);
        assert.strictEqual(posts.length, 1, 'announced exactly once');
        assert.match(posts[0].content, /Hurt2.*back from injury/);
        const { rows } = await f.pool.query(`select cleared_at from injuries where character_id=$1`, [C.Hurt2]);
        assert.ok(rows[0].cleared_at);
        await f.pool.query(`update guilds set matches_channel_id=null where guild_id=$1`, [G]);
    });

    // ---------- seasons ----------
    await t('seasons: recap picture, standings text, empty year, scheduler New Year post', async () => {
        const year = new Date().getFullYear();
        let i = await run('season', 'recap', { year });
        assert.ok(hasFile(i) && new RegExp(`${year} Season Recap`).test(text(i)), text(i));
        i = await run('season', 'standings', { year });
        assert.match(text(i), /Season Standings/, text(i)); assert.match(text(i), /Top wrestlers/, text(i));
        i = await run('season', 'recap', { year: 1999 });
        assert.ok(isPrivateErr(i), text(i));
        i = await run('season', 'recap', {});
        assert.ok(hasFile(i), 'defaults to this year');
        const { buildSeasonData } = require('../src/utils/season');
        const d = await buildSeasonData({ id: G, name: 'X', members: { fetch: async () => new Map() } }, year);
        assert.ok(d.matches > 0 && d.wrestlers.length && d.champions.length, JSON.stringify(d).slice(0, 300));
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end();
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
