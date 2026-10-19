const { pool } = require('../db/pool');
const { DEFAULT_TITLES } = require('./constants');

const ensured = new Set(); // guilds we already verified this process lifetime

/**
 * Ensures a guilds row and its default titles exist. Cheap no-op after the
 * first call per guild per bot restart.
 */
async function ensureGuild(guildId) {
    if (ensured.has(guildId)) return;
    await pool.query(
        `INSERT INTO guilds (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING`,
        [guildId]
    );
    // Insert any default title that's missing (also tops up older servers if a title is ever added)
    for (const t of DEFAULT_TITLES) {
        await pool.query(
            `INSERT INTO titles (guild_id, name, division, is_tag_title) VALUES ($1, $2, $3, $4)
             ON CONFLICT (guild_id, name) DO NOTHING`,
            [guildId, t.name, t.division, t.is_tag_title]
        );
    }
    ensured.add(guildId);
}

/** Ensures a users row exists for this discord user in this guild, returns the internal id. */
async function ensureUser(guildId, discordId, client = pool) {
    const { rows } = await client.query(
        `INSERT INTO users (guild_id, discord_id) VALUES ($1, $2)
         ON CONFLICT (guild_id, discord_id) DO UPDATE SET discord_id = EXCLUDED.discord_id
         RETURNING id`,
        [guildId, discordId]
    );
    return rows[0].id;
}

async function getGuildSettings(guildId, client = pool) {
    const { rows } = await client.query(`SELECT * FROM guilds WHERE guild_id = $1`, [guildId]);
    return rows[0];
}

module.exports = { ensureGuild, ensureUser, getGuildSettings };
