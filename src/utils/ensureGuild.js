const { pool } = require('../db/pool');
const { DEFAULT_TITLES } = require('./constants');

/**
 * Ensures a guilds row and its 9 default titles exist. Safe to call on
 * every interaction — cheap no-op after the first call per guild.
 */
async function ensureGuild(guildId) {
    await pool.query(
        `INSERT INTO guilds (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING`,
        [guildId]
    );

    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count FROM titles WHERE guild_id = $1`,
        [guildId]
    );

    if (rows[0].count === 0) {
        const values = [];
        const params = [];
        let i = 1;
        for (const t of DEFAULT_TITLES) {
            values.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
            params.push(guildId, t.name, t.division, t.is_tag_title);
        }
        await pool.query(
            `INSERT INTO titles (guild_id, name, division, is_tag_title) VALUES ${values.join(', ')}`,
            params
        );
    }
}

/**
 * Ensures a users row exists for this discord user in this guild, returns the internal id.
 */
async function ensureUser(guildId, discordId) {
    const existing = await pool.query(
        `SELECT id FROM users WHERE guild_id = $1 AND discord_id = $2`,
        [guildId, discordId]
    );
    if (existing.rows.length) return existing.rows[0].id;

    const inserted = await pool.query(
        `INSERT INTO users (guild_id, discord_id) VALUES ($1, $2) RETURNING id`,
        [guildId, discordId]
    );
    return inserted.rows[0].id;
}

module.exports = { ensureGuild, ensureUser };
