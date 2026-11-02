// /championship = what everyone can look at: list, belt card, panel, history, defenses, lineage, contenders.
// Admins run belts with /title and fix the record with /title reign-add / reign-edit.
const { partsOf, makeUmbrella } = require('../utils/umbrella');
const champ = require('../modules/championship');

const rename = (parts, map) => parts.map((p) => (map[p.json.name] ? { ...p, json: { ...p.json, name: map[p.json.name] } } : p));

module.exports = makeUmbrella({
    name: 'championship',
    description: 'Title belts: champions, belt cards, history, defenses, records and contenders',
    parts: [
        ...partsOf(champ, { only: ['list', 'belt', 'lineage', 'defenses', 'history', 'grand-slam', 'rematches'] }),
        ...partsOf(require('../modules/titlePanel'), { asSub: 'panel' }),
        ...partsOf(require('../modules/records'), { asSub: 'records' }),
        ...rename(partsOf(require('../modules/contender'), { prefix: 'contender-', only: ['list', 'challenge'] }), {})
    ]
});
