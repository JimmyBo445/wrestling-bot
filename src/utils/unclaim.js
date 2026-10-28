const { pool, withTransaction } = require('../db/pool');
const { UserError } = require('./errors');
const { vacateTitle } = require('./titleLogic');
const { getTeamsOfCharacter, getTeamMembers } = require('./teamUtils');
const { ensureUser } = require('./ensureGuild');
const { logAudit } = require('./audit');

/** The "player" row that holds characters nobody owns. It is the bot's own Discord id, so mentions and names still resolve. */
async function placeholderUserId(guildId, botDiscordId, client = pool) {
    const id = await ensureUser(guildId, botDiscordId, client);
    await client.query(`UPDATE users SET is_placeholder = true WHERE id = $1`, [id]);
    return id;
}

/** Everything that would be affected by taking this character off their owner. */
async function unclaimPlan(guildId, character) {
    const out = { titles: [], teams: [], signups: [], contract: null, offers: 0, tournaments: [] };
    const { rows: titles } = await pool.query(
        `SELECT t.name FROM title_reigns tr JOIN titles t ON t.id = tr.title_id WHERE tr.character_id = $1 AND tr.team_id IS NULL AND tr.lost_date IS NULL`, [character.id]);
    out.titles = titles.map((t) => t.name);
    for (const team of await getTeamsOfCharacter(character.id)) {
        const { rows: held } = await pool.query(`SELECT t.name FROM title_reigns tr JOIN titles t ON t.id = tr.title_id WHERE tr.team_id = $1 AND tr.lost_date IS NULL`, [team.id]);
        const members = await getTeamMembers(team.id);
        out.teams.push({ id: team.id, name: team.name, vacates: held.map((h) => h.name), disbands: members.length - 1 < 2 });
    }
    const { rows: sg } = await pool.query(
        `SELECT s.title FROM signup_entries e JOIN signups s ON s.id = e.signup_id WHERE e.character_id = $1 AND s.guild_id = $2 AND s.status IN ('open','closed')`, [character.id, guildId]);
    out.signups = sg.map((r) => r.title);
    const { rows: ct } = await pool.query(`SELECT salary, end_date FROM contracts WHERE character_id = $1 AND status = 'active' LIMIT 1`, [character.id]);
    out.contract = ct[0] || null;
    const { rows: off } = await pool.query(`SELECT COUNT(*)::int AS n FROM contracts WHERE character_id = $1 AND status IN ('offered','requested')`, [character.id]);
    out.offers = off[0].n;
    const { rows: tr } = await pool.query(
        `SELECT t.name FROM tournament_entrants te JOIN tournaments t ON t.id = te.tournament_id WHERE te.character_id = $1 AND t.guild_id = $2 AND t.status IN ('signup','active')`, [character.id, guildId]);
    out.tournaments = tr.map((r) => r.name);
    return out;
}

const hasConflicts = (p) => Boolean(p.titles.length || p.teams.length || p.signups.length || p.contract || p.offers || p.tournaments.length);

function describePlan(character, p) {
    const lines = [];
    if (p.titles.length) lines.push(`🏆 They are the current **${p.titles.join(', ')}** champion. The belt stays on them, but they can't defend it until you give them to a player (or vacate it).`);
    for (const t of p.teams) {
        lines.push(`🤝 They leave **${t.name}**.${t.vacates.length ? ` The team splits, so **${t.vacates.join(', ')}** becomes vacant.` : ''}${t.disbands ? ' The team drops below 2 members and is disbanded (its record is kept).' : ''}`);
    }
    if (p.signups.length) lines.push(`✋ They are taken off the signup${p.signups.length > 1 ? 's' : ''}: ${p.signups.join(', ')}.`);
    if (p.contract) lines.push('📝 Their contract ends today (earnings so far are kept).');
    if (p.offers) lines.push('📝 A waiting contract offer/request is withdrawn.');
    if (p.tournaments.length) lines.push(`🏟️ They are entered in **${p.tournaments.join(', ')}**. The bracket can't advance their matches until you transfer them (or use \`/tournament advance\`).`);
    return lines;
}

/** Does the work. Returns the plan that was applied. */
async function unclaimCharacter(client, guildId, character, actorId, botDiscordId) {
    if (character.unclaimed) throw new UserError(`**${character.name}** is already unclaimed.`);
    if (!['approved', 'retired'].includes(character.status)) throw new UserError(`**${character.name}** is ${character.status}. Only approved or retired wrestlers can be unclaimed.`);
    const plan = await unclaimPlan(guildId, character);
    await withTransaction(async (tx) => {
        const holderId = await placeholderUserId(guildId, botDiscordId, tx);
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
        await tx.query(`UPDATE contracts SET status = 'released', end_date = CURRENT_DATE WHERE character_id = $1 AND status = 'active'`, [character.id]);
        await tx.query(`UPDATE contracts SET status = 'withdrawn' WHERE character_id = $1 AND status IN ('offered','requested')`, [character.id]);
        await tx.query(`UPDATE characters SET owner_id = $1 WHERE id = $2 AND guild_id = $3`, [holderId, character.id, guildId]);
    });
    await logAudit(guildId, actorId, 'character_unclaimed', { name: character.name, from: character.owner_discord_id });
    // open signup posts should drop them
    try {
        const su = require('./signupUtils');
        const { rows } = await pool.query(`SELECT * FROM signups WHERE guild_id = $1 AND status = 'open'`, [guildId]);
        for (const s of rows) await su.refreshSignupPost(client, s);
    } catch (_) { /* best effort */ }
    return plan;
}

module.exports = { unclaimPlan, unclaimCharacter, describePlan, hasConflicts, placeholderUserId };
