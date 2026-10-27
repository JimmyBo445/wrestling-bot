const { EmbedBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { titleStatus, localNow } = require('./titleWatch');
const { weekKey } = require('./newsletter');
const { passedOverCounts } = require('./signupUtils');
const { DIVISION_LABELS, NO_MENTIONS } = require('./discordHelpers');

const IDLE_DAYS = 30;
const THIN = 4;
const list = (arr, max = 8) => (arr.length ? arr.slice(0, max).join('\n') + (arr.length > max ? `\n…and ${arr.length - max} more` : '') : null);

/** The staff report. Returns an embed (always something to say, even if everything is fine). */
async function buildReport(guildId, guildName) {
    const embed = new EmbedBuilder().setColor(0x3498DB).setTitle(`📊 Weekly staff report${guildName ? ` — ${guildName}` : ''}`);

    const { rows: chars } = await pool.query(
        `SELECT c.id, c.name, c.division, c.created_at, u.discord_id,
                (SELECT MAX(m.created_at) FROM match_participants mp JOIN matches m ON m.id = mp.match_id WHERE mp.character_id = c.id) AS last_match,
                (SELECT COUNT(*)::int FROM match_participants mp JOIN matches m ON m.id = mp.match_id WHERE mp.character_id = c.id AND m.created_at > now() - interval '14 days') AS recent,
                EXISTS (SELECT 1 FROM injuries i WHERE i.character_id = c.id AND i.cleared_at IS NULL AND i.returns_at >= CURRENT_DATE) AS injured
         FROM characters c JOIN users u ON u.id = c.owner_id WHERE c.guild_id = $1 AND c.status = 'approved'`, [guildId]);
    const days = (d) => Math.floor((Date.now() - new Date(d).getTime()) / 864e5);

    const idle = chars.filter((c) => !c.injured && (c.last_match ? days(c.last_match) >= IDLE_DAYS : days(c.created_at) >= 14))
        .sort((a, b) => (days(b.last_match || b.created_at)) - (days(a.last_match || a.created_at)))
        .map((c) => `• **${c.name}** (<@${c.discord_id}>) — ${c.last_match ? `${days(c.last_match)} days since last match` : 'never wrestled'}`);
    embed.addFields({ name: `😴 Idle (${IDLE_DAYS}+ days)`, value: list(idle) || 'Nobody. Everyone has wrestled recently.' });

    const busy = [...chars].filter((c) => c.recent >= 4).sort((a, b) => b.recent - a.recent)
        .map((c) => `• **${c.name}** — ${c.recent} matches in 14 days`);
    embed.addFields({ name: '🔥 Busiest (possible overexposure)', value: list(busy, 5) || 'No one is overused.' });

    const counts = {};
    for (const c of chars) counts[c.division] = (counts[c.division] || 0) + 1;
    const divLines = Object.keys(DIVISION_LABELS).map((d) => `${DIVISION_LABELS[d]}: **${counts[d] || 0}**${(counts[d] || 0) < THIN ? ' ⚠️ thin' : ''}`);
    embed.addFields({ name: '👥 Divisions', value: divLines.join(' · ') });

    const { rows: g } = await pool.query(`SELECT defense_days FROM guilds WHERE guild_id = $1`, [guildId]);
    const limit = g[0]?.defense_days > 0 ? g[0].defense_days : 45;
    const status = await titleStatus(guildId);
    const stale = status.filter((s) => s.daysSinceDefense >= limit).sort((a, b) => b.daysSinceDefense - a.daysSinceDefense)
        .map((s) => `• **${s.title_name}** — ${s.holder}, ${s.daysSinceDefense} days without a defense`);
    const { rows: vacant } = await pool.query(
        `SELECT t.name FROM titles t WHERE t.guild_id = $1 AND NOT EXISTS (SELECT 1 FROM title_reigns tr WHERE tr.title_id = t.id AND tr.lost_date IS NULL) ORDER BY t.name`, [guildId]);
    const titleLines = [...stale, ...vacant.map((v) => `• **${v.name}** — vacant`)];
    embed.addFields({ name: `🏆 Titles needing attention (${limit}+ days)`, value: list(titleLines) || 'All titles are active.' });

    const { rows: entries } = await pool.query(
        `SELECT DISTINCT e.character_id FROM signup_entries e JOIN signups s ON s.id = e.signup_id WHERE s.guild_id = $1 AND s.status = 'closed'`, [guildId]);
    const passed = await passedOverCounts(guildId, entries.map((e) => e.character_id));
    const byId = new Map(chars.map((c) => [String(c.id), c]));
    const passedLines = [...passed.entries()].filter(([id]) => byId.has(id)).sort((a, b) => b[1] - a[1])
        .map(([id, n]) => `• **${byId.get(id).name}** — passed over ×${n}`);
    if (passedLines.length) embed.addFields({ name: '⏭️ Signed up but not booked', value: list(passedLines, 6) });

    const { rows: ct } = await pool.query(
        `SELECT c.name, k.end_date, k.status FROM contracts k JOIN characters c ON c.id = k.character_id
         WHERE k.guild_id = $1 AND ((k.status = 'active' AND k.end_date <= CURRENT_DATE + 30) OR (k.status = 'expired' AND k.end_date >= CURRENT_DATE - 14)) ORDER BY k.end_date`, [guildId]);
    if (ct.length) embed.addFields({ name: '📝 Contracts', value: list(ct.map((r) => `• **${r.name}** — ${r.status === 'expired' ? 'expired' : 'ends'} ${new Date(r.end_date).toISOString().slice(0, 10)}`), 6) });

    const { rows: pend } = await pool.query(`SELECT COUNT(*)::int AS n FROM pending_requests WHERE guild_id = $1 AND status = 'pending'`, [guildId]);
    const { rows: open } = await pool.query(`SELECT title, status FROM signups WHERE guild_id = $1 AND status IN ('open','closed') ORDER BY created_at DESC LIMIT 1`, [guildId]);
    const todo = [];
    if (pend[0].n) todo.push(`${pend[0].n} request${pend[0].n === 1 ? '' : 's'} waiting in \`/admin pending\``);
    if (open[0]) todo.push(open[0].status === 'open' ? `signup **${open[0].title}** is still open` : `signup **${open[0].title}** is closed but still guiding booking (run \`/booking signup-done\` when you've finished booking)`);
    if (todo.length) embed.addFields({ name: '📌 To do', value: todo.map((t) => `• ${t}`).join('\n') });
    return embed;
}

/** Monday from 9am local time, once per week, to the staff channel. */
async function runWeeklyReport(client, g) {
    if (!g.admin_channel_id) return;
    const { date, hour } = localNow(g.tz);
    if (new Date(`${date}T00:00:00Z`).getUTCDay() !== 1 || hour < 9) return;
    const key = weekKey();
    const { rowCount } = await pool.query(`UPDATE guilds SET report_last = $1 WHERE guild_id = $2 AND report_last IS DISTINCT FROM $1`, [key, g.guild_id]);
    if (!rowCount) return;
    const ch = await client.channels.fetch(g.admin_channel_id).catch(() => null);
    if (!ch?.isTextBased()) return;
    const guild = client.guilds?.cache?.get(g.guild_id);
    await ch.send({ embeds: [await buildReport(g.guild_id, guild?.name)], allowedMentions: NO_MENTIONS });
}

module.exports = { buildReport, runWeeklyReport };
