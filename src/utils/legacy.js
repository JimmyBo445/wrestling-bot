// Legacy accolades: Money in the Bank and Royal Rumble (per division), Face of FNLW MVP and year-end awards.
// An accolade belongs to the character who won it; the player who owned them then keeps the credit.
const { pool } = require('../db/pool');
const { DIVISION_LABELS } = require('./discordHelpers');

const KINDS = {
    mitb: { label: 'Money in the Bank', short: 'MITB', perDivision: true },
    rumble: { label: 'Royal Rumble', short: 'RUMBLE', perDivision: true },
    mvp: { label: 'Face of FNLW MVP', short: 'FACE OF FNLW', perDivision: false },
    award: { label: 'Year-end award', short: null, perDivision: false }
};
const DEFAULT_AWARDS = ['Breakout Wrestler of the Year', 'Rivalry of the Year', 'Kickout King of the Year', 'Promo Prince of the Year', 'Match of the Year', 'Rookie of the Year', 'Cringe Guy Award', 'OMG Moment of the Year'];

/** "Money in the Bank (Men's) 2026", "Wrestler of the Year 2025" */
function accoladeName(a, { withYear = true } = {}) {
    const base = a.kind === 'award' ? a.award_name : KINDS[a.kind].label;
    const div = KINDS[a.kind]?.perDivision && a.division ? ` (${DIVISION_LABELS[a.division] || a.division})` : '';
    return `${base}${div}${withYear ? ` ${a.year}` : ''}`;
}

/** The server's year-end award names; the defaults are filled in the first time. */
async function awardNames(guildId) {
    let { rows } = await pool.query(`SELECT name FROM legacy_award_names WHERE guild_id = $1 ORDER BY sort, lower(name)`, [guildId]);
    if (!rows.length) {
        const { rows: any } = await pool.query(`SELECT 1 FROM legacy WHERE guild_id = $1 AND kind = 'award' LIMIT 1`, [guildId]);
        const { rows: touched } = await pool.query(`SELECT legacy_names_set FROM guilds WHERE guild_id = $1`, [guildId]);
        if (!any.length && !touched[0]?.legacy_names_set) {
            for (let i = 0; i < DEFAULT_AWARDS.length; i++) {
                await pool.query(`INSERT INTO legacy_award_names (guild_id, name, sort) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [guildId, DEFAULT_AWARDS[i], i]);
            }
            rows = DEFAULT_AWARDS.map((name) => ({ name }));
        }
    }
    return rows.map((r) => r.name);
}

/** Accolades won by a character (singles credit only to them). Newest first. */
async function characterLegacy(characterId) {
    const { rows } = await pool.query(`SELECT * FROM legacy WHERE character_id = $1 ORDER BY year DESC, id DESC`, [characterId]);
    return rows;
}

/** Accolades credited to a player (by users.id). Newest first. */
async function playerLegacy(userId) {
    const { rows } = await pool.query(`SELECT * FROM legacy WHERE user_id = $1 ORDER BY year DESC, id DESC`, [userId]);
    return rows;
}

/**
 * Gold badges for a card, one per kind of accolade:
 * one win → "MEN'S MITB 2026" / "WRESTLER OF THE YEAR 2025"; several → "2X MITB WINNER" / "2X WRESTLER OF THE YEAR".
 */
function legacyBadges(list) {
    const groups = new Map();
    for (const a of list) {
        const key = a.kind === 'award' ? `award:${String(a.award_name).toLowerCase()}` : a.kind;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(a);
    }
    const out = [];
    for (const items of groups.values()) {
        const a = items[0];
        let label;
        if (items.length > 1) {
            label = a.kind === 'award' ? `${items.length}X ${a.award_name}` : a.kind === 'mvp' ? `${items.length}X FACE OF FNLW` : `${items.length}X ${KINDS[a.kind].short} WINNER`;
        } else if (a.kind === 'award') label = `${a.award_name} ${a.year}`;
        else if (a.kind === 'mvp') label = `FACE OF FNLW ${a.year}`;
        else label = `${a.division ? `${(DIVISION_LABELS[a.division] || '').toUpperCase()} ` : ''}${KINDS[a.kind].short} ${a.year}`;
        out.push({ key: `legacy:${a.kind}`, label: label.toUpperCase(), tone: 'gold', count: items.length, year: a.year });
    }
    // most-won first, then newest
    return out.sort((x, y) => y.count - x.count || y.year - x.year);
}

module.exports = { KINDS, DEFAULT_AWARDS, accoladeName, awardNames, characterLegacy, playerLegacy, legacyBadges };
