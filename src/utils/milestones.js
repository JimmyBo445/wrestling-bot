const { pool } = require('../db/pool');
const { computeStreaks } = require('./streaks');
const { isTeamMatch } = require('./constants');

const ord = (n) => `${n}${[, 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10] || 'th'}`;
const STREAK_STEP = 5;               // 5, 10, 15 ... wins in a row
const CAREER_WINS = new Set([10, 25, 50, 100, 150, 200]);

/**
 * Shout-outs for a freshly logged match. Returns an array of short lines (may be empty).
 * Never throws: a failed shout-out must not break match logging.
 */
async function detectMilestones(guildId, result) {
    try {
        const { rows } = await pool.query(`SELECT milestones_enabled FROM guilds WHERE guild_id = $1`, [guildId]);
        if (rows[0] && rows[0].milestones_enabled === false) return [];
        if (result.resultType !== 'decisive') return [];
        const lines = [];
        const winners = result.characters.filter((_, i) => result.winnerIdx.includes(i));

        // streaks and career wins (per wrestler)
        for (const c of winners) {
            const { rows: res } = await pool.query(
                `SELECT mp.is_winner, m.result_type FROM match_participants mp JOIN matches m ON m.id = mp.match_id
                 WHERE mp.character_id = $1 ORDER BY m.created_at, m.id`, [c.id]);
            const results = res.map((r) => (r.result_type === 'draw' ? 'D' : r.result_type === 'no_contest' ? 'NC' : r.is_winner ? 'W' : 'L'));
            const { current, direction } = computeStreaks(results);
            if (direction === 'win' && current >= STREAK_STEP && current % STREAK_STEP === 0) {
                lines.push(`🔥 **${c.name}** just won their **${ord(current)}** match in a row!`);
            }
            const wins = results.filter((r) => r === 'W').length;
            if (CAREER_WINS.has(wins)) lines.push(`🏅 **${c.name}** just earned career win number **${wins}**!`);
        }

        // title reigns
        const effect = result.effect;
        if (result.title && effect && ['new_reign', 'title_change'].includes(effect.type)) {
            if (isTeamMatch(result.matchType) && result.winnerSubject?.type === 'team') {
                const { rows: t } = await pool.query(`SELECT name FROM teams WHERE id = $1`, [result.winnerSubject.id]);
                const { rows: n } = await pool.query(`SELECT COUNT(*)::int AS n FROM title_reigns WHERE team_id = $1`, [result.winnerSubject.id]);
                if (t[0]) lines.push(champLine(t[0].name, n[0].n, result.title.name, true));
            } else if (!isTeamMatch(result.matchType)) {
                const w = winners[0];
                const { rows: n } = await pool.query(`SELECT COUNT(*)::int AS n FROM title_reigns WHERE character_id = $1 AND team_id IS NULL`, [w.id]);
                lines.push(champLine(w.name, n[0].n, result.title.name, false));
            }
        }
        return lines;
    } catch (err) {
        console.error('Milestone check failed:', err.message);
        return [];
    }
}

function champLine(name, n, titleName, isTeam) {
    if (n <= 1) return `👑 **${name}** ${isTeam ? 'are' : 'is'} the new **${titleName}** champion${isTeam ? 's' : ''}!`;
    return `👑 **${name}** ${isTeam ? 'are now' : 'is now'} a **${n}-time** champion${isTeam ? 's' : ''}: new **${titleName}** champion${isTeam ? 's' : ''}!`;
}

module.exports = { detectMilestones };
