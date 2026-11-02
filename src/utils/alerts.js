// Error alerts (3.0): when something breaks, tell the staff channel (/admin channels staff:) instead of failing quietly.
// The same problem is only reported once every 6 hours, so a broken channel can't flood the staff room.
const { pool } = require('../db/pool');

const QUIET_MS = 6 * 60 * 60 * 1000;
const lastSent = new Map(); // `${guildId}:${key}` -> time

/** Sends a short alert to the staff channel. Never throws. Returns true if it was sent. */
async function alertStaff(client, guildId, key, text) {
    try {
        if (!client || !guildId) return false;
        const k = `${guildId}:${key}`;
        if (Date.now() - (lastSent.get(k) || 0) < QUIET_MS) return false;
        const { rows } = await pool.query(`SELECT admin_channel_id FROM guilds WHERE guild_id = $1`, [guildId]);
        const chId = rows[0]?.admin_channel_id;
        if (!chId) return false;
        const ch = await client.channels.fetch(chId).catch(() => null);
        if (!ch?.isTextBased?.()) return false;
        lastSent.set(k, Date.now());
        await ch.send({ content: `⚠️ **Bot problem:** ${String(text).slice(0, 1800)}\n-# I'll only mention this again if it is still happening in 6 hours.`, allowedMentions: { parse: [] } });
        return true;
    } catch (_) { return false; }
}

const resetAlerts = () => lastSent.clear(); // for tests

module.exports = { alertStaff, resetAlerts };
