const { pool } = require('../db/pool');
const { topWrestlers, bestMatch } = require('./monthly');
const { getDisplayNames, DIVISION_LABELS } = require('./discordHelpers');

function yearRange(year) {
    return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
}

/** Everything the season recap / standings need for one calendar year. */
async function buildSeasonData(guild, year) {
    const { start, end } = yearRange(year);
    const guildId = guild.id;
    const { rows: tot } = await pool.query(
        `SELECT COUNT(*)::int AS matches, COUNT(*) FILTER (WHERE is_title_match)::int AS title_matches
         FROM matches WHERE guild_id = $1 AND created_at >= $2 AND created_at < $3`, [guildId, start, end]);
    const wrestlers = await topWrestlers(guildId, start, end, 10);
    const { rows: players } = await pool.query(
        `SELECT u.discord_id,
                COUNT(DISTINCT m.id) FILTER (WHERE m.result_type = 'decisive' AND mp.is_winner)::int AS w,
                COUNT(DISTINCT m.id) FILTER (WHERE m.result_type = 'decisive' AND NOT mp.is_winner)::int AS l,
                COUNT(DISTINCT m.id)::int AS total
         FROM match_participants mp JOIN matches m ON m.id = mp.match_id JOIN users u ON u.id = mp.owner_id
         WHERE m.guild_id = $1 AND m.created_at >= $2 AND m.created_at < $3
         GROUP BY u.discord_id HAVING COUNT(DISTINCT m.id) FILTER (WHERE m.result_type = 'decisive' AND mp.is_winner) > 0
         ORDER BY w DESC, l ASC, u.discord_id LIMIT 10`, [guildId, start, end]);
    const names = await getDisplayNames(guild, players.map((p) => p.discord_id), 2500);
    const { rows: champs } = await pool.query(
        `SELECT t.name AS title, t.division, COALESCE(tm.name, c.name, tr.reign_char_name) AS holder
         FROM title_reigns tr JOIN titles t ON t.id = tr.title_id
         LEFT JOIN characters c ON c.id = tr.character_id LEFT JOIN teams tm ON tm.id = tr.team_id
         WHERE tr.guild_id = $1 AND tr.won_date < $2::date AND (tr.lost_date IS NULL OR tr.lost_date >= $2::date)
         ORDER BY t.division, t.name`, [guildId, end]);
    const { rows: changes } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM title_reigns WHERE guild_id = $1 AND won_date >= $2::date AND won_date < $3::date`, [guildId, start, end]);
    const best = await bestMatch(guildId, start, end);
    return {
        year, serverName: guild.name || null,
        matches: tot[0].matches, titleMatches: tot[0].title_matches, titleChanges: changes[0].n,
        wrestlers: wrestlers.map((w) => ({ name: w.name, division: w.division, w: w.w, l: w.l, discordId: w.discord_id })),
        players: players.map((p) => ({ name: names.get(p.discord_id) || 'unknown', discordId: p.discord_id, w: p.w, l: p.l, total: p.total })),
        champions: champs.map((c) => ({ title: c.title, division: c.division, holder: c.holder || 'Unknown' })),
        best: best ? { id: best.id, stars: best.stars, text: `${best.winners || '?'} def. ${best.others || '?'}`, title: best.title_name, rated: best.rated } : null
    };
}

module.exports = { buildSeasonData, yearRange, DIVISION_LABELS };
