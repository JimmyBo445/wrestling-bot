// /fnlw: the home menu. One command to remember; everything else is a button away.
const { SlashCommandBuilder } = require('discord.js');
const { respond, EPHEMERAL } = require('../utils/discordHelpers');
const { homePayload } = require('../modules/menus');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fnlw')
        .setDescription('Home menu: champions, next show, results, roster, your wrestlers and help')
        .setDMPermission(false),

    async execute(interaction) {
        return respond(interaction, { ...homePayload(interaction, interaction.guild?.name), flags: EPHEMERAL });
    }
};
