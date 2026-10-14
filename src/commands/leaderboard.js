const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { buildLeaderboardEmbed } = require('../utils/leaderboardQueries');

module.exports = {
    data: new SlashCommandBuilder().setName('leaderboard').setDescription('View leaderboards'),

    async execute(interaction) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId('leaderboard_select')
            .setPlaceholder('Choose a leaderboard category')
            .addOptions(
                { label: 'Win %', value: 'win_pct', description: 'Highest win percentage (min 5 matches)' },
                { label: 'Total Wins', value: 'total_wins', description: 'Most career wins' },
                { label: 'Current Win Streaks', value: 'current_streak', description: 'Hottest active streaks' },
                { label: 'Longest Win Streak Ever', value: 'longest_streak', description: 'All-time streak record' },
                { label: 'Most Championship Reigns', value: 'title_reigns', description: 'Most times winning a title' },
                { label: 'Most Active', value: 'most_matches', description: 'Most total matches wrestled' }
            );

        const row = new ActionRowBuilder().addComponents(menu);
        const embed = await buildLeaderboardEmbed(interaction.guildId, 'win_pct');
        await interaction.reply({ embeds: [embed], components: [row] });
    }
};
