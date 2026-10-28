const { pool, withTransaction } = require('../db/pool');
const { UserError } = require('./errors');
const { vacateTitle } = require('./titleLogic');
const { getTeamsOfCharacter, getTeamMembers } = require('./teamUtils');
const { logAudit } = require('./audit');
const { DIVISION_LABELS } = require('./discordHelpers');

/** What moving this character to another division would disturb. */
async function swapPlan(guildId, character) {
    const out = { titles: [], teams: [], signups: [], tournaments: [], contenders: [] };
    const { rows: titles } = await pool.query(
        `SELECT t.id, t.name FROM title_reigns tr JOIN titles t ON t.id = tr.title_id WHERE tr.character_id = $1 AND tr.team_id IS NULL AND tr.lost_date IS NULL`, [character.id]);
    out.titles = titles;
    for (const team of await getTeamsOfCharacter(character.id)) {
        const { rows: held } = await pool.query(`SELECT t.name FROM title_reigns tr JOIN titles t ON t.id = tr.title_id WHERE tr.team_id = $1 AND tr.lost_date IS NULL`, [team.id]);
        const members = await getTeamMembers(team.id);
        out.teams.push({ id: team.id, name: team.name, vacates: held.map((h) => h.name), disbands: members.length - 1 < 2 });
    }
    const { rows: sg } = await pool.query(
        `SELECT s.title FROM signup_entries e JOIN signups s ON s.id = e.signup_id WHERE e.character_id = $1 AND s.guild_id = $2 AND s.status IN ('open','closed')`, [character.id, guildId]);
    out.signups = sg.map((r) => r.title);
    const { rows: tr } = await pool.query(
        `SELECT t.name FROM tournament_entrants te JOIN tournaments t ON t.id = te.tournament_id WHERE te.character_id = $1 AND t.guild_id = $2 AND t.status IN ('signup','active')`, [character.id, guildId]);
    out.tournaments = tr.map((r) => r.name);
    const { rows: cn } = await pool.query(`SELECT t.name FROM contenders c JOIN titles t ON t.id = c.title_id WHERE c.character_id = $1 AND c.status = 'active'`, [character.id]);
    out.contenders = cn.map((r) => r.name);
    return out;
}

const hasConflicts = (p) => Boolean(p.titles.length || p.teams.length || p.signups.length || p.tournaments.length || p.contenders.length);

function describeSwap(p, toDivision) {
    const lines = [];
    if (p.titles.length) lines.push(`🏆 They hold **${p.titles.map((t) => t.name).join(', ')}**. Titles belong to one division, so ${p.titles.length > 1 ? 'those become' : 'it becomes'} **vacant**.`);
    for (const t of p.teams) lines.push(`🤝 They leave **${t.name}**.${t.vacates.length ? ` **${t.vacates.join(', ')}** becomes vacant.` : ''}${t.disbands ? ' The team drops below 2 members and is disbanded (its record is kept).' : ''}`);
    if (p.signups.length) lines.push(`✋ They are taken off the signup${p.signups.length > 1 ? 's' : ''}: ${p.signups.join(', ')} (they can sign up again as ${DIVISION_LABELS[toDivision]}).`);
    if (p.tournaments.length) lines.push(`🏟️ They are entered in **${p.tournaments.join(', ')}**, which is for their old division. Check the bracket afterwards.`);
    if (p.contenders.length) lines.push(`🎯 They are #1 contender for **${p.contenders.join(', ')}**. That spot is cleared.`);
    return lines;
}

async function swapDivision(client, guildId, character, toDivision, actorId) {
    if (character.division === toDivision) throw new UserError(`**${character.name}** is already in ${DIVISION_LABELS[toDivision]}.`);
    if (!['approved', 'retired'].includes(character.status)) throw new UserError(`**${character.name}** is ${character.status}. Only approved or retired wrestlers can change division.`);
    const plan = await swapPlan(guildId, character);
    await withTransaction(async (tx) => {
        for (const t of plan.titles) await vacateTitle(tx, t.id);
        for (const t of plan.teams) {
            const { rows: held } = await tx.query(`SELECT t.id FROM title_reigns tr JOIN titles t ON t.id = tr.title_id WHERE tr.team_id = $1 AND tr.lost_date IS NULL`, [t.id]);
            for (const h of held) await vacateTitle(tx, h.id);
            await tx.query(`UPDATE team_members SET left_at = now() WHERE team_id = $1 AND character_id = $2 AND left_at IS NULL`, [t.id, character.id]);
            if (t.disbands) {
                await tx.query(`UPDATE team_members SET left_at = now() WHERE team_id = $1 AND left_at IS NULL`, [t.id]);
                await tx.query(`UPDATE teams SET status = 'disbanded', disbanded_at = now() WHERE id = $1`, [t.id]);
                await tx.query(`UPDATE contenders SET status = 'revoked', resolved_at = now() WHERE team_id = $1 AND status = 'active'`, [t.id]);
                await tx.query(`UPDATE pending_requests SET status = 'dismissed', resolved_at = now() WHERE team_id = $1 AND status = 'pending'`, [t.id]);
            }
        }
        await tx.query(`DELETE FROM signup_entries WHERE character_id = $1 AND signup_id IN (SELECT id FROM signups WHERE guild_id = $2 AND status IN ('open','closed'))`, [character.id, guildId]);
        await tx.query(`UPDATE contenders SET status = 'revoked', resolved_at = now() WHERE character_id = $1 AND status = 'active'`, [character.id]);
        await tx.query(`UPDATE characters SET division = $1 WHERE id = $2 AND guild_id = $3`, [toDivision, character.id, guildId]);
    });
    await logAudit(guildId, actorId, 'character_division_changed', { name: character.name, from: character.division, to: toDivision });
    try {
        const su = require('./signupUtils');
        const { rows } = await pool.query(`SELECT * FROM signups WHERE guild_id = $1 AND status = 'open'`, [guildId]);
        for (const s of rows) await su.refreshSignupPost(client, s);
    } catch (_) { /* best effort */ }
    return plan;
}

module.exports = { swapPlan, swapDivision, describeSwap, hasConflicts };
