const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, AttachmentBuilder } = require('discord.js');
const { buildRankingsEmbed } = require('../utils/leaderboardQueries');
const { buildRankingsData } = require('../utils/cardData');
const { renderRankingsCard } = require('../utils/cardRenderer');
const { DIVISION_THEME } = require('../utils/constants');
const { respond } = require('../utils/discordHelpers');

function rankingsComponents(division) {
    const menu = new StringSelectMenuBuilder().setCustomId('rank_div').setPlaceholder('Division')
        .addOptions(Object.entries(DIVISION_THEME).map(([value, t]) => ({ label: `${t.label} Division`, value, default: value === division })));
    return [new ActionRowBuilder().addComponents(menu)];
}

/** Ladder picture (falls back to the text version when nobody has matches or the picture fails). */
async function rankingsPayload(guild, division) {
    try {
        const data = await buildRankingsData(guild, division);
        if (data) {
            const buffer = await renderRankingsCard(data);
            return { content: `📈 **${data.label} Division Rankings**`, embeds: [], files: [new AttachmentBuilder(buffer, { name: 'rankings.png' })], attachments: [], components: rankingsComponents(division) };
        }
    } catch (err) { console.error('Rankings card failed, using text:', err); }
    return { content: '', embeds: [await buildRankingsEmbed(guild.id, division)], files: [], attachments: [], components: rankingsComponents(division) };
}

module.exports = {
    rankingsPayload,
    data: new SlashCommandBuilder().setName('rankings').setDescription('Division ranking ladders (recent form)').setDMPermission(false)
        .addStringOption((o) => o.setName('division').setDescription('Default: Men\'s').setRequired(false)
            .addChoices(...Object.entries(DIVISION_THEME).map(([value, t]) => ({ name: t.label, value })))),
    rankingsComponents,

    async execute(interaction) {
        const division = interaction.options.getString('division') || 'mens';
        await interaction.deferReply();
        return respond(interaction, await rankingsPayload(interaction.guild, division));
    }
};
