const { pool } = require('../db/pool');

/**
 * How many titles of each division has every character held? A "grand slam" means
 * holding (or having held) every title in their division.
 * Returns { total, rows:[{id,name,n,complete}] } for a division.
 */
async function grandSlamProgress(guildId, division) {
    const { rows: tot } = await pool.query(`SELECT COUNT(*)::int AS n FROM titles WHERE guild_id = $1 AND division = $2`, [guildId, division]);
    const total = tot[0].n;
    const { rows } = await pool.query(
        `SELECT c.id, c.name, c.status, COUNT(DISTINCT tr.title_id)::int AS n
         FROM characters c
         JOIN title_reigns tr ON (tr.team_id IS NULL AND tr.character_id = c.id)
              OR EXISTS (SELECT 1 FROM title_reign_members m WHERE m.reign_id = tr.id AND m.character_id = c.id)
         JOIN titles t ON t.id = tr.title_id AND t.division = $2
         WHERE c.guild_id = $1 AND c.division = $2
         GROUP BY c.id, c.name, c.status
         ORDER BY n DESC, c.name`,
        [guildId, division]);
    return { total, rows: rows.map((r) => ({ ...r, complete: total > 0 && r.n >= total })) };
}

const WIN_TIERS = [[100, '100 WINS'], [50, '50 WINS'], [25, '25 WINS'], [10, '10 WINS']];

/**
 * Achievement badges for a character. Pure rules over numbers we already have,
 * plus a few small lookups. Returns [{ key, label, tone }] best first.
 */
async function characterBadges(character, summary, { reigns = 0, defenses = 0 } = {}) {
    const out = [];
    if (summary.wins >= 5 && summary.losses === 0) out.push({ key: 'undefeated', label: 'UNDEFEATED', tone: 'gold' });

    const gs = await grandSlamProgress(character.guild_id, character.division);
    if (gs.rows.some((r) => String(r.id) === String(character.id) && r.complete)) out.push({ key: 'grandslam', label: 'GRAND SLAM', tone: 'gold' });

    const { rows: extra } = await pool.query(
        `SELECT
           (SELECT COUNT(*) FROM matches m JOIN match_participants mp ON mp.match_id = m.id
             WHERE mp.character_id = $1 AND m.stars = 5)::int AS five_star,
           (SELECT COUNT(*) FROM motn_polls p JOIN match_participants mp ON mp.match_id = p.winner_match_id
             WHERE mp.character_id = $1 AND p.status = 'closed')::int AS motn,
           (SELECT COUNT(*) FROM tournaments WHERE winner_id = $1)::int AS tournaments`,
        [character.id]);
    const e = extra[0];
    if (e.tournaments) out.push({ key: 'tournament', label: e.tournaments > 1 ? `${e.tournaments}X TOURNAMENT WINNER` : 'TOURNAMENT WINNER', tone: 'gold' });
    if (reigns >= 3) out.push({ key: 'multichamp', label: `${reigns}-TIME CHAMPION`, tone: 'gold' });
    if (defenses >= 5) out.push({ key: 'defender', label: `${defenses} DEFENSES`, tone: 'gold' });
    if (e.five_star) out.push({ key: 'fivestar', label: e.five_star > 1 ? `${e.five_star}X FIVE STAR` : 'FIVE STAR CLASSIC', tone: 'orange' });
    if (e.motn) out.push({ key: 'motn', label: e.motn > 1 ? `${e.motn}X MATCH OF THE NIGHT` : 'MATCH OF THE NIGHT', tone: 'orange' });
    const run = summary.streaks.longestWin;
    if (run >= 10) out.push({ key: 'streak', label: `${run}-WIN STREAK`, tone: 'green' });
    else if (run >= 5) out.push({ key: 'streak', label: 'HOT STREAK', tone: 'green' });
    const tier = WIN_TIERS.find(([n]) => summary.wins >= n);
    if (tier) out.push({ key: 'wins', label: tier[1], tone: 'green' });
    if (summary.total >= 50) out.push({ key: 'veteran', label: 'VETERAN', tone: 'grey' });
    return out;
}

module.exports = { grandSlamProgress, characterBadges };
