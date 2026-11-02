// Weekly power rankings (3.0): one list per division, from the last 60 days.
// Points per match (newer matches count more):
//   win  = 3 + up to 2 for beating a strong opponent (their win rate) + 2 if it was a title match
//   draw = 1, loss = -1 (only -0.5 in a title match)
// Plus: current champion +3, #1 contender +1.5, and +0.5 for each win in their last 5 matches.
// Every week the order is saved, so the next list can show ▲ / ▼ movement.
const { EmbedBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { DIVISION_THEME } = require('./constants');

const WINDOW_DAYS = 60;
const DAY = 864e5;
const recency = (at, now) => { const d = (now - new Date(at).getTime()) / DAY; return d <= 14 ? 1 : d <= 30 ? 0.75 : 0.5; };

/** Ranked rows for one division: [{ id, name, discord_id, score, w, l, d, champ, contender }]. */
async function computePower(guildId, division, now = Date.now()) {
    const { rows } = await pool.query(
        `SELECT m.id AS match_id, m.result_type, m.is_title_match, m.created_at, mp.character_id, mp.is_winner, mp.team_number
         FROM matches m JOIN match_participants mp ON mp.match_id = m.id
         WHERE m.guild_id = $1 AND m.created_at >= to_timestamp($2 / 1000.0) - ($3 || ' days')::interval AND m.created_at <= to_timestamp($2 / 1000.0)
         ORDER BY m.created_at, m.id`, [guildId, now, String(WINDOW_DAYS)]);
    const byMatch = new Map();
    for (const r of rows) {
        if (!byMatch.has(r.match_id)) byMatch.set(r.match_id, []);
        byMatch.get(r.match_id).push(r);
    }
    // win rate of everyone in the window (for opponent strength)
    const rec = new Map();
    for (const r of rows) {
        const k = String(r.character_id);
        if (!rec.has(k)) rec.set(k, { w: 0, n: 0 });
        if (r.result_type === 'decisive') { rec.get(k).n++; if (r.is_winner) rec.get(k).w++; }
    }
    const rate = (id) => { const x = rec.get(String(id)); return x && x.n ? x.w / x.n : 0.5; };

    const { rows: chars } = await pool.query(
        `SELECT c.id, c.name, u.discord_id, u.is_placeholder,
                (EXISTS (SELECT 1 FROM title_reigns tr WHERE tr.lost_date IS NULL AND tr.team_id IS NULL AND tr.character_id = c.id)
                 OR EXISTS (SELECT 1 FROM title_reigns tr JOIN title_reign_members trm ON trm.reign_id = tr.id WHERE tr.lost_date IS NULL AND trm.character_id = c.id)
                 OR EXISTS (SELECT 1 FROM title_reigns tr JOIN team_members tm ON tm.team_id = tr.team_id AND tm.left_at IS NULL WHERE tr.lost_date IS NULL AND tm.character_id = c.id)) AS champ,
                EXISTS (SELECT 1 FROM contenders co WHERE co.status = 'active' AND co.character_id = c.id) AS contender
         FROM characters c JOIN users u ON u.id = c.owner_id
         WHERE c.guild_id = $1 AND c.division = $2 AND c.status = 'approved'`, [guildId, division]);

    const out = [];
    for (const c of chars) {
        const mine = rows.filter((r) => String(r.character_id) === String(c.id));
        if (!mine.length) continue; // must have wrestled in the window
        let score = 0, w = 0, l = 0, d = 0;
        for (const r of mine) {
            const weight = recency(r.created_at, now);
            const all = byMatch.get(r.match_id);
            const opps = all.filter((o) => String(o.character_id) !== String(c.id) && (r.team_number == null || o.team_number !== r.team_number));
            const oppRate = opps.length ? opps.reduce((a, o) => a + rate(o.character_id), 0) / opps.length : 0.5;
            if (r.result_type !== 'decisive') { d++; score += 1 * weight; continue; }
            if (r.is_winner) { w++; score += (3 + 2 * oppRate + (r.is_title_match ? 2 : 0)) * weight; } else { l++; score += (r.is_title_match ? -0.5 : -1) * weight; }
        }
        const last5 = mine.slice(-5).filter((r) => r.result_type === 'decisive' && r.is_winner).length;
        score += last5 * 0.5 + (c.champ ? 3 : 0) + (c.contender ? 1.5 : 0);
        out.push({ id: String(c.id), name: c.name, discord_id: c.is_placeholder ? null : c.discord_id, score: Math.round(score * 10) / 10, w, l, d, champ: c.champ, contender: c.contender });
    }
    return out.sort((a, b) => b.score - a.score || b.w - a.w || a.l - b.l || a.name.localeCompare(b.name));
}

/** Last saved order for a division (before `week`): Map id → rank. */
async function previousRanks(guildId, division, week) {
    const { rows } = await pool.query(
        `SELECT character_id, rank FROM power_snapshots WHERE guild_id = $1 AND division = $2
           AND week = (SELECT MAX(week) FROM power_snapshots WHERE guild_id = $1 AND division = $2 AND week < $3)`, [guildId, division, week]);
    return new Map(rows.map((r) => [String(r.character_id), r.rank]));
}

async function saveSnapshot(guildId, division, week, ranked) {
    await pool.query(`DELETE FROM power_snapshots WHERE guild_id = $1 AND division = $2 AND week = $3`, [guildId, division, week]);
    for (let i = 0; i < ranked.length; i++) {
        await pool.query(`INSERT INTO power_snapshots (guild_id, week, division, character_id, rank) VALUES ($1,$2,$3,$4,$5)`, [guildId, week, division, ranked[i].id, i + 1]);
    }
}

function moveText(prev, now) {
    if (prev === undefined) return '🆕';
    if (prev === now) return '➖';
    return prev > now ? `▲${prev - now}` : `▼${now - prev}`;
}

async function powerEmbed(guildId, division, week) {
    const ranked = await computePower(guildId, division);
    const prev = await previousRanks(guildId, division, week);
    const theme = DIVISION_THEME[division];
    const lines = ranked.slice(0, 20).map((r, i) => {
        const flags = `${r.champ ? ' 👑' : ''}${r.contender ? ' 🎯' : ''}`;
        return `**${i + 1}.** ${moveText(prev.get(r.id), i + 1)} **${r.name}**${r.discord_id ? ` (<@${r.discord_id}>)` : ''}${flags} · ${r.w}-${r.l}${r.d ? `-${r.d}` : ''}`;
    });
    const embed = new EmbedBuilder().setColor(theme.embed).setTitle(`⚡ ${theme.label} Power Rankings`)
        .setDescription(lines.length ? lines.join('\n') : `Nobody in the ${theme.label} division has wrestled in the last ${WINDOW_DAYS} days.`)
        .setFooter({ text: `Last ${WINDOW_DAYS} days: wins, who you beat, title matches and recent form count · 👑 champion 🎯 #1 contender` });
    return { embed, ranked };
}

/** Posts every division's rankings in the power rankings channel and saves this week's order. */
async function postWeekly(client, g, week) {
    const ch = await client.channels.fetch(g.power_channel_id).catch(() => null);
    if (!ch?.isTextBased?.()) throw new Error('I can\'t reach the power rankings channel. Check it still exists and that I can post there.');
    const embeds = [];
    for (const div of Object.keys(DIVISION_THEME)) {
        const { embed, ranked } = await powerEmbed(g.guild_id, div, week);
        if (ranked.length) { embeds.push(embed); await saveSnapshot(g.guild_id, div, week, ranked); }
    }
    if (!embeds.length) return 0;
    await ch.send({ content: `⚡ **Power Rankings** · week of ${new Date().toISOString().slice(0, 10)}`, embeds: embeds.slice(0, 10), allowedMentions: { parse: [] } });
    return embeds.length;
}

module.exports = { computePower, powerEmbed, postWeekly, previousRanks, saveSnapshot, moveText, WINDOW_DAYS };
