const { partsOf, makeUmbrella } = require('../utils/umbrella');

// Matchmaking help (players) and show signups (admins) in one place
module.exports = makeUmbrella({
    name: 'booking',
    description: 'Find opponents, request matches and run show signups',
    parts: [
        ...partsOf(require('../modules/matchmaking')),
        ...partsOf(require('../modules/signup'), { prefix: 'signup-' })
    ]
});
