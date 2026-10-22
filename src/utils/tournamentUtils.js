const { pool, withTransaction } = require('../db/pool');
const { UserError } = require('./errors');
const { parseId } = require('./characterUtils');
const { vacateTitle, startReign, setVacancy } = require('./titleLogic');

const MIN_ENTRANTS = 4;
const MAX_ENTRANTS = 16;

const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(n));

function roundName(round, rounds) {
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
    await client.query(`UPDATE tournament_matches SET ${col} = $3 WHERE tournament_id = $1 AND round = $2 AND slot = $4`, [tm.tournament_id, tm.round + 1, winnerId, nextSlot]);
    return { finished: false, tournament: tour, nextRound: roundName(tm.round + 1, rounds) };
}

async function startTournament(guildId, tournamentId) {
    return withTransaction(async (client) => {
        const { rows: t } = await client.query(`SELECT * FROM tournaments WHERE id = $1 AND guild_id = $2 FOR UPDATE`, [tournamentId, guildId]);
        const tour = t[0];
        if (!tour) throw new UserError('I could not find that tournament.');
        if (tour.status !== 'signup') throw new UserError('That tournament has already started.');
        const { rows: ents } = await client.query(
            `SELECT te.character_id FROM tournament_entrants te JOIN characters c ON c.id = te.character_id WHERE te.tournament_id = $1 AND c.status = 'approved'`, [tour.id]);
        if (ents.length < MIN_ENTRANTS) throw new UserError(`A tournament needs at least ${MIN_ENTRANTS} wrestlers. Add more with \`/tournament add\`.`);
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

/** Advances the bracket from a logged singles match. Never throws: logging the match matters more. */
async function advanceFromMatch(guildId, matchId, matchType, characters, winnerIdx, resultType) {
    try {
        if (matchType !== 'singles' || resultType !== 'decisive' || winnerIdx.length !== 1) return null;
        const [x, y] = characters.map((c) => String(c.id));
        const winner = String(characters[winnerIdx[0]].id);
        return await withTransaction(async (client) => {
            const { rows } = await client.query(
                `SELECT tm.*, t.name AS tname FROM tournament_matches tm JOIN tournaments t ON t.id = tm.tournament_id
                 WHERE t.guild_id = $1 AND t.status = 'active' AND tm.winner_id IS NULL AND tm.a_id IS NOT NULL AND tm.b_id IS NOT NULL
                   AND ((tm.a_id::text = $2 AND tm.b_id::text = $3) OR (tm.a_id::text = $3 AND tm.b_id::text = $2))
                 ORDER BY tm.round LIMIT 1 FOR UPDATE OF tm`, [guildId, x, y]);
            const tm = rows[0];
            if (!tm) return null;
            await client.query(`UPDATE tournament_matches SET match_id = $2 WHERE id = $1`, [tm.id, matchId]);
            const { rows: mx } = await client.query(`SELECT MAX(round)::int AS r FROM tournament_matches WHERE tournament_id = $1`, [tm.tournament_id]);
            const res = await placeWinner(client, { ...tm, match_id: matchId }, winner);
            return { ...res, name: tm.tname, round: roundName(tm.round, mx[0].r), winnerId: winner };
        });
    } catch (err) {
        console.error('Could not advance tournament:', err.message);
        return null;
    }
}

/** Undoing a bracket match reopens it (only if the next round hasn't been decided yet). Runs in the undo transaction. */
async function revertTournamentMatch(client, matchId) {
    const { rows } = await client.query(`SELECT tm.*, t.status, t.title_id FROM tournament_matches tm JOIN tournaments t ON t.id = tm.tournament_id WHERE tm.match_id = $1`, [matchId]);
    const tm = rows[0];
    if (!tm) return;
    const { rows: mx } = await client.query(`SELECT MAX(round)::int AS r FROM tournament_matches WHERE tournament_id = $1`, [tm.tournament_id]);
    if (tm.round === mx[0].r) {
        if (tm.status === 'finished' && tm.title_id) throw new UserError('That match crowned the tournament winner as champion. Fix the title first (`/championship vacate` or `edit-reign`), then undo the match.');
        await client.query(`UPDATE tournaments SET status = 'active', winner_id = NULL, winner_name = NULL WHERE id = $1`, [tm.tournament_id]);
    } else {
        const nextSlot = Math.ceil(tm.slot / 2);
        const { rows: nx } = await client.query(`SELECT * FROM tournament_matches WHERE tournament_id = $1 AND round = $2 AND slot = $3`, [tm.tournament_id, tm.round + 1, nextSlot]);
        if (nx[0]?.winner_id) throw new UserError('The next round of that bracket has already been decided. Undo that match first.');
        const col = tm.slot % 2 === 1 ? 'a_id' : 'b_id';
        await client.query(`UPDATE tournament_matches SET ${col} = NULL WHERE id = $1`, [nx[0].id]);
    }
    await client.query(`UPDATE tournament_matches SET winner_id = NULL, match_id = NULL WHERE id = $1`, [tm.id]);
}

/** Everything the bracket picture needs. */
async function bracketData(guild, tournament) {
    const { rows } = await pool.query(
        `SELECT tm.*, a.name AS a_name, b.name AS b_name, a.image_url AS a_img, b.image_url AS b_img
         FROM tournament_matches tm LEFT JOIN characters a ON a.id = tm.a_id LEFT JOIN characters b ON b.id = tm.b_id
         WHERE tm.tournament_id = $1 ORDER BY tm.round, tm.slot`, [tournament.id]);
    const rounds = rows.length ? Math.max(...rows.map((r) => r.round)) : 0;
    const { rows: ch } = tournament.winner_id ? await pool.query(`SELECT name, image_url FROM characters WHERE id = $1`, [tournament.winner_id]) : { rows: [] };
    return {
        serverName: guild?.name || null,
        name: tournament.name, division: tournament.division, status: tournament.status, rounds,
        titleName: tournament.title_id ? (await pool.query(`SELECT name FROM titles WHERE id = $1`, [tournament.title_id])).rows[0]?.name : null,
        champion: ch[0] ? { name: ch[0].name, imageUrl: ch[0].image_url } : null,
        matches: rows.map((r) => ({
            round: r.round, slot: r.slot, roundName: roundName(r.round, rounds), bye: r.round === 1 && !r.b_id && Boolean(r.a_id),
            a: r.a_id ? { id: String(r.a_id), name: r.a_name, imageUrl: r.a_img } : null,
            b: r.b_id ? { id: String(r.b_id), name: r.b_name, imageUrl: r.b_img } : null,
            winnerId: r.winner_id ? String(r.winner_id) : null
        }))
    };
}

module.exports = {
    MIN_ENTRANTS, MAX_ENTRANTS, roundName, requireTournament, autocompleteTournaments, placeWinner,
    startTournament, advanceFromMatch, revertTournamentMatch, bracketData
};
