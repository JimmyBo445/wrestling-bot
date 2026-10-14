// The fixed 9-title catalogue. Guilds get these seeded automatically the
// first time the bot sees them (see utils/ensureGuild.js).
const DEFAULT_TITLES = [
    { name: "World Heavyweight Championship", division: 'mens', is_tag_title: false },
    { name: "United States Championship", division: 'mens', is_tag_title: false },
    { name: "Intercontinental Championship", division: 'mens', is_tag_title: false },
    { name: "Men's Tag Team Championship", division: 'mens', is_tag_title: true },

    { name: "Women's World Championship", division: 'womens', is_tag_title: false },
    { name: "Women's Intercontinental Championship", division: 'womens', is_tag_title: false },
    { name: "Women's Tag Team Championship", division: 'womens', is_tag_title: true },

    { name: "Prime Time Universal Championship", division: 'custom', is_tag_title: false },
    { name: "Showtime Championship", division: 'custom', is_tag_title: false },
    { name: "Customs Tag Team Championship", division: 'custom', is_tag_title: true }
];

const MATCH_TYPES = {
    singles: { label: 'Singles', participants: 2, teams: false },
    tag2v2: { label: 'Tag Team (2v2)', participants: 4, teams: true },
    tag3v3: { label: 'Tag Team (3v3)', participants: 6, teams: true },
    triple_threat: { label: 'Triple Threat', participants: 3, teams: false },
    fatal4way: { label: 'Fatal 4-Way', participants: 4, teams: false },
    fiveway: { label: '5-Way', participants: 5, teams: false },
    sixman: { label: '6-Man', participants: 6, teams: false },
    eightman: { label: '8-Man', participants: 8, teams: false }
};

const MAX_CHARACTERS_PER_USER = 3;
const SINGLES_COOLDOWN_HOURS = 24; // avoid immediate repeat singles matchups

module.exports = { DEFAULT_TITLES, MATCH_TYPES, MAX_CHARACTERS_PER_USER, SINGLES_COOLDOWN_HOURS };
