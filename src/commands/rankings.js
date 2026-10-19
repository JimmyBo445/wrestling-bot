const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { buildRankingsEmbed } = require('../utils/leaderboardQueries');
const { DIVISION_THEME } = require('../utils/constants');
const { respond } = require('../utils/discordHelpers');

function rankingsComponents(division) {
    const menu = new StringSelectMenuBuilder().setCustomId('rank_div').setPlaceholder('Division')
        .addOptions(Object.entries(DIVISION_THEME).map(([value, t]) => ({ label: `${t.label} Division`, value, default: value === division })));
    return [new ActionRowBuilder().addComponents(menu)];
}

module.exports = {
    data: new SlashCommandBuilder().setName('rankings').setDescription('Division ranking ladders (recent form)').setDMPermission(false)
        .addStringOption((o) => o.setName('division').setDescription('Default: Men\'s').setRequired(false)
            .addChoices(...Object.entries(DIVISION_THEME).map(([value, t]) => ({ name: t.label, value })))),
    rankingsComponents,

    async execute(interaction) {
        const division = interaction.options.getString('division') || 'mens';
        return respond(interaction, { embeds: [await buildRankingsEmbed(interaction.guildId, division)], components: rankingsComponents(division) });
    }
};
