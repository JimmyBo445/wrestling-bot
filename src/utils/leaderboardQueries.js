const { EmbedBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { getStreaks } = require('./contenderLogic');

const CATEGORY_LABELS = {
    win_pct: 'Win %',
    total_wins: 'Total Wins',
    current_streak: 'Current Win Streaks',
    longest_streak: 'Longest Win Streak Ever',
    title_reigns: 'Most Championship Reigns',
    most_matches: 'Most Active (Total Matches)'
};

async function buildLeaderboardEmbed(guildId, category) {
    let description = 'No data yet.';

    if (category === 'win_pct' || category === 'total_wins' || category === 'most_matches') {
        const { rows } = await pool.query(
            `SELECT c.name, u.discord_id,
                    COUNT(*) FILTER (WHERE mp.is_winner AND m.result_type = 'decisive') AS wins,
                    COUNT(*) FILTER (WHERE NOT mp.is_winner AND m.result_type = 'decisive') AS losses,
                    COUNT(*) AS total
             FROM characters c
             JOIN users u ON u.id = c.owner_id
             JOIN match_participants mp ON mp.character_id = c.id
             JOIN matches m ON m.id = mp.match_id
             WHERE c.guild_id = $1 AND c.status = 'approved'
             GROUP BY c.name, u.discord_id
             HAVING COUNT(*) >= 1`,
            [guildId]
        );

        let sorted;
        if (category === 'win_pct') {
            sorted = rows.filter((r) => (parseInt(r.wins) + parseInt(r.losses)) >= 5)
                .map((r) => ({ ...r, pct: parseInt(r.wins) / (parseInt(r.wins) + parseInt(r.losses)) }))
                .sort((a, b) => b.pct - a.pct)
                .slice(0, 10);
            description = sorted.map((r, i) => `**${i + 1}.** ${r.name} (<@${r.discord_id}>) — ${(r.pct * 100).toFixed(1)}% (${r.wins}-${r.losses})`).join('\n') || 'No characters with 5+ matches yet.';
        } else if (category === 'total_wins') {
            sorted = rows.sort((a, b) => parseInt(b.wins) - parseInt(a.wins)).slice(0, 10);
            description = sorted.map((r, i) => `**${i + 1}.** ${r.name} (<@${r.discord_id}>) — ${r.wins} wins`).join('\n');
        } else {
            sorted = rows.sort((a, b) => parseInt(b.total) - parseInt(a.total)).slice(0, 10);
            description = sorted.map((r, i) => `**${i + 1}.** ${r.name} (<@${r.discord_id}>) — ${r.total} matches`).join('\n');
        }
    }

    if (category === 'current_streak' || category === 'longest_streak') {
        const { rows } = await pool.query(
            `SELECT c.id, c.name, u.discord_id FROM characters c JOIN users u ON u.id = c.owner_id
             WHERE c.guild_id = $1 AND c.status = 'approved'`,
            [guildId]
        );
        const withStreaks = await Promise.all(rows.map(async (r) => ({ ...r, streaks: await getStreaks(r.id) })));

        let sorted;
        if (category === 'current_streak') {
            sorted = withStreaks.filter((r) => r.streaks.direction === 'win' && r.streaks.current > 0)
                .sort((a, b) => b.streaks.current - a.streaks.current).slice(0, 10);
            description = sorted.map((r, i) => `**${i + 1}.** ${r.name} (<@${r.discord_id}>) — ${r.streaks.current} wins`).join('\n') || 'No active win streaks right now.';
        } else {
            sorted = withStreaks.sort((a, b) => b.streaks.longestWin - a.streaks.longestWin).slice(0, 10);
            description = sorted.map((r, i) => `**${i + 1}.** ${r.name} (<@${r.discord_id}>) — ${r.streaks.longestWin} wins`).join('\n');
        }
    }

    if (category === 'title_reigns') {
        const { rows } = await pool.query(
            `SELECT c.name, u.discord_id, COUNT(*) AS reigns
             FROM title_reigns tr
             JOIN characters c ON c.id = tr.character_id
             JOIN users u ON u.id = c.owner_id
             WHERE tr.guild_id = $1
             GROUP BY c.name, u.discord_id
             ORDER BY reigns DESC LIMIT 10`,
            [guildId]
        );
        description = rows.map((r, i) => `**${i + 1}.** ${r.name} (<@${r.discord_id}>) — ${r.reigns} reign(s)`).join('\n') || 'No title reigns recorded yet.';
    }

    return new EmbedBuilder()
        .setTitle(`Leaderboard — ${CATEGORY_LABELS[category]}`)
        .setColor(0x9B59B6)
        .setDescription(description);
}

module.exports = { buildLeaderboardEmbed, CATEGORY_LABELS };
