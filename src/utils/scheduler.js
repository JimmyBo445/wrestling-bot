const { AttachmentBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { buildSeasonData } = require('./season');
const { renderSeasonCard } = require('./cardRenderer');
const { prevMonthKey, buildMonthlyEmbed } = require('./monthly');
const { sendBackup } = require('./backup');
const { NO_MENTIONS } = require('./discordHelpers');
const { runTitleWatch, runRematchWatch } = require('./titleWatch');
const { runCardReminders } = require('./cardReminders');
const { postNewsletter, weekKey } = require('./newsletter');
const { localNow } = require('./titleWatch');

const WEEK_MS = 7 * 24 * 3600 * 1000;

/** Wrestlers whose injury ended: mark healthy and tell the matches channel. */
async function announceReturns(client) {
    const { rows } = await pool.query(
        `UPDATE injuries SET cleared_at = now(), announced = true
         WHERE announced = false AND cleared_at IS NULL AND returns_at < CURRENT_DATE RETURNING guild_id, character_id`);
    const by = new Map();
    for (const r of rows) { if (!by.has(r.guild_id)) by.set(r.guild_id, []); by.get(r.guild_id).push(r.character_id); }
    for (const [guildId, ids] of by) {
        try {
            const { rows: g } = await pool.query(`SELECT matches_channel_id FROM guilds WHERE guild_id = $1`, [guildId]);
            if (!g[0]?.matches_channel_id) continue;
            const { rows: names } = await pool.query(`SELECT c.name, u.discord_id FROM characters c JOIN users u ON u.id = c.owner_id WHERE c.id = ANY($1::bigint[]) ORDER BY c.name`, [ids]);
            const channel = await client.channels.fetch(g[0].matches_channel_id).catch(() => null);
            if (channel?.isTextBased()) await channel.send({ content: names.map((n) => `💪 **${n.name}** (<@${n.discord_id}>) is back from injury and ready to wrestle!`).join('\n'), allowedMentions: NO_MENTIONS });
        } catch (err) { console.error('Injury return post failed:', err.message); }
    }
}

async function tick(client) {
    try { await announceReturns(client); } catch (err) { console.error('Injury check failed:', err.message); }
    try {
        const { rows } = await pool.query(`SELECT * FROM guilds`);
        for (const g of rows) {
            try { await runRematchWatch(client, g); } catch (err) { console.error('Rematch watch failed:', err.message); }
            try { await runCardReminders(client, g); } catch (err) { console.error('Card reminder failed:', err.message); }
            try {
                // weekly newsletter: Monday from 9am (server time zone), once per week
                if (g.newsletter_channel_id) {
                    const key = weekKey();
                    const { date, hour } = localNow(g.tz);
                    const monday = new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
                    if (monday && hour >= 9 && g.newsletter_last !== key) {
                        const { rowCount } = await pool.query(`UPDATE guilds SET newsletter_last = $1 WHERE guild_id = $2 AND newsletter_last IS DISTINCT FROM $1`, [key, g.guild_id]);
                        if (rowCount) await postNewsletter(client, g, key);
                    }
                }
            } catch (err) { console.error('Newsletter failed:', err.message); }
            try { await runTitleWatch(client, g); } catch (err) { console.error('Title watch failed:', err.message); }
        }
    } catch (err) { console.error('Title checks failed:', err.message); }
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
            // after New Year: post last year's recap once, in the same channel as the monthly post
            const lastYear = new Date().getUTCFullYear() - 1;
            if (g.monthly_channel_id && g.season_last !== lastYear && new Date().getUTCMonth() === 0) {
                const { rowCount } = await pool.query(`UPDATE guilds SET season_last = $1 WHERE guild_id = $2 AND season_last IS DISTINCT FROM $1`, [lastYear, g.guild_id]);
                if (rowCount) {
                    try {
                        const channel = await client.channels.fetch(g.monthly_channel_id).catch(() => null);
                        const guild = client.guilds?.cache?.get(g.guild_id);
                        if (channel?.isTextBased() && guild) {
                            const d = await buildSeasonData(guild, lastYear);
                            if (d.matches) await channel.send({ content: `🏆 **${lastYear} Season Recap**`, files: [new AttachmentBuilder(await renderSeasonCard(d), { name: `season-${lastYear}.png` })] });
                        }
                    } catch (err) { console.error('Season recap post failed:', err.message); }
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
