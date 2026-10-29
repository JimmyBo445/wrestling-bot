const { EmbedBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { topWrestlers, bestMatch, rivalries } = require('./monthly');
const { feudHeat } = require('./feudUtils');
const { fmtYmd } = require('./dates');

const DAY = 864e5;

/** ISO week key like 2026-W43 for a Date. */
function weekKey(d = new Date()) {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t - yearStart) / DAY + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Builds the weekly newsletter for the 7 days before `end`. Returns { embed, entryIds, empty }. */
async function buildNewsletter(guildId, guildName, { end = new Date() } = {}) {
    const start = new Date(end.getTime() - 7 * DAY);
    const { rows: tot } = await pool.query(`SELECT COUNT(*)::int AS n FROM matches WHERE guild_id = $1 AND created_at >= $2 AND created_at < $3`, [guildId, start, end]);
    const top = await topWrestlers(guildId, start, end, 3).catch(() => []);
    const best = await bestMatch(guildId, start, end);
    const riv = await rivalries(guildId, { start, end, limit: 2, min: 2 });

    const { rows: changes } = await pool.query(
        `SELECT m.id, t.name AS title_name, m.title_effect->>'type' AS type,
                (SELECT string_agg(c.name, ' & ' ORDER BY mp.id) FROM match_participants mp JOIN characters c ON c.id = mp.character_id WHERE mp.match_id = m.id AND mp.is_winner) AS winners
         FROM matches m JOIN titles t ON t.id = m.title_id
         WHERE m.guild_id = $1 AND m.created_at >= $2 AND m.created_at < $3 AND m.title_effect->>'type' IN ('title_change','new_reign')
         ORDER BY m.created_at`, [guildId, start, end]);
    const { rows: defenses } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM matches WHERE guild_id = $1 AND created_at >= $2 AND created_at < $3 AND title_effect->>'type' = 'defense'`, [guildId, start, end]);

    const { rows: feuds } = await pool.query(
        `SELECT f.*, a.name AS a_name, b.name AS b_name FROM feuds f JOIN characters a ON a.id = f.char_a JOIN characters b ON b.id = f.char_b
         WHERE f.guild_id = $1 AND f.status = 'active'`, [guildId]);
    const heated = (await Promise.all(feuds.map(async (f) => ({ f, heat: await feudHeat(f) })))).sort((x, y) => y.heat.score - x.heat.score).slice(0, 2);

    const { rows: upcoming } = await pool.query(
        `SELECT brand, name, show_date FROM card_shows WHERE guild_id = $1 AND show_date >= CURRENT_DATE AND show_date < CURRENT_DATE + 8 ORDER BY show_date`, [guildId]);
    const { rows: injured } = await pool.query(
        `SELECT c.name, to_char(i.returns_at, 'YYYY-MM-DD') AS returns_at FROM injuries i JOIN characters c ON c.id = i.character_id
         WHERE c.guild_id = $1 AND i.cleared_at IS NULL AND i.returns_at >= CURRENT_DATE ORDER BY i.returns_at LIMIT 5`, [guildId]);
    const { rows: entries } = await pool.query(`SELECT id, body FROM newsletter_entries WHERE guild_id = $1 AND posted_in IS NULL ORDER BY id`, [guildId]);

    const embed = new EmbedBuilder().setColor(0xE8BF4A).setTitle(`📰 ${guildName ? `${guildName} ` : ''}Weekly Newsletter`)
        .setFooter({ text: `${fmtYmd(start)} to ${fmtYmd(end)} · ${tot[0].n} match${tot[0].n === 1 ? '' : 'es'} this week` });
    const parts = [];
    if (changes.length || defenses[0].n) {
        const lines = changes.map((c) => `👑 **${c.winners}** ${c.type === 'new_reign' ? 'won the vacant' : 'won the'} **${c.title_name}**`);
        if (defenses[0].n) lines.push(`🛡️ ${defenses[0].n} successful title defense${defenses[0].n === 1 ? '' : 's'}`);
        embed.addFields({ name: 'Championship news', value: lines.join('\n').slice(0, 1024) });
        parts.push(1);
    }
    if (top.length) { embed.addFields({ name: 'Stars of the week', value: top.map((r, i) => `${['🥇', '🥈', '🥉'][i]} **${r.name}** — ${r.w}-${r.l}`).join('\n') }); parts.push(1); }
    if (best) { embed.addFields({ name: `Match of the week${best.rated ? ` ${'⭐'.repeat(best.stars)}` : ''}`, value: `${best.winners || '?'} def. ${best.others || '?'}${best.title_name ? ` · ${best.title_name}` : ''}` }); parts.push(1); }
    if (heated.length) { embed.addFields({ name: 'Hottest feuds', value: heated.map(({ f, heat }) => `🔥 **${f.name}** — ${heat.label} (${heat.score})`).join('\n') }); parts.push(1); }
    else if (riv.length) { embed.addFields({ name: 'Rivalries', value: riv.map((r) => `🔥 ${r.a_name} vs ${r.b_name}: ${r.meetings} meetings (${r.a_wins}-${r.b_wins})`).join('\n') }); parts.push(1); }
    if (upcoming.length) { embed.addFields({ name: 'Coming up', value: upcoming.map((u) => `📅 **${fmtYmd(u.show_date)}** — ${u.brand === 'raw' ? 'RAW' : 'SmackDown'}${u.name ? ` “${u.name}”` : ''}`).join('\n') }); parts.push(1); }
    if (injured.length) { embed.addFields({ name: 'Injury report', value: injured.map((i) => `🤕 ${i.name} (back ${i.returns_at})`).join('\n') }); parts.push(1); }
    if (entries.length) { embed.addFields({ name: 'From the office', value: entries.map((e) => `• ${e.body}`).join('\n').slice(0, 1024) }); parts.push(1); }
    if (!parts.length) embed.setDescription('A quiet week. Nothing to report yet.');
    return { embed, entryIds: entries.map((e) => e.id), empty: !parts.length };
}

/** Posts the newsletter to the configured channel and marks the admin entries as used. */
async function postNewsletter(client, g, key) {
    const channelId = g.newsletter_channel_id;
    if (!channelId) return false;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return false;
    const guildName = client.guilds?.cache?.get(g.guild_id)?.name || null;
    const { embed, entryIds, empty } = await buildNewsletter(g.guild_id, guildName);
    if (empty) return false;
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    if (entryIds.length) await pool.query(`UPDATE newsletter_entries SET posted_in = $2 WHERE id = ANY($1::bigint[])`, [entryIds, key]);
    return true;
}

module.exports = { weekKey, buildNewsletter, postNewsletter };
