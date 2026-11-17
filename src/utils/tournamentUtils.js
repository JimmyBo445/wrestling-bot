const { pool, withTransaction } = require('../db/pool');
const { UserError } = require('./errors');
const { parseId } = require('./characterUtils');
const { vacateTitle, startReign, setVacancy } = require('./titleLogic');

const MIN_ENTRANTS = 4;
const MAX_ENTRANTS = 16;
// 3.18: a triple-threat first round (winners then go one-on-one)
const TRIPLE_MIN = 6;
const TRIPLE_MAX = 24;
const isTriple = (t) => t?.format === 'triple';
const minFor = (t) => (isTriple(t) ? TRIPLE_MIN : MIN_ENTRANTS);
const maxFor = (t) => (isTriple(t) ? TRIPLE_MAX : MAX_ENTRANTS);
/** How many first-round matches a triple-threat tournament with n wrestlers has. */
const groupCount = (n) => Math.max(2, Math.ceil(n / 3));
/** Round-1 slots for the groups, spread so an empty slot always sits next to a real match (odd slots first). */
const slotOrder = (P) => [...Array.from({ length: P / 2 }, (_, i) => 2 * i + 1), ...Array.from({ length: P / 2 }, (_, i) => 2 * i + 2)];

const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(n));

function roundName(round, rounds, triple = false) {
    if (triple && round === 1) return 'First round';
    const fromEnd = rounds - round;
    if (fromEnd === 0) return 'Final';
    if (fromEnd === 1) return 'Semi-finals';
    if (fromEnd === 2) return 'Quarter-finals';
    return `Round of ${2 ** (fromEnd + 1)}`;
}

async function requireTournament(guildId, value, { statuses = null } = {}) {
    const id = parseId(value);
    const { rows } = id ? await pool.query(`SELECT * FROM tournaments WHERE id = $1 AND guild_id = $2`, [id, guildId]) : { rows: [] };
    if (!rows[0]) throw new UserError('I could not find that tournament. Pick one from the dropdown list that appears as you type.');
    if (statuses && !statuses.includes(rows[0].status)) throw new UserError(`That tournament is ${rows[0].status}, so that isn't possible.`);
    return rows[0];
}

async function autocompleteTournaments(interaction, focused, statuses = null) {
    const { rows } = await pool.query(
        `SELECT id, name, status FROM tournaments WHERE guild_id = $1 AND name ILIKE $2 ${statuses ? 'AND status = ANY($3)' : ''} ORDER BY id DESC LIMIT 25`,
        statuses ? [interaction.guildId, `%${String(focused).replace(/[%_]/g, '')}%`, statuses] : [interaction.guildId, `%${String(focused).replace(/[%_]/g, '')}%`]);
    return rows.map((r) => ({ name: `${r.name} (${r.status})`.slice(0, 100), value: String(r.id) }));
}

/** Moves a decided winner into the next round (or finishes the tournament). Runs inside a transaction. */
async function placeWinner(client, tm, winnerId) {
    await client.query(`UPDATE tournament_matches SET winner_id = $2 WHERE id = $1`, [tm.id, winnerId]);
    const { rows: t } = await client.query(`SELECT * FROM tournaments WHERE id = $1 FOR UPDATE`, [tm.tournament_id]);
    const tour = t[0];
    const { rows: mx } = await client.query(`SELECT MAX(round)::int AS r FROM tournament_matches WHERE tournament_id = $1`, [tm.tournament_id]);
    const rounds = mx[0].r;
    if (tm.round === rounds) {
        const { rows: ch } = await client.query(`SELECT name FROM characters WHERE id = $1`, [winnerId]);
        await client.query(`UPDATE tournaments SET status = 'finished', winner_id = $2, winner_name = $3 WHERE id = $1`, [tour.id, winnerId, ch[0]?.name || null]);
        let crowned = null;
        if (tour.title_id) {
            const { rows: tt } = await client.query(`SELECT * FROM titles WHERE id = $1`, [tour.title_id]);
            if (tt[0] && !tt[0].is_tag_title) {
                await vacateTitle(client, tt[0].id);
                await startReign(client, { guildId: tour.guild_id, title: tt[0], subject: { type: 'character', id: winnerId }, memberIds: [], matchId: tm.match_id || null, actor: tour.created_by, notes: `Won the ${tour.name}` });
                await setVacancy(client, tt[0].id);
                crowned = tt[0].name;
            }
        }
        return { finished: true, tournament: tour, winnerName: ch[0]?.name, crowned, nextRound: null };
    }
    const nextSlot = Math.ceil(tm.slot / 2);
    const col = tm.slot % 2 === 1 ? 'a_id' : 'b_id';
    const { rows: nx } = await client.query(`UPDATE tournament_matches SET ${col} = $3 WHERE tournament_id = $1 AND round = $2 AND slot = $4 RETURNING *`, [tm.tournament_id, tm.round + 1, winnerId, nextSlot]);
    // 3.18: if the other half of that match is an empty first-round slot, there is nobody to face: move straight on
    if (tm.round === 1 && nx[0]) {
        const { rows: sib } = await client.query(`SELECT a_id FROM tournament_matches WHERE tournament_id = $1 AND round = 1 AND slot = $2`, [tm.tournament_id, tm.slot % 2 === 1 ? tm.slot + 1 : tm.slot - 1]);
        if (sib[0] && !sib[0].a_id) return placeWinner(client, nx[0], winnerId);
    }
    return { finished: false, tournament: tour, nextRound: roundName(tm.round + 1, rounds, isTriple(tour)) };
}

async function startTournament(guildId, tournamentId) {
    return withTransaction(async (client) => {
        const { rows: t } = await client.query(`SELECT * FROM tournaments WHERE id = $1 AND guild_id = $2 FOR UPDATE`, [tournamentId, guildId]);
        const tour = t[0];
        if (!tour) throw new UserError('I could not find that tournament.');
        if (tour.status !== 'signup') throw new UserError('That tournament has already started.');
        const { rows: ents } = await client.query(
            `SELECT te.character_id FROM tournament_entrants te JOIN characters c ON c.id = te.character_id WHERE te.tournament_id = $1 AND c.status = 'approved'`, [tour.id]);
        if (ents.length < minFor(tour)) throw new UserError(`${isTriple(tour) ? 'A tournament with a triple-threat first round' : 'A tournament'} needs at least ${minFor(tour)} wrestlers. Add more with \`/tournament view\`.`);
        if (isTriple(tour)) return startTriple(client, tour);
        const order = ents.map((e) => String(e.character_id));
        for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
        const P = nextPow2(order.length);
        const rounds = Math.log2(P);
        for (let r = 1; r <= rounds; r++) {
            for (let s = 1; s <= P / 2 ** r; s++) {
                const a = r === 1 ? order[s - 1] : null;
                const b = r === 1 ? (order[P / 2 + s - 1] || null) : null;
                await client.query(`INSERT INTO tournament_matches (tournament_id, round, slot, a_id, b_id) VALUES ($1,$2,$3,$4,$5)`, [tour.id, r, s, a, b]);
            }
        }
        await client.query(`UPDATE tournaments SET status = 'active' WHERE id = $1`, [tour.id]);
        // byes: the lone wrestler moves straight on
        const { rows: byes } = await client.query(`SELECT * FROM tournament_matches WHERE tournament_id = $1 AND round = 1 AND b_id IS NULL ORDER BY slot`, [tour.id]);
        for (const bye of byes) await placeWinner(client, bye, bye.a_id);
        return { tournament: tour, entrants: order.length, rounds, byes: byes.length };
    });
}

/**
 * 3.18: draws a triple-threat first round. Wrestlers the staff placed keep their match; the rest are drawn at
 * random, filling the matches in order. A match with 3 is a triple threat, with 2 a singles match, with 1 a bye.
 * The winners meet one-on-one from round 2. Runs inside startTournament's transaction.
 */
async function startTriple(client, tour) {
    const { rows: ents } = await client.query(
        `SELECT te.character_id, te.grp FROM tournament_entrants te JOIN characters c ON c.id = te.character_id WHERE te.tournament_id = $1 AND c.status = 'approved'`, [tour.id]);
    const G = groupCount(ents.length);
    const groups = Array.from({ length: G }, () => []);
    const loose = [];
    for (const e of ents) {
        const g = groups[(e.grp || 0) - 1];
        if (g && g.length < 3) g.push(String(e.character_id)); else loose.push(String(e.character_id));
    }
    for (let i = loose.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [loose[i], loose[j]] = [loose[j], loose[i]]; }
    for (const id of loose) (groups.find((g) => g.length < 3) || groups[groups.length - 1]).push(id); // fill match 1, then 2… so leftovers land in the last match
    const P = nextPow2(G);
    const rounds = 1 + Math.log2(P);
    const order = slotOrder(P);
    const bySlot = new Map(groups.map((g, i) => [order[i], g]));
    for (let s = 1; s <= P; s++) {
        const g = bySlot.get(s) || [];
        await client.query(`INSERT INTO tournament_matches (tournament_id, round, slot, a_id, b_id, c_id) VALUES ($1, 1, $2, $3, $4, $5)`, [tour.id, s, g[0] || null, g[1] || null, g[2] || null]);
    }
    for (let r = 2; r <= rounds; r++) {
        for (let s = 1; s <= P / 2 ** (r - 1); s++) await client.query(`INSERT INTO tournament_matches (tournament_id, round, slot) VALUES ($1, $2, $3)`, [tour.id, r, s]);
    }
    await client.query(`UPDATE tournaments SET status = 'active' WHERE id = $1`, [tour.id]);
    const { rows: byes } = await client.query(`SELECT * FROM tournament_matches WHERE tournament_id = $1 AND round = 1 AND a_id IS NOT NULL AND b_id IS NULL ORDER BY slot`, [tour.id]);
    for (const bye of byes) await placeWinner(client, bye, bye.a_id);
    return { tournament: tour, entrants: ents.length, rounds, byes: byes.length, triple: true,
        triples: groups.filter((g) => g.length === 3).length, singles: groups.filter((g) => g.length === 2).length };
}

/** Advances the bracket from a logged singles or triple threat match. Never throws: logging the match matters more. */
async function advanceFromMatch(guildId, matchId, matchType, characters, winnerIdx, resultType) {
    try {
        const size = { singles: 2, triple_threat: 3 }[matchType];
        if (!size || characters.length !== size || resultType !== 'decisive' || winnerIdx.length !== 1) return null;
        const ids = characters.map((c) => String(c.id));
        const winner = String(characters[winnerIdx[0]].id);
        return await withTransaction(async (client) => {
            // the bracket match with exactly these wrestlers (in any order)
            const { rows } = await client.query(
                `SELECT tm.*, t.name AS tname, t.format FROM tournament_matches tm JOIN tournaments t ON t.id = tm.tournament_id
                 WHERE t.guild_id = $1 AND t.status = 'active' AND tm.winner_id IS NULL AND tm.a_id IS NOT NULL AND tm.b_id IS NOT NULL
                   AND (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[tm.a_id, tm.b_id, tm.c_id]) x WHERE x IS NOT NULL)
                     = (SELECT array_agg(y ORDER BY y) FROM unnest($2::bigint[]) y)
                 ORDER BY tm.round LIMIT 1 FOR UPDATE OF tm`, [guildId, ids]);
            const tm = rows[0];
            if (!tm) return null;
            await client.query(`UPDATE tournament_matches SET match_id = $2 WHERE id = $1`, [tm.id, matchId]);
            const { rows: mx } = await client.query(`SELECT MAX(round)::int AS r FROM tournament_matches WHERE tournament_id = $1`, [tm.tournament_id]);
            const res = await placeWinner(client, { ...tm, match_id: matchId }, winner);
            return { ...res, name: tm.tname, round: roundName(tm.round, mx[0].r, tm.format === 'triple'), winnerId: winner };
        });
    } catch (err) {
        console.error('Could not advance tournament:', err.message);
        return null;
    }
}

/** Undoing a bracket match reopens it (only if the next round hasn't been decided yet). Runs in the undo transaction. */
async function revertTournamentMatch(client, matchId, { bracketMatchId = null } = {}) {
    const { rows } = bracketMatchId
        ? await client.query(`SELECT tm.*, t.status, t.title_id FROM tournament_matches tm JOIN tournaments t ON t.id = tm.tournament_id WHERE tm.id = $1`, [bracketMatchId])
        : await client.query(`SELECT tm.*, t.status, t.title_id FROM tournament_matches tm JOIN tournaments t ON t.id = tm.tournament_id WHERE tm.match_id = $1`, [matchId]);
    const tm = rows[0];
    if (!tm || !tm.winner_id) return;
    const { rows: mx } = await client.query(`SELECT MAX(round)::int AS r FROM tournament_matches WHERE tournament_id = $1`, [tm.tournament_id]);
    if (tm.round === mx[0].r) {
        if (tm.status === 'finished' && tm.title_id) throw new UserError('That match crowned the tournament winner as champion. Fix the title first (`/title manage`), then undo the match.');
        await client.query(`UPDATE tournaments SET status = 'active', winner_id = NULL, winner_name = NULL WHERE id = $1`, [tm.tournament_id]);
    } else {
        // walk forward: the winner's own place, plus any match they passed straight through (3.18: empty first-round slot)
        let cur = tm;
        const chain = [];
        for (;;) {
            const { rows: nx } = await client.query(`SELECT * FROM tournament_matches WHERE tournament_id = $1 AND round = $2 AND slot = $3`, [cur.tournament_id, cur.round + 1, Math.ceil(cur.slot / 2)]);
            const next = nx[0];
            if (!next) break;
            const col = cur.slot % 2 === 1 ? 'a_id' : 'b_id';
            const passedThrough = next.winner_id && !next.match_id && (!next.a_id || !next.b_id) && String(next.winner_id) === String(tm.winner_id);
            if (next.winner_id && !passedThrough) throw new UserError('The next round of that bracket has already been decided. Undo that match first.');
            chain.push({ id: next.id, col, passedThrough });
            if (!passedThrough) break;
            cur = next;
        }
        if (chain.some((c) => c.passedThrough) && tm.status === 'finished') await client.query(`UPDATE tournaments SET status = 'active', winner_id = NULL, winner_name = NULL WHERE id = $1`, [tm.tournament_id]);
        for (const c of chain) await client.query(`UPDATE tournament_matches SET ${c.col} = NULL${c.passedThrough ? ', winner_id = NULL' : ''} WHERE id = $1`, [c.id]);
    }
    await client.query(`UPDATE tournament_matches SET winner_id = NULL, match_id = NULL WHERE id = $1`, [tm.id]);
}

/** Everything the bracket picture needs. */
async function bracketData(guild, tournament) {
    const { rows } = await pool.query(
        `SELECT tm.*, a.name AS a_name, b.name AS b_name, c.name AS c_name, a.image_url AS a_img, b.image_url AS b_img, c.image_url AS c_img
         FROM tournament_matches tm LEFT JOIN characters a ON a.id = tm.a_id LEFT JOIN characters b ON b.id = tm.b_id LEFT JOIN characters c ON c.id = tm.c_id
         WHERE tm.tournament_id = $1 ORDER BY tm.round, tm.slot`, [tournament.id]);
    const rounds = rows.length ? Math.max(...rows.map((r) => r.round)) : 0;
    const { rows: ch } = tournament.winner_id ? await pool.query(`SELECT name, image_url FROM characters WHERE id = $1`, [tournament.winner_id]) : { rows: [] };
    const triple = isTriple(tournament);
    const empty = new Set(rows.filter((r) => r.round === 1 && !r.a_id && triple).map((r) => r.slot)); // 3.18: unused first-round slots
    return {
        serverName: guild?.name || null, triple,
        name: tournament.name, division: tournament.division, status: tournament.status, rounds,
        titleName: tournament.title_id ? (await pool.query(`SELECT name FROM titles WHERE id = $1`, [tournament.title_id])).rows[0]?.name : null,
        champion: ch[0] ? { name: ch[0].name, imageUrl: ch[0].image_url } : null,
        matches: rows.map((r) => ({
            round: r.round, slot: r.slot, roundName: roundName(r.round, rounds, triple), bye: r.round === 1 && !r.b_id && Boolean(r.a_id),
            empty: r.round === 1 && empty.has(r.slot),
            // a round-2 place fed by an unused slot is a bye for whoever comes from the other side
            aBye: r.round === 2 && empty.has(r.slot * 2 - 1), bBye: r.round === 2 && empty.has(r.slot * 2),
            a: r.a_id ? { id: String(r.a_id), name: r.a_name, imageUrl: r.a_img } : null,
            b: r.b_id ? { id: String(r.b_id), name: r.b_name, imageUrl: r.b_img } : null,
            c: r.c_id ? { id: String(r.c_id), name: r.c_name, imageUrl: r.c_img } : null,
            winnerId: r.winner_id ? String(r.winner_id) : null
        }))
    };
}

/**
 * 3.18.1: the matches that are ready to be played (everyone in them is known, no winner yet), written like a
 * posted show card: "**1.** @player (Wrestler) vs @player (Wrestler)". Returns { content, userIds } or null.
 */
async function matchList(tournament) {
    const { rows } = await pool.query(
        `SELECT tm.round, tm.slot, tm.a_id, tm.b_id, tm.c_id FROM tournament_matches tm
         WHERE tm.tournament_id = $1 AND tm.winner_id IS NULL AND tm.a_id IS NOT NULL AND tm.b_id IS NOT NULL ORDER BY tm.round, tm.slot`, [tournament.id]);
    if (!rows.length) return null;
    const { rows: mx } = await pool.query(`SELECT MAX(round)::int AS r FROM tournament_matches WHERE tournament_id = $1`, [tournament.id]);
    const ids = [...new Set(rows.flatMap((r) => [r.a_id, r.b_id, r.c_id]).filter(Boolean).map(String))];
    const { rows: chars } = await pool.query(`SELECT c.id, c.name, u.discord_id, u.is_placeholder FROM characters c JOIN users u ON u.id = c.owner_id WHERE c.id = ANY($1::bigint[])`, [ids]);
    const byId = new Map(chars.map((c) => [String(c.id), c]));
    const userIds = new Set();
    const who = (id) => {
        const c = byId.get(String(id));
        if (!c) return 'TBD';
        if (c.is_placeholder) return c.name;
        userIds.add(c.discord_id);
        return `<@${c.discord_id}> (${c.name})`;
    };
    const { DIVISION_LABELS } = require('./discordHelpers');
    const lines = [`📣 **${tournament.name}** · ${DIVISION_LABELS[tournament.division] || tournament.division} · matches to play`];
    let round = null, n = 0;
    for (const r of rows) {
        if (r.round !== round) { round = r.round; n = 0; lines.push(`__${roundName(r.round, mx[0].r, isTriple(tournament))}__`); }
        const names = [r.a_id, r.b_id, r.c_id].filter(Boolean);
        lines.push(`**${++n}.** ${names.map(who).join(' vs ')}${names.length === 3 ? ' _(Triple Threat)_' : ''}`);
    }
    return { content: lines.join('\n').slice(0, 1950), userIds: [...userIds] };
}


// ------------------------------------------------------------------ 3.20: editing a running bracket (staff)
const SPOT_COLS = { a: 'a_id', b: 'b_id', c: 'c_id' };

/** Every bracket match of a tournament, with names, in round/slot order. */
async function bracketRows(tournamentId, client = pool) {
    const { rows } = await client.query(
        `SELECT tm.*, a.name AS a_name, b.name AS b_name, c.name AS c_name, w.name AS w_name FROM tournament_matches tm
         LEFT JOIN characters a ON a.id = tm.a_id LEFT JOIN characters b ON b.id = tm.b_id LEFT JOIN characters c ON c.id = tm.c_id LEFT JOIN characters w ON w.id = tm.winner_id
         WHERE tm.tournament_id = $1 ORDER BY tm.round, tm.slot`, [tournamentId]);
    return rows;
}

/** The filled spots in matches that haven't been decided yet: [{ key: 'tmid.col', tm, col, id, name }]. */
async function openSpots(tournamentId, client = pool) {
    const out = [];
    for (const tm of await bracketRows(tournamentId, client)) {
        if (tm.winner_id) continue;
        for (const col of ['a', 'b', 'c']) if (tm[SPOT_COLS[col]]) out.push({ key: `${tm.id}.${col}`, tm, col, id: String(tm[SPOT_COLS[col]]), name: tm[`${col}_name`] });
    }
    return out;
}

async function lockActive(client, guildId, tournamentId) {
    const { rows } = await client.query(`SELECT * FROM tournaments WHERE id = $1 AND guild_id = $2 FOR UPDATE`, [tournamentId, guildId]);
    if (!rows[0]) throw new UserError('I could not find that tournament.');
    if (rows[0].status !== 'active') throw new UserError('Only a running tournament\'s bracket can be edited.');
    return rows[0];
}
const parseSpot = (key) => { const [id, col] = String(key).split('.'); if (!SPOT_COLS[col] || !/^\d+$/.test(id)) throw new UserError('Pick a spot from the list.'); return { id, col: SPOT_COLS[col] }; };

/** Puts a different wrestler in an undecided spot. They take over the old wrestler's place in the tournament. */
async function replaceInBracket(guildId, tournamentId, spotKey, newCharId) {
    return withTransaction(async (client) => {
        const tour = await lockActive(client, guildId, tournamentId);
        const { id, col } = parseSpot(spotKey);
        const { rows } = await client.query(`SELECT * FROM tournament_matches WHERE id = $1 AND tournament_id = $2`, [id, tour.id]);
        const tm = rows[0];
        if (!tm || !tm[col]) throw new UserError('That spot is empty now. Open the edit screen again.');
        if (tm.winner_id) throw new UserError('That match has already been decided. Undo the result first.');
        const { rows: ch } = await client.query(`SELECT id, name, division, status FROM characters WHERE id = $1 AND guild_id = $2`, [newCharId, guildId]);
        const c = ch[0];
        if (!c || c.status !== 'approved') throw new UserError('Pick an approved wrestler from the list.');
        if (c.division !== tour.division) throw new UserError(`**${c.name}** isn't in this tournament's division.`);
        const { rows: inIt } = await client.query(`SELECT 1 FROM tournament_entrants WHERE tournament_id = $1 AND character_id = $2`, [tour.id, c.id]);
        if (inIt.length) throw new UserError(`**${c.name}** is already in this tournament. Use ↔️ Swap two spots to move them.`);
        const oldId = tm[col];
        const { rows: on } = await client.query(`SELECT name FROM characters WHERE id = $1`, [oldId]);
        await client.query(`UPDATE tournament_matches SET ${col} = $2 WHERE id = $1`, [tm.id, c.id]);
        await client.query(`UPDATE tournament_entrants SET character_id = $3 WHERE tournament_id = $1 AND character_id = $2`, [tour.id, oldId, c.id]);
        return { out: on[0]?.name || 'someone', in: c.name, round: tm.round, slot: tm.slot };
    });
}

/** Swaps two wrestlers between spots in undecided matches. */
async function swapInBracket(guildId, tournamentId, keyA, keyB) {
    return withTransaction(async (client) => {
        const tour = await lockActive(client, guildId, tournamentId);
        const x = parseSpot(keyA), y = parseSpot(keyB);
        if (x.id === y.id) throw new UserError('Those two are in the same match, so swapping them changes nothing. Pick spots in two different matches.');
        const { rows } = await client.query(`SELECT * FROM tournament_matches WHERE id = ANY($1::bigint[]) AND tournament_id = $2`, [[x.id, y.id], tour.id]);
        const mx = rows.find((r) => String(r.id) === x.id), my = rows.find((r) => String(r.id) === y.id);
        if (!mx || !my || !mx[x.col] || !my[y.col]) throw new UserError('One of those spots is empty now. Open the edit screen again.');
        if (mx.winner_id || my.winner_id) throw new UserError('One of those matches has already been decided. Undo the result first.');
        const ix = mx[x.col], iy = my[y.col];
        await client.query(`UPDATE tournament_matches SET ${x.col} = $2 WHERE id = $1`, [mx.id, iy]);
        await client.query(`UPDATE tournament_matches SET ${y.col} = $2 WHERE id = $1`, [my.id, ix]);
        const { rows: n } = await client.query(`SELECT id, name FROM characters WHERE id = ANY($1::bigint[])`, [[ix, iy]]);
        const name = (id) => n.find((r) => String(r.id) === String(id))?.name || 'someone';
        return { a: name(ix), b: name(iy) };
    });
}

/**
 * Reopens a decided bracket match (it goes back to "not decided"). With newWinnerId, someone else advances instead.
 * A logged match stays in the records; only the bracket changes.
 */
async function redoBracketResult(guildId, tournamentId, bracketMatchId, newWinnerId = null) {
    return withTransaction(async (client) => {
        const { rows: t } = await client.query(`SELECT * FROM tournaments WHERE id = $1 AND guild_id = $2 FOR UPDATE`, [tournamentId, guildId]);
        const tour = t[0];
        if (!tour) throw new UserError('I could not find that tournament.');
        if (!['active', 'finished'].includes(tour.status)) throw new UserError('That tournament isn\'t running.');
        const { rows } = await client.query(`SELECT * FROM tournament_matches WHERE id = $1 AND tournament_id = $2`, [bracketMatchId, tour.id]);
        const tm = rows[0];
        if (!tm || !tm.winner_id) throw new UserError('That match hasn\'t been decided, so there\'s nothing to undo.');
        if (newWinnerId && ![tm.a_id, tm.b_id, tm.c_id].filter(Boolean).map(String).includes(String(newWinnerId))) throw new UserError('That wrestler isn\'t in that match.');
        if (newWinnerId && String(newWinnerId) === String(tm.winner_id)) throw new UserError('They already advanced from that match.');
        const loggedMatch = tm.match_id;
        await revertTournamentMatch(client, null, { bracketMatchId: tm.id });
        let placed = null;
        if (newWinnerId) {
            const { rows: fresh } = await client.query(`SELECT * FROM tournament_matches WHERE id = $1`, [tm.id]);
            placed = await placeWinner(client, fresh[0], newWinnerId);
        }
        return { loggedMatch, placed, round: tm.round, slot: tm.slot };
    });
}

module.exports = {
    bracketRows, openSpots, replaceInBracket, swapInBracket, redoBracketResult,
    matchList,
    MIN_ENTRANTS, MAX_ENTRANTS, TRIPLE_MIN, TRIPLE_MAX, isTriple, minFor, maxFor, groupCount, roundName, requireTournament, autocompleteTournaments, placeWinner,
    startTournament, advanceFromMatch, revertTournamentMatch, bracketData
};
