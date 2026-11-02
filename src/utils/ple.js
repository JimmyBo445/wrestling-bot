// PLE tags (3.0): which premium live event a match happened at ("WrestleMania", shown with its year).
// Tagging is optional and never changes a result. At a PLE, a Money in the Bank or Royal Rumble
// winner gets that Legacy accolade automatically.
const { pool } = require('../db/pool');
const { UserError } = require('./errors');
const L = require('./legacy');

const yearOf = (d) => new Date(d).getUTCFullYear();
/** "WrestleMania 2026" */
const pleLabel = (ple, date) => (ple ? `${ple} ${yearOf(date)}` : null);

function cleanName(raw) {
    const v = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!v) throw new UserError('Type the PLE name, e.g. WrestleMania.');
    if (v.length > 40) throw new UserError('Keep the PLE name under 40 characters.');
    // "WrestleMania 2026" → "WrestleMania" (the year comes from the match date)
    return v.replace(/\s+(19|20)\d\d$/, '');
}

/** PLE names used before, for autocomplete (most recent first). */
async function pleNames(guildId, typed = '') {
    const { rows } = await pool.query(
        `SELECT ple, MAX(created_at) AS last FROM matches WHERE guild_id = $1 AND ple IS NOT NULL GROUP BY ple ORDER BY last DESC LIMIT 50`, [guildId]);
    const t = String(typed).toLowerCase();
    return rows.map((r) => r.ple).filter((n) => n.toLowerCase().includes(t));
}

/** Matches logged on a day (in the server's time zone). */
async function matchIdsOnDate(guildId, date, tz = 'UTC') {
    let zone = tz || 'UTC';
    try { new Intl.DateTimeFormat('en-CA', { timeZone: zone }); } catch (_) { zone = 'UTC'; }
    const { rows } = await pool.query(
        `SELECT id FROM matches WHERE guild_id = $1 AND (created_at AT TIME ZONE $3)::date = $2::date ORDER BY id`, [guildId, date, zone]);
    return rows.map((r) => r.id);
}

/** If the match is a decisive MITB or Royal Rumble with one winner, give them the accolade. Returns [{row, ch}]. */
async function autoLegacy(guildId, matchId, actor) {
    const { rows } = await pool.query(`SELECT * FROM matches WHERE id = $1 AND guild_id = $2`, [matchId, guildId]);
    const m = rows[0];
    if (!m || !m.ple || m.result_type !== 'decisive') return [];
    const stip = String(m.stipulation || '').toLowerCase();
    const kind = /money in the bank|\bmitb\b/.test(stip) ? 'mitb' : /rumble/.test(stip) ? 'rumble' : null;
    if (!kind) return [];
    const { rows: winners } = await pool.query(
        `SELECT mp.character_id, mp.division, u.discord_id FROM match_participants mp LEFT JOIN users u ON u.id = mp.owner_id
         WHERE mp.match_id = $1 AND mp.is_winner`, [matchId]);
    if (winners.length !== 1) return []; // only a clear single winner earns it
    const { getCharacterById } = require('./characterUtils');
    const ch = await getCharacterById(winners[0].character_id);
    if (!ch) return [];
    const row = await L.giveAccolade(guildId, {
        kind, division: winners[0].division || ch.division, year: yearOf(m.created_at), character: ch,
        playerDiscord: winners[0].discord_id || null, notes: pleLabel(m.ple, m.created_at), actor
    });
    return row ? [{ row, ch }] : [];
}

/**
 * Tags matches with a PLE (or clears the tag with ple = null). Announces any automatic Legacy wins.
 * Returns { tagged, awards: [{row, ch}] }.
 */
async function tagMatches(client, guildId, matchIds, ple, actor) {
    if (!matchIds.length) return { tagged: 0, awards: [] };
    const { rowCount } = await pool.query(`UPDATE matches SET ple = $3 WHERE guild_id = $1 AND id = ANY($2::bigint[])`, [guildId, matchIds, ple]);
    const awards = [];
    if (ple) {
        for (const id of matchIds) awards.push(...(await autoLegacy(guildId, id, actor)));
        for (const a of awards) await L.announceAccolade(client, guildId, a.row, a.ch, `Won at ${a.row.notes}.`);
    }
    return { tagged: rowCount, awards };
}

/** A wrestler's record at PLEs. */
async function plePlayerRecord(characterId) {
    const { rows } = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE m.result_type = 'decisive' AND mp.is_winner)::int AS w,
                COUNT(*) FILTER (WHERE m.result_type = 'decisive' AND NOT mp.is_winner)::int AS l,
                COUNT(*) FILTER (WHERE m.result_type <> 'decisive')::int AS d
         FROM match_participants mp JOIN matches m ON m.id = mp.match_id
         WHERE mp.character_id = $1 AND m.ple IS NOT NULL`, [characterId]);
    return rows[0];
}

/** Wrestlers with the most PLE wins. */
async function pleLeaders(guildId, limit = 10) {
    const { rows } = await pool.query(
        `SELECT c.id, c.name, u.discord_id,
                COUNT(*) FILTER (WHERE m.result_type = 'decisive' AND mp.is_winner)::int AS w,
                COUNT(*) FILTER (WHERE m.result_type = 'decisive' AND NOT mp.is_winner)::int AS l
         FROM match_participants mp JOIN matches m ON m.id = mp.match_id JOIN characters c ON c.id = mp.character_id
         LEFT JOIN users u ON u.id = c.owner_id
         WHERE m.guild_id = $1 AND m.ple IS NOT NULL
         GROUP BY c.id, c.name, u.discord_id HAVING COUNT(*) FILTER (WHERE m.result_type = 'decisive' AND mp.is_winner) > 0
         ORDER BY w DESC, l ASC, c.name LIMIT $2`, [guildId, limit]);
    return rows;
}

/** Every PLE held, newest first: name, year, number of matches. */
async function pleList(guildId) {
    const { rows } = await pool.query(
        `SELECT ple, EXTRACT(YEAR FROM created_at)::int AS year, COUNT(*)::int AS matches, MIN(created_at) AS at
         FROM matches WHERE guild_id = $1 AND ple IS NOT NULL GROUP BY ple, year ORDER BY at DESC LIMIT 30`, [guildId]);
    return rows;
}

module.exports = { cleanName, pleNames, pleLabel, matchIdsOnDate, tagMatches, autoLegacy, plePlayerRecord, pleLeaders, pleList };
