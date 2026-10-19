const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { buildLeaderboardEmbed, CATEGORY_LABELS } = require('../utils/leaderboardQueries');
const { PERIOD_LABELS } = require('../utils/statsQueries');
const { respond } = require('../utils/discordHelpers');

const DESCRIPTIONS = {
    win_pct: 'Highest win % (min 5 decided matches)', total_wins: 'Most wins', current_streak: 'Hottest active win streaks',
    longest_streak: 'Longest win streak in the period', most_matches: 'Most matches wrestled', title_reigns: 'Most title reigns',
    defenses: 'Most successful title defenses', title_days: 'Total days holding titles', user_wins: 'Most wins per player (all wrestlers combined)',
    team_wins: 'Registered tag teams with the most wins'
};

/** Builds the two dropdowns, remembering the current choice in the component ids. */
function leaderboardComponents(category, period) {
    const cat = new StringSelectMenuBuilder().setCustomId(`lb_cat_${period}`).setPlaceholder('Leaderboard category')
        .addOptions(Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ label, value, description: DESCRIPTIONS[value].slice(0, 100), default: value === category })));
    const per = new StringSelectMenuBuilder().setCustomId(`lb_period_${category}`).setPlaceholder('Time period')
        .addOptions(Object.entries(PERIOD_LABELS).map(([value, label]) => ({ label, value, default: value === period })));
    return [new ActionRowBuilder().addComponents(cat), new ActionRowBuilder().addComponents(per)];
}

module.exports = {
    data: new SlashCommandBuilder().setName('leaderboard').setDescription('Leaderboards: pick a category and time period').setDMPermission(false),
    leaderboardComponents,

    async execute(interaction) {
        const embed = await buildLeaderboardEmbed(interaction.guildId, 'win_pct', 'all');
        return respond(interaction, { embeds: [embed], components: leaderboardComponents('win_pct', 'all') });
    }
};
