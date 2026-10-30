// Championships credited to a PLAYER: every reign held by a wrestler they owned at the time.
const { pool } = require('../db/pool');

const DAYS = `(COALESCE(tr.lost_date, CURRENT_DATE) - tr.won_date)::int`;

async function playerTitleStats(guildId, userId) {
    const { rows } = await pool.query(
        `SELECT tr.id, t.name AS title, tr.won_date, tr.lost_date, tr.defenses, tr.is_interim, ${DAYS} AS days,
                COALESCE(tm.name, c.name, tr.reign_char_name) AS holder
         FROM reign_owners ro JOIN title_reigns tr ON tr.id = ro.reign_id JOIN titles t ON t.id = tr.title_id
         LEFT JOIN characters c ON c.id = tr.character_id LEFT JOIN teams tm ON tm.id = tr.team_id
         WHERE ro.user_id = $1 AND tr.guild_id = $2 ORDER BY tr.won_date DESC, tr.id DESC`, [userId, guildId]);
    return {
        reigns: rows.length, days: rows.reduce((a, r) => a + r.days, 0), defenses: rows.reduce((a, r) => a + r.defenses, 0),
        distinctTitles: new Set(rows.map((r) => r.title)).size,
        current: rows.filter((r) => !r.lost_date).map((r) => ({ title: r.title, holder: r.holder })),
        list: rows
    };
}

/** Players ranked by championship reigns. */
async function topChampions(guildId, limit = 15) {
    const { rows } = await pool.query(
        `SELECT u.discord_id, COUNT(*)::int AS reigns, COALESCE(SUM(${DAYS}), 0)::int AS days, COALESCE(SUM(tr.defenses), 0)::int AS defenses,
                COUNT(*) FILTER (WHERE tr.lost_date IS NULL)::int AS current
         FROM reign_owners ro JOIN users u ON u.id = ro.user_id JOIN title_reigns tr ON tr.id = ro.reign_id
         WHERE tr.guild_id = $1 AND NOT u.is_placeholder
         GROUP BY u.discord_id ORDER BY reigns DESC, days DESC LIMIT $2`, [guildId, limit]);
    return rows;
}

module.exports = { playerTitleStats, topChampions };
