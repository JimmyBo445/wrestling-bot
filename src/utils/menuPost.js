// 3.10: a permanent menu post in a channel staff pick (/admin panel → 📌 Menu post).
// It always sits at the bottom: a few seconds after anyone else posts there, the bot deletes it and
// posts it again. If someone deletes it, it comes back. Every button answers only the person who pressed it.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { pool } = require('../db/pool');

const QUIET_MS = Number(process.env.MENU_QUIET_MS) || 10 * 1000; // wait this long after the last message before moving the menu down (tests shorten it)
const cache = new Map();    // guildId → { channelId, messageId }
const timers = new Map();
const busy = new Set();

const btn = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const row = (...c) => new ActionRowBuilder().addComponents(...c);

/** What the menu looks like. Button ids end in :mp so the usage report can count menu presses. */
function payload(guildName) {
    const embed = new EmbedBuilder().setColor(0xC0392B).setTitle(`🏟 ${guildName || 'FNLW'}: start here`).setDescription([
        'Tap a button. **Only you see the answer**, so you can\'t mess anything up.',
        '',
        '🆕 New here? **Make a wrestler** and staff will approve it.',
        '🙋 **My wrestlers**: edit them, see what you\'re booked in, report results.',
        '📨 **My requests**: see what\'s waiting for staff (and cancel it if you changed your mind).'
    ].join('\n'));
    return {
        embeds: [embed],
        components: [
            row(btn('ui:mk:h:mp', '🆕 Make a wrestler', ButtonStyle.Success), btn('ui:h:mine:mp', '🙋 My wrestlers', ButtonStyle.Primary), btn('ui:rp:h:mp', '📝 Report a result'), btn('ui:mr:h:mp', '📨 My requests')),
            row(btn('ui:h:champs:mp', '🏆 Champions'), btn('ui:h:show:mp', '📅 Next show'), btn('ui:h:results:mp', '📰 Results'), btn('ui:h:roster:mp', '📋 Roster')),
            row(btn('ui:h:stats:mp', '📊 Stats'), btn('ui:h:stand:mp', '📈 Standings'), btn('ui:h:legacy:mp', '🎖 Legacy'), btn('ui:h:help:mp', '❓ Help'))
        ],
        allowedMentions: { parse: [] }
    };
}

/** Posts the menu again at the bottom of its channel (and removes the old one). Returns the new message id or null. */
async function repost(client, guildId) {
    const c = cache.get(guildId);
    if (!c?.channelId || busy.has(guildId)) return null;
    busy.add(guildId);
    try {
        const ch = await client.channels.fetch(c.channelId).catch(() => null);
        if (!ch?.send) return null;
        const guildName = client.guilds?.cache?.get(guildId)?.name || ch.guild?.name;
        const msg = await ch.send(payload(guildName));
        const old = c.messageId;
        cache.set(guildId, { channelId: c.channelId, messageId: msg.id }); // set first, so deleting the old one isn't mistaken for "someone deleted the menu"
        await pool.query(`UPDATE guilds SET menu_message_id = $2 WHERE guild_id = $1`, [guildId, msg.id]);
        if (old) {
            try { const m = await ch.messages.fetch(old); await m.delete(); } catch (_) { /* already gone */ }
        }
        return msg.id;
    } catch (err) {
        console.error('Menu post failed:', err.message);
        return null;
    } finally { busy.delete(guildId); }
}

/** Staff picked a channel (or null to turn it off). */
async function setChannel(client, guildId, channelId) {
    const before = cache.get(guildId);
    if (before?.messageId) {
        try { const ch = await client.channels.fetch(before.channelId); const m = await ch.messages.fetch(before.messageId); cache.delete(guildId); await m.delete(); } catch (_) { /* gone */ }
    }
    await pool.query(`UPDATE guilds SET menu_channel_id = $2, menu_message_id = NULL WHERE guild_id = $1`, [guildId, channelId]);
    if (!channelId) { cache.delete(guildId); return null; }
    cache.set(guildId, { channelId, messageId: null });
    return repost(client, guildId);
}

/** Someone posted: move the menu down once the channel has been quiet for a few seconds. */
function onMessage(client, message) {
    const guildId = message.guildId;
    if (!guildId || message.author?.id === client.user?.id) return;
    const c = cache.get(guildId);
    if (!c || message.channelId !== c.channelId) return;
    clearTimeout(timers.get(guildId));
    timers.set(guildId, setTimeout(() => { timers.delete(guildId); repost(client, guildId); }, QUIET_MS));
}

/** Someone deleted the menu: put it back. */
function onDelete(client, message) {
    const c = cache.get(message.guildId);
    if (!c || message.id !== c.messageId) return;
    clearTimeout(timers.get(message.guildId));
    timers.set(message.guildId, setTimeout(() => { timers.delete(message.guildId); repost(client, message.guildId); }, 2000));
}

/** At startup: remember every menu, and repost any that went missing while the bot was offline. */
async function load(client) {
    const { rows } = await pool.query(`SELECT guild_id, menu_channel_id, menu_message_id FROM guilds WHERE menu_channel_id IS NOT NULL`);
    for (const r of rows) {
        cache.set(r.guild_id, { channelId: r.menu_channel_id, messageId: r.menu_message_id });
        let ok = false;
        if (r.menu_message_id) {
            try { const ch = await client.channels.fetch(r.menu_channel_id); await ch.messages.fetch(r.menu_message_id); ok = true; } catch (_) { ok = false; }
        }
        if (!ok) await repost(client, r.guild_id);
    }
}

const get = (guildId) => cache.get(guildId) || null;

module.exports = { payload, repost, setChannel, onMessage, onDelete, load, get, QUIET_MS };
