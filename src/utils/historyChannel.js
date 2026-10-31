// Keeps a championship history channel up to date: one message per title, in the same style
// as a hand-written history post ("3x @player", "1st Reign - 2 Defenses", "4/1/23-5/23/23").
// The bot edits its own messages, so nobody gets pinged and the channel doesn't fill up.
const { pool } = require('../db/pool');
const { getGuildSettings } = require('./ensureGuild');

const MAX_LEN = 1900;
const DIVIDER = '━━━━━━━━━━━━━━━━━━━━';
const NO_PINGS = { parse: [] };
const TRIGGERS = /^(match_logged|match_undone|match_edited|reign_|title_vacated|title_auto_vacated|interim_crowned|title_unified|defense_|import_titles|team_renamed|character_edited|character_transferred|character_unclaimed)/;

const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
/** M/D/YY. pg gives DATE columns as local-midnight Dates; strings are YYYY-MM-DD. */
function shortDate(d) {
    if (!d) return '';
    let y, m, day;
    if (d instanceof Date) { y = d.getFullYear(); m = d.getMonth() + 1; day = d.getDate(); }
    else [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
    return `${m}/${day}/${String(y).slice(-2)}`;
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const joinNames = (list) => (list.length <= 2 ? list.join(' and ') : `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`);

/** Builds the history as a list of message texts (one or more per title). */
async function renderHistory(guildId) {
    const { rows: reigns } = await pool.query(
        `SELECT t.id AS title_id, t.name AS title, t.is_tag_title, tr.id, tr.won_date, tr.lost_date, tr.defenses, tr.notes,
                tr.is_backfilled, tr.is_interim, tr.team_id, COALESCE(tm.name, c.name, tr.reign_char_name, 'Unknown') AS holder
         FROM titles t
         JOIN title_reigns tr ON tr.title_id = t.id
         LEFT JOIN characters c ON c.id = tr.character_id
         LEFT JOIN teams tm ON tm.id = tr.team_id
         WHERE t.guild_id = $1
         ORDER BY t.id, tr.won_date, COALESCE(tr.lost_date, 'infinity'::date), tr.id`, [guildId]);
    const { rows: owners } = await pool.query(
        `SELECT ro.reign_id, u.discord_id FROM reign_owners ro
         JOIN users u ON u.id = ro.user_id JOIN title_reigns tr ON tr.id = ro.reign_id
         WHERE tr.guild_id = $1 ORDER BY ro.reign_id, u.id`, [guildId]);
    const ownersOf = new Map();
    for (const o of owners) ownersOf.set(String(o.reign_id), [...(ownersOf.get(String(o.reign_id)) || []), o.discord_id]);

    const byTitle = new Map();
    for (const r of reigns) {
        if (!byTitle.has(r.title_id)) byTitle.set(r.title_id, { name: r.title, isTag: r.is_tag_title, reigns: [] });
        byTitle.get(r.title_id).reigns.push(r);
    }

    const messages = [];
    for (const t of byTitle.values()) {
        // Group the reigns by who held them, in order of each holder's first reign.
        const groups = new Map();
        for (const r of t.reigns) {
            const ids = ownersOf.get(String(r.id)) || [];
            const isTeam = t.isTag || r.team_id;
            const key = isTeam ? `t:${norm(r.holder)}` : ids.length ? `u:${[...ids].sort().join(',')}` : `n:${norm(r.holder)}`;
            const label = isTeam || !ids.length ? r.holder : ids.map((id) => `<@${id}>`).join(' & ');
            if (!groups.has(key)) groups.set(key, { label, reigns: [] });
            groups.get(key).reigns.push({ ...r, ids, isTeam });
        }
        const blocks = [...groups.values()].map((g) => {
            const lines = [`${g.reigns.length}x ${g.label}`];
            g.reigns.forEach((r, i) => {
                const d = Number(r.defenses) || 0;
                const note = r.notes && r.notes.length <= 40 ? ` (${r.notes})` : '';
                lines.push(`*${ord(i + 1)} Reign - ${d} Defense${d === 1 ? '' : 's'}*${r.is_interim ? ' (Interim)' : ''}${note}`);
                if (r.isTeam && r.ids.length) lines.push(`( ${joinNames(r.ids.map((id) => `<@${id}>`))} )`);
                lines.push(`${shortDate(r.won_date)}-${shortDate(r.lost_date)}`);
            });
            return lines.join('\n');
        });
        // Pack a title's holders into as few messages as fit.
        let cur = `# ${t.name}`;
        for (const b of blocks) {
            if (cur.length + b.length + 2 > MAX_LEN) { messages.push(cur); cur = `# ${t.name} (continued)`; }
            cur += `\n\n${b.slice(0, MAX_LEN - 40)}`;
        }
        messages.push(`${cur}\n\n${DIVIDER}`);
    }
    if (messages.length) {
        messages[0] = `# 🏆 CHAMPIONSHIP HISTORY\n${messages[0]}`;
        messages[messages.length - 1] += `\n-# Kept up to date by the bot · last updated <t:${Math.floor(Date.now() / 1000)}:f>`;
    }
    return messages;
}

const running = new Map(); // guildId -> promise, so two refreshes never run at once

/**
 * Posts or updates the history in the history channel. Edits the bot's own earlier messages
 * where it can, posts new ones when it needs more, and deletes ones it no longer needs.
 * Returns { posted, edited, removed } or throws a friendly Error.
 */
async function refreshHistory(client, guildId) {
    const prev = running.get(guildId) || Promise.resolve();
    const job = prev.catch(() => {}).then(() => doRefresh(client, guildId));
    running.set(guildId, job);
    try { return await job; } finally { if (running.get(guildId) === job) running.delete(guildId); }
}

async function doRefresh(client, guildId) {
    const s = await getGuildSettings(guildId);
    if (!s?.history_channel_id) throw new Error('No history channel is set. Use `/admin history channel:#your-channel`.');
    let channel;
    try { channel = await client.channels.fetch(s.history_channel_id); } catch (_) { channel = null; }
    if (!channel || !channel.isTextBased?.()) throw new Error('I can\'t reach the history channel. Check it still exists and that I can see it.');

    const texts = await renderHistory(guildId);
    if (!texts.length) texts.push('# 🏆 CHAMPIONSHIP HISTORY\nNo title reigns yet.');
    let { rows: posts } = await pool.query(`SELECT position, message_id FROM history_posts WHERE guild_id = $1 ORDER BY position`, [guildId]);
    const result = { posted: 0, edited: 0, removed: 0 };

    // Find the bot's earlier messages. If one in the middle was deleted, start over so the order stays right.
    const found = [];
    for (const p of posts) { try { found[p.position] = await channel.messages.fetch(p.message_id); } catch (_) { found[p.position] = null; } }
    const gap = posts.some((p) => p.position < texts.length && !found[p.position]);
    if (gap) {
        for (const p of posts) { if (found[p.position]) { try { await found[p.position].delete(); result.removed++; } catch (_) { /* gone */ } } }
        await forgetPosts(guildId);
        posts = [];
        found.length = 0;
    }

    for (let i = 0; i < texts.length; i++) {
        const content = texts[i];
        const msg = found[i];
        if (msg) {
            if (msg.content !== content) { await msg.edit({ content, allowedMentions: NO_PINGS }); result.edited++; }
            continue;
        }
        const sent = await channel.send({ content, allowedMentions: NO_PINGS });
        await pool.query(
            `INSERT INTO history_posts (guild_id, position, message_id) VALUES ($1,$2,$3)
             ON CONFLICT (guild_id, position) DO UPDATE SET message_id = EXCLUDED.message_id`, [guildId, i, sent.id]);
        result.posted++;
    }
    for (const p of posts.filter((x) => x.position >= texts.length)) {
        if (found[p.position]) { try { await found[p.position].delete(); } catch (_) { /* already gone */ } }
        await pool.query(`DELETE FROM history_posts WHERE guild_id = $1 AND position = $2`, [guildId, p.position]);
        result.removed++;
    }
    return result;
}

/** Forgets the bot's messages (used when the channel changes, so it starts fresh there). */
async function forgetPosts(guildId) {
    await pool.query(`DELETE FROM history_posts WHERE guild_id = $1`, [guildId]);
}

// ---------- automatic updates ----------
let botClient = null;
const timers = new Map();
const setClient = (c) => { botClient = c; };

/** Called after every admin action. Title changes refresh the channel a few seconds later (several changes = one update). */
function onAudit(guildId, action) {
    if (!botClient || !guildId || !TRIGGERS.test(String(action))) return;
    clearTimeout(timers.get(guildId));
    timers.set(guildId, setTimeout(async () => {
        timers.delete(guildId);
        try {
            const s = await getGuildSettings(guildId);
            if (!s?.history_channel_id || s.history_auto === false) return;
            await refreshHistory(botClient, guildId);
        } catch (err) {
            console.error('History channel update failed:', err.message);
        }
    }, 5000));
}

module.exports = { renderHistory, refreshHistory, forgetPosts, setClient, onAudit, shortDate, TRIGGERS };
