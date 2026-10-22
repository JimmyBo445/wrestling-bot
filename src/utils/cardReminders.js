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
        `SELECT * FROM card_drafts WHERE guild_id = $1 AND show_date = $2::date AND reminded_on IS DISTINCT FROM $2::date`, [g.guild_id, date]);
    if (!rows.length) return;
    const ch = await adminChannel(client, g);
    const guild = client.guilds?.cache?.get(g.guild_id);
    for (const draft of rows) {
        const claimed = await pool.query(`UPDATE card_drafts SET reminded_on = $2::date WHERE id = $1 AND reminded_on IS DISTINCT FROM $2::date`, [draft.id, date]);
        if (!claimed.rowCount || !ch) continue;
        try {
            const slots = await svc.getDraftMatches(draft.id);
            const payload = { content: `📅 **Tonight's card: ${svc.cardLabel ? svc.cardLabel(draft) : `${svc.brandLabel(draft.brand)} ${svc.divisionLabel(draft.division)}`}${draft.name ? ` — ${draft.name}` : ''}** (${slots.length} match${slots.length === 1 ? '' : 'es'}). Log results with \`/match\` as they happen.\n${await svc.describeCard(draft)}`.slice(0, 1900), allowedMentions: NO_MENTIONS };
            if (guild && slots.length) payload.files = [new AttachmentBuilder(await renderShowCard(await svc.buildShowData(guild, draft)), { name: 'tonights-card.png' })];
            await ch.send(payload);
        } catch (err) { console.error('Card reminder failed:', err.message); }
    }
}

module.exports = { runCardReminders };
