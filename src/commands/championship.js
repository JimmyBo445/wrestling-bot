// /championship = what everyone can look at.
// 3.8: one command. `/championship` alone shows every title with buttons (grand slam, contenders,
// rematches) and a menu to open a title. `/championship title:` opens that title's belt with buttons
// (history, defenses, lineage, records, contenders, challenge for it). Admins run belts with /title.
// The old subcommands (list, belt, history…) still work inside the bot for the buttons.
const { SlashCommandBuilder } = require('discord.js');
const { partsOf, makeUmbrella } = require('../utils/umbrella');
const { autocompleteTitles } = require('../utils/titleLogic');
const champ = require('../modules/championship');

const inner = makeUmbrella({
    name: 'championship',
    description: 'Title belts',
    parts: [
        ...partsOf(champ, { only: ['list', 'belt', 'lineage', 'defenses', 'history', 'grand-slam', 'rematches'] }),
        ...partsOf(require('../modules/titlePanel'), { asSub: 'panel' }),
        ...partsOf(require('../modules/records'), { asSub: 'records' }),
        ...partsOf(require('../modules/contender'), { prefix: 'contender-', only: ['list', 'challenge'] })
    ]
});

const data = new SlashCommandBuilder()
    .setName('championship')
    .setDescription('Titles and champions. Pick a title to open its belt with buttons.')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('title').setDescription('Open one title (leave empty to see every title)').setRequired(false).setAutocomplete(true));

const subOf = (interaction) => { try { return interaction.options.getSubcommand(false); } catch (_) { return null; } };

module.exports = {
    data,
    routes: inner.routes,
    async autocomplete(interaction) {
        if (subOf(interaction)) return inner.autocomplete(interaction);
        return interaction.respond(await autocompleteTitles(interaction, interaction.options.getFocused()));
    },
    async execute(interaction) {
        if (subOf(interaction)) return inner.execute(interaction);
        return require('../modules/staffPanels').championshipHome(interaction);
    }
};
