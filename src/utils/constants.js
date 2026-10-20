// The fixed 10-title catalogue. Guilds get these seeded automatically the
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
    { name: "Customs Tag Team Championship", division: 'custom', is_tag_title: true },

    { name: "Golden Global Kingdom Championship", division: 'custom_womens', is_tag_title: false },
    { name: "Custom Women's Air Force Championship", division: 'custom_womens', is_tag_title: false },
    { name: "Custom Women's Tag Team Championship", division: 'custom_womens', is_tag_title: true }
];

const ffa = (n) => Array.from({ length: n }, (_, i) => ({ name: `participant${i + 1}`, label: `Wrestler ${i + 1}`, team: null }));
const teamSlots = (n) => [1, 2].flatMap((t) =>
    Array.from({ length: n }, (_, i) => ({ name: `team${t}_p${i + 1}`, label: `Team ${t} - Wrestler ${i + 1}`, team: t })));

// One config drives the slash command shape, the validation, and the cards.
// winnerMode 'single' = one winner (free-for-all style), 'team' = winning team 1 or 2.
const MATCH_CONFIG = {
    singles:       { label: 'Singles',         slots: ffa(2),       winnerMode: 'single' },
    tag2v2:        { label: 'Tag Team (2v2)',  slots: teamSlots(2), winnerMode: 'team' },
    tag3v3:        { label: 'Tag Team (3v3)',  slots: teamSlots(3), winnerMode: 'team' },
    triple_threat: { label: 'Triple Threat',   slots: ffa(3),       winnerMode: 'single' },
    fatal4way:     { label: 'Fatal 4-Way',     slots: ffa(4),       winnerMode: 'single' },
    fiveway:       { label: '5-Way',           slots: ffa(5),       winnerMode: 'single' },
    sixman:        { label: '6-Man Tag',       slots: teamSlots(3), winnerMode: 'team' },
    eightman:      { label: '8-Man Tag',       slots: teamSlots(4), winnerMode: 'team' }
};

const isTeamMatch = (matchType) => MATCH_CONFIG[matchType]?.winnerMode === 'team';
const matchLabel = (matchType) => MATCH_CONFIG[matchType]?.label || matchType;

const MAX_CHARACTERS_PER_USER = 4;
const MAX_CARD_MATCHES = 10;
const DEFAULT_COOLDOWN_HOURS = 24;
const DEFAULT_STREAK_THRESHOLD = 3;
const RANKING_WINDOW_DAYS = 90;

// Look & feel per division (cards, embeds)
const DIVISION_THEME = {
    mens:   { label: "Men's",   accent: '#C0392B', accent2: '#7B1E16', embed: 0xC0392B },
    womens: { label: "Women's", accent: '#D6336C', accent2: '#7A1D3C', embed: 0xD6336C },
    custom: { label: 'Custom',  accent: '#7C3AED', accent2: '#3F1D8A', embed: 0x7C3AED },
    custom_womens: { label: "Custom Women's", accent: '#0EA5A4', accent2: '#0B5E5E', embed: 0x0EA5A4 }
};

// Show brands for match cards. Plain colours + text only (no logos).
const CARD_BRANDS = {
    raw:       { name: 'RAW', label: 'RAW',       bgTop: '#9b1118', bgBottom: '#2a0306', accent: '#ff3b3b', glow: '#ff5a4a' },
    smackdown: { name: 'SmackDown', label: 'SMACKDOWN', bgTop: '#0e4cb5', bgBottom: '#041230', accent: '#3d9bff', glow: '#4fa3ff' }
};

module.exports = {
    MAX_CARD_MATCHES, CARD_BRANDS,
    DEFAULT_TITLES, MATCH_CONFIG, isTeamMatch, matchLabel,
    MAX_CHARACTERS_PER_USER, DEFAULT_COOLDOWN_HOURS, DEFAULT_STREAK_THRESHOLD, RANKING_WINDOW_DAYS,
    DIVISION_THEME,
    // kept so any leftover old file that imports it does not crash
    MATCH_TYPES: MATCH_CONFIG, SINGLES_COOLDOWN_HOURS: DEFAULT_COOLDOWN_HOURS
};
