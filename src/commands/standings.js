const { partsOf, makeUmbrella } = require('../utils/umbrella');

// Boards in one place: /standings leaderboard | rankings | season-standings | season-recap
module.exports = makeUmbrella({
    name: 'standings',
    description: 'Leaderboards, division rankings and season standings in one place',
    parts: [
        ...partsOf(require('../modules/leaderboard'), { asSub: 'leaderboard' }),
        ...partsOf(require('../modules/rankings'), { asSub: 'rankings' }),
        ...partsOf(require('../modules/season'), { prefix: 'season-' })
    ]
});
