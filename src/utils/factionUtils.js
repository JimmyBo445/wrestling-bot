const { pool } = require('../db/pool');
const { UserError } = require('./errors');
const { parseId } = require('./characterUtils');
const { DIVISION_LABELS, getDisplayNames } = require('./discordHelpers');
const { computeStreaks, recentForm } = require('./streaks');
const { tally } = require('./statsQueries');
const { getTitlesHeldByCharacter } = require('./teamUtils');

const MIN_FACTION = 3;
const MAX_FACTION = 8;

async function autocompleteFactions(interaction, focusedValue, { includeDisbanded = false } = {}) {
    const { rows } = await pool.query(
        `SELECT f.id, f.name, f.division, f.status,
                (SELECT COUNT(*) FROM faction_members fm WHERE fm.faction_id = f.id AND fm.left_at IS NULL)::int AS members
         FROM factions f
         WHERE f.guild_id = $1 AND ($2 OR f.status = 'active') AND f.name ILIKE $3 ORDER BY f.name LIMIT 25`,
        [interaction.guildId, includeDisbanded, `%${String(focusedValue).replace(/[%_]/g, '')}%`]);
    return rows.map((r) => ({ name: `${r.name} (${DIVISION_LABELS[r.division]}, ${r.members} members${r.status !== 'active' ? ', disbanded' : ''})`.slice(0, 100), value: String(r.id) }));
}

async function requireFaction(guildId, value, { active = true } = {}) {
    const id = parseId(value);
    const { rows } = id ? await pool.query(`SELECT * FROM factions WHERE id = $1 AND guild_id = $2`, [id, guildId]) : { rows: [] };
    const f = rows[0];
    if (!f) throw new UserError('I could not find that faction. Pick one from the dropdown list that appears as you type.');
    if (active && f.status !== 'active') throw new UserError(`**${f.name}** has been disbanded.`);
    return f;
}

async function getFactionMembers(factionId, client = pool) {
    const { rows } = await client.query(
        `SELECT c.*, u.discord_id AS owner_discord_id
         FROM faction_members fm JOIN characters c ON c.id = fm.character_id JOIN users u ON u.id = c.owner_id
         WHERE fm.faction_id = $1 AND fm.left_at IS NULL ORDER BY fm.joined_at, c.name`, [factionId]);
    return rows;
}

async function factionOfCharacter(characterId, client = pool) {
    const { rows } = await client.query(
        `SELECT f.* FROM faction_members fm JOIN factions f ON f.id = fm.faction_id
         WHERE fm.character_id = $1 AND fm.left_at IS NULL AND f.status = 'active'`, [characterId]);
    return rows[0] || null;
}

/**
 * Shared faction record: a match counts once for the faction when at least one member took part
 * while they were in it. It's a win if a member's side won, a loss if members took part and none won.
 */
async function factionSummary(factionId) {
    const { rows } = await pool.query(
        `SELECT m.id, m.result_type, m.created_at, m.is_title_match, bool_or(mp.is_winner) AS won
         FROM faction_members fm
         JOIN match_participants mp ON mp.character_id = fm.character_id
         JOIN matches m ON m.id = mp.match_id AND m.created_at >= fm.joined_at AND (fm.left_at IS NULL OR m.created_at <= fm.left_at)
         WHERE fm.faction_id = $1 GROUP BY m.id ORDER BY m.created_at, m.id`, [factionId]);
    const timeline = rows.map((r) => ({ ...r, result: r.result_type === 'draw' ? 'D' : r.result_type === 'no_contest' ? 'NC' : r.won ? 'W' : 'L' }));
    const results = timeline.map((r) => r.result);
    return { ...tally(timeline), streaks: computeStreaks(results), form: recentForm(results, 5) };
}

async function buildFactionData(guild, faction) {
    const members = await getFactionMembers(faction.id);
    const names = await getDisplayNames(guild, members.map((m) => m.owner_discord_id), 2500);
    const summary = await factionSummary(faction.id);
    const held = [];
    for (const m of members) for (const t of await getTitlesHeldByCharacter(m.id)) held.push(`${t.name || t}`);
    return {
        serverName: guild.name || null,
        faction: { name: faction.name, division: faction.division, status: faction.status },
        members: members.map((c) => ({ name: c.name, division: c.division, imageUrl: c.image_url, owner: names.get(c.owner_discord_id) || 'unknown' })),
        summary, titlesHeld: [...new Set(held)]
    };
}

module.exports = { MIN_FACTION, MAX_FACTION, autocompleteFactions, requireFaction, getFactionMembers, factionOfCharacter, factionSummary, buildFactionData };
