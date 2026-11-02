// Fan ratings (3.1): anyone can give a match 1-5 stars with the ⭐ button under its result.
const { pool } = require('../db/pool');

/** Saves (or changes) one person's rating. Returns { avg, votes }. */
async function rate(guildId, matchId, discordId, stars) {
    const { rows } = await pool.query(`SELECT 1 FROM matches WHERE id = $1 AND guild_id = $2`, [matchId, guildId]);
    if (!rows.length) {
        const { UserError } = require('./errors');
        throw new UserError('That match isn\'t on record anymore (it may have been undone).');
    }
    await pool.query(
        `INSERT INTO match_ratings (match_id, discord_id, stars) VALUES ($1,$2,$3)
         ON CONFLICT (match_id, discord_id) DO UPDATE SET stars = EXCLUDED.stars, rated_at = now()`, [matchId, discordId, stars]);
    return (await averages([matchId])).get(String(matchId));
}

/** Map matchId → { avg: '4.2', votes } for the matches that have fan ratings. */
async function averages(matchIds) {
    const ids = (matchIds || []).map(String).filter((x) => /^\d+$/.test(x));
    if (!ids.length) return new Map();
    const { rows } = await pool.query(
        `SELECT match_id, AVG(stars)::float AS a, COUNT(*)::int AS n FROM match_ratings WHERE match_id = ANY($1::bigint[]) GROUP BY match_id`, [ids]);
    return new Map(rows.map((r) => [String(r.match_id), { avg: (Math.round(r.a * 10) / 10).toFixed(1), votes: r.n }]));
}

/** This person's own rating of a match, or null. */
async function mine(matchId, discordId) {
    const { rows } = await pool.query(`SELECT stars FROM match_ratings WHERE match_id = $1 AND discord_id = $2`, [matchId, discordId]);
    return rows[0]?.stars || null;
}

module.exports = { rate, averages, mine };
