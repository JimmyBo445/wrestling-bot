const { pool } = require('../db/pool');
const { UserError } = require('./errors');
const { parseId } = require('./characterUtils');

const DAY = 864e5;
const weight = (date) => {
    const days = (Date.now() - new Date(date).getTime()) / DAY;
    return days <= 7 ? 1 : days <= 14 ? 0.75 : days <= 30 ? 0.5 : 0;
};

const LEVELS = [[80, 'Boiling'], [60, 'Hot'], [40, 'Heated'], [20, 'Simmering'], [0, 'Cold']];
const levelOf = (score) => LEVELS.find(([min]) => score >= min)[1];
const bar = (score) => { const n = Math.round(score / 10); return `${'🟥'.repeat(Math.min(n, 10))}${'⬛'.repeat(Math.max(0, 10 - n))}`; };

/** Matches in which both wrestlers took part. */
async function feudMatches(feud) {
    const { rows } = await pool.query(
        `SELECT m.id, m.created_at, m.match_type, m.result_type, m.is_title_match, m.stipulation, m.stars, t.name AS title_name,
                a.is_winner AS a_won, b.is_winner AS b_won
         FROM matches m
         JOIN match_participants a ON a.match_id = m.id AND a.character_id = $1
         JOIN match_participants b ON b.match_id = m.id AND b.character_id = $2
         LEFT JOIN titles t ON t.id = m.title_id
         WHERE m.created_at >= $3
         ORDER BY m.created_at, m.id`, [feud.char_a, feud.char_b, feud.created_at]);
    return rows;
}

/** Heat 0 to 100: recent matches between them, storyline entries and a manual boost. */
async function feudHeat(feud) {
    const matches = await feudMatches(feud);
    const { rows: entries } = await pool.query(`SELECT created_at FROM feud_entries WHERE feud_id = $1`, [feud.id]);
    let score = feud.boost || 0;
    for (const m of matches) score += weight(m.created_at) * (10 + (m.is_title_match ? 10 : 0) + (m.stars >= 4 ? 5 : 0));
    for (const e of entries) score += weight(e.created_at) * 6;
    score = Math.max(0, Math.min(100, Math.round(score)));
    return { score, label: levelOf(score), bar: bar(score) };
}

async function requireFeud(guildId, value) {
    const id = parseId(value);
    const { rows } = id ? await pool.query(
        `SELECT f.*, a.name AS a_name, b.name AS b_name FROM feuds f JOIN characters a ON a.id = f.char_a JOIN characters b ON b.id = f.char_b
         WHERE f.id = $1 AND f.guild_id = $2`, [id, guildId]) : { rows: [] };
    if (!rows[0]) throw new UserError('I could not find that feud. Pick one from the dropdown list that appears as you type.');
    return rows[0];
}

async function autocompleteFeuds(interaction, focused, { activeOnly = false } = {}) {
    const { rows } = await pool.query(
        `SELECT f.id, f.name, f.status FROM feuds f WHERE f.guild_id = $1 ${activeOnly ? "AND f.status = 'active'" : ''} AND f.name ILIKE $2
         ORDER BY f.status, f.id DESC LIMIT 25`, [interaction.guildId, `%${String(focused).replace(/[%_]/g, '')}%`]);
    return rows.map((r) => ({ name: `${r.name}${r.status === 'ended' ? ' (ended)' : ''}`.slice(0, 100), value: String(r.id) }));
}

module.exports = { feudMatches, feudHeat, requireFeud, autocompleteFeuds, levelOf, bar };
