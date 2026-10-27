const { partsOf, makeUmbrella } = require('../utils/umbrella');

// People and history in one place: roster, hall of fame, injury report
module.exports = makeUmbrella({
    name: 'directory',
    description: 'Roster pages, the Hall of Fame and the injury report in one place',
    parts: [
        ...partsOf(require('../modules/roster'), { asSub: 'roster' }),
        ...partsOf(require('../modules/halloffame'), { prefix: 'hof-' }),
        ...partsOf(require('../modules/injury'), { prefix: 'injury-' })
    ]
});
