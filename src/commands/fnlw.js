// /fnlw: the home menu. One command to remember; everything else is a button away.
// 3.1: `go:` jumps straight to one section (Standings, Stats, Legacy…).
const { SlashCommandBuilder } = require('discord.js');
const { respond, EPHEMERAL } = require('../utils/discordHelpers');
const { homePayload } = require('../modules/menus');

const GO = [['📈 Standings', 'stand'], ['📊 Stats', 'stats'], ['🎖 Legacy', 'legacy'], ['👥 Teams & Factions', 'teams'],
    ['🔥 Feuds', 'feuds'], ['🏟 Tournaments', 'tourn'], ['📝 Contracts', 'contract']];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fnlw')
        .setDescription('Home menu: champions, shows, standings, stats, legacy, teams, feuds and more')
        .setDMPermission(false)
        .addStringOption((o) => o.setName('go').setDescription('Jump straight to one section').setRequired(false)
            .addChoices(...GO.map(([name, value]) => ({ name, value })))),

    async execute(interaction) {
        const go = interaction.options?.getString?.('go');
        if (go) return require('../modules/hub').openSection(interaction, go);
        return respond(interaction, { ...homePayload(interaction, interaction.guild?.name), flags: EPHEMERAL });
    }
};
