// /title [Admin]: run the belts. Log a title match, set contenders, vacate, upload belt art,
// and fix the history (reign-add, reign-edit, reign-remove, add-defense, remove-defense; these were /reign until 2.20).
const { partsOf, makeUmbrella, choicePart } = require('../utils/umbrella');
const champ = require('../modules/championship');
const { adminParts } = require('../utils/adminParts');

const contenderParts = adminParts(partsOf(require('../modules/contender'), { prefix: 'contender-', only: ['award', 'revoke'] }));
module.exports = makeUmbrella({
    name: 'title',
    description: '[Admin] Run the belts: title matches, contenders, vacate, belt pictures, fix reigns',
    parts: adminParts([
        ...partsOf(require('../modules/titleExtras'), { only: ['match', 'belt-image'] }),
        ...partsOf(champ, { only: ['vacate', 'interim', 'unify', 'watch', 'waive-rematch'] }),
        // 3.5: contender-award + contender-revoke became one /title contender (action: give / take away)
        choicePart({
            name: 'contender',
            description: '[Admin] Make someone #1 contender for a title, or take it away',
            choice: { name: 'action', description: 'Give or take away' },
            cases: [
                { value: 'give', label: 'Give #1 contender', part: contenderParts.find((p) => p.json.name === 'contender-award') },
                { value: 'take', label: 'Take it away', part: contenderParts.find((p) => p.json.name === 'contender-revoke') }]
        }),
        ...partsOf(champ, { only: ['backfill-reign', 'edit-reign', 'remove-reign'] }),
        ...partsOf(require('../modules/titleExtras'), { only: ['add-defense', 'remove-defense'] })
    ], { 'backfill-reign': 'reign-add', 'edit-reign': 'reign-edit', 'remove-reign': 'reign-remove' }),
    hidden: contenderParts
});
