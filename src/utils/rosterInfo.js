// Shared lookups for /whois and /directory list: who plays which wrestler, and what belts they hold.
const { pool } = require('../db/pool');

/** Every wrestler in the server with its player. statuses: which character statuses to include. */
async function rosterRows(guildId, { statuses = ['approved'], division = null, ownerDiscordId = null } = {}) {
    const params = [guildId, statuses];
    let extra = '';
    if (division) { params.push(division); extra += ` AND c.division = $${params.length}`; }
    if (ownerDiscordId) { params.push(ownerDiscordId); extra += ` AND u.discord_id = $${params.length}`; }
    const { rows } = await pool.query(
        `SELECT c.id, c.name, c.division, c.status, c.owner_id, u.discord_id, u.is_placeholder AS unclaimed
         FROM characters c JOIN users u ON u.id = c.owner_id
         WHERE c.guild_id = $1 AND c.status = ANY($2::text[])${extra}
         ORDER BY lower(c.name), c.id`, params);
    return rows;
}

/** Map of character id → names of the belts they hold right now (singles, or as part of a tag team). */
async function currentTitles(guildId) {
    const { rows } = await pool.query(
        `SELECT x.character_id, t.name FROM (
             SELECT tr.character_id, tr.title_id FROM title_reigns tr
             WHERE tr.guild_id = $1 AND tr.lost_date IS NULL AND tr.team_id IS NULL AND tr.character_id IS NOT NULL
             UNION
             SELECT tm.character_id, tr.title_id FROM title_reigns tr JOIN team_members tm ON tm.team_id = tr.team_id AND tm.left_at IS NULL
             WHERE tr.guild_id = $1 AND tr.lost_date IS NULL
             UNION
             SELECT m.character_id, tr.title_id FROM title_reigns tr JOIN title_reign_members m ON m.reign_id = tr.id
             WHERE tr.guild_id = $1 AND tr.lost_date IS NULL AND m.character_id IS NOT NULL
         ) x JOIN titles t ON t.id = x.title_id ORDER BY t.name`, [guildId]);
    const map = new Map();
    for (const r of rows) map.set(String(r.character_id), [...(map.get(String(r.character_id)) || []), r.name]);
    return map;
}

/** Map of character id → active team names. */
async function activeTeams(guildId) {
    const { rows } = await pool.query(
        `SELECT tm.character_id, t.name FROM team_members tm JOIN teams t ON t.id = tm.team_id
         WHERE t.guild_id = $1 AND t.status = 'active' AND tm.left_at IS NULL ORDER BY t.name`, [guildId]);
    const map = new Map();
    for (const r of rows) map.set(String(r.character_id), [...(map.get(String(r.character_id)) || []), r.name]);
    return map;
}

/** Shortens "Women's Intercontinental Championship" to "Women's Intercontinental" for tight lists. */
const shortTitle = (n) => String(n).replace(/\s+Championships?$/i, '');

module.exports = { rosterRows, currentTitles, activeTeams, shortTitle };
