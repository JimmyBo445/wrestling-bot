const { pool } = require('../db/pool');
const { UserError } = require('./errors');
const { parseId } = require('./characterUtils');
const { DIVISION_LABELS } = require('./discordHelpers');

async function autocompleteTeams(interaction, focusedValue, { includeDisbanded = false } = {}) {
    const { rows } = await pool.query(
        `SELECT t.id, t.name, t.division, t.status,
                (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id AND tm.left_at IS NULL)::int AS members
         FROM teams t
         WHERE t.guild_id = $1 AND ($2 OR t.status = 'active') AND t.name ILIKE $3
         ORDER BY t.name LIMIT 25`,
        [interaction.guildId, includeDisbanded, `%${focusedValue.replace(/[%_]/g, '')}%`]
    );
    return rows.map((r) => ({
        name: `${r.name} (${DIVISION_LABELS[r.division]}, ${r.members} members${r.status !== 'active' ? ', disbanded' : ''})`.slice(0, 100),
        value: String(r.id)
    }));
}

async function getTeamById(value, client = pool) {
    const id = parseId(value);
    if (!id) return null;
    const { rows } = await client.query(`SELECT * FROM teams WHERE id = $1`, [id]);
    return rows[0] || null;
}

async function requireTeam(guildId, value, { active = true, client = pool } = {}) {
    const t = await getTeamById(value, client);
    if (!t || t.guild_id !== guildId) throw new UserError('I could not find that team. Pick one from the dropdown list that appears as you type.');
    if (active && t.status !== 'active') throw new UserError(`**${t.name}** has been disbanded.`);
    return t;
}

/** Active members, with owner discord ids, in join order. */
async function getTeamMembers(teamId, client = pool) {
    const { rows } = await client.query(
        `SELECT c.*, u.discord_id AS owner_discord_id
         FROM team_members tm
         JOIN characters c ON c.id = tm.character_id
         JOIN users u ON u.id = c.owner_id
         WHERE tm.team_id = $1 AND tm.left_at IS NULL
         ORDER BY tm.joined_at, tm.id`,
        [teamId]
    );
    return rows;
}

/** Active teams a character currently belongs to (a wrestler can be on several teams). */
async function getTeamsOfCharacter(characterId, client = pool) {
    const { rows } = await client.query(
        `SELECT t.* FROM team_members tm JOIN teams t ON t.id = tm.team_id
         WHERE tm.character_id = $1 AND tm.left_at IS NULL AND t.status = 'active' ORDER BY t.name`,
        [characterId]
    );
    return rows;
}

/**
 * Finds the registered, active team whose current members are EXACTLY these
 * characters (same people, no more, no fewer). Returns the team row or null.
 */
async function findTeamForCharacters(guildId, characterIds, client = pool) {
    const ids = characterIds.map(String);
    const { rows } = await client.query(
        `SELECT t.*
         FROM teams t
         WHERE t.guild_id = $1 AND t.status = 'active'
           AND (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id AND tm.left_at IS NULL) = $3
           AND NOT EXISTS (
               SELECT 1 FROM team_members tm WHERE tm.team_id = t.id AND tm.left_at IS NULL
                 AND tm.character_id::text <> ALL($2::text[]))
         LIMIT 1`,
        [guildId, ids, ids.length]
    );
    return rows[0] || null;
}

/** Titles the team currently holds. */
async function getTitlesHeldByTeam(teamId, client = pool) {
    const { rows } = await client.query(
        `SELECT t.id, t.name FROM title_reigns tr JOIN titles t ON t.id = tr.title_id
         WHERE tr.team_id = $1 AND tr.lost_date IS NULL`,
        [teamId]
    );
    return rows;
}

/** Titles an individual character currently holds (as a singles champion). */
async function getTitlesHeldByCharacter(characterId, client = pool) {
    const { rows } = await client.query(
        `SELECT t.id, t.name FROM title_reigns tr JOIN titles t ON t.id = tr.title_id
         WHERE tr.character_id = $1 AND tr.team_id IS NULL AND tr.lost_date IS NULL`,
        [characterId]
    );
    return rows;
}

module.exports = {
    autocompleteTeams, getTeamById, requireTeam, getTeamMembers, getTeamsOfCharacter,
    findTeamForCharacters, getTitlesHeldByTeam, getTitlesHeldByCharacter
};
