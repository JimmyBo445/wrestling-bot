// /whois: who plays a wrestler, and every wrestler that player has. Anyone can use it.
// The card comes with a dropdown of the player's wrestlers and buttons for their profile card, stats and title history.
const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../utils/discordHelpers');
const { autocompleteCharacters } = require('../utils/characterUtils');
const { UserError } = require('../utils/errors');

const data = new SlashCommandBuilder()
    .setName('whois')
    .setDescription('Who plays a wrestler, and all of that player\'s wrestlers')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('character').setDescription('A wrestler (start typing)').setRequired(false).setAutocomplete(true))
    .addUserOption((o) => o.setName('player').setDescription('Or pick a player to see their wrestlers').setRequired(false));

module.exports = {
    data,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused();
        return interaction.respond(await autocompleteCharacters(interaction, focused, { statuses: ['approved', 'retired'] }));
    },

    async execute(interaction) {
        const charVal = interaction.options.getString('character');
        const player = interaction.options.getUser('player');
        if (!charVal && !player) throw new UserError('Pick a `character` (who plays them?) or a `player` (which wrestlers do they have?).');
        const { whoisPayload } = require('../modules/menus');
        return respond(interaction, await whoisPayload(interaction, { ...(charVal ? { characterId: charVal } : { ownerId: player.id }), actions: false }));
    }
};
