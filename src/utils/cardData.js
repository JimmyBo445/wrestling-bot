const { pool } = require('../db/pool');
const { getDisplayNames, DIVISION_LABELS } = require('./discordHelpers');
const { characterSummary, teamSummary, headToHead, userSummary } = require('./statsQueries');
const { rankingRows } = require('./leaderboardQueries');
const { injuredMap } = require('./injuryUtils');
const { RANKING_WINDOW_DAYS } = require('./constants');
const { getTeamMembers, getTeamsOfCharacter, getTitlesHeldByCharacter } = require('./teamUtils');
const { getCurrentReign, reignHolderName } = require('./titleLogic');
const { MATCH_CONFIG, FINISH_LABEL } = require('./constants');
const { characterBadges } = require('./badges');

const toMember = (c, names, winner = false) => ({
    name: c.name, division: c.division, imageUrl: c.image_url, owner: names.get(c.owner_discord_id) || 'unknown', winner
});

const ordinal = (n) => `${n}${[, 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10] || 'th'}`;

/** Sentence under the winner explaining what the match changed. */
function outcomeText(result) {
    const { effect, title, contenderTitle, resultType, characters, winnerIdx, winnerSubject, sideTeams, config } = result;
    const winnerName = () => {
        if (config.winnerMode === 'team') {
            const side = config.slots[winnerIdx[0]]?.team;
            return sideTeams[side]?.name || characters.filter((_, i) => winnerIdx.includes(i)).map((c) => c.name).join(' & ');
        }
        return characters[winnerIdx[0]]?.name;
    };
    if (title) {
        if (!effect || effect.type === 'none') return resultType === 'draw' ? 'Draw: the champion retains' : 'No contest: the title stays put';
        if (effect.type === 'defense') return `${winnerName()} retains the ${title.name}${result.defenseNumber ? ` (${ordinal(result.defenseNumber)} defense)` : ''}`;
        if (effect.type === 'new_reign') return `${winnerName()} wins the vacant ${title.name}`;
        return `And new ${title.is_tag_title ? 'champions' : 'champion'}: ${winnerName()}`;
    }
    if (contenderTitle) return `${winnerName()} is the new #1 contender`;
    return null;
}

async function buildMatchCardData(guild, result) {
    const { characters, config, winnerIdx, resultType, sideTeams } = result;
    const names = await getDisplayNames(guild, characters.map((c) => c.owner_discord_id));
    const banner = result.title
        ? { kind: 'title', text: `${result.title.name}${resultType === 'decisive' ? '' : ''}` }
        : result.contenderTitle ? { kind: 'contender', text: `#1 Contender Match • ${result.contenderTitle.name}` } : null;
    if (banner && banner.kind === 'title') banner.text = `Championship Match • ${result.title.name}`;

    const base = { serverName: guild.name || null, show: result.card || null, label: result.label, matchId: result.matchId, resultType, notes: result.notes, banner, outcome: outcomeText(result),
        stipulation: result.stipulation || null, finish: result.finish ? (FINISH_LABEL[result.finish] || result.finish) : null, score: result.score || null };
    const isWinner = (i) => winnerIdx.includes(i);

    if (config.winnerMode === 'single' && config.slots.length > 2) {
        return { ...base, mode: 'ffa', entrants: characters.map((c, i) => toMember(c, names, isWinner(i))) };
    }
    if (config.winnerMode === 'single') {
        return { ...base, mode: 'sides', sides: characters.map((c, i) => ({ name: null, winner: isWinner(i), members: [toMember(c, names, isWinner(i))] })) };
    }
    const sides = [1, 2].map((side) => {
        const idxs = config.slots.map((s, i) => (s.team === side ? i : -1)).filter((i) => i >= 0);
        return {
            name: sideTeams[side]?.name || null,
            winner: idxs.some(isWinner),
            members: idxs.map((i) => toMember(characters[i], names, isWinner(i)))
        };
    });
    return { ...base, mode: 'sides', sides };
}

async function buildProfileData(guild, character) {
    const names = await getDisplayNames(guild, [character.owner_discord_id], 2500);
    const summary = await characterSummary(character.id, null, character.owner_id);
    const all = await characterSummary(character.id);
    const allTime = all.total !== summary.total ? { wins: all.wins, losses: all.losses, draws: all.draws, total: all.total } : null;
    const { rows: held } = await pool.query(
        `SELECT t.name FROM title_reigns tr JOIN titles t ON t.id = tr.title_id
         WHERE tr.lost_date IS NULL AND ((tr.team_id IS NULL AND tr.character_id = $1)
            OR EXISTS (SELECT 1 FROM title_reign_members m WHERE m.reign_id = tr.id AND m.character_id = $1))
         ORDER BY t.name`,
        [character.id]
    );
    const { rows: stats } = await pool.query(
        `SELECT COUNT(DISTINCT tr.id)::int AS reigns, COALESCE(SUM(tr.defenses), 0)::int AS defenses
         FROM title_reigns tr
         WHERE (tr.team_id IS NULL AND tr.character_id = $1)
            OR EXISTS (SELECT 1 FROM title_reign_members m WHERE m.reign_id = tr.id AND m.character_id = $1)`,
        [character.id]
    );
    const teams = await getTeamsOfCharacter(character.id);
    const injured = (await injuredMap([character.id])).get(String(character.id));
    const badges = await characterBadges(character, summary, { reigns: stats[0].reigns, defenses: stats[0].defenses });
    return {
        serverName: guild.name || null,
        injuredUntil: injured ? injured.returns_at : null,
        badges,
        character: { name: character.name, division: character.division, imageUrl: character.image_url, alignment: character.alignment, bio: character.bio, finisher: character.finisher, entranceTheme: character.entrance_theme, status: character.status,
            signatures: character.signatures || null, catchphrase: character.catchphrase || null },
        ownerName: names.get(character.owner_discord_id) || 'unknown',
        summary, allTime, titlesHeld: held.map((r) => r.name), reigns: stats[0].reigns, defenses: stats[0].defenses,
        teamName: teams.length ? teams.map((t) => t.name).join(' / ') : null
    };
}

async function buildTeamData(guild, team) {
    const members = await getTeamMembers(team.id);
    const names = await getDisplayNames(guild, members.map((m) => m.owner_discord_id), 2500);
    const summary = await teamSummary(team.id);
    const { rows: held } = await pool.query(
        `SELECT t.name FROM title_reigns tr JOIN titles t ON t.id = tr.title_id WHERE tr.team_id = $1 AND tr.lost_date IS NULL`, [team.id]);
    const { rows: stats } = await pool.query(
        `SELECT COUNT(*)::int AS reigns, COALESCE(SUM(defenses), 0)::int AS defenses FROM title_reigns WHERE team_id = $1`, [team.id]);
    return {
        serverName: guild.name || null,
        team: { name: team.name, division: team.division, status: team.status },
        members: members.map((m) => toMember(m, names)),
        summary, titlesHeld: held.map((r) => r.name), reigns: stats[0].reigns, defenses: stats[0].defenses
    };
}

async function buildBeltData(guild, title) {
    const current = await getCurrentReign(title.id);
    const { rows: cnt } = await pool.query(`SELECT COUNT(*)::int AS n FROM title_reigns WHERE title_id = $1`, [title.id]);
    const { rows: cont } = await pool.query(
        `SELECT COALESCE(t.name, c.name) AS name FROM contenders co
         LEFT JOIN characters c ON c.id = co.character_id LEFT JOIN teams t ON t.id = co.team_id
         WHERE co.title_id = $1 AND co.status = 'active'`, [title.id]);

    let champion = null;
    if (current) {
        let members = [];
        let ownerName = null;
        if (current.team_id) {
            const { rows } = await pool.query(
                `SELECT c.*, u.discord_id AS owner_discord_id FROM title_reign_members trm
                 JOIN characters c ON c.id = trm.character_id JOIN users u ON u.id = c.owner_id WHERE trm.reign_id = $1 ORDER BY trm.id`, [current.id]);
            const names = await getDisplayNames(guild, rows.map((r) => r.owner_discord_id), 2500);
            members = rows.map((r) => toMember(r, names));
        } else if (current.character_id) {
            const { rows } = await pool.query(
                `SELECT c.*, u.discord_id AS owner_discord_id FROM characters c JOIN users u ON u.id = c.owner_id WHERE c.id = $1`, [current.character_id]);
            const names = await getDisplayNames(guild, rows.map((r) => r.owner_discord_id), 2500);
            members = rows.map((r) => toMember(r, names));
            ownerName = members[0]?.owner;
        } else {
            members = [{ name: reignHolderName(current), division: title.division, imageUrl: null, owner: '' }];
        }
        const { rows: nRows } = await pool.query(
            `SELECT COUNT(*)::int AS n FROM title_reigns WHERE title_id = $1 AND won_date <= $2 AND id <= $3`, [title.id, current.won_date, current.id]);
        const won = new Date(current.won_date);
        champion = {
            name: reignHolderName(current), owner: ownerName, members,
            reignNumber: nRows[0].n, days: Math.max(0, Math.floor((Date.now() - won.getTime()) / 864e5)),
            defenses: current.defenses, since: won.toISOString().slice(0, 10), isBackfilled: current.is_backfilled
        };
    }
    const { rows: prev } = await pool.query(
        `SELECT COALESCE(tm.name, c.name, tr.reign_char_name) AS name, (tr.lost_date - tr.won_date)::int AS days
         FROM title_reigns tr LEFT JOIN characters c ON c.id = tr.character_id LEFT JOIN teams tm ON tm.id = tr.team_id
         WHERE tr.title_id = $1 AND tr.lost_date IS NOT NULL ORDER BY tr.lost_date DESC, tr.id DESC LIMIT 3`, [title.id]);
    return { serverName: guild.name || null, title, champion, contender: cont[0]?.name || null, totalReigns: cnt[0].n, previous: prev.map((r) => ({ name: r.name || 'Unknown', days: r.days })) };
}

/** One side of a tale of the tape: a single wrestler or a registered team. */
async function tapeSide(guild, subject) {
    if (subject.type === 'team') {
        const team = subject.team;
        const members = await getTeamMembers(team.id);
        const names = await getDisplayNames(guild, members.map((m) => m.owner_discord_id), 2500);
        const s = await teamSummary(team.id);
        const { rows: held } = await pool.query(
            `SELECT t.name FROM title_reigns tr JOIN titles t ON t.id = tr.title_id WHERE tr.team_id = $1 AND tr.lost_date IS NULL ORDER BY t.name`, [team.id]);
        const { rows: r } = await pool.query(`SELECT COUNT(*)::int AS n FROM title_reigns WHERE team_id = $1`, [team.id]);
        const owners = [...new Set(members.map((m) => names.get(m.owner_discord_id)).filter(Boolean))];
        return {
            ids: members.map((m) => String(m.id)), name: team.name, owner: owners.length ? owners.map((o) => `@${o}`).join(' & ') : null,
            members: members.map((m) => toMember(m, names)),
            wins: s.wins, losses: s.losses, draws: s.draws, winPct: s.winPct, streak: { current: s.streaks.current, direction: s.streaks.direction },
            longestWin: s.streaks.longestWin, titles: held.map((x) => x.name), reigns: r[0].n, form: s.form
        };
    }
    const c = subject.character;
    const names = await getDisplayNames(guild, [c.owner_discord_id], 2500);
    const s = await characterSummary(c.id);
    const held = await getTitlesHeldByCharacter(c.id);
    const { rows: r } = await pool.query(
        `SELECT COUNT(DISTINCT tr.id)::int AS n FROM title_reigns tr
         WHERE (tr.team_id IS NULL AND tr.character_id = $1) OR EXISTS (SELECT 1 FROM title_reign_members m WHERE m.reign_id = tr.id AND m.character_id = $1)`, [c.id]);
    return {
        ids: [String(c.id)], name: c.name, owner: names.get(c.owner_discord_id) ? `@${names.get(c.owner_discord_id)}` : null,
        members: [toMember(c, names)],
        wins: s.wins, losses: s.losses, draws: s.draws, winPct: s.winPct, streak: { current: s.streaks.current, direction: s.streaks.direction },
        longestWin: s.streaks.longestWin, titles: held.map((x) => x.name), reigns: r[0].n, form: s.form
    };
}

/** left / right: { type:'character', character } or { type:'team', team } */
async function buildTapeData(guild, { left, right, label, title = null, division }) {
    const [L, R] = [await tapeSide(guild, left), await tapeSide(guild, right)];
    const h = await headToHead(L.ids, R.ids);
    const last = h.matches[0]?.created_at ? new Date(h.matches[0].created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
    return {
        serverName: guild.name || null, division, label, title,
        left: L, right: R, h2h: { a: h.a, b: h.b, d: h.d, total: h.total, lastDate: last }
    };
}

/** Every champion of a belt, oldest first (the newest 12 reigns; older ones are summarised as a count). */
async function buildLineageData(guild, title) {
    const { rows } = await pool.query(
        `SELECT n, id, name, won, lost, days, defenses, is_backfilled FROM (
            SELECT tr.id, ROW_NUMBER() OVER (ORDER BY tr.won_date, tr.id)::int AS n,
                   COALESCE(tm.name, c.name, tr.reign_char_name, 'Unknown') AS name,
                   to_char(tr.won_date, 'YYYY-MM-DD') AS won, to_char(tr.lost_date, 'YYYY-MM-DD') AS lost,
                   (COALESCE(tr.lost_date, CURRENT_DATE) - tr.won_date)::int AS days, tr.defenses, tr.is_backfilled
            FROM title_reigns tr LEFT JOIN characters c ON c.id = tr.character_id LEFT JOIN teams tm ON tm.id = tr.team_id
            WHERE tr.title_id = $1) x ORDER BY n`, [title.id]);
    const shown = rows.slice(-12);
    return {
        serverName: guild.name || null, title, totalReigns: rows.length, hiddenEarlier: rows.length - shown.length,
        reigns: shown.map((r) => ({ n: r.n, name: r.name, won: r.won, lost: r.lost, days: r.days, defenses: r.defenses, backfilled: r.is_backfilled }))
    };
}

/** Division ladder as card data (top 10). Null when nobody has matches in the window. */
async function buildRankingsData(guild, division) {
    const rows = await rankingRows(guild.id, division, 10);
    if (!rows.length) return null;
    const names = await getDisplayNames(guild, rows.map((r) => r.discord_id), 2500);
    return {
        division, label: DIVISION_LABELS[division], windowDays: RANKING_WINDOW_DAYS, serverName: guild.name || null,
        rows: rows.map((r) => ({ name: r.name, owner: names.get(r.discord_id) || 'unknown', imageUrl: r.image_url, pts: r.w * 3 + r.d, w: r.w, l: r.l, d: r.d, champ: r.champ, contender: r.contender }))
    };
}

/** A player's card: overall + per-division records and their wrestlers. */
async function buildPlayerData(guild, user, ownerId) {
    const u = await userSummary(guild.id, ownerId);
    const avatarUrl = typeof user.displayAvatarURL === 'function' ? user.displayAvatarURL({ extension: 'png', size: 256 }) : null;
    return {
        serverName: guild.name || null, name: user.displayName || user.username, avatarUrl,
        summary: u, byDivision: u.byDivision,
        wrestlers: u.chars.map((c) => ({ name: c.name, division: c.division, status: c.status, current: c.current, wins: c.wins, losses: c.losses, draws: c.draws }))
    };
}

module.exports = { buildRankingsData, buildPlayerData, buildLineageData, buildTapeData, buildMatchCardData, buildProfileData, buildTeamData, buildBeltData, outcomeText, toMember, DIVISION_LABELS, MATCH_CONFIG };

/** The moments that shaped a career, oldest first (at most `max` shown, titles always win a spot). */
async function buildCareerData(guild, character, max = 12) {
    const names = await getDisplayNames(guild, [character.owner_discord_id], 2500);
    const summary = await characterSummary(character.id, null, character.owner_id);
    const events = [];
    const ymd = (d) => new Date(d).toISOString().slice(0, 10);
    const tl = summary.timeline;

    if (tl.length) {
        const { rows } = await pool.query(
            `SELECT (SELECT string_agg(c.name, ' & ' ORDER BY mp.id) FROM match_participants mp JOIN characters c ON c.id = mp.character_id
                      WHERE mp.match_id = $1 AND mp.character_id <> $2) AS opp`, [tl[0].match_id, character.id]);
        events.push({ at: new Date(tl[0].created_at), pri: 3, date: ymd(tl[0].created_at), title: 'Debut', sub: `${tl[0].result === 'W' ? 'Won' : tl[0].result === 'L' ? 'Lost' : 'Drew'} against ${rows[0]?.opp || 'an opponent'}`, tone: 'blue' });
        let w = 0;
        for (const r of tl) {
            if (r.result !== 'W') continue;
            w++;
            if ([1, 10, 25, 50, 100, 200].includes(w)) events.push({ at: new Date(r.created_at), pri: w === 1 ? 2 : 2, date: ymd(r.created_at), title: w === 1 ? 'First career win' : `${w}th career win`, sub: null, tone: 'green' });
        }
    }
    const { rows: reigns } = await pool.query(
        `SELECT tr.won_date, tr.lost_date, tr.defenses, tr.is_interim, t.name AS title_name
         FROM title_reigns tr JOIN titles t ON t.id = tr.title_id
         WHERE (tr.team_id IS NULL AND tr.character_id = $1) OR EXISTS (SELECT 1 FROM title_reign_members m WHERE m.reign_id = tr.id AND m.character_id = $1)
         ORDER BY tr.won_date`, [character.id]);
    for (const r of reigns) {
        events.push({ at: new Date(r.won_date), pri: 5, date: ymd(r.won_date), title: `Won the ${r.title_name}${r.is_interim ? ' (interim)' : ''}`, sub: null, tone: 'gold' });
        if (r.lost_date) {
            const days = Math.round((new Date(r.lost_date) - new Date(r.won_date)) / 864e5);
            events.push({ at: new Date(r.lost_date), pri: 4, date: ymd(r.lost_date), title: `Reign ended: ${r.title_name}`, sub: `${days} day${days === 1 ? '' : 's'}, ${r.defenses} defense${r.defenses === 1 ? '' : 's'}`, tone: 'red' });
        }
    }
    const { rows: tours } = await pool.query(`SELECT name, created_at FROM tournaments WHERE winner_id = $1`, [character.id]);
    for (const t of tours) events.push({ at: new Date(t.created_at), pri: 5, date: ymd(t.created_at), title: `Won ${t.name}`, sub: 'Tournament winner', tone: 'gold' });
    const { rows: stars } = await pool.query(
        `SELECT m.id, m.created_at, m.stars FROM matches m JOIN match_participants mp ON mp.match_id = m.id
         WHERE mp.character_id = $1 AND m.stars >= 5 ORDER BY m.created_at DESC LIMIT 2`, [character.id]);
    for (const m of stars) events.push({ at: new Date(m.created_at), pri: 3, date: ymd(m.created_at), title: 'Five-star classic', sub: `Match #${m.id}`, tone: 'orange' });
    const { rows: inj } = await pool.query(`SELECT reason, started_at, returns_at FROM injuries WHERE character_id = $1 ORDER BY started_at`, [character.id]);
    for (const i of inj) events.push({ at: new Date(i.started_at), pri: 2, date: ymd(i.started_at), title: 'Injured', sub: `${i.reason ? `${i.reason} · ` : ''}out until ${ymd(i.returns_at)}`, tone: 'grey' });

    events.sort((a, b) => a.at - b.at);
    let shown = events;
    if (events.length > max) {
        const keep = [...events].map((e, idx) => ({ e, idx })).sort((x, y) => y.e.pri - x.e.pri || y.e.at - x.e.at).slice(0, max).map((x) => x.idx);
        shown = events.filter((_, idx) => keep.includes(idx));
    }
    return {
        serverName: guild.name || null,
        character: { name: character.name, division: character.division, imageUrl: character.image_url },
        ownerName: names.get(character.owner_discord_id) || 'unknown',
        summary, events: shown, hidden: events.length - shown.length
    };
}
module.exports.buildCareerData = buildCareerData;
