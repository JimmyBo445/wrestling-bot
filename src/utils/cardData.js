const { pool } = require('../db/pool');
const { getDisplayNames, DIVISION_LABELS } = require('./discordHelpers');
const { characterSummary, teamSummary } = require('./statsQueries');
const { getTeamMembers, getTeamsOfCharacter } = require('./teamUtils');
const { getCurrentReign, reignHolderName } = require('./titleLogic');
const { MATCH_CONFIG } = require('./constants');

const toMember = (c, names, winner = false) => ({
    name: c.name, division: c.division, imageUrl: c.image_url, owner: names.get(c.owner_discord_id) || 'unknown', winner
});

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
        if (effect.type === 'defense') return `${winnerName()} retains the ${title.name}`;
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

    const base = { serverName: guild.name || null, label: result.label, matchId: result.matchId, resultType, notes: result.notes, banner, outcome: outcomeText(result) };
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
    const summary = await characterSummary(character.id);
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
    return {
        serverName: guild.name || null,
        character: { name: character.name, division: character.division, imageUrl: character.image_url, alignment: character.alignment, bio: character.bio, finisher: character.finisher, entranceTheme: character.entrance_theme, status: character.status },
        ownerName: names.get(character.owner_discord_id) || 'unknown',
        summary, titlesHeld: held.map((r) => r.name), reigns: stats[0].reigns, defenses: stats[0].defenses,
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
    return { serverName: guild.name || null, title, champion, contender: cont[0]?.name || null, totalReigns: cnt[0].n };
}

module.exports = { buildMatchCardData, buildProfileData, buildTeamData, buildBeltData, outcomeText, toMember, DIVISION_LABELS, MATCH_CONFIG };
