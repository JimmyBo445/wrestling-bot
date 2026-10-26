const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { requireAdmin, respond, NO_MENTIONS } = require('../utils/discordHelpers');
const { buildReport } = require('../utils/reportUtils');

const data = new SlashCommandBuilder()
    .setName('report')
    .setDescription('[Admin] Staff report: idle wrestlers, thin divisions, stale titles, contracts')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('now').setDescription('Show the staff report right now (it also posts weekly to the staff channel)'));

module.exports = {
    data,
    async execute(interaction) {
        requireAdmin(interaction, 'see staff reports');
        await interaction.deferReply({ flags: 64 });
        return respond(interaction, { embeds: [await buildReport(interaction.guildId, interaction.guild?.name)], allowedMentions: NO_MENTIONS });
    }
};
