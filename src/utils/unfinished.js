// Unfinished matches (3.2): matches on a RAW / SmackDown card whose show date has passed
// but that have no result recorded yet. A card with no show date (/card schedule) counts from the day it was made. Staff can list them and ping the players any time;
// with a reminders channel set, the bot also pings them once a day from 1 pm (server time),
// starting the day after the show, for up to MAX_PINGS days in a row.
const { pool } = require('../db/pool');
const { MATCH_CONFIG, matchLabel } = require('./constants');
const { DIVISION_LABELS } = require('./discordHelpers');
const { localNow } = require('./titleWatch');

const MAX_PINGS = 6;
const PING_HOUR = 13; // 1 pm in the server's time zone (/admin rules timezone:)
const BRAND = { raw: 'RAW', smackdown: 'SmackDown', luchaderpy: 'LuchaDerpy' };
const mdy = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return `${m}/${d}/${String(y).slice(-2)}`; };

/** Every unfinished match, oldest show first. today = 'YYYY-MM-DD' in the server's time zone. */
async function listUnfinished(guildId, today) {
    // The show date set with /card schedule. A card with no date set counts from the day it was made.
    const { rows } = await pool.query(
        `WITH shows AS (
             SELECT cs.guild_id, cs.brand, cs.name, cs.show_date IS NULL AS no_date,
                    COALESCE(cs.show_date, (SELECT (MIN(d.created_at) AT TIME ZONE COALESCE(g.tz, 'UTC'))::date FROM card_drafts d
                                            WHERE d.guild_id = cs.guild_id AND d.brand = cs.brand)) AS day
             FROM card_shows cs JOIN guilds g ON g.guild_id = cs.guild_id
             WHERE cs.guild_id = $1)
         SELECT s.brand, s.name AS show_name, s.no_date, to_char(s.day, 'YYYY-MM-DD') AS show_ymd, ($2::date - s.day) AS days_late,
                cd.division, cdm.position, cdm.match_type, cdm.character_ids, cdm.title_id, cdm.stipulation,
                (SELECT t.name FROM titles t WHERE t.id = cdm.title_id) AS title_name
         FROM shows s
         JOIN card_drafts cd ON cd.guild_id = s.guild_id AND cd.brand = s.brand
         JOIN card_draft_matches cdm ON cdm.draft_id = cd.id
         WHERE s.day IS NOT NULL AND s.day < $2::date AND cdm.match_id IS NULL
         ORDER BY s.day, s.brand, cd.division, cdm.position`, [guildId, today]);
    const allIds = [...new Set(rows.flatMap((r) => (r.character_ids || []).map(String)))];
    const { rows: chars } = allIds.length
        ? await pool.query(`SELECT c.id, c.name, u.discord_id, u.is_placeholder FROM characters c JOIN users u ON u.id = c.owner_id WHERE c.id = ANY($1::bigint[])`, [allIds])
        : { rows: [] };
    const byId = new Map(chars.map((c) => [String(c.id), c]));
    const divOrder = Object.keys(DIVISION_LABELS);
    rows.sort((a, b) => a.show_ymd.localeCompare(b.show_ymd) || a.brand.localeCompare(b.brand) || divOrder.indexOf(a.division) - divOrder.indexOf(b.division) || a.position - b.position);
    return rows.map((r) => {
        const idsInOrder = (r.character_ids || []).map(String);
        const people = idsInOrder.map((id) => byId.get(id) || { id, name: 'TBD', is_placeholder: true });
        const players = [...new Set(people.filter((p) => !p.is_placeholder && p.discord_id).map((p) => p.discord_id))];
        const key = `${r.brand}:${r.match_type}:${[...idsInOrder].sort().join(',')}`;
        return { ...r, people, players, key };
    });
}

/** One line for a match. mention = tag the players (only in posts meant to ping them). */
function matchLine(m, { mention = false, extra = '' } = {}) {
    const who = (p) => (mention && !p.is_placeholder && p.discord_id ? `<@${p.discord_id}> (${p.name})` : `**${p.name}**`);
    const cfg = MATCH_CONFIG[m.match_type];
    let vs;
    if (cfg?.winnerMode === 'team') {
        const half = m.people.length / 2;
        vs = `${m.people.slice(0, half).map(who).join(' & ')} vs ${m.people.slice(half).map(who).join(' & ')}`;
    } else vs = m.people.map(who).join(' vs ');
    const bits = [m.title_name ? `🏆 ${m.title_name}` : null, m.stipulation, `${m.days_late} day${m.days_late === 1 ? '' : 's'} late`].filter(Boolean);
    return `• ${BRAND[m.brand] || m.brand} ${m.no_date ? `card from ${mdy(m.show_ymd)}` : mdy(m.show_ymd)} · ${DIVISION_LABELS[m.division] || m.division} #${m.position} (${matchLabel(m.match_type)}): ${vs} · ${bits.join(' · ')}${extra}`;
}

const BRAND_ICON = { raw: '🟥', smackdown: '🟦', luchaderpy: '🟪' };
const late = (n) => `${n} day${n === 1 ? '' : 's'} late`;

/** Short line for one match inside its card + division section: `#2` Ace vs Bolt · 🏆 IC · Street Fight */
function shortLine(m, { mention = false, extra = '' } = {}) {
    const who = (p) => (mention && !p.is_placeholder && p.discord_id ? `<@${p.discord_id}> (${p.name})` : `**${p.name}**`);
    const cfg = MATCH_CONFIG[m.match_type];
    let vs;
    if (cfg?.winnerMode === 'team') {
        const half = m.people.length / 2;
        vs = `${m.people.slice(0, half).map(who).join(' & ')} vs ${m.people.slice(half).map(who).join(' & ')}`;
    } else vs = m.people.map(who).join(' vs ');
    const type = m.match_type === 'singles' ? null : matchLabel(m.match_type);
    const bits = [type, m.title_name ? `🏆 ${m.title_name}` : null, m.stipulation].filter(Boolean);
    return `\`#${m.position}\` ${vs}${bits.length ? ` · ${bits.join(' · ')}` : ''}${extra}`;
}

/**
 * Groups matches by card (RAW / SmackDown, with its date) and then by division.
 * Returns [{ title, body }] — one section per card, body lines grouped under **division** headings.
 */
function sections(list, opts = {}) {
    const out = [];
    for (const m of list) {
        const key = `${m.brand}|${m.show_ymd}`;
        let sec = out.find((x) => x.key === key);
        if (!sec) {
            const when = m.no_date ? `card from ${mdy(m.show_ymd)}` : `show on ${mdy(m.show_ymd)}`;
            sec = { key, title: `${BRAND_ICON[m.brand] || '📅'} ${BRAND[m.brand] || m.brand}${m.show_name ? ` “${m.show_name}”` : ''} · ${when} · ${late(m.days_late)}`, lines: [], div: null, count: 0 };
            out.push(sec);
        }
        if (sec.div !== m.division) { sec.lines.push(`**${DIVISION_LABELS[m.division] || m.division}**`); sec.div = m.division; }
        sec.lines.push(shortLine(m, { ...opts, extra: opts.extras?.get(m.key) || '' }));
        sec.count++;
    }
    return out.map((x) => ({ title: x.title, lines: x.lines, count: x.count }));
}

/** Builds the ping messages (each under Discord's limit) and the list of people to notify. */
function pingMessages(list, { header, extras = new Map() } = {}) {
    const lines = [];
    for (const sec of sections(list, { mention: true, extras })) lines.push('', `__${sec.title}__`, ...sec.lines);
    const out = [];
    let cur = header;
    for (const l of lines) {
        if (cur.length + l.length + 1 > 1900) { out.push(cur); cur = ''; }
        cur += `${cur ? '\n' : ''}${l}`;
    }
    if (cur) out.push(cur);
    const users = [...new Set(list.flatMap((m) => m.players))].slice(0, 100);
    return { messages: out, users };
}

const PING_HEADER = '⏳ **Unfinished matches**: these were on the card but haven\'t been played yet. Please get them done, then let staff know so they can record the result!';

/** Staff "ping now": posts in `channel`. Returns how many matches were mentioned. Doesn't count toward the daily reminders. */
async function pingNow(channel, list) {
    if (!list.length) return 0;
    const { messages, users } = pingMessages(list, { header: PING_HEADER });
    for (const content of messages) await channel.send({ content, allowedMentions: { users } });
    return list.length;
}

/** Daily automatic reminder (called by the scheduler for every server). */
async function runUnfinishedReminders(client, g, now = new Date()) {
    if (!g.reminders_channel_id) return;
    const { date, hour } = localNow(g.tz, now);
    if (hour < PING_HOUR || g.unfinished_last === date || String(g.unfinished_last || '').slice(0, 10) === date) return;
    const { rowCount } = await pool.query(`UPDATE guilds SET unfinished_last = $1::date WHERE guild_id = $2 AND unfinished_last IS DISTINCT FROM $1::date`, [date, g.guild_id]);
    if (!rowCount) return; // another tick already did today
    const list = (await listUnfinished(g.guild_id, date)).filter((m) => m.players.length);
    if (!list.length) return;
    const { rows: sentRows } = await pool.query(`SELECT show_date::text AS d, match_key, sent FROM match_reminders WHERE guild_id = $1`, [g.guild_id]);
    const sentMap = new Map(sentRows.map((r) => [`${r.d}|${r.match_key}`, r.sent]));
    const due = list.filter((m) => (sentMap.get(`${m.show_ymd}|${m.key}`) || 0) < MAX_PINGS);
    if (!due.length) return;
    const extras = new Map();
    for (const m of due) {
        const n = (sentMap.get(`${m.show_ymd}|${m.key}`) || 0) + 1;
        extras.set(m.key, n === MAX_PINGS ? ' · **last reminder**' : ` · reminder ${n}/${MAX_PINGS}`);
    }
    const ch = await client.channels.fetch(g.reminders_channel_id).catch(() => null);
    if (!ch?.isTextBased?.()) throw new Error('I can\'t reach the match reminders channel. Check it still exists and that I can post there.');
    const { messages, users } = pingMessages(due, { header: PING_HEADER, extras });
    for (const content of messages) await ch.send({ content, allowedMentions: { users } });
    for (const m of due) {
        await pool.query(
            `INSERT INTO match_reminders (guild_id, show_date, match_key, sent, last_on) VALUES ($1, $2::date, $3, 1, $4::date)
             ON CONFLICT (guild_id, show_date, match_key) DO UPDATE SET sent = match_reminders.sent + 1, last_on = EXCLUDED.last_on`,
            [g.guild_id, m.show_ymd, m.key, date]);
    }
}

/** A player's own unfinished matches (for My Wrestlers). */
async function unfinishedFor(guildId, today, discordId) {
    return (await listUnfinished(guildId, today)).filter((m) => m.players.includes(String(discordId)));
}

module.exports = { MAX_PINGS, listUnfinished, matchLine, shortLine, sections, pingNow, runUnfinishedReminders, unfinishedFor };
