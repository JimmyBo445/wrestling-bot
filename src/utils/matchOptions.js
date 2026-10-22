const { STIPULATIONS, FINISHES } = require('./constants');

/** Adds the optional stipulation / finish / score options to a log subcommand. */
function addDetailOptions(sub) {
    sub.addStringOption((o) => o.setName('stipulation').setDescription('Match type or stipulation (Ladder, Hell in a Cell...) - pick or type your own').setRequired(false).setMaxLength(40).setAutocomplete(true));
    sub.addStringOption((o) => o.setName('finish').setDescription('How it ended (DQ, count-out, submission...)').setRequired(false).addChoices(...FINISHES));
    sub.addStringOption((o) => o.setName('score').setDescription('Falls or score, like 3-2 for an Iron Man match').setRequired(false).setMaxLength(20));
    return sub;
}

function readDetails(interaction) {
    return {
        stipulation: interaction.options.getString('stipulation'),
        finish: interaction.options.getString('finish'),
        score: interaction.options.getString('score')
    };
}

function stipulationChoices(typed) {
    const q = String(typed || '').toLowerCase();
    const list = STIPULATIONS.filter((s) => s.toLowerCase().includes(q)).slice(0, 24);
    const out = list.map((s) => ({ name: s, value: s }));
    // let people use their own wording
    if (typed && !STIPULATIONS.some((s) => s.toLowerCase() === q)) out.unshift({ name: String(typed).slice(0, 40), value: String(typed).slice(0, 40) });
    return out.slice(0, 25);
}

module.exports = { addDetailOptions, readDetails, stipulationChoices };
