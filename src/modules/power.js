// /standings power: this week's power rankings (also posted every Monday if a channel is set).
const { SlashCommandBuilder } = require('discord.js');
const { respond, NO_MENTIONS, DIVISION_LABELS } = require('../utils/discordHelpers');
const { powerEmbed } = require('../utils/powerRankings');
const { weekKey } = require('../utils/newsletter');

const data = new SlashCommandBuilder()
    .setName('power')
    .setDescription('Power rankings: wins, who you beat, title matches and recent form (last 60 days)')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('division').setDescription('Just one division (default: all)').setRequired(false)
        .addChoices(...Object.entries(DIVISION_LABELS).map(([value, name]) => ({ name, value }))));

module.exports = {
    data,
    async execute(interaction) {
        const one = interaction.options.getString('division');
        const embeds = [];
        for (const div of one ? [one] : Object.keys(DIVISION_LABELS)) embeds.push((await powerEmbed(interaction.guildId, div, weekKey())).embed);
        return respond(interaction, { embeds, allowedMentions: NO_MENTIONS });
    }
};
