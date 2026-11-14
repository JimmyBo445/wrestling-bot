// Checkup tool (3.10.1): builds a league that looks like a real one, then presses every button and menu
// it can reach from every command, as staff and as a player, and reports anything that breaks:
//   • "Something went wrong" / logged errors / crashes
//   • buttons that lead nowhere ("older version" answers)
//   • messages Discord would refuse (too long, too many buttons, repeated button ids, bad menus)
// Run:  node test/crawl.js            (prints a report; exit code 1 if anything is wrong)
process.env.MENU_QUIET_MS = '20';
process.env.ROSTER_DEBOUNCE_MS = '20';
const f = require('./fixtures');
const { run, click, client } = require('./mock');

const problems = [];
const seen = new Set();
let clicks = 0;
const MAX_CLICKS = Number(process.env.CRAWL_MAX || 4000);
const G = 'g1';
const ADMIN = { admin: true, user: 'admin1' };
const PLAYER = { admin: false, user: 'u1' }; // owns Ace and Nova
const STRANGER = { admin: false, user: 'u77' }; // no wrestlers

// ------------------------------------------------------------------ catch logged errors
const origError = console.error;
let lastErrors = [];
console.error = (...a) => { lastErrors.push(a.map((x) => (x && x.stack) || String(x)).join(' ')); };

// ------------------------------------------------------------------ checks Discord would make
const toJ = (x) => (x && typeof x.toJSON === 'function' ? x.toJSON() : x);
function checkPayload(where, p) {
    if (!p || typeof p !== 'object') return;
    const bad = (m) => problems.push({ where, what: `Discord would refuse this: ${m}` });
    if (p.content && p.content.length > 2000) bad(`text is ${p.content.length} characters (max 2000)`);
    const embeds = (p.embeds || []).map(toJ);
    if (embeds.length > 10) bad('more than 10 embeds');
    let total = 0;
    for (const e of embeds) {
        const d = e.data || e;
        const len = (d.title || '').length + (d.description || '').length + (d.footer?.text || '').length + (d.author?.name || '').length
            + (d.fields || []).reduce((a, x) => a + x.name.length + x.value.length, 0);
        total += len;
        if ((d.title || '').length > 256) bad('embed title over 256');
        if ((d.description || '').length > 4096) bad('embed description over 4096');
        if ((d.fields || []).length > 25) bad('more than 25 embed fields');
        for (const x of d.fields || []) { if (!x.value || x.value.length > 1024) bad(`embed field "${x.name}" empty or over 1024`); if (x.name.length > 256) bad('field name over 256'); }
    }
    if (total > 6000) bad(`embeds total ${total} characters (max 6000)`);
    let rows;
    try { rows = (p.components || []).map(toJ); } catch (e) { bad(`component won't build: ${e.message}`); return; }
    if (rows.length > 5) bad(`${rows.length} rows of buttons (max 5)`);
    const idsHere = [];
    for (const r of rows) {
        const comps = r.components || [];
        if (!comps.length) bad('an empty row');
        if (comps.length > 5) bad('more than 5 buttons in a row');
        if (comps.some((c) => c.type !== 2) && comps.length > 1) bad('a menu shares its row with something else');
        for (const c of comps) {
            if (c.custom_id) { idsHere.push(c.custom_id); if (c.custom_id.length > 100) bad(`button id over 100: ${c.custom_id}`); }
            if (c.type === 2 && c.label && c.label.length > 80) bad(`button label over 80: ${c.label}`);
            if (c.type === 3) {
                if (!c.options?.length) bad(`menu ${c.custom_id} has no options`);
                if (c.options?.length > 25) bad(`menu ${c.custom_id} has ${c.options.length} options`);
                const vals = (c.options || []).map((o) => o.value);
                if (new Set(vals).size !== vals.length) bad(`menu ${c.custom_id} repeats a value`);
                for (const o of c.options || []) if (!o.label || o.label.length > 100 || (o.description || '').length > 100) bad(`menu ${c.custom_id} option label/description length`);
                if ((c.placeholder || '').length > 150) bad('menu placeholder over 150');
            }
        }
    }
    const dup = idsHere.filter((x, i) => idsHere.indexOf(x) !== i);
    if (dup.length) bad(`repeated button ids ${[...new Set(dup)].join(', ')}`);
}

/** Every component in the last answers, as { id, kind, values }. */
function targets(i) {
    const out = [];
    for (const r of i.responses) {
        const p = r.p;
        if (!p || typeof p !== 'object' || r.type === 'modal') continue;
        let rows = [];
        try { rows = (p.components || []).map(toJ); } catch (_) { continue; }
        for (const row of rows) for (const c of row.components || []) {
            if (!c.custom_id) continue;
            if (c.type === 2) out.push({ id: c.custom_id, disabled: c.disabled });
            else if (c.type === 3) out.push({ id: c.custom_id, select: (c.options || []).slice(0, 2).map((o) => o.value) });
            else if (c.type === 8) out.push({ id: c.custom_id, channel: true });
            else if (c.type === 6) out.push({ id: c.custom_id, role: true });
            else if (c.type === 5) out.push({ id: c.custom_id, user: true });
        }
    }
    return out;
}

/** Plausible answers for a pop-up form. */
function fillModal(m) {
    const j = toJ(m);
    const fields = {};
    for (const row of j.components) {
        const c = row.components[0];
        const id = c.custom_id;
        if (c.value !== undefined && c.value !== '') { fields[id] = c.value; continue; }
        if (/date|won|day/.test(id)) fields[id] = '2026-11-01';
        else if (/lost/.test(id)) fields[id] = '';
        else if (/year/.test(id)) fields[id] = '2026';
        else if (/defenses|matches|win|count|number|hours|days/.test(id)) fields[id] = '2';
        else if (/signup|interim/.test(id)) fields[id] = 'no';
        else if (/nominees|voters/.test(id)) fields[id] = 'everyone';
        else if (/alignment/.test(id)) fields[id] = 'heel';
        else if (/zone/.test(id)) fields[id] = 'America/Chicago';
        else if (/url|image/.test(id)) fields[id] = '';
        else if (/winner/.test(id)) fields[id] = '1';
        else if (/champion|name|title|opponent|event|text|reason|note|bio|finisher|story|partner/.test(id)) fields[id] = c.required ? `Crawl ${id}` : '';
        else fields[id] = c.required ? 'test' : '';
    }
    return { id: j.custom_id, fields };
}

/** Buttons that only repeat a screen with a different page/sort are checked a few times, not hundreds. */
function familyKey(id) {
    return id.replace(/\d{2,}/g, '#').split(':').slice(0, 4).join(':');
}
const familyCount = new Map();

async function press(who, t, from) {
    if (clicks >= MAX_CLICKS) return [];
    const key = `${who.user}|${t.id}|${t.select ? t.select[0] : ''}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const fam = `${who.user}|${familyKey(t.id)}`;
    const n = (familyCount.get(fam) || 0) + 1;
    familyCount.set(fam, n);
    if (n > 6) return [];
    const variants = t.select ? t.select.map((v) => ({ values: [v] })) : t.channel ? [{ kind: 'channel', values: ['crawlch'] }] : t.role ? [{ values: ['crawlrole'] }] : t.user ? [{ values: ['u2'] }] : [{}];
    const next = [];
    for (const v of variants) {
        clicks++;
        lastErrors = [];
        let i;
        const where = `${who === ADMIN ? 'staff' : who === PLAYER ? 'player' : 'stranger'} pressed ${t.id}${v.values ? ` (${v.values[0]})` : ''}  ← ${from}`;
        try { i = await click(t.id, { ...who, ...v, private: true }); }
        catch (e) { problems.push({ where, what: `crashed: ${e.message}` }); continue; }
        inspect(where, i);
        const modal = i.responses.find((r) => r.type === 'modal');
        if (modal) {
            let filled;
            try { filled = fillModal(modal.p); } catch (e) { problems.push({ where, what: `form won't build: ${e.message}` }); continue; }
            lastErrors = [];
            clicks++;
            let m;
            try { m = await click(filled.id, { ...who, fields: filled.fields, private: true }); } catch (e) { problems.push({ where: `${where} → form`, what: `crashed: ${e.message}` }); continue; }
            inspect(`${where} → submitted form ${filled.id}`, m);
            next.push(...targets(m).map((x) => ({ t: x, from: filled.id })));
        }
        next.push(...targets(i).map((x) => ({ t: x, from: t.id })));
    }
    return next;
}

const warnings = new Map();
const denied = new Set(); // things players were refused (should all be staff tools)
function inspect(where, i) {
    for (const r of i.responses) {
        const c = String(r.p?.content || '');
        const m = /⚠️ ([^\n]+)/.exec(c);
        if (m && !warnings.has(m[1].slice(0, 90))) warnings.set(m[1].slice(0, 90), where);
        if (m && /^Only admins/.test(m[1]) && !where.startsWith('staff')) denied.add(`${familyKey((where.split(' pressed ')[1] || where).split(' ')[0])}  → ${m[1].slice(0, 60)}`);
    }
    const all = i.responses.map((r) => [r.p?.content, ...((r.p?.embeds || []).map((e) => toJ(e).description || ''))].join(' ')).join(' ');
    if (/Something went wrong/.test(all)) problems.push({ where, what: `error shown to the user${lastErrors.length ? `: ${lastErrors[0].split('\n').slice(0, 3).join(' / ')}` : ''}` });
    else if (lastErrors.length) problems.push({ where, what: `logged error: ${lastErrors[0].split('\n').slice(0, 3).join(' / ')}` });
    if (/older version of the bot/.test(all)) problems.push({ where, what: 'button leads nowhere ("older version")' });
    if (!i.responses.length) problems.push({ where, what: 'no answer at all (Discord shows "This interaction failed")' });
    for (const r of i.responses) if (r.type !== 'modal') checkPayload(where, r.p);
}

async function crawlFrom(who, start, label) {
    let queue = start.map((t) => ({ t, from: label }));
    while (queue.length && clicks < MAX_CLICKS) {
        const next = [];
        for (const { t, from } of queue) {
            if (t.disabled) continue;
            next.push(...await press(who, t, from));
        }
        queue = next;
    }
}

// ------------------------------------------------------------------ a league that looks real
async function seed() {
    await f.resetDb();
    await f.ensureGuild(G);
    const P = (u) => ({ admin: false, user: u });
    const mk = (u, n, d) => f.makeChar(G, u, n, d);
    const W = {
        ace: await mk('u1', 'Ace Blackout', 'mens'), nova: await mk('u1', 'Nova', 'womens'),
        bolt: await mk('u2', 'Bolt', 'mens'), cruz: await mk('u3', 'Cruz Control', 'mens'), dax: await mk('u4', 'Dax Steele', 'mens'),
        eve: await mk('u5', 'Eve Storm', 'womens'), fia: await mk('u6', 'Fia Fury', 'womens'), gia: await mk('u7', 'Gia Gold', 'womens'),
        hex: await mk('u8', 'Hex', 'custom'), ivy: await mk('u9', 'Ivy Rose', 'custom_womens'),
        jax: await mk('ph1', 'Jax Legend', 'mens'), pend: await f.makeChar(G, 'u10', 'Pending Pete', 'mens', 'pending')
    };
    // big divisions, so every list gets a page 2 and 3 (more than 25 is where Discord menus run out)
    for (let k = 0; k < 55; k++) await mk(`r${k % 20}`, `Roster Man ${String(k).padStart(2, '0')}`, 'mens');
    for (let k = 0; k < 30; k++) await mk(`q${k % 15}`, `Roster Woman ${String(k).padStart(2, '0')}`, 'womens');
    await f.pool.query(`UPDATE users SET is_placeholder = true WHERE discord_id = 'ph1'`).catch(() => {});
    const A = { admin: true, user: 'admin1' };
    await run('admin', 'channels', { staff: 'staffch', matches: 'resultsch', legacy: 'legacych', power: 'powerch', reminders: 'remch', newsletter: 'newsch' }, A);
    await run('admin', 'rules', { timezone: 'America/Chicago' }, A);
    await run('team', 'create', { kind: 'tag', name: 'Bloody Widows', member1: W.eve, member2: W.fia }, A);
    await run('team', 'create', { kind: 'tag', name: 'Murda Mafia', member1: W.bolt, member2: W.dax }, A);
    await run('team', 'create', { kind: 'faction', name: 'The Syndicate', member1: W.ace, member2: W.cruz, member3: W.jax }, A);
    const wh = (await f.pool.query(`SELECT id FROM titles WHERE guild_id=$1 AND division='mens' AND NOT is_tag_title ORDER BY id LIMIT 1`, [G])).rows[0].id;
    const tagT = (await f.pool.query(`SELECT id FROM titles WHERE guild_id=$1 AND division='womens' AND is_tag_title ORDER BY id LIMIT 1`, [G])).rows[0]?.id;
    for (const [a, b, w] of [[W.ace, W.bolt, 1], [W.cruz, W.dax, 2], [W.ace, W.cruz, 1], [W.bolt, W.dax, 1], [W.eve, W.fia, 2], [W.gia, W.nova, 1], [W.hex, W.hex, 1]]) {
        if (a === b) continue;
        await run('match', 'log', { type: 'singles', wrestler1: a, wrestler2: b, winner: w }, A);
    }
    await run('match', 'log', { type: 'singles', wrestler1: W.ace, wrestler2: W.dax, winner: 1, title: wh }, A);
    await run('match', 'log', { type: 'singles', wrestler1: W.ace, wrestler2: W.bolt, winner: 1, title: wh }, A);
    await run('title', 'reign-add', { title: wh, champion_name: 'Old Legend', won_date: '2024-01-01', lost_date: '2024-06-01', defenses: 4 }, A);
    if (tagT) await run('title', 'reign-add', { title: tagT, champion_name: 'Retro Duo', won_date: '2024-02-01', lost_date: '2024-03-01' }, A);
    await run('match', 'ple', { event: 'WrestleMania' }, A);
    // cards
    await run('card', 'auto', { brand: 'raw', matches: 2, use_signup: false }, A);
    const svc = require('../src/utils/cardService');
    await svc.addMatchToCard(G, 'smackdown', { matchType: 'singles', characterIds: [W.eve, W.gia] });
    await run('card', 'schedule', { brand: 'smackdown', date: '2026-11-01' }, A);
    // signups, requests, challenges, reports
    await run('booking', 'signup-open', { title: 'RAW - Nov 20' }, A);
    const s = (await f.pool.query(`SELECT id FROM signups ORDER BY id DESC LIMIT 1`)).rows[0].id;
    for (const c of [W.ace, W.bolt, W.cruz]) await run('booking', 'signup-add', { signup: s, character: c }, A);
    await run('booking', 'request', { character: W.ace, opponent: W.cruz, note: 'Ladder match' }, P('u1'));
    await run('booking', 'request', { character: W.bolt, opponent: W.ace }, P('u2'));
    await click(`chmp:chp:${wh}`, { ...P('u3'), values: [W.cruz] });
    const draft = (await f.pool.query(`SELECT id FROM card_drafts WHERE brand='smackdown'`)).rows[0].id;
    await click(`ui:rpm:${draft}:1:1`, { ...P('u5'), private: true, fields: { finish: 'pin', score: '', notes: 'great match' } });
    // feuds, tournaments, contracts, legacy, injuries, hall of fame
    await run('feud', 'start', { wrestler1: W.ace, wrestler2: W.bolt }, A);
    await run('tournament', 'create', { name: 'King of the Ring', division: 'mens' }, A);
    const tn = (await f.pool.query(`SELECT id FROM tournaments`)).rows[0].id;
    for (const c of [W.ace, W.bolt, W.cruz, W.dax]) await run('tournament', 'add', { tournament: tn, character: c }, A);
    await run('tournament', 'start', { tournament: tn }, A);
    await run('contract', 'offer', { character: W.bolt, months: 6, salary: 1000 }, A);
    await run('contract', 'offer', { character: W.ace, months: 3, salary: 500 }, A);
    await run('legacy', 'award', { accolade: 'mitb', character: W.ace, year: 2025, announce: false }, A);
    await run('legacy', 'award', { accolade: 'rumble', character: W.eve, year: 2025, announce: false }, A);
    await run('legacy', 'vote-open', { accolade: 'mvp', year: 2026, nominees_by: 'everyone', voters: 'everyone' }, A);
    await run('directory', 'injury-add', { character: W.dax, days: 14, reason: 'Knee' }, A);
    await run('directory', 'hof-induct', { character: W.jax }, A);
    await run('admin', 'add', { text: 'Big show this Friday' }, { ...A, group: 'newsletter' });
    await click('ui:mp:s', { ...A, kind: 'channel', values: ['startch'], private: true });
    await click('ui:ch:s:roster', { ...A, kind: 'channel', values: ['rosterch'], private: true });
    await click('ui:ch:s:roster_womens', { ...A, kind: 'channel', values: ['womensch'], private: true });
    await click('ui:ch:s:champions', { ...A, kind: 'channel', values: ['champch'], private: true });
    await f.pool.query(`UPDATE characters SET overall = 88 WHERE id = $1`, [W.ace]);
    return W;
}

(async () => {
    const W = await seed();
    const seedProblems = problems.length;
    const cnt = async (t, w = '') => (await f.pool.query(`SELECT COUNT(*)::int n FROM ${t} ${w}`)).rows[0].n;
    console.log('seeded:', JSON.stringify({ chars: await cnt('characters'), matches: await cnt('matches'), teams: await cnt('teams'), factions: await cnt('factions'), reigns: await cnt('title_reigns'), drafts: await cnt('card_drafts'), signups: await cnt('signup_entries'), requests: await cnt('pending_requests'), reports: await cnt('match_reports'), feuds: await cnt('feuds'), tournaments: await cnt('tournaments'), contracts: await cnt('contracts'), legacy: await cnt('legacy'), polls: await cnt('award_polls'), injuries: await cnt('injuries'), hof: await cnt('hall_of_fame'), newsletter: await cnt('newsletter_entries') }));
    // every command as Discord lists it, with nothing filled in, plus the most common filled-in versions
    const starts = [];
    for (const [name, cmd] of client.commands) {
        if (['championship-legacy', 'faction'].includes(name)) continue;
        const j = cmd.data.toJSON();
        const subs = (j.options || []).filter((o) => o.type === 1);
        if (!subs.length) starts.push([name, null, {}]);
        for (const s of subs) if (!(s.options || []).some((o) => o.required)) starts.push([name, s.name, {}]);
    }
    const wh = (await f.pool.query(`SELECT id FROM titles WHERE guild_id=$1 AND division='mens' AND NOT is_tag_title ORDER BY id LIMIT 1`, [G])).rows[0].id;
    const fid = (await f.pool.query(`SELECT id FROM feuds LIMIT 1`)).rows[0].id;
    const tid = (await f.pool.query(`SELECT id FROM teams LIMIT 1`)).rows[0].id;
    starts.push(['stats', null, { wrestler: W.ace }], ['stats', null, { player: 'u1' }], ['legacy', null, { wrestler: W.ace }], ['championship', null, { title: wh }],
        ['title', 'manage', { title: wh }], ['feud', null, { feud: fid }], ['contract', null, { wrestler: W.bolt }], ['team', 'view', { group: `t:${tid}` }],
        ['directory', null, { page: 'hof' }], ['directory', null, { page: 'injuries' }], ['directory', null, { page: 'roster', division: 'mens' }],
        ['card', 'view', { brand: 'raw' }], ['card', 'view', { brand: 'smackdown' }], ['whois', null, { character: W.ace }], ['fnlw', null, {}]);
    const extraStarts = [{ id: 'ui:h:home' }, { id: 'ui:h:staff' }, { id: 'ui:ad:h' }, { id: 'ui:h:mine' }, { id: 'ui:mr:h' }, { id: 'ui:mk:h' }];
    for (const who of [ADMIN, PLAYER, STRANGER]) {
        const found = [...extraStarts];
        for (const [name, sub, opts] of starts) {
            lastErrors = [];
            let i;
            const where = `${who === ADMIN ? 'staff' : who === PLAYER ? 'player' : 'stranger'} ran /${name}${sub ? ` ${sub}` : ''} ${JSON.stringify(opts)}`;
            try { i = await run(name, sub, opts, who); } catch (e) { problems.push({ where, what: `crashed: ${e.message}` }); continue; }
            inspect(where, i);
            found.push(...targets(i));
        }
        await crawlFrom(who, found, 'start');
    }
    console.error = origError;
    const uniq = new Map();
    for (const p of problems) { const k = `${p.what}|${familyKey(p.where.split(' pressed ')[1] || p.where)}`; if (!uniq.has(k)) uniq.set(k, p); }
    console.log(`\nPressed ${clicks} buttons/menus/forms. Seed problems: ${seedProblems}. Problems found: ${uniq.size} (raw ${problems.length}).\n`);
    for (const p of uniq.values()) console.log(`• ${p.where}\n    ${p.what}`);
    if (process.env.CRAWL_WARN) { console.log(`\n${warnings.size} different ⚠️ messages people can get:`); for (const [w, where] of warnings) console.log(`  ⚠️ ${w}\n      (${where.slice(0, 160)})`); }
    if (process.env.CRAWL_WARN) { console.log(`\nPlayers were refused at:`); for (const d of [...denied].sort()) console.log(`  ${d}`); }
    if (process.env.CRAWL_FAMILIES) console.log([...familyCount.keys()].map((k) => k.split('|')[1]).filter((v, i, a) => a.indexOf(v) === i).sort().join('\n'));
    await f.pool.end();
    process.exit(uniq.size ? 1 : 0);
})().catch((e) => { console.error = origError; console.error(e); process.exit(2); });
