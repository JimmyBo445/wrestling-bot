const { pool } = require('../db/pool');
const { MAX_CHARACTERS_PER_USER } = require('./constants');
const { UserError } = require('./errors');
const { getDisplayNames, DIVISION_LABELS } = require('./discordHelpers');

/** Turns a dropdown value into a safe integer id, or null if the user typed free text. */
function parseId(value) {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    return /^\d{1,15}$/.test(s) ? s : null;
}

/**
 * Autocomplete list of characters. Option `statuses` controls which are shown
 * (default: approved only). Names are looked up in one batch and cached.
 */
async function autocompleteCharacters(interaction, focusedValue, { statuses = ['approved'], division = null } = {}) {
    const params = [interaction.guildId, statuses, `%${focusedValue.replace(/[%_]/g, '')}%`];
    let divisionSql = '';
    if (division) { params.push(division); divisionSql = `AND c.division = $4`; }
    const { rows } = await pool.query(
        `SELECT c.id, c.name, c.division, c.status, u.discord_id
         FROM characters c JOIN users u ON u.id = c.owner_id
         WHERE c.guild_id = $1 AND c.status = ANY($2) AND c.name ILIKE $3 ${divisionSql}
         ORDER BY c.name ASC LIMIT 25`,
        params
    );
    const names = await getDisplayNames(interaction.guild, rows.map((r) => r.discord_id));
    return rows.map((r) => ({
        name: `${r.name} — @${names.get(r.discord_id)} (${DIVISION_LABELS[r.division]})${r.status !== 'approved' ? ` [${r.status}]` : ''}`.slice(0, 100),
        value: String(r.id)
    }));
}

async function getCharacterCount(guildId, ownerId, client = pool) {
    const { rows } = await client.query(
        `SELECT COUNT(*)::int AS count FROM characters
         WHERE guild_id = $1 AND owner_id = $2 AND status IN ('approved','pending')`,
        [guildId, ownerId]
    );
    return rows[0].count;
}

async function canAddCharacter(guildId, ownerId, client = pool) {
    return (await getCharacterCount(guildId, ownerId, client)) < MAX_CHARACTERS_PER_USER;
}

/** Returns the character row (with owner_discord_id) or null. Never throws on bad input. */
async function getCharacterById(characterId, client = pool) {
    const id = parseId(characterId);
    if (!id) return null;
    const { rows } = await client.query(
        `SELECT c.*, u.discord_id AS owner_discord_id, u.is_placeholder AS unclaimed
         FROM characters c JOIN users u ON u.id = c.owner_id
         WHERE c.id = $1`,
        [id]
    );
    return rows[0] || null;
}

/** Like getCharacterById but must belong to this server; throws a friendly error otherwise. */
async function requireCharacter(guildId, value, { statuses = null, client = pool, claimed = false } = {}) {
    const c = await getCharacterById(value, client);
    if (!c || c.guild_id !== guildId) throw new UserError('I could not find that character. Pick one from the dropdown list that appears as you type.');
    if (statuses && !statuses.includes(c.status)) throw new UserError(`**${c.name}** is ${c.status}, so that isn't possible.`);
    if (claimed && c.unclaimed) throw new UserError(`**${c.name}** is unclaimed (no player owns them right now). Give them to a player with \`/character transfer\` first.`);
    return c;
}

const normName = (n) => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');

/** Throws if another (non-denied) character in this server already has this name, ignoring case, spaces, punctuation, accents and a leading "The". */
async function assertNameFree(guildId, name, excludeId = null, client = pool) {
    const key = normName(name);
    if (!key) return;
    const { rows } = await client.query(
        `SELECT c.id, c.name, c.status, u.discord_id, u.is_placeholder FROM characters c JOIN users u ON u.id = c.owner_id
         WHERE c.guild_id = $1 AND c.status <> 'denied'`, [guildId]);
    const hit = rows.find((r) => normName(r.name) === key && (excludeId === null || String(r.id) !== String(excludeId)));
    if (!hit) return;
    const who = hit.is_placeholder ? 'nobody (unclaimed)' : `<@${hit.discord_id}>`;
    const hint = hit.status === 'retired' ? ' They are retired, so an admin can bring them back with `/character restore`.' : hit.status === 'pending' ? ' They are waiting for approval.' : '';
    throw new UserError(`A character called **${hit.name}** already exists (owned by ${who}).${hint} Pick a different name.`);
}

module.exports = {
    normName, assertNameFree,
    parseId, autocompleteCharacters, getCharacterCount, canAddCharacter, getCharacterById, requireCharacter
};
