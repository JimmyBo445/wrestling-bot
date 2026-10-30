// /title [Admin]: run the belts. Log a title match, set contenders, vacate, upload belt art.
const { partsOf, makeUmbrella } = require('../utils/umbrella');
const champ = require('../modules/championship');
const { adminParts } = require('../utils/adminParts');

module.exports = makeUmbrella({
    name: 'title',
    description: '[Admin] Run the title belts: log title matches, contenders, vacate, belt pictures',
    parts: adminParts([
        ...partsOf(require('../modules/titleExtras'), { only: ['match', 'belt-image'] }),
        ...partsOf(champ, { only: ['vacate', 'interim', 'unify', 'watch', 'waive-rematch'] }),
        ...partsOf(require('../modules/contender'), { prefix: 'contender-', only: ['award', 'revoke'] })
    ])
});
