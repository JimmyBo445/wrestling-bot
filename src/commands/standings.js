const { partsOf, makeUmbrella, choicePart } = require('../utils/umbrella');

// Boards in one place: /standings leaderboard | rankings | power | season
// 3.5: season-standings + season-recap became one /standings season (picture: shows the recap picture).
const season = partsOf(require('../modules/season'), { prefix: 'season-' });
const part = (n) => season.find((p) => p.json.name === n);
module.exports = makeUmbrella({
    name: 'standings',
    description: 'Leaderboards, division rankings and season standings in one place',
    parts: [
        ...partsOf(require('../modules/leaderboard'), { asSub: 'leaderboard' }),
        ...partsOf(require('../modules/rankings'), { asSub: 'rankings' }),
        ...partsOf(require('../modules/power'), { asSub: 'power' }),
        choicePart({
            name: 'season',
            description: 'Season standings for a year (picture: the year-end recap picture)',
            cases: [{ value: 'standings', label: 'Standings', part: part('season-standings') }, { value: 'recap', label: 'Recap picture', part: part('season-recap') }],
            pick: (i) => (i.options.getBoolean('picture') ? 'recap' : 'standings'),
            extra: [{ type: 5, name: 'picture', description: 'Show the recap picture instead of the table', required: false }]
        })
    ],
    hidden: season
});
