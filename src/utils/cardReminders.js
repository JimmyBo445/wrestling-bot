const { AttachmentBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { renderShowCard } = require('../cards/showCard');
const svc = require('./cardService');
const { localNow, adminChannel } = require('./titleWatch');
const { NO_MENTIONS } = require('./discordHelpers');

/** From noon on show day, post "tonight's card" to the staff channel (once per card). */
async function runCardReminders(client, g, now = new Date()) {
    if (!g.admin_channel_id) return;
    const { date, hour } = localNow(g.tz, now);
    if (hour < 12) return;
    const { rows } = await pool.query(
        `SELECT * FROM card_shows WHERE guild_id = $1 AND show_date = $2::date AND reminded_on IS DISTINCT FROM $2::date`, [g.guild_id, date]);
    if (!rows.length) return;
    const ch = await adminChannel(client, g);
    const guild = client.guilds?.cache?.get(g.guild_id);
    for (const show of rows) {
        const claimed = await pool.query(`UPDATE card_shows SET reminded_on = $3::date WHERE guild_id = $1 AND brand = $2 AND reminded_on IS DISTINCT FROM $3::date`, [show.guild_id, show.brand, date]);
        if (!claimed.rowCount || !ch) continue;
        try {
            const drafts = await svc.filledDrafts(show.guild_id, show.brand);
            const total = drafts.reduce((n, d) => n + d.n, 0);
            const payload = { content: `📅 **Tonight's card: ${svc.brandLabel(show.brand)}${show.name ? ` — ${show.name}` : ''}** (${total} match${total === 1 ? '' : 'es'}). Log results with \`/match\` as they happen.\n${await svc.describeShow(show.guild_id, show.brand)}`.slice(0, 1900), allowedMentions: NO_MENTIONS };
            if (guild && drafts.length) {
                payload.files = [];
                for (const d of drafts.slice(0, 4)) payload.files.push(new AttachmentBuilder(await renderShowCard(await svc.buildShowData(guild, d)), { name: `tonights-card-${d.division}.png` }));
            }
            await ch.send(payload);
        } catch (err) { console.error('Card reminder failed:', err.message); }
    }
}

module.exports = { runCardReminders };
