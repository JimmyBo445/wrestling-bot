const { pool, withTransaction } = require('../db/pool');
const { UserError } = require('./errors');
const { ensureUser } = require('./ensureGuild');
const { canAddCharacter } = require('./characterUtils');
const { logAudit } = require('./audit');

const MAX_BYTES = 300 * 1024;
const MAX_CHAR_ROWS = 200;
const MAX_RESULT_ROWS = 500;
const DISCORD_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'];

/** Downloads a small CSV the person attached in Discord. Tests replace this. */
async function downloadCsv(att) {
    if (att.size > MAX_BYTES) throw new UserError('That file is too big (300 KB max). Split it into smaller files.');
    let url;
    try { url = new URL(att.url); } catch (_) { throw new UserError('I couldn\'t read that attachment.'); }
    if (url.protocol !== 'https:' || !DISCORD_HOSTS.includes(url.hostname)) throw new UserError('Please attach the file directly in Discord.');
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new UserError('I couldn\'t download that file. Try attaching it again.');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new UserError('That file is too big (300 KB max).');
    return buf.toString('utf8');
}

/** Small CSV reader: quotes, commas and newlines inside quotes, BOM, Windows line endings. Also accepts tabs/semicolons. */
function parseCsv(text) {
    let s = String(text).replace(/^﻿/, '');
    const first = s.split(/\r?\n/, 1)[0] || '';
    const delim = [',', '\t', ';'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (quoted) {
            if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
            else if (ch === '"') quoted = false;
            else field += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === delim) { row.push(field); field = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && s[i + 1] === '\n') i++;
            row.push(field); field = '';
            if (row.some((c) => c.trim() !== '')) rows.push(row);
            row = [];
        } else field += ch;
    }
    row.push(field);
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    if (rows.length < 2) throw new UserError('The file needs a header row and at least one data row.');
    const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ''));
    return rows.slice(1).map((r, idx) => {
        const o = { _line: idx + 2 };
        header.forEach((h, c) => { if (h) o[h] = (r[c] || '').trim(); });
        return o;
    });
}

const DIV_ALIASES = {
    mens: 'mens', men: 'mens', male: 'mens', m: 'mens',
    womens: 'womens', women: 'womens', female: 'womens', w: 'womens',
    custom: 'custom', customs: 'custom',
    customwomens: 'custom_womens', customwomen: 'custom_womens', cw: 'custom_womens'
};
const normDivision = (v) => DIV_ALIASES[String(v || '').toLowerCase().replace(/[^a-z]/g, '')] || null;

/** Finds a member of the server from an id, a mention, or an exact username / display name. */
async function resolveOwner(guild, raw) {
    const v = String(raw || '').trim();
    if (!v) return null;
    const m = v.match(/^<@!?(\d{15,25})>$/) || v.match(/^(\d{15,25})$/);
    if (m) return m[1];
    const name = v.replace(/^@/, '').toLowerCase();
    try {
        const found = await guild.members.search({ query: name, limit: 10 });
        const hit = [...found.values()].find((x) => x.user.username.toLowerCase() === name || x.displayName.toLowerCase() === name || x.user.globalName?.toLowerCase() === name);
        return hit ? hit.id : null;
    } catch (_) { return null; }
}

/** Dry-runs (apply=false) or imports characters. Returns { ok:[], problems:[] }. */
async function importCharacters(guild, rows, { apply, actor }) {
    if (rows.length > MAX_CHAR_ROWS) throw new UserError(`Up to ${MAX_CHAR_ROWS} characters per file, please.`);
    const ok = [], problems = [];
    const plannedPerOwner = new Map();
    const seen = new Set();
    for (const r of rows) {
        const name = (r.name || r.character || r.wrestler || '').slice(0, 40);
        const division = normDivision(r.division);
        const ownerRaw = r.owner || r.player || r.user || r.discord;
        if (!name) { problems.push(`Line ${r._line}: no name.`); continue; }
        if (!division) { problems.push(`Line ${r._line} (${name}): division must be mens, womens, custom or custom womens.`); continue; }
        const discordId = await resolveOwner(guild, ownerRaw);
        if (!discordId) { problems.push(`Line ${r._line} (${name}): I couldn't find the player "${ownerRaw || ''}". Use their Discord ID or exact username.`); continue; }
        const key = `${discordId}:${name.toLowerCase()}`;
        if (seen.has(key)) { problems.push(`Line ${r._line} (${name}): listed twice for the same player.`); continue; }
        seen.add(key);
        const { rows: dupe } = await pool.query(
            `SELECT 1 FROM characters c JOIN users u ON u.id = c.owner_id WHERE c.guild_id = $1 AND u.discord_id = $2 AND lower(c.name) = lower($3) AND c.status <> 'denied'`, [guild.id, discordId, name]);
        if (dupe.length) { problems.push(`Line ${r._line} (${name}): that player already has a character with this name. Skipped.`); continue; }
        const ownerId = await ensureUser(guild.id, discordId);
        const planned = plannedPerOwner.get(discordId) || 0;
        const { rows: cnt } = await pool.query(`SELECT COUNT(*)::int AS n FROM characters WHERE guild_id = $1 AND owner_id = $2 AND status IN ('approved','pending')`, [guild.id, ownerId]);
        if (!(await canAddCharacter(guild.id, ownerId)) || cnt[0].n + planned >= require('./constants').MAX_CHARACTERS_PER_USER) {
            problems.push(`Line ${r._line} (${name}): that player is already at the character limit.`); continue;
        }
        plannedPerOwner.set(discordId, planned + 1);
        const alignment = ['face', 'heel', 'neutral'].includes((r.alignment || '').toLowerCase()) ? r.alignment.toLowerCase() : null;
        ok.push({ name, division, discordId, ownerId, alignment, bio: (r.bio || '').slice(0, 120) || null, finisher: (r.finisher || '').slice(0, 40) || null, theme: (r.entrancetheme || r.theme || '').slice(0, 60) || null });
    }
    if (apply && ok.length) {
        await withTransaction(async (client) => {
            for (const c of ok) {
                await client.query(
                    `INSERT INTO characters (guild_id, owner_id, name, division, alignment, bio, finisher, entrance_theme, status, submitted_by, approved_by, approved_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'approved',$9,$9,now())`,
                    [guild.id, c.ownerId, c.name, c.division, c.alignment, c.bio, c.finisher, c.theme, actor]);
            }
        });
        await logAudit(guild.id, actor, 'import_characters', { count: ok.length });
    }
    return { ok, problems };
}

/** Dry-runs or imports plain past results (singles): winner, loser, date, stipulation, notes, result (win or draw). */
async function importResults(guildId, rows, { apply, actor }) {
    if (rows.length > MAX_RESULT_ROWS) throw new UserError(`Up to ${MAX_RESULT_ROWS} results per file, please.`);
    const { rows: chars } = await pool.query(`SELECT id, name, owner_id, division FROM characters WHERE guild_id = $1 AND status IN ('approved','retired')`, [guildId]);
    const byName = new Map();
    for (const c of chars) { const k = c.name.toLowerCase(); byName.set(k, [...(byName.get(k) || []), c]); }
    const pick = (name) => {
        const list = byName.get(String(name || '').trim().toLowerCase()) || [];
        return list.length === 1 ? { c: list[0] } : { err: list.length ? `"${name}" matches more than one character` : `I don't know a character called "${name}"` };
    };
    const ok = [], problems = [];
    const today = new Date().toISOString().slice(0, 10);
    for (const r of rows) {
        const a = pick(r.winner || r.wrestler1 || r.character1), b = pick(r.loser || r.wrestler2 || r.character2);
        if (a.err || b.err) { problems.push(`Line ${r._line}: ${a.err || b.err}.`); continue; }
        if (a.c.id === b.c.id) { problems.push(`Line ${r._line}: a wrestler can't face themselves.`); continue; }
        const date = (r.date || today).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00Z`).getTime())) { problems.push(`Line ${r._line}: date must look like 2026-03-21.`); continue; }
        if (date > today) { problems.push(`Line ${r._line}: that date is in the future.`); continue; }
        const draw = /^draw/i.test(r.result || '');
        const stip = (r.stipulation || '').slice(0, 40) || null;
        ok.push({ a: a.c, b: b.c, date, draw, stip, notes: (r.notes || '').slice(0, 300) || null });
    }
    if (apply && ok.length) {
        await withTransaction(async (client) => {
            for (const m of ok) {
                const { rows: ins } = await client.query(
                    `INSERT INTO matches (guild_id, match_type, result_type, logged_by, notes, stipulation, created_at)
                     VALUES ($1,'singles',$2,$3,$4,$5,$6::date + time '12:00') RETURNING id`, [guildId, m.draw ? 'draw' : 'decisive', actor, m.notes, m.stip, m.date]);
                for (const [c, win] of [[m.a, !m.draw], [m.b, false]]) {
                    await client.query(
                        `INSERT INTO match_participants (match_id, character_id, is_winner, owner_id, division) VALUES ($1,$2,$3,$4,$5)`, [ins[0].id, c.id, win, c.owner_id, c.division]);
                }
            }
        });
        await logAudit(guildId, actor, 'import_results', { count: ok.length });
    }
    return { ok, problems };
}

const TEMPLATES = {
    characters: 'name,division,owner,alignment,bio,finisher\nThe Titan,mens,123456789012345678,heel,Steel city bruiser,Titan Drop\nQueen Bee,womens,someusername,face,,Sting Slam\n',
    results: 'winner,loser,date,stipulation,notes,result\nThe Titan,Hawk,2026-03-14,Steel Cage,Great main event,win\nQueen Bee,Raven,2026-03-21,,,draw\n'
};

module.exports = { parseCsv, importCharacters, importResults, normDivision, resolveOwner, TEMPLATES, downloadCsv, MAX_CHAR_ROWS, MAX_RESULT_ROWS };
