process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:pw@localhost:54329/wrestle';
const { pool } = require('../src/db/pool');
const { runMigrations } = require('../src/db/migrator');
const { ensureGuild, ensureUser } = require('../src/utils/ensureGuild');

async function resetDb() {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runMigrations(() => {});
}

async function makeChar(guildId, discordId, name, division = 'mens', status = 'approved') {
    const ownerId = await ensureUser(guildId, discordId);
    const { rows } = await pool.query(
        `INSERT INTO characters (guild_id, owner_id, name, division, status, submitted_by) VALUES ($1,$2,$3,$4,$5,'t') RETURNING id`,
        [guildId, ownerId, name, division, status]);
    return String(rows[0].id);
}

async function makeTeam(guildId, name, division, charIds) {
    const { rows } = await pool.query(`INSERT INTO teams (guild_id, name, division, created_by) VALUES ($1,$2,$3,'t') RETURNING id`, [guildId, name, division]);
    for (const c of charIds) await pool.query(`INSERT INTO team_members (team_id, character_id) VALUES ($1,$2)`, [rows[0].id, c]);
    return String(rows[0].id);
}

async function titleId(guildId, name) {
    const { rows } = await pool.query(`SELECT id FROM titles WHERE guild_id=$1 AND name=$2`, [guildId, name]);
    return String(rows[0].id);
}

module.exports = { pool, resetDb, makeChar, makeTeam, titleId, ensureGuild, ensureUser };
