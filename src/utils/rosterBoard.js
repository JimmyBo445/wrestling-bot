// 3.11 / 3.12: the live roster. Plain-text posts like the match card, every line
// "Wrestler (91 Overall) : @player", open wrestlers in their own section, then a "want a character?"
// post with buttons. Each division can have its own channel (📺 Channels → Live roster: Men's …);
// a division without one goes to the main roster channel. It keeps itself up to date: a few seconds
// after anything is done with the bot it edits only the posts that changed. Mentions never ping.
const crypto = require('crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown } = require('discord.js');
const { pool } = require('../db/pool');
const { DIVISION_LABELS } = require('./discordHelpers');

const DEBOUNCE_MS = Number(process.env.ROSTER_DEBOUNCE_MS) || 5000;
const CHUNK = 1800; // characters per post (Discord allows 2000 in a message)
const NOPING = { parse: [] };
const DIV_COLUMN = { mens: 'roster_channel_mens', womens: 'roster_channel_womens', custom: 'roster_channel_custom', custom_womens: 'roster_channel_custom_womens' };
const timers = new Map();
const busy = new Map(); // guildId → true while refreshing; 'again' if asked again meanwhile

const hash = (x) => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex');
const name = (r) => `**${escapeMarkdown(r.name)}**${r.overall ? ` (${r.overall} Overall)` : ''}`;

/** Which channel each division goes to: { mens: '123', … } (null = not posted). */
function routes(g) {
    const out = {};
    for (const d of Object.keys(DIVISION_LABELS)) out[d] = g?.[DIV_COLUMN[d]] || g?.roster_channel_id || null;
    return out;
}

/** The posts for one division, already split to fit. */
function divisionPosts(div, list) {
    const label = DIVISION_LABELS[div];
    const takenRows = list.filter((r) => !r.is_placeholder);
    const openRows = list.filter((r) => r.is_placeholder);
    const lines = takenRows.length ? takenRows.map((r) => `${name(r)} : <@${r.discord_id}>`) : ['_Nobody yet._'];
    if (openRows.length) lines.push('', `🟢 **Open — nobody plays them yet**`, ...openRows.map((r) => `${name(r)} : _open_`));
    const chunks = [];
    let cur = [];
    for (const l of lines) {
        if (cur.join('\n').length + l.length + 1 > CHUNK && cur.length) { chunks.push(cur); cur = []; }
        cur.push(l);
    }
    chunks.push(cur);
    return chunks.map((c, i) => ({
        slot: `${div}:${i}`,
        header: `📋 **${label} Division**${chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ''} · ${takenRows.length} taken · ${openRows.length} open`,
        body: c.join('\n')
    }));
}

const INFO = {
    slot: 'info', buttons: true,
    header: '🆕 **Want a character?**',
    body: [
        '• **Make your own:** press 🆕 Make a wrestler. Staff approve it and it shows up here.',
        '• **Want an 🟢 open one?** Ask staff and they\'ll give it to you.',
        '• **Waiting on staff?** 📨 My requests shows where your request stands.',
        '-# This channel updates by itself whenever someone gets, changes or gives up a character.'
    ].join('\n')
};

/** What should be posted: Map channelId → [posts in order]. */
async function plan(guildId) {
    const { rows: g } = await pool.query(`SELECT * FROM guilds WHERE guild_id = $1`, [guildId]);
    const where = routes(g[0]);
    const out = new Map();
    if (!Object.values(where).some(Boolean)) return out;
    const { rows } = await pool.query(
        `SELECT c.id, c.name, c.division, c.overall, u.discord_id, u.is_placeholder
         FROM characters c JOIN users u ON u.id = c.owner_id
         WHERE c.guild_id = $1 AND c.status = 'approved'
         ORDER BY lower(c.name), c.id`, [guildId]);
    for (const div of Object.keys(DIVISION_LABELS)) {
        const ch = where[div];
        if (!ch) continue;
        if (!out.has(ch)) out.set(ch, []);
        out.get(ch).push(...divisionPosts(div, rows.filter((r) => r.division === div)));
    }
    for (const list of out.values()) list.push(INFO);
    return out;
}

const keyOf = (p) => hash({ h: p.header, b: p.body });

function payload(p) {
    const content = `${p.header}\n\n${p.body}${p.buttons ? '' : `\n\n-# Updated <t:${Math.floor(Date.now() / 1000)}:R>`}`;
    const components = p.buttons ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ui:mk:h:rb').setLabel('🆕 Make a wrestler').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ui:mr:h:rb').setLabel('📨 My requests').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ui:h:roster:rb').setLabel('📋 Roster with records').setStyle(ButtonStyle.Secondary))] : [];
    return { content, embeds: [], components, allowedMentions: NOPING };
}

async function deletePosts(client, rows) {
    const byChannel = new Map();
    for (const r of rows) { if (!byChannel.has(r.channel_id)) byChannel.set(r.channel_id, []); byChannel.get(r.channel_id).push(r); }
    for (const [channelId, list] of byChannel) {
        const ch = await client.channels.fetch(channelId).catch(() => null);
        for (const r of list) {
            try { const m = await ch.messages.fetch(r.message_id); await m.delete(); } catch (_) { /* already gone */ }
        }
        await pool.query(`DELETE FROM roster_board_posts WHERE guild_id = $1 AND channel_id = $2`, [list[0].guild_id, channelId]);
    }
}

async function repost(ch, guildId, channelId, want) {
    for (let i = 0; i < want.length; i++) {
        const msg = await ch.send(payload(want[i]));
        await pool.query(`INSERT INTO roster_board_posts (guild_id, channel_id, position, slot, message_id, hash) VALUES ($1, $2, $3, $4, $5, $6)`,
            [guildId, channelId, i, want[i].slot, msg.id, keyOf(want[i])]);
    }
    return 'posted';
}

/** One channel up to date. */
async function refreshChannel(client, guildId, channelId, want, have, verify) {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch?.send) return 'failed';
    const sameShape = have.length === want.length && have.every((h, i) => h.slot === want[i].slot);
    if (sameShape && verify) {
        for (const h of have) {
            try { await ch.messages.fetch(h.message_id); } catch (_) { await deletePosts(client, have); return repost(ch, guildId, channelId, want); }
        }
    }
    if (!sameShape) { await deletePosts(client, have); return repost(ch, guildId, channelId, want); }
    let edited = 0;
    for (let i = 0; i < want.length; i++) {
        const k = keyOf(want[i]);
        if (have[i].hash === k) continue;
        let msg = null;
        try { msg = await ch.messages.fetch(have[i].message_id); } catch (_) { msg = null; }
        if (!msg) { await deletePosts(client, have); return repost(ch, guildId, channelId, want); }
        await msg.edit(payload(want[i]));
        await pool.query(`UPDATE roster_board_posts SET hash = $4 WHERE guild_id = $1 AND channel_id = $2 AND position = $3`, [guildId, channelId, i, k]);
        edited++;
    }
    return edited ? 'edited' : 'unchanged';
}

/**
 * Brings every roster channel up to date. Returns the overall result: 'posted', 'edited', 'unchanged',
 * 'off' (no roster channels) or 'failed' (a channel it couldn't post in).
 */
async function refresh(client, guildId, { verify = false } = {}) {
    if (busy.get(guildId)) { busy.set(guildId, 'again'); return 'busy'; }
    busy.set(guildId, true);
    try {
        const want = await plan(guildId);
        const { rows: have } = await pool.query(`SELECT * FROM roster_board_posts WHERE guild_id = $1 ORDER BY channel_id, position`, [guildId]);
        // channels that aren't used anymore lose their posts
        const stale = have.filter((h) => !want.has(h.channel_id));
        if (stale.length) await deletePosts(client, stale);
        if (!want.size) return 'off';
        const results = [];
        for (const [channelId, posts] of want) {
            results.push(await refreshChannel(client, guildId, channelId, posts, have.filter((h) => h.channel_id === channelId), verify));
        }
        for (const r of ['failed', 'posted', 'edited']) if (results.includes(r)) return r;
        return 'unchanged';
    } catch (err) {
        console.error('Roster channel update failed:', err.message);
        return 'failed';
    } finally {
        const again = busy.get(guildId) === 'again';
        busy.delete(guildId);
        if (again) schedule(client, guildId);
    }
}

/** Something happened in this server: check the roster a few seconds later (many clicks = one check). */
function schedule(client, guildId) {
    if (!guildId || !client) return;
    clearTimeout(timers.get(guildId));
    const t = setTimeout(() => { timers.delete(guildId); refresh(client, guildId).catch(() => {}); }, DEBOUNCE_MS);
    if (t.unref) t.unref();
    timers.set(guildId, t);
}

const COLUMN_FOR = { roster: 'roster_channel_id', roster_mens: DIV_COLUMN.mens, roster_womens: DIV_COLUMN.womens, roster_custom: DIV_COLUMN.custom, roster_custom_womens: DIV_COLUMN.custom_womens };

/**
 * Staff picked a channel for `key` ('roster' = main, 'roster_mens' … = one division), or null to turn it off.
 * Older callers may pass (client, guildId, channelId) for the main channel.
 */
async function setChannel(client, guildId, key, channelId) {
    if (arguments.length === 3) { channelId = key; key = 'roster'; }
    const col = COLUMN_FOR[key];
    if (!col) throw new Error(`unknown roster channel ${key}`);
    await pool.query(`UPDATE guilds SET ${col} = $2 WHERE guild_id = $1`, [guildId, channelId || null]);
    // a pick is a good moment to re-check every post (and to move posts that changed channel)
    const r = await refresh(client, guildId, { verify: true });
    const what = key === 'roster' ? 'The live roster' : `The ${DIVISION_LABELS[key.replace('roster_', '')]} roster`;
    if (!channelId) return `${what} is off here${r === 'off' ? ' (I removed its posts)' : ''}.${key !== 'roster' ? ' That division uses the main roster channel again, if one is set.' : ''}`;
    if (r === 'failed') return `⚠️ I couldn't post in <#${channelId}>. Check I can see it, send messages and read message history there.`;
    return `${what} is in <#${channelId}> and will keep itself up to date.`;
}

/** At startup and every hour: catch anything changed while the bot wasn't watching, and put back deleted posts. */
async function refreshAll(client) {
    const cols = ['roster_channel_id', ...Object.values(DIV_COLUMN)].map((c) => `${c} IS NOT NULL`).join(' OR ');
    const { rows } = await pool.query(`SELECT guild_id FROM guilds WHERE ${cols} OR guild_id IN (SELECT guild_id FROM roster_board_posts)`);
    for (const r of rows) await refresh(client, r.guild_id, { verify: true });
}

module.exports = { plan, refresh, schedule, setChannel, refreshAll, routes, DIV_COLUMN };
