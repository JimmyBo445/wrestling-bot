const { partsOf, makeUmbrella } = require('../utils/umbrella');

// People and history in one place: roster, hall of fame, injury report
module.exports = makeUmbrella({
    name: 'directory',
    description: 'Roster pages and lists, the Hall of Fame and the injury report in one place',
    parts: [
        ...partsOf(require('../modules/roster'), { asSub: 'roster' }),
        ...partsOf(require('../modules/rosterList'), { asSub: 'list' }),
        ...partsOf(require('../modules/halloffame'), { prefix: 'hof-' }),
        ...partsOf(require('../modules/injury'), { prefix: 'injury-' })
    ]
});

// 3.9: one command. /directory opens the roster list with buttons for roster cards, Hall of Fame and injuries.
require('../utils/slim').asScreen(module.exports, {
    description: 'The roster, roster cards, the Hall of Fame and the injury report',
    options: [
        { type: 3, name: 'page', description: 'What to open (default: the roster list)', required: false,
            choices: [{ name: 'Roster list', value: 'list' }, { name: 'Roster cards (flip through)', value: 'roster' }, { name: 'Hall of Fame', value: 'hof' }, { name: 'Injury report', value: 'injuries' }] },
        { type: 3, name: 'division', description: 'Only one division', required: false,
            choices: Object.entries(require('../utils/discordHelpers').DIVISION_LABELS).map(([value, name]) => ({ name, value })) }
    ],
    screen: (i) => require('../modules/screens').directoryScreen(i)
});
