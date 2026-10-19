const { pool } = require('../db/pool');

/**
 * Pure function. `results` is oldest -> newest, each 'W' | 'L' | 'D' | 'NC'.
 * Draws and no-contests neither extend nor break a streak.
 */
function computeStreaks(results) {
    let longestWin = 0, longestLoss = 0, runWin = 0, runLoss = 0;
    let last = null;
    for (const r of results) {
        if (r === 'W') { runWin += 1; runLoss = 0; longestWin = Math.max(longestWin, runWin); last = 'win'; }
        else if (r === 'L') { runLoss += 1; runWin = 0; longestLoss = Math.max(longestLoss, runLoss); last = 'loss'; }
    }
    const current = last === 'win' ? runWin : last === 'loss' ? runLoss : 0;
    return { current, direction: last, longestWin, longestLoss };
}

/** Last N results (newest first) for the form chips, e.g. ['W','W','L','D','W']. */
function recentForm(results, n = 5) {
    return results.slice(-n).reverse();
}

function rowToResult(row) {
    if (row.result_type === 'draw') return 'D';
    if (row.result_type === 'no_contest') return 'NC';
    return row.is_winner ? 'W' : 'L';
}

/** Oldest -> newest list of results for a character. */
async function getCharacterResults(characterId, client = pool) {
    const { rows } = await client.query(
        `SELECT mp.is_winner, m.result_type
         FROM match_participants mp JOIN matches m ON m.id = mp.match_id
         WHERE mp.character_id = $1
         ORDER BY m.created_at ASC, m.id ASC`,
        [characterId]
    );
    return rows.map(rowToResult);
}

/** Oldest -> newest list of results for a registered team (counted once per match). */
async function getTeamResults(teamId, client = pool) {
    const { rows } = await client.query(
        `SELECT m.id, m.result_type, bool_or(mp.is_winner) AS is_winner
         FROM match_participants mp JOIN matches m ON m.id = mp.match_id
         WHERE mp.team_id = $1
         GROUP BY m.id, m.result_type, m.created_at
         ORDER BY m.created_at ASC, m.id ASC`,
        [teamId]
    );
    return rows.map(rowToResult);
}

async function getStreaks(characterId, client = pool) {
    return computeStreaks(await getCharacterResults(characterId, client));
}

async function getTeamStreaks(teamId, client = pool) {
    return computeStreaks(await getTeamResults(teamId, client));
}

module.exports = {
    computeStreaks, recentForm, getCharacterResults, getTeamResults, getStreaks, getTeamStreaks
};
