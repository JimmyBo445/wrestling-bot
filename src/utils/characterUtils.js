const { pool } = require('../db/pool');
const { MAX_CHARACTERS_PER_USER } = require('./constants');

/**
 * Returns up to 25 approved characters matching the typed text, formatted as
 * "Name — @displayname (division)" for autocomplete. Value is the character id.
 */
async function autocompleteCharacters(interaction, focusedValue) {
    const guildId = interaction.guildId;
    const { rows } = await pool.query(
        `SELECT c.id, c.name, c.division, u.discord_id
         FROM characters c
         JOIN users u ON u.id = c.owner_id
         WHERE c.guild_id = $1 AND c.status = 'approved' AND c.name ILIKE $2
         ORDER BY c.name ASC
         LIMIT 25`,
        [guildId, `%${focusedValue}%`]
    );

    const results = [];
    for (const row of rows) {
        let username = row.discord_id;
        try {
            const member = await interaction.guild.members.fetch(row.discord_id);
            username = member.user.username;
        } catch (_) { /* member may have left; fall back to id */ }
        results.push({
            name: `${row.name} — @${username} (${row.division})`.slice(0, 100),
            value: String(row.id)
        });
    }
    return results;
}

async function getCharacterCount(guildId, ownerId) {
    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count FROM characters
         WHERE guild_id = $1 AND owner_id = $2 AND status IN ('approved','pending')`,
        [guildId, ownerId]
    );
    return rows[0].count;
}

async function canAddCharacter(guildId, ownerId) {
    const count = await getCharacterCount(guildId, ownerId);
    return count < MAX_CHARACTERS_PER_USER;
}

async function getCharacterById(characterId) {
    const { rows } = await pool.query(
        `SELECT c.*, u.discord_id AS owner_discord_id
         FROM characters c JOIN users u ON u.id = c.owner_id
         WHERE c.id = $1`,
        [characterId]
    );
    return rows[0] || null;
}

module.exports = { autocompleteCharacters, getCharacterCount, canAddCharacter, getCharacterById };
