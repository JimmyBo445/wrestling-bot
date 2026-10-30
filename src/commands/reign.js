// /reign [Admin]: fix the record. Add old reigns, edit or remove them, add or remove defenses.
const { partsOf, makeUmbrella } = require('../utils/umbrella');
const { adminParts } = require('../utils/adminParts');

module.exports = makeUmbrella({
    name: 'reign',
    description: '[Admin] Fix title history: add old reigns, edit or remove them, add defenses',
    parts: adminParts([
        ...partsOf(require('../modules/championship'), { only: ['backfill-reign', 'edit-reign', 'remove-reign'] }),
        ...partsOf(require('../modules/titleExtras'), { only: ['add-defense', 'remove-defense'] })
    ], { 'backfill-reign': 'add', 'edit-reign': 'edit', 'remove-reign': 'remove' })
});
