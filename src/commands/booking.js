const { partsOf, makeUmbrella, choicePart } = require('../utils/umbrella');

// Matchmaking help (players) and show signups (admins) in one place.
// 3.5: signup-add + signup-remove became one /booking signup-edit (action: add / remove).
// 3.8: Discord only lists /booking request and /booking signups (a button screen). The other
//      subcommands still work inside the bot: the buttons run them.
const signup = partsOf(require('../modules/signup'), { prefix: 'signup-' });
const matchmaking = partsOf(require('../modules/matchmaking'));
const part = (list, n) => list.find((p) => p.json.name === n);

const signupsPanel = {
    json: { type: 1, name: 'signups', description: 'Signups and booking help: join, see who signed up, suggest opponents (staff: open/close)', options: [] },
    route: { cmd: { execute: (interaction) => require('../modules/staffPanels').bookingHome(interaction) }, orig: null, admin: false }
};

module.exports = makeUmbrella({
    name: 'booking',
    description: 'Ask for a match, and show signups',
    parts: [part(matchmaking, 'request'), signupsPanel],
    hidden: [
        ...matchmaking, ...signup,
        choicePart({
            name: 'signup-edit',
            description: '[Admin] Add a wrestler to a signup, or take one off',
            choice: { name: 'action', description: 'Add or remove' },
            cases: [{ value: 'add', label: 'Add to the signup', part: part(signup, 'signup-add') }, { value: 'remove', label: 'Remove from the signup', part: part(signup, 'signup-remove') }]
        })
    ]
});
