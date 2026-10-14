const { pool } = require('../db/pool');

const WIN_STREAK_THRESHOLD = 3; // consecutive wins before we flag a character as contender-worthy

/**
 * Returns { current, longest, direction } for a character.
 * direction is 'win' or 'loss' describing the current streak type (null if no decisive matches yet).
 */
async function getStreaks(characterId) {
    const { rows } = await pool.query(
        `SELECT mp.is_winner, m.result_type, m.created_at
         FROM match_participants mp
         JOIN matches m ON m.id = mp.match_id
         WHERE mp.character_id = $1 AND m.result_type = 'decisive'
         ORDER BY m.created_at ASC`,
        [characterId]
    );

    let longestWin = 0, longestLoss = 0;
    let runWin = 0, runLoss = 0;

    for (const row of rows) {
        if (row.is_winner) {
            runWin += 1; runLoss = 0;
            longestWin = Math.max(longestWin, runWin);
        } else {
            runLoss += 1; runWin = 0;
            longestLoss = Math.max(longestLoss, runLoss);
        }
    }

    let current = 0, direction = null;
    if (rows.length) {
        const last = rows[rows.length - 1];
        direction = last.is_winner ? 'win' : 'loss';
        current = direction === 'win' ? runWin : runLoss;
    }

    return { current, direction, longestWin, longestLoss };
}

/**
 * Best-effort check: if a character just hit the win-streak threshold, this
 * does NOT auto-award a title contender spot (division titles are ambiguous
 * which specific belt it should count toward). Instead it returns a flag so
 * the match command can nudge admins to run /contender award.
 */
async function checkAndAwardWinStreak(guildId, characterId) {
    const { current, direction } = await getStreaks(characterId);
    if (direction === 'win' && current === WIN_STREAK_THRESHOLD) {
        return { streak: current }; // caller just surfaces a notice; no auto title assignment
    }
    return null;
}

module.exports = { getStreaks, checkAndAwardWinStreak, WIN_STREAK_THRESHOLD };
