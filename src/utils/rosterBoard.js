// 3.11: the live roster channel. One post per division (more if a division is very big), then a
// "want a character?" post with buttons. Every line is "Wrestler (91 Overall) : @player"; wrestlers
// nobody plays yet are listed as open. It keeps itself up to date: a few seconds after anything is done
// with the bot, it checks the lists and edits only the posts that changed. Mentions never ping.
const crypto = require('crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown } = require('discord.js');
const { pool } = require('../db/pool');
const { DIVISION_LABELS } = require('./discordHelpers');

const DEBOUNCE_MS = Number(process.env.ROSTER_DEBOUNCE_MS) || 5000;
const CHUNK = 3900; // characters per post (Discord allows 4096 in one embed)
const NOPING = { parse: [] };
const COLORS = { mens: 0x2E86DE, womens: 0xE84393, custom: 0x16A085, custom_womens: 0x8E44AD };
const timers = new Map();
const busy = new Map(); // guildId → true while refreshing; 'again' if asked again meanwhile

const hash = (x) => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex');
const name = (r) => `**${escapeMarkdown(r.name)}**${r.overall ? ` (${r.overall} Overall)` : ''}`;

/** What the channel should show right now: [{ slot, body, buttons }] in order. */
async function build(guildId) {
    const { rows } = await pool.query(
        `SELECT c.id, c.name, c.division, c.overall, u.discord_id, u.is_placeholder
         FROM characters c JOIN users u ON u.id = c.owner_id
         WHERE c.guild_id = $1 AND c.status = 'approved'
         ORDER BY lower(c.name), c.id`, [guildId]);
    const posts = [];
    for (const [div, label] of Object.entries(DIVISION_LABELS)) {
        const list = rows.filter((r) => r.division === div);
        const taken = list.filter((r) => !r.is_placeholder).map((r) => `${name(r)} : <@${r.discord_id}>`);
        const open = list.filter((r) => r.is_placeholder).map((r) => `${name(r)} : _open_`);
        const lines = taken.length ? [...taken] : ['_Nobody yet._'];
        if (open.length) lines.push('', `**🟢 Open — nobody plays them yet (${open.length})**`, ...open);
        // split very big divisions over several posts
        const chunks = [];
        let cur = [];
        for (const l of lines) {
            if (cur.join('\n').length + l.length + 1 > CHUNK && cur.length) { chunks.push(cur); cur = []; }
            cur.push(l);
        }
        chunks.push(cur);
        chunks.forEach((c, i) => posts.push({
            slot: `${div}:${i}`,
            title: `🤼 ${label}${chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ''}`,
            color: COLORS[div] || 0xC0392B,
            body: c.join('\n'),
            footer: `${taken.length} taken · ${open.length} open`
        }));
    }
    posts.push({ slot: 'info', title: '🆕 Want a character?', color: 0xC0392B, buttons: true,
        body: [
            '• **Make your own:** press 🆕 Make a wrestler. Staff approve it and it shows up here.',
            '• **Want an 🟢 open one?** Ask staff and they\'ll give it to you.',
            '• **Waiting on staff?** 📨 My requests shows where your request stands.',
            '',
            '_This channel updates by itself whenever someone gets, changes or gives up a character._'
        ].join('\n') });
    return posts;
}

function payload(p) {
    const embed = new EmbedBuilder().setColor(p.color).setTitle(p.title)
        .setDescription(`${p.body}\n\n-# Updated <t:${Math.floor(Date.now() / 1000)}:R>`);
    if (p.footer) embed.setFooter({ text: p.footer });
    const components = p.buttons ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ui:mk:h:rb').setLabel('🆕 Make a wrestler').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ui:mr:h:rb').setLabel('📨 My requests').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ui:h:roster:rb').setLabel('📋 Roster with records').setStyle(ButtonStyle.Secondary))] : [];
    return { embeds: [embed], components, allowedMentions: NOPING };
}

async function clearPosts(client, guildId, channelId) {
    const { rows } = await pool.query(`SELECT message_id FROM roster_board_posts WHERE guild_id = $1`, [guildId]);
    await pool.query(`DELETE FROM roster_board_posts WHERE guild_id = $1`, [guildId]);
    if (!channelId || !rows.length) return;
    const ch = await client.channels.fetch(channelId).catch(() => null);
    for (const r of rows) {
        try { const m = await ch.messages.fetch(r.message_id); await m.delete(); } catch (_) { /* already gone */ }
    }
}

/** Brings the channel up to date. Returns 'unchanged', 'edited', 'posted', 'off' or 'failed'. */
async function refresh(client, guildId, { verify = false } = {}) {
    if (busy.get(guildId)) { busy.set(guildId, 'again'); return 'busy'; }
    busy.set(guildId, true);
    try {
        const { rows: g } = await pool.query(`SELECT roster_channel_id FROM guilds WHERE guild_id = $1`, [guildId]);
        const channelId = g[0]?.roster_channel_id;
        if (!channelId) return 'off';
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (!ch?.send) return 'failed';
        const want = await build(guildId);
        const { rows: have } = await pool.query(`SELECT * FROM roster_board_posts WHERE guild_id = $1 ORDER BY position`, [guildId]);
        const sameShape = have.length === want.length && have.every((h, i) => h.slot === want[i].slot);
        if (sameShape && verify) {
            // hourly: make sure nobody deleted one of the posts
            for (const h of have) {
                try { await ch.messages.fetch(h.message_id); } catch (_) { await clearPosts(client, guildId, channelId); return await repost(ch, guildId, want); }
            }
        }
        if (sameShape) {
            let edited = 0;
            for (let i = 0; i < want.length; i++) {
                const hsh = hash({ t: want[i].title, b: want[i].body, f: want[i].footer || '' });
                if (have[i].hash === hsh) continue;
                let msg = null;
                try { msg = await ch.messages.fetch(have[i].message_id); } catch (_) { msg = null; }
                if (!msg) { await clearPosts(client, guildId, channelId); return await repost(ch, guildId, want); }
                await msg.edit(payload(want[i]));
                await pool.query(`UPDATE roster_board_posts SET hash = $3 WHERE guild_id = $1 AND position = $2`, [guildId, i, hsh]);
                edited++;
            }
            return edited ? 'edited' : 'unchanged';
        }
        await clearPosts(client, guildId, channelId);
        return await repost(ch, guildId, want);
    } catch (err) {
        console.error('Roster channel update failed:', err.message);
        return 'failed';
    } finally {
        const again = busy.get(guildId) === 'again';
        busy.delete(guildId);
        if (again) schedule(client, guildId);
    }
}

async function repost(ch, guildId, want) {
    for (let i = 0; i < want.length; i++) {
        const msg = await ch.send(payload(want[i]));
        await pool.query(`INSERT INTO roster_board_posts (guild_id, position, slot, message_id, hash) VALUES ($1, $2, $3, $4, $5)`,
            [guildId, i, want[i].slot, msg.id, hash({ t: want[i].title, b: want[i].body, f: want[i].footer || '' })]);
    }
    return 'posted';
}

/** Something happened in this server: check the roster a few seconds later (many clicks = one check). */
function schedule(client, guildId) {
    if (!guildId || !client) return;
    clearTimeout(timers.get(guildId));
    const t = setTimeout(() => { timers.delete(guildId); refresh(client, guildId).catch(() => {}); }, DEBOUNCE_MS);
    if (t.unref) t.unref();
    timers.set(guildId, t);
}

/** Staff picked a channel (or null to turn it off). */
async function setChannel(client, guildId, channelId) {
    const { rows } = await pool.query(`SELECT roster_channel_id FROM guilds WHERE guild_id = $1`, [guildId]);
    await clearPosts(client, guildId, rows[0]?.roster_channel_id);
    await pool.query(`UPDATE guilds SET roster_channel_id = $2 WHERE guild_id = $1`, [guildId, channelId || null]);
    if (!channelId) return 'The live roster is off (I removed its posts).';
    const r = await refresh(client, guildId);
    return r === 'posted' ? `The live roster is posted in <#${channelId}> and will keep itself up to date.`
        : `⚠️ I couldn't post in <#${channelId}>. Check I can see it, send messages, embed links and read message history there.`;
}

/** At startup and every hour: catch anything changed while the bot wasn't watching. */
async function refreshAll(client) {
    const { rows } = await pool.query(`SELECT guild_id FROM guilds WHERE roster_channel_id IS NOT NULL`);
    for (const r of rows) await refresh(client, r.guild_id, { verify: true });
}

module.exports = { build, refresh, schedule, setChannel, refreshAll };
