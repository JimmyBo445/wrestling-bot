const { EmbedBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { computeStreaks } = require('./streaks');
const { PERIODS, PERIOD_LABELS } = require('./statsQueries');
const { RANKING_WINDOW_DAYS, DIVISION_THEME } = require('./constants');

const CATEGORY_LABELS = {
    win_pct: 'Win %',
    total_wins: 'Total Wins',
    current_streak: 'Current Win Streaks',
    longest_streak: 'Longest Win Streak',
    most_matches: 'Most Active',
    title_reigns: 'Most Title Reigns',
    defenses: 'Most Title Defenses',
    title_days: 'Most Days as Champion',
    user_wins: 'Players: Total Wins',
    team_wins: 'Tag Teams: Total Wins'
};
const TIME_INDEPENDENT = new Set(['title_reigns', 'defenses', 'title_days']);
const MEDALS = ['🥇', '🥈', '🥉'];
const rank = (i) => MEDALS[i] || `**${i + 1}.**`;

function since(days) {
    return days ? `AND m.created_at >= now() - interval '${Number(days)} days'` : '';
}

async function characterRows(guildId, days) {
    const { rows } = await pool.query(
        `SELECT c.id, c.name, u.discord_id,
                mp.is_winner, m.result_type, m.created_at, m.id AS match_id
         FROM match_participants mp
         JOIN matches m ON m.id = mp.match_id
         JOIN characters c ON c.id = mp.character_id
         JOIN users u ON u.id = c.owner_id
         WHERE c.guild_id = $1 AND c.status = 'approved' ${since(days)}
         ORDER BY m.created_at ASC, m.id ASC`,
        [guildId]
    );
    const by = new Map();
    for (const r of rows) {
        if (!by.has(r.id)) by.set(r.id, { id: r.id, name: r.name, discord_id: r.discord_id, results: [] });
        by.get(r.id).results.push(r.result_type === 'draw' ? 'D' : r.result_type === 'no_contest' ? 'NC' : r.is_winner ? 'W' : 'L');
    }
    return [...by.values()].map((c) => {
        const w = c.results.filter((x) => x === 'W').length;
        const l = c.results.filter((x) => x === 'L').length;
        return { ...c, w, l, total: c.results.length, streaks: computeStreaks(c.results) };
    });
}

const who = (r) => `${r.name} (<@${r.discord_id}>)`;

async function buildLeaderboardEmbed(guildId, category = 'win_pct', period = 'all') {
    if (!CATEGORY_LABELS[category]) category = 'win_pct';
    if (!(period in PERIODS)) period = 'all';
    const days = PERIODS[period];
    let lines = [];
    let empty = 'No data yet.';

    if (['win_pct', 'total_wins', 'current_streak', 'longest_streak', 'most_matches'].includes(category)) {
        const chars = await characterRows(guildId, days);
        if (category === 'win_pct') {
            const q = chars.filter((c) => c.w + c.l >= 5).map((c) => ({ ...c, pct: c.w / (c.w + c.l) }))
                .sort((a, b) => b.pct - a.pct || b.w - a.w).slice(0, 10);
            lines = q.map((c, i) => `${rank(i)} ${who(c)} — **${(c.pct * 100).toFixed(1)}%** (${c.w}-${c.l})`);
            empty = 'Nobody has 5+ decided matches in this period yet.';
        } else if (category === 'total_wins') {
            lines = chars.filter((c) => c.w > 0).sort((a, b) => b.w - a.w || a.l - b.l).slice(0, 10)
                .map((c, i) => `${rank(i)} ${who(c)} — **${c.w}** wins (${c.w}-${c.l})`);
        } else if (category === 'current_streak') {
            lines = chars.filter((c) => c.streaks.direction === 'win' && c.streaks.current > 0)
                .sort((a, b) => b.streaks.current - a.streaks.current).slice(0, 10)
                .map((c, i) => `${rank(i)} ${who(c)} — **${c.streaks.current}** in a row 🔥`);
            empty = 'No active win streaks right now.';
        } else if (category === 'longest_streak') {
            lines = chars.filter((c) => c.streaks.longestWin > 0).sort((a, b) => b.streaks.longestWin - a.streaks.longestWin).slice(0, 10)
                .map((c, i) => `${rank(i)} ${who(c)} — **${c.streaks.longestWin}** straight wins`);
        } else {
            lines = chars.sort((a, b) => b.total - a.total).slice(0, 10).map((c, i) => `${rank(i)} ${who(c)} — **${c.total}** matches`);
        }
    } else if (category === 'title_reigns' || category === 'defenses') {
        const col = category === 'title_reigns' ? 'COUNT(*)' : 'SUM(defenses)';
        const { rows } = await pool.query(
            `SELECT name, discord_id, total FROM (
                SELECT c.name, u.discord_id, ${col}::int AS total
                FROM title_reigns tr JOIN characters c ON c.id = tr.character_id AND tr.team_id IS NULL JOIN users u ON u.id = c.owner_id
                WHERE tr.guild_id = $1 GROUP BY c.id, c.name, u.discord_id
                UNION ALL
                SELECT c.name, u.discord_id, ${col}::int
                FROM title_reigns tr JOIN title_reign_members trm ON trm.reign_id = tr.id
                JOIN characters c ON c.id = trm.character_id JOIN users u ON u.id = c.owner_id
                WHERE tr.guild_id = $1 AND tr.team_id IS NOT NULL GROUP BY c.id, c.name, u.discord_id
             ) x WHERE total > 0 ORDER BY total DESC LIMIT 30`,
            [guildId]
        );
        // a character can appear in both halves of the union (singles + tag) -> merge
        const merged = new Map();
        for (const r of rows) {
            const key = r.discord_id + r.name;
            merged.set(key, { ...r, total: (merged.get(key)?.total || 0) + r.total });
        }
        lines = [...merged.values()].sort((a, b) => b.total - a.total).slice(0, 10)
            .map((r, i) => `${rank(i)} ${who(r)} — **${r.total}** ${category === 'title_reigns' ? 'reign(s)' : 'defense(s)'}`);
        empty = 'No title reigns recorded yet.';
    } else if (category === 'title_days') {
        const { rows } = await pool.query(
            `SELECT COALESCE(tm.name, c.name) AS name, u.discord_id,
                    SUM(COALESCE(tr.lost_date, CURRENT_DATE) - tr.won_date)::int AS days
             FROM title_reigns tr
             LEFT JOIN characters c ON c.id = tr.character_id
             LEFT JOIN teams tm ON tm.id = tr.team_id
             LEFT JOIN users u ON u.id = c.owner_id
             WHERE tr.guild_id = $1 AND (tr.character_id IS NOT NULL OR tr.team_id IS NOT NULL)
             GROUP BY COALESCE(tm.name, c.name), u.discord_id
             ORDER BY days DESC LIMIT 10`,
            [guildId]
        );
        lines = rows.map((r, i) => `${rank(i)} ${r.discord_id ? who(r) : r.name} — **${r.days}** days`);
        empty = 'No title reigns recorded yet.';
    } else if (category === 'user_wins') {
        const { rows } = await pool.query(
            `SELECT u.discord_id,
                    COUNT(DISTINCT m.id) FILTER (WHERE mp.is_winner AND m.result_type = 'decisive')::int AS w,
                    COUNT(DISTINCT m.id) FILTER (WHERE NOT mp.is_winner AND m.result_type = 'decisive')::int AS l
             FROM users u JOIN characters c ON c.owner_id = u.id
             JOIN match_participants mp ON mp.character_id = c.id JOIN matches m ON m.id = mp.match_id
             WHERE u.guild_id = $1 ${since(days)} GROUP BY u.discord_id HAVING COUNT(*) > 0
             ORDER BY w DESC, l ASC LIMIT 10`,
            [guildId]
        );
        lines = rows.filter((r) => r.w > 0).map((r, i) => `${rank(i)} <@${r.discord_id}> — **${r.w}** wins (${r.w}-${r.l})`);
    } else if (category === 'team_wins') {
        const { rows } = await pool.query(
            `SELECT t.name,
                    COUNT(*) FILTER (WHERE x.won)::int AS w, COUNT(*) FILTER (WHERE NOT x.won)::int AS l
             FROM (SELECT mp.team_id, m.id, bool_or(mp.is_winner) AS won, m.created_at, m.result_type
                   FROM match_participants mp JOIN matches m ON m.id = mp.match_id
                   WHERE mp.team_id IS NOT NULL AND m.result_type = 'decisive' ${since(days)}
                   GROUP BY mp.team_id, m.id, m.created_at, m.result_type) x
             JOIN teams t ON t.id = x.team_id WHERE t.guild_id = $1 AND t.status = 'active'
             GROUP BY t.id, t.name HAVING COUNT(*) FILTER (WHERE x.won) > 0
             ORDER BY w DESC, l ASC LIMIT 10`,
            [guildId]
        );
        lines = rows.map((r, i) => `${rank(i)} **${r.name}** — **${r.w}** wins (${r.w}-${r.l})`);
    }

    const periodText = TIME_INDEPENDENT.has(category) ? 'All time' : PERIOD_LABELS[period];
    return new EmbedBuilder()
        .setTitle(`🏆 Leaderboard — ${CATEGORY_LABELS[category]}`)
        .setColor(0x9B59B6)
        .setDescription(lines.length ? lines.join('\n') : empty)
        .setFooter({ text: periodText });
}

/**
 * Division ranking ladder: 3 points per win, 1 per draw, over the last N days.
 * Champions and #1 contenders are flagged.
 */
async function buildRankingsEmbed(guildId, division = 'mens') {
    const { rows } = await pool.query(
        `SELECT c.id, c.name, u.discord_id,
                COUNT(*) FILTER (WHERE m.result_type = 'decisive' AND mp.is_winner)::int AS w,
                COUNT(*) FILTER (WHERE m.result_type = 'decisive' AND NOT mp.is_winner)::int AS l,
                COUNT(*) FILTER (WHERE m.result_type = 'draw')::int AS d,
                (EXISTS (SELECT 1 FROM title_reigns tr WHERE tr.lost_date IS NULL AND tr.team_id IS NULL AND tr.character_id = c.id)
                 OR EXISTS (SELECT 1 FROM title_reigns tr JOIN title_reign_members trm ON trm.reign_id = tr.id
                            WHERE tr.lost_date IS NULL AND trm.character_id = c.id)) AS champ,
                EXISTS (SELECT 1 FROM contenders co WHERE co.status = 'active' AND co.character_id = c.id) AS contender
         FROM characters c
         JOIN users u ON u.id = c.owner_id
         JOIN match_participants mp ON mp.character_id = c.id
         JOIN matches m ON m.id = mp.match_id AND m.created_at >= now() - ($3 || ' days')::interval
         WHERE c.guild_id = $1 AND c.status = 'approved' AND c.division = $2
         GROUP BY c.id, c.name, u.discord_id
         ORDER BY (COUNT(*) FILTER (WHERE m.result_type = 'decisive' AND mp.is_winner) * 3
                 + COUNT(*) FILTER (WHERE m.result_type = 'draw')) DESC,
                 COUNT(*) FILTER (WHERE m.result_type = 'decisive' AND NOT mp.is_winner) ASC, c.name
         LIMIT 15`,
        [guildId, division, String(RANKING_WINDOW_DAYS)]
    );
    const theme = DIVISION_THEME[division];
    const lines = rows.map((r, i) => {
        const pts = r.w * 3 + r.d;
        const flags = `${r.champ ? ' 👑' : ''}${r.contender ? ' 🎯' : ''}`;
        return `${rank(i)} ${r.name} (<@${r.discord_id}>)${flags} — **${pts} pts** (${r.w}-${r.l}${r.d ? `-${r.d}` : ''})`;
    });
    return new EmbedBuilder()
        .setTitle(`📈 ${theme.label} Division Rankings`)
        .setColor(theme.embed)
        .setDescription(lines.length ? lines.join('\n') : `No ${theme.label} matches in the last ${RANKING_WINDOW_DAYS} days.`)
        .setFooter({ text: `3 pts per win, 1 per draw · last ${RANKING_WINDOW_DAYS} days · 👑 champion  🎯 #1 contender` });
}

module.exports = { buildLeaderboardEmbed, buildRankingsEmbed, CATEGORY_LABELS, TIME_INDEPENDENT };
