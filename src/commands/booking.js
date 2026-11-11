const { partsOf, makeUmbrella, choicePart } = require('../utils/umbrella');

// Matchmaking help (players) and show signups (admins) in one place
// 3.5: signup-add + signup-remove became one /booking signup-edit (action: add / remove).
const signup = partsOf(require('../modules/signup'), { prefix: 'signup-' });
const part = (n) => signup.find((p) => p.json.name === n);
module.exports = makeUmbrella({
    name: 'booking',
    description: 'Find opponents, request matches and run show signups',
    parts: [
        ...partsOf(require('../modules/matchmaking')),
        ...signup.filter((p) => !['signup-add', 'signup-remove'].includes(p.json.name)),
        choicePart({
            name: 'signup-edit',
            description: '[Admin] Add a wrestler to a signup, or take one off',
            choice: { name: 'action', description: 'Add or remove' },
            cases: [{ value: 'add', label: 'Add to the signup', part: part('signup-add') }, { value: 'remove', label: 'Remove from the signup', part: part('signup-remove') }]
        })
    ],
    hidden: signup
});
