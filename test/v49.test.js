// 3.8.0: fewer typed commands. /admin, /booking, /card and /championship moved most subcommands to buttons.
const assert = require('assert');
const f = require('./fixtures');
const { run, click, text, sent, ids, modalOf, dms } = require('./mock');

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
const json = (i) => JSON.stringify((i.responses.at(-1)?.p?.components || []).map((r) => (r.toJSON ? r.toJSON() : r)));
const subs = (name) => (require('./mock').client.commands.get(name).data.toJSON().options || []).filter((o) => o.type === 1 || o.type === 2).map((o) => o.name);

(async () => {
    await f.resetDb();
    await f.ensureGuild(G);
    const A = await f.makeChar(G, 'u1', 'Ace', 'mens');
    const B = await f.makeChar(G, 'u2', 'Bolt', 'mens');
    const C = await f.makeChar(G, 'u3', 'Cruz', 'mens');
    const D = await f.makeChar(G, 'u4', 'Dax', 'mens');

    await t('Discord only lists the short versions', async () => {
        assert.deepStrictEqual(subs('admin'), ['pending', 'panel', 'data']);
        assert.deepStrictEqual(subs('booking'), ['request', 'signups']);
        assert.deepStrictEqual(subs('card'), ['view', 'add']);
        const ch = require('./mock').client.commands.get('championship').data.toJSON();
        assert.deepStrictEqual(ch.options.map((o) => [o.name, o.type, Boolean(o.required)]), [['title', 3, false]]);
    });

    // ---------------- /admin panel ----------------
    await t('/admin panel: staff get every tool as buttons, pending first; players are refused', async () => {
        const i = await run('admin', 'panel', {}, ADM);
        const list = ids(i);
        assert.strictEqual(list[0], 'ui:h:pending');
        for (const x of ['ui:ch:h', 'ui:ad:ru', 'ui:ad:sr', 'ui:ad:hi', 'ui:ad:nl', 'ui:ad:rp', 'ui:ad:ma', 'ui:ad:au', 'ui:ad:st', 'ui:ad:dt', 'ui:uf:h', 'ui:rr:list']) assert.ok(list.includes(x), x);
        const p = await click('ui:ad:h', P('u1'));
        assert.match(text(p), /Only admins|only admins|staff/i);
        assert.ok(!ids(p).includes('ui:ad:ru'));
    });

    await t('rules: toggles and the numbers form save, a bad number changes nothing', async () => {
        let i = await click('ui:ad:ru', priv(ADM));
        assert.ok(ids(i).includes('ui:ad:rt:milestones:off'), ids(i).join(' '));
        i = await click('ui:ad:rt:milestones:off', priv(ADM));
        assert.strictEqual((await q(`select milestones_enabled from guilds where guild_id=$1`, [G]))[0].milestones_enabled, false);
        assert.ok(ids(i).includes('ui:ad:rt:milestones:on'));
        i = await click('ui:ad:rn', priv(ADM));
        assert.deepStrictEqual(modalOf(i).inputs, ['cooldown_hours', 'streak_wins', 'defense_days', 'vacate_days', 'rematch_days']);
        i = await click('ui:adm:rn', priv({ ...ADM, fields: { cooldown_hours: '12', streak_wins: '4', defense_days: '30', vacate_days: '60', rematch_days: '14' } }));
        assert.match(text(i), /Saved/);
        const g = (await q(`select singles_cooldown_hours, streak_threshold, defense_days, vacate_days, rematch_days from guilds where guild_id=$1`, [G]))[0];
        assert.deepStrictEqual([g.singles_cooldown_hours, g.streak_threshold, g.defense_days, g.vacate_days, g.rematch_days], [12, 4, 30, 60, 14]);
        i = await click('ui:adm:rn', priv({ ...ADM, fields: { cooldown_hours: 'lots', streak_wins: '9' } }));
        assert.match(text(i), /whole number/);
        assert.strictEqual((await q(`select streak_threshold from guilds where guild_id=$1`, [G]))[0].streak_threshold, 4);
        i = await click('ui:adm:tz', priv({ ...ADM, fields: { zone: 'Mars/Olympus' } }));
        assert.match(text(i), /don't know that time zone/);
        i = await click('ui:adm:tz', priv({ ...ADM, fields: { zone: 'America/Chicago' } }));
        assert.strictEqual((await q(`select tz from guilds where guild_id=$1`, [G]))[0].tz, 'America/Chicago');
    });

    await t('staff role: pick one from the menu, then turn it off', async () => {
        let i = await click('ui:ad:srs', priv({ ...ADM, values: ['role-staff'] }));
        assert.match(text(i), /Saved/);
        assert.strictEqual((await q(`select staff_role_id from guilds where guild_id=$1`, [G]))[0].staff_role_id, 'role-staff');
        i = await click('ui:ad:srx', priv(ADM));
        assert.strictEqual((await q(`select staff_role_id from guilds where guild_id=$1`, [G]))[0].staff_role_id, null);
    });

    await t('newsletter: add a line, delete one, preview and post here', async () => {
        let i = await click('ui:adm:nl', priv({ ...ADM, fields: { text: 'Big news this week' } }));
        assert.match(text(i), /Added as line/);
        await click('ui:adm:nl', priv({ ...ADM, fields: { text: 'Delete me' } }));
        const lines = await q(`select id, body from newsletter_entries order by id`);
        i = await click('ui:ad:nl', priv(ADM));
        assert.match(text(i), /Big news this week/);
        assert.ok(ids(i).includes('ui:ad:nlr'));
        i = await click('ui:ad:nlr', priv({ ...ADM, values: [String(lines[1].id)] }));
        assert.strictEqual((await q(`select count(*)::int n from newsletter_entries`))[0].n, 1);
        i = await click('ui:ad:nlp', priv(ADM));
        assert.ok(!bad(i), text(i));
        i = await click('ui:ad:nlq', priv(ADM));
        assert.ok(ids(i).includes('ui:ad:nly'));
        const before = sent.length;
        i = await click('ui:ad:nly', priv(ADM));
        assert.match(text(i), /Posted in <#chan1>/);
        assert.ok(sent.slice(before).some((m) => m.channelId === 'chan1'));
        assert.ok((await q(`select posted_in from newsletter_entries`))[0].posted_in);
    });

    await t('history, settings, audit, staff report, monthly awards and backups open inside the panel', async () => {
        for (const id of ['ui:ad:hi', 'ui:ad:st', 'ui:ad:au', 'ui:ad:rp', 'ui:ad:ma', 'ui:ad:dt', 'ui:ad:tpl']) {
            const i = await click(id, priv(ADM));
            assert.ok(i.responses.length && !bad(i) && !String(i.responses.at(-1).p?.content || '').startsWith('⚠️'), `${id}: ${text(i)}`);
        }
        let i = await click('ui:ad:hi', priv(ADM));
        assert.ok(ids(i).includes('ui:ch:k:history'));
        i = await click('ui:ad:bu:on', priv(ADM));
        assert.strictEqual((await q(`select backup_user_id from guilds where guild_id=$1`, [G]))[0].backup_user_id, 'admin1');
        assert.ok(dms.some((d) => d.id === 'admin1'));
        i = await click('ui:ad:bu:off', priv(ADM));
        assert.strictEqual((await q(`select backup_user_id from guilds where guild_id=$1`, [G]))[0].backup_user_id, null);
        const before = sent.length;
        i = await click('ui:ad:map', priv(ADM));
        assert.ok(sent.length > before, 'monthly awards posted');
    });

    await t('the old /admin subcommands still work inside the bot', async () => {
        const i = await run('admin', 'rules', { streak_wins: 5 }, ADM);
        assert.ok(!bad(i));
        assert.strictEqual((await q(`select streak_threshold from guilds where guild_id=$1`, [G]))[0].streak_threshold, 5);
        const n = await run('admin', 'add', { text: 'Hidden still works' }, { ...ADM, group: 'newsletter' });
        assert.match(text(n), /Added as line/);
    });

    // ---------------- /booking signups ----------------
    let signupId;
    await t('/booking signups: players get Suggest opponents; staff also get the signup buttons', async () => {
        let i = await run('booking', 'signups', {}, P('u1'));
        assert.deepStrictEqual(ids(i).filter((x) => !x.startsWith('ui:h:')), ['ui:pg:sug:0:all:0']);
        i = await run('booking', 'signups', {}, ADM);
        for (const x of ['ui:bk:op', 'ui:bk:ls:0', 'ui:bk:cl:0']) assert.ok(ids(i).includes(x), x);
        const p = await click('ui:bk:op', P('u1'));
        assert.match(text(p), /Only admins|staff/i);
    });

    await t('open a signup from the form, sign someone up, take them off, close it', async () => {
        let i = await click('ui:bk:op', priv(ADM));
        assert.deepStrictEqual(modalOf(i).inputs, ['title', 'deadline']);
        const before = sent.length;
        i = await click('ui:bkm:op', priv({ ...ADM, fields: { title: 'RAW - Nov 20', deadline: '' } }));
        assert.match(text(i), /RAW - Nov 20/);
        assert.ok(sent.slice(before).some((m) => m.channelId === 'chan1'), 'signup posted here');
        signupId = (await q(`select id from signups where title='RAW - Nov 20'`))[0].id;
        i = await click(`ui:pg:sga:${signupId}:all:0`, priv(ADM));
        assert.ok(ids(i).includes(`ui:pk:sga:${signupId}`), ids(i).join(' '));
        i = await click(`ui:pk:sga:${signupId}`, priv({ ...ADM, values: [String(A)] }));
        assert.match(text(i), /Signed \*\*Ace\*\* up/);
        await click(`ui:pk:sga:${signupId}`, priv({ ...ADM, values: [String(B)] }));
        i = await click(`ui:bk:rm:${signupId}`, priv(ADM));
        assert.ok(ids(i).includes(`ui:bk:rs:${signupId}`));
        i = await click(`ui:bk:rs:${signupId}`, priv({ ...ADM, values: [String(B)] }));
        assert.match(text(i), /Removed \*\*Bolt\*\*/);
        i = await click(`ui:bk:ls:${signupId}`, priv(ADM));
        assert.match(text(i), /Ace/);
        i = await click(`ui:bk:cl:${signupId}`, priv(ADM));
        assert.match(text(i), /Closed/);
        assert.strictEqual((await q(`select status from signups where id=$1`, [signupId]))[0].status, 'closed');
    });

    await t('suggest opponents works for players, with a button to ignore the signup', async () => {
        let i = await click('ui:pg:sug:0:all:0', priv(P('u3')));
        assert.ok(ids(i).includes('ui:pk:sug:0'));
        i = await click('ui:pk:sug:0', priv({ ...P('u3'), values: [String(C)] }));
        assert.ok(ids(i).includes(`ui:bk:se:${C}:1`), text(i));
        i = await click(`ui:bk:se:${C}:1`, priv(P('u3')));
        assert.ok(!bad(i), text(i));
        assert.match(text(i), /Dax|Bolt|Ace/);
        await click(`ui:bk:dn:${signupId}`, priv(ADM));
    });

    // ---------------- /card ----------------
    await t('/card view with no card explains where the tools are, and has 🧰 More tools', async () => {
        const i = await run('card', 'view', { brand: 'raw' }, ADM);
        assert.match(text(i), /More tools/);
        assert.ok(ids(i).includes('ui:ct:h:raw') && ids(i).includes('ui:ct:v:smackdown'));
    });

    await t('card tools: new card, auto-build, schedule, auto recap and clear from buttons', async () => {
        let i = await click('ui:ct:h:raw', priv(ADM));
        for (const x of ['ui:ct:nw:raw', 'ui:ct:au:raw', 'ui:ct:sc:raw', 'ui:ct:cq:raw', 'cardui:bk:raw']) assert.ok(ids(i).includes(x), x);
        i = await click('ui:ctm:nw:raw', priv({ ...ADM, fields: { name: 'Monday Mayhem' } }));
        assert.strictEqual((await q(`select name from card_shows where brand='raw'`))[0].name, 'Monday Mayhem');
        i = await click('ui:ct:au:raw', priv(ADM));
        assert.deepStrictEqual(modalOf(i).inputs, ['matches', 'name', 'signup']);
        i = await click('ui:ctm:au:raw', priv({ ...ADM, fields: { matches: '2', name: '', signup: 'no' } }));
        assert.match(text(i), /Booked the \*\*RAW\*\* card/, text(i));
        assert.ok((await q(`select count(*)::int n from card_draft_matches m join card_drafts d on d.id=m.draft_id where d.brand='raw'`))[0].n >= 1);
        i = await click('ui:ctm:au:raw', priv({ ...ADM, fields: { matches: '99', signup: 'no' } }));
        assert.match(text(i), /1 to 10/);
        i = await click('ui:ctm:sc:raw', priv({ ...ADM, fields: { date: '2026-12-01' } }));
        assert.match(text(i), /2026-12-01/);
        i = await click('ui:ct:ar:raw:off', priv(ADM));
        assert.strictEqual((await q(`select auto_recap from guilds where guild_id=$1`, [G]))[0].auto_recap, false);
        i = await click('ui:ct:up:raw', priv(ADM));
        assert.match(text(i), /Upcoming cards/);
        i = await click('ui:ct:cq:raw', priv(ADM));
        assert.ok(ids(i).includes('ui:ct:cy:raw'));
        i = await click('ui:ct:cy:raw', priv(ADM));
        assert.strictEqual((await q(`select count(*)::int n from card_drafts where brand='raw'`))[0].n, 0);
        const p = await click('ui:ct:h:raw', P('u1'));
        assert.match(text(p), /Only admins|staff/i);
    });

    await t('a match on the card has a 📼 Tale of the tape button that can post it here', async () => {
        const svc = require('../src/utils/cardService');
        await svc.addMatchToCard(G, 'smackdown', { matchType: 'singles', characterIds: [A, B] });
        const draft = (await q(`select id from card_drafts where brand='smackdown'`))[0].id;
        let i = await click(`cardui:pick:smackdown`, priv({ ...ADM, values: [`${draft}:1`] }));
        assert.ok(ids(i).includes(`ui:ct:tp:${draft}:1`), ids(i).join(' '));
        i = await click(`ui:ct:tp:${draft}:1`, priv(ADM));
        assert.ok((i.responses.at(-1).p.files || []).length, text(i));
        const before = sent.length;
        i = await click(`ui:ct:tq:${draft}:1`, priv(ADM));
        assert.ok(sent.length > before);
    });

    // ---------------- /championship ----------------
    const WH = (await q(`select id from titles where guild_id=$1 and division='mens' and not is_tag_title order by id limit 1`, [G]))[0].id;
    await t('/championship alone lists every title with the belt menu and grand slam / contender / rematch buttons', async () => {
        const i = await run('championship', null, {}, P('u1'));
        assert.match(text(i), /Championship Titles/);
        for (const x of ['ui:belt', 'ui:cs:gs:mens', 'ui:cs:cl', 'ui:cs:rm']) assert.ok(ids(i).includes(x), x);
        for (const x of ['ui:cs:gs:womens', 'ui:cs:cl', 'ui:cs:rm']) {
            const c = await click(x, P('u1'));
            assert.ok(c.responses.length && !bad(c), `${x}: ${text(c)}`);
        }
    });

    await t('/championship title: opens the belt; a player can challenge for it with their own wrestler', async () => {
        let i = await run('championship', null, { title: WH }, P('u3'));
        assert.ok((i.responses.at(-1).p.files || []).length);
        assert.ok(ids(i).includes(`chmp:ch:${WH}`) && ids(i).includes(`chmp:cl:${WH}`));
        assert.ok(!ids(i).includes(`chmp:vac:${WH}`));
        i = await click(`chmp:ch:${WH}`, P('u3'));
        assert.match(json(i), new RegExp(`chmp:chp:${WH}`));
        assert.match(json(i), /Cruz/);
        assert.ok(!/Ace/.test(json(i)), 'only their own wrestlers');
        i = await click(`chmp:chp:${WH}`, { ...P('u3'), values: [String(C)] });
        assert.match(text(i), /Challenge sent/);
        assert.strictEqual((await q(`select count(*)::int n from pending_requests where request_type='contender_challenge'`))[0].n, 1);
        i = await click(`chmp:ch:${WH}`, P('u99'));
        assert.match(text(i), /don't have a wrestler/);
        i = await click(`chmp:cl:${WH}`, P('u3'));
        assert.ok(!bad(i), text(i));
        i = await click(`chmp:rm:${WH}`, P('u3'));
        assert.ok(!bad(i), text(i));
    });

    await t('the old /championship subcommands still work inside the bot', async () => {
        const i = await run('championship', 'history', { title: WH }, P('u1'));
        assert.ok(!bad(i), text(i));
        const a = await require('./mock').auto('championship', null, 'title', '', {}, P('u1'));
        assert.ok(a && a.length, 'title autocomplete');
    });

    await t('Staff Tools links the admin panel and signups; help mentions /admin panel', async () => {
        const i = await click('ui:h:staff', priv(ADM));
        assert.ok(ids(i).includes('ui:ad:h') && ids(i).includes('ui:bk:h'));
        const h = await run('help', null, { command: 'admin' }, ADM);
        assert.match(text(h), /\/admin panel/);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    await f.pool.end(); process.exit(failed ? 1 : 0);
})();
