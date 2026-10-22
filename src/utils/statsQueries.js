const { pool } = require('../db/pool');
const { computeStreaks, recentForm } = require('./streaks');

// period -> number of days (null = all time)
const PERIODS = { all: null, '30d': 30, '90d': 90, '365d': 365 };
const PERIOD_LABELS = { all: 'All time', '30d': 'Last 30 days', '90d': 'Last 90 days', '365d': 'Last year' };

function sinceClause(days, alias = 'm') {
    return days ? `AND ${alias}.created_at >= now() - interval '${Number(days)} days'` : '';
}

/** Full ordered result list (oldest->newest) with dates, for one character. */
async function characterTimeline(characterId, days = null, ownerId = null) {
    const { rows } = await pool.query(
        `SELECT m.id AS match_id, m.match_type, m.result_type, m.is_title_match, m.is_contender_match, m.created_at, mp.is_winner
         FROM match_participants mp JOIN matches m ON m.id = mp.match_id
         WHERE mp.character_id = $1 ${ownerId ? 'AND mp.owner_id = $2' : ''} ${sinceClause(days)}
         ORDER BY m.created_at ASC, m.id ASC`,
        ownerId ? [characterId, ownerId] : [characterId]
    );
    return rows.map((r) => ({
        ...r,
        result: r.result_type === 'draw' ? 'D' : r.result_type === 'no_contest' ? 'NC' : r.is_winner ? 'W' : 'L'
    }));
}

function tally(timeline) {
    const t = { wins: 0, losses: 0, draws: 0, ncs: 0, total: timeline.length };
    for (const r of timeline) {
        if (r.result === 'W') t.wins++; else if (r.result === 'L') t.losses++; else if (r.result === 'D') t.draws++; else t.ncs++;
    }
    const decided = t.wins + t.losses;
    t.winPct = decided ? (t.wins / decided) * 100 : 0;
    return t;
}

async function characterSummary(characterId, days = null, ownerId = null) {
    const timeline = await characterTimeline(characterId, days, ownerId);
    const results = timeline.map((r) => r.result);
    const byType = {};
    for (const r of timeline) {
        byType[r.match_type] ||= { w: 0, l: 0, d: 0 };
        if (r.result === 'W') byType[r.match_type].w++; else if (r.result === 'L') byType[r.match_type].l++; else if (r.result === 'D') byType[r.match_type].d++;
    }
    const title = timeline.filter((r) => r.is_title_match);
    const titleW = title.filter((r) => r.result === 'W').length;
    const titleL = title.filter((r) => r.result === 'L').length;
    return {
        ...tally(timeline),
        streaks: computeStreaks(results),
        form: recentForm(results, 5),
        byType,
        titleMatches: { w: titleW, l: titleL },
        timeline
    };
}

/**
 * Record of `characterId` against every opponent. An opponent is anyone on the other
 * side of a team match, or anyone else in a free-for-all. In a free-for-all, a win
 * counts against everyone; a loss counts only against the actual winner.
 */
async function opponentBreakdown(characterId, { days = null, limit = 25 } = {}) {
    const { rows } = await pool.query(
        `SELECT oc.id, oc.name, u.discord_id,
                COUNT(*) FILTER (WHERE m.result_type = 'decisive' AND me.is_winner)::int AS w,
                COUNT(*) FILTER (WHERE m.result_type = 'decisive' AND NOT me.is_winner AND op.is_winner)::int AS l,
                COUNT(*) FILTER (WHERE m.result_type = 'draw')::int AS d,
                COUNT(*)::int AS meetings,
                MAX(m.created_at) AS last_met
         FROM match_participants me
         JOIN match_participants op ON op.match_id = me.match_id AND op.character_id <> me.character_id
              AND (me.team_number IS NULL OR op.team_number IS DISTINCT FROM me.team_number)
         JOIN matches m ON m.id = me.match_id
         JOIN characters oc ON oc.id = op.character_id
         JOIN users u ON u.id = oc.owner_id
         WHERE me.character_id = $1 ${sinceClause(days)}
         GROUP BY oc.id, oc.name, u.discord_id
         ORDER BY meetings DESC, last_met DESC
         LIMIT ${Number(limit)}`,
        [characterId]
    );
    return rows;
}

/** Head to head between two groups of characters (single characters, or all of two users' characters). */
async function headToHead(idsA, idsB, days = null) {
    const { rows } = await pool.query(
        `SELECT m.id, m.match_type, m.result_type, m.is_title_match, m.created_at, a.is_winner AS a_won, b.is_winner AS b_won
         FROM match_participants a
         JOIN match_participants b ON b.match_id = a.match_id
              AND (a.team_number IS NULL OR b.team_number IS DISTINCT FROM a.team_number)
         JOIN matches m ON m.id = a.match_id
         WHERE a.character_id = ANY($1::bigint[]) AND b.character_id = ANY($2::bigint[]) AND a.character_id <> b.character_id
           ${sinceClause(days)}
         ORDER BY m.created_at DESC, m.id DESC`,
        [idsA, idsB]
    );
    // a match may appear several times (multiple chars of one user): collapse per match
    const seen = new Map();
    for (const r of rows) {
        const prev = seen.get(r.id);
        if (!prev) seen.set(r.id, { ...r });
        else { prev.a_won = prev.a_won || r.a_won; prev.b_won = prev.b_won || r.b_won; }
    }
    const matches = [...seen.values()];
    let a = 0, b = 0, d = 0, other = 0;
    for (const m of matches) {
        if (m.result_type === 'draw') d++;
        else if (m.result_type === 'no_contest') other++;
        else if (m.a_won && !m.b_won) a++;
        else if (m.b_won && !m.a_won) b++;
        else other++;
    }
    return { a, b, d, other, total: matches.length, matches };
}

async function recentMatches(guildId, { characterId = null, teamId = null, limit = 10 } = {}) {
    const params = [guildId];
    let filter = '';
    if (characterId) { params.push(characterId); filter = `AND EXISTS (SELECT 1 FROM match_participants x WHERE x.match_id = m.id AND x.character_id = $2)`; }
    if (teamId) { params.push(teamId); filter = `AND EXISTS (SELECT 1 FROM match_participants x WHERE x.match_id = m.id AND x.team_id = $2)`; }
    const { rows } = await pool.query(
        `SELECT m.id, m.match_type, m.result_type, m.notes, m.created_at, m.is_title_match, m.is_contender_match,
                t.name AS title_name, ct.name AS contender_title_name,
                (SELECT string_agg(c.name, ', ' ORDER BY mp.id) FROM match_participants mp JOIN characters c ON c.id = mp.character_id
                  WHERE mp.match_id = m.id AND mp.is_winner) AS winners,
                (SELECT string_agg(c.name, ', ' ORDER BY mp.id) FROM match_participants mp JOIN characters c ON c.id = mp.character_id
                  WHERE mp.match_id = m.id AND NOT mp.is_winner) AS others
         FROM matches m
         LEFT JOIN titles t ON t.id = m.title_id
         LEFT JOIN titles ct ON ct.id = m.contender_title_id
         WHERE m.guild_id = $1 ${filter}
         ORDER BY m.created_at DESC, m.id DESC LIMIT ${Number(limit)}`,
        params
    );
    return rows;
}

async function teamSummary(teamId) {
    const { rows } = await pool.query(
        `SELECT m.id, m.match_type, m.result_type, m.is_title_match, m.created_at, bool_or(mp.is_winner) AS is_winner
         FROM match_participants mp JOIN matches m ON m.id = mp.match_id
         WHERE mp.team_id = $1 GROUP BY m.id ORDER BY m.created_at ASC, m.id ASC`,
        [teamId]
    );
    const timeline = rows.map((r) => ({
        ...r, result: r.result_type === 'draw' ? 'D' : r.result_type === 'no_contest' ? 'NC' : r.is_winner ? 'W' : 'L'
    }));
    const results = timeline.map((r) => r.result);
    return { ...tally(timeline), streaks: computeStreaks(results), form: recentForm(results, 5), timeline };
}

/**
 * A player's record follows the PLAYER: every match they wrestled in (whichever character
 * they used), overall and per division. Characters they no longer own still count for them.
 */
async function userSummary(guildId, ownerId) {
    const { rows } = await pool.query(
        `SELECT m.id AS match_id, m.match_type, m.result_type, m.created_at, mp.is_winner, mp.division,
                c.id AS char_id, c.name AS char_name, c.status AS char_status, c.owner_id AS char_owner
         FROM match_participants mp
         JOIN matches m ON m.id = mp.match_id
         JOIN characters c ON c.id = mp.character_id
         WHERE mp.owner_id = $2 AND m.guild_id = $1
         ORDER BY m.created_at ASC, m.id ASC`, [guildId, ownerId]);
    const toResult = (r) => (r.result_type === 'draw' ? 'D' : r.result_type === 'no_contest' ? 'NC' : r.is_winner ? 'W' : 'L');
    const all = rows.map((r) => ({ ...r, result: toResult(r) }));
    const seen = new Set();
    const merged = all.filter((r) => (seen.has(r.match_id) ? false : seen.add(r.match_id)));
    const summarize = (list) => {
        const once = new Set();
        const uniq = list.filter((r) => (once.has(r.match_id) ? false : once.add(r.match_id)));
        const results = uniq.map((r) => r.result);
        return { ...tally(uniq), streaks: computeStreaks(results), form: recentForm(results, 5) };
    };
    const byDivision = {};
    for (const div of [...new Set(all.map((r) => r.division).filter(Boolean))]) byDivision[div] = summarize(all.filter((r) => r.division === div));
    const chars = [];
    for (const id of [...new Set(all.map((r) => String(r.char_id)))]) {
        const mine = all.filter((r) => String(r.char_id) === id);
        const t = tally(mine);
        chars.push({ id, name: mine[0].char_name, status: mine[0].char_status, division: mine[0].division,
            current: String(mine[0].char_owner) === String(ownerId), ...t, streaks: computeStreaks(mine.map((r) => r.result)) });
    }
    // current characters with no matches yet still get listed
    const { rows: owned } = await pool.query(
        `SELECT id, name, status, division FROM characters WHERE guild_id = $1 AND owner_id = $2 AND status IN ('approved','retired')`, [guildId, ownerId]);
    for (const c of owned) if (!chars.some((x) => String(x.id) === String(c.id))) {
        chars.push({ id: String(c.id), name: c.name, status: c.status, division: c.division, current: true, wins: 0, losses: 0, draws: 0, ncs: 0, total: 0, winPct: 0, streaks: computeStreaks([]) });
    }
    return { chars, byDivision, ...summarize(merged) };
}

/** Record per stipulation and wins by finish for one wrestler (their current owner's matches only). */
async function stipulationBreakdown(characterId, ownerId = null, days = null) {
    const { rows } = await pool.query(
        `SELECT m.stipulation, m.finish, m.result_type, mp.is_winner
         FROM match_participants mp JOIN matches m ON m.id = mp.match_id
         WHERE mp.character_id = $1 AND ($2::bigint IS NULL OR mp.owner_id = $2)
           AND ($3::int IS NULL OR m.created_at >= now() - ($3 || ' days')::interval)
           AND (m.stipulation IS NOT NULL OR m.finish IS NOT NULL)`,
        [characterId, ownerId, days]);
    const bySip = {};
    const winFinishes = {};
    for (const r of rows) {
        if (r.stipulation && r.result_type === 'decisive') {
            const b = (bySip[r.stipulation] ||= { w: 0, l: 0 });
            if (r.is_winner) b.w++; else b.l++;
        }
        if (r.finish && r.is_winner && r.result_type === 'decisive') winFinishes[r.finish] = (winFinishes[r.finish] || 0) + 1;
    }
    return { bySip, winFinishes };
}

module.exports = {
    stipulationBreakdown,
    PERIODS, PERIOD_LABELS, characterSummary, characterTimeline, opponentBreakdown, headToHead,
    recentMatches, teamSummary, userSummary, tally
};
