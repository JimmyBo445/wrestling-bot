const { EmbedBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { DIVISION_LABELS } = require('./discordHelpers');

const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const prevMonthKey = (now = new Date()) => monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthRange(key) {
    const [y, m] = key.split('-').map(Number);
    return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)), label: `${MONTHS[m - 1]} ${y}` };
}

/** Top wrestler: most wins, then best win %, at least 3 decided matches. */
async function topWrestlers(guildId, start, end, limit = 3) {
    const { rows } = await pool.query(
        `SELECT c.id, c.name, c.division, u.discord_id,
                COUNT(*) FILTER (WHERE m.result_type = 'decisive' AND mp.is_winner)::int AS w,
                COUNT(*) FILTER (WHERE m.result_type = 'decisive' AND NOT mp.is_winner)::int AS l,
                COUNT(*) FILTER (WHERE m.is_title_match AND m.result_type = 'decisive' AND mp.is_winner)::int AS title_wins
         FROM match_participants mp JOIN matches m ON m.id = mp.match_id
         JOIN characters c ON c.id = mp.character_id JOIN users u ON u.id = c.owner_id
         WHERE m.guild_id = $1 AND m.created_at >= $2 AND m.created_at < $3
         GROUP BY c.id, c.name, c.division, u.discord_id
         HAVING COUNT(*) FILTER (WHERE m.result_type = 'decisive') >= 3 AND COUNT(*) FILTER (WHERE m.result_type = 'decisive' AND mp.is_winner) > 0
         ORDER BY w DESC, (COUNT(*) FILTER (WHERE m.result_type = 'decisive' AND mp.is_winner)::float / NULLIF(COUNT(*) FILTER (WHERE m.result_type = 'decisive'), 0)) DESC, title_wins DESC, c.name
         LIMIT ${Number(limit)}`, [guildId, start, end]);
    return rows;
}

/** Best match: highest star rating, newest first; if nothing is rated, the newest title match. */
async function bestMatch(guildId, start, end) {
    const base = `SELECT m.id, m.stars, m.match_type, m.is_title_match, m.created_at, t.name AS title_name,
                         (SELECT string_agg(c.name, ' & ' ORDER BY mp.id) FROM match_participants mp JOIN characters c ON c.id = mp.character_id WHERE mp.match_id = m.id AND mp.is_winner) AS winners,
                         (SELECT string_agg(c.name, ' & ' ORDER BY mp.id) FROM match_participants mp JOIN characters c ON c.id = mp.character_id WHERE mp.match_id = m.id AND NOT mp.is_winner) AS others
                  FROM matches m LEFT JOIN titles t ON t.id = m.title_id
                  WHERE m.guild_id = $1 AND m.created_at >= $2 AND m.created_at < $3`;
    const rated = await pool.query(`${base} AND m.stars IS NOT NULL ORDER BY m.stars DESC, m.created_at DESC, m.id DESC LIMIT 1`, [guildId, start, end]);
    if (rated.rows[0]) return { ...rated.rows[0], rated: true };
    const title = await pool.query(`${base} AND m.is_title_match ORDER BY m.created_at DESC, m.id DESC LIMIT 1`, [guildId, start, end]);
    return title.rows[0] ? { ...title.rows[0], rated: false } : null;
}

/** Pairs who met the most (singles and sides counted by actual opponents). */
async function rivalries(guildId, { start = null, end = null, limit = 5, min = 2 } = {}) {
    const { rows } = await pool.query(
        `SELECT a.character_id AS a_id, b.character_id AS b_id, ca.name AS a_name, cb.name AS b_name,
                COUNT(DISTINCT m.id)::int AS meetings,
                COUNT(DISTINCT m.id) FILTER (WHERE a.is_winner AND m.result_type = 'decisive')::int AS a_wins,
                COUNT(DISTINCT m.id) FILTER (WHERE b.is_winner AND m.result_type = 'decisive')::int AS b_wins
         FROM match_participants a
         JOIN match_participants b ON b.match_id = a.match_id AND a.character_id < b.character_id AND (a.team_number IS NULL OR b.team_number IS DISTINCT FROM a.team_number)
         JOIN matches m ON m.id = a.match_id
         JOIN characters ca ON ca.id = a.character_id JOIN characters cb ON cb.id = b.character_id
         WHERE m.guild_id = $1 AND ($2::timestamptz IS NULL OR m.created_at >= $2) AND ($3::timestamptz IS NULL OR m.created_at < $3)
         GROUP BY a.character_id, b.character_id, ca.name, cb.name
         HAVING COUNT(DISTINCT m.id) >= ${Number(min)}
         ORDER BY meetings DESC, (COUNT(DISTINCT m.id) FILTER (WHERE a.is_winner)) + (COUNT(DISTINCT m.id) FILTER (WHERE b.is_winner)) DESC LIMIT ${Number(limit)}`, [guildId, start, end]);
    return rows;
}

async function buildMonthlyEmbed(guildId, key) {
    const { start, end, label } = monthRange(key);
    const top = await topWrestlers(guildId, start, end, 3);
    const best = await bestMatch(guildId, start, end);
    const riv = await rivalries(guildId, { start, end, limit: 3 });
    const { rows: tot } = await pool.query(`SELECT COUNT(*)::int AS n FROM matches WHERE guild_id = $1 AND created_at >= $2 AND created_at < $3`, [guildId, start, end]);
    const embed = new EmbedBuilder().setColor(0xE8BF4A).setTitle(`🏆 ${label}: Wrestler of the Month`);
    if (!top.length) {
        embed.setDescription(`${tot[0].n ? `${tot[0].n} matches were logged, but nobody had 3+ decided matches with a win.` : 'No matches were logged this month.'}`);
        return { embed, empty: true, top, best, riv };
    }
    const w = top[0];
    embed.setDescription(`👑 **${w.name}** (<@${w.discord_id}>) · ${DIVISION_LABELS[w.division]}\n**${w.w}-${w.l}** this month${w.title_wins ? ` · ${w.title_wins} title match win${w.title_wins === 1 ? '' : 's'}` : ''}`);
    if (top.length > 1) embed.addFields({ name: 'Runners-up', value: top.slice(1).map((r, i) => `${i + 2}. ${r.name} (<@${r.discord_id}>) · ${r.w}-${r.l}`).join('\n') });
    if (best) embed.addFields({ name: `Match of the Month${best.rated ? ` ${'⭐'.repeat(best.stars)}` : ''}`, value: `${best.winners || '?'} def. ${best.others || '?'}${best.title_name ? ` · ${best.title_name}` : ''} (match #${best.id})` });
    if (riv.length) embed.addFields({ name: 'Hottest rivalries', value: riv.map((r) => `🔥 ${r.a_name} vs ${r.b_name}: ${r.meetings} meetings (${r.a_wins}-${r.b_wins})`).join('\n') });
    embed.setFooter({ text: `${tot[0].n} matches this month · 3+ decided matches to qualify` });
    return { embed, empty: false, top, best, riv };
}

module.exports = { monthKey, prevMonthKey, monthRange, buildMonthlyEmbed, rivalries, topWrestlers, bestMatch };
