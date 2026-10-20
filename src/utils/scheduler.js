const { pool } = require('../db/pool');
const { prevMonthKey, buildMonthlyEmbed } = require('./monthly');
const { sendBackup } = require('./backup');
const { NO_MENTIONS } = require('./discordHelpers');

const WEEK_MS = 7 * 24 * 3600 * 1000;

async function tick(client) {
    try {
        const { rows } = await pool.query(`SELECT * FROM guilds WHERE monthly_channel_id IS NOT NULL OR backup_user_id IS NOT NULL`);
        const prev = prevMonthKey();
        for (const g of rows) {
            if (g.monthly_channel_id && g.monthly_last !== prev) {
                // claim the month first so a slow/failed post can never post twice
                const { rowCount } = await pool.query(`UPDATE guilds SET monthly_last = $1 WHERE guild_id = $2 AND monthly_last IS DISTINCT FROM $1`, [prev, g.guild_id]);
                if (rowCount) {
                    try {
                        const channel = await client.channels.fetch(g.monthly_channel_id).catch(() => null);
                        const { embed, empty } = await buildMonthlyEmbed(g.guild_id, prev);
                        if (channel?.isTextBased() && !empty) await channel.send({ embeds: [embed], allowedMentions: NO_MENTIONS });
                    } catch (err) { console.error('Monthly post failed:', err.message); }
                }
            }
            if (g.backup_user_id && (!g.backup_last || Date.now() - new Date(g.backup_last).getTime() >= WEEK_MS)) {
                await pool.query(`UPDATE guilds SET backup_last = now() WHERE guild_id = $1`, [g.guild_id]); // don't retry every hour if DMs are closed
                await sendBackup(client, g.guild_id, g.backup_user_id);
            }
        }
    } catch (err) {
        console.error('Scheduler error:', err.message);
    }
}

function start(client) {
    setTimeout(() => tick(client), 60 * 1000);
    setInterval(() => tick(client), 60 * 60 * 1000);
}

module.exports = { tick, start };
