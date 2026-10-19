const { pool } = require('../db/pool');

/** Records an admin action so /admin audit can show who did what. Never throws. */
async function logAudit(guildId, actorId, action, details = {}, client = pool) {
    try {
        await client.query(
            `INSERT INTO audit_log (guild_id, actor_id, action, details) VALUES ($1, $2, $3, $4)`,
            [guildId, actorId, action, JSON.stringify(details)]
        );
    } catch (err) {
        console.error('Audit log write failed:', err.message);
    }
}

module.exports = { logAudit };
