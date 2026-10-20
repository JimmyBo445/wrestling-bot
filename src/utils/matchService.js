const { pool, withTransaction } = require('../db/pool');
const { UserError } = require('./errors');
const { MATCH_CONFIG, isTeamMatch, matchLabel } = require('./constants');
const { requireCharacter } = require('./characterUtils');
const { findTeamForCharacters } = require('./teamUtils');
const { requireTitle, getCurrentReign, applyTitleResult, undoMatchEffect, reignMatchesSubject } = require('./titleLogic');
const { setContender } = require('./contenderLogic');
const { getGuildSettings } = require('./ensureGuild');
const { logAudit } = require('./audit');
const { DIVISION_LABELS } = require('./discordHelpers');
const { linkMatchToCard } = require('./cardService');

/**
 * Cooldown (regular singles only: never title, contender, or tag matches).
 * Returns hours left (a whole number >= 1) or 0 if the matchup is allowed.
 */
async function singlesCooldownHoursLeft(guildId, charA, charB, settings, client = pool) {
    const hours = settings.singles_cooldown_hours;
    if (!hours || hours <= 0) return 0;
    const byCharacter = settings.cooldown_scope === 'character';
    const { rows } = await client.query(
        `SELECT m.created_at
         FROM matches m
         JOIN match_participants a ON a.match_id = m.id
         JOIN match_participants b ON b.match_id = m.id AND b.id <> a.id
         JOIN characters ca ON ca.id = a.character_id
         JOIN characters cb ON cb.id = b.character_id
         WHERE m.guild_id = $1 AND m.match_type = 'singles'
           AND NOT m.is_title_match AND NOT m.is_contender_match
           AND ${byCharacter ? 'ca.id = $2 AND cb.id = $3' : 'ca.owner_id = $2 AND cb.owner_id = $3'}
         ORDER BY m.created_at DESC LIMIT 1`,
        [guildId, byCharacter ? charA.id : charA.owner_id, byCharacter ? charB.id : charB.owner_id]
    );
    if (!rows.length) return 0;
    const elapsed = (Date.now() - new Date(rows[0].created_at).getTime()) / 36e5;
    return elapsed < hours ? Math.ceil(hours - elapsed) : 0;
}

/**
 * Validates and records a match. Everything is checked BEFORE anything is written,
 * and all writes happen in one transaction (a failure leaves no half-saved match).
 *
 * input: {
 *   guildId, matchType, slotCharacterIds: [..] (in config order),
 *   winnerIndex (single mode, 0-based) | winningTeam (team mode, 1|2),
 *   resultType, notes, titleValue, contenderTitleValue, actor, overrideCooldown
 * }
 */
async function logMatch(input) {
    const {
        guildId, matchType, slotCharacterIds, winnerIndex = null, winningTeam = null,
        resultType = 'decisive', notes = null, titleValue = null, contenderTitleValue = null,
        actor, overrideCooldown = false
    } = input;
    const config = MATCH_CONFIG[matchType];
    if (!config) throw new UserError('Unknown match type.');
    if (titleValue && contenderTitleValue) throw new UserError('A match can be a title match or a #1 contender match, not both.');
    if (notes && notes.length > 300) throw new UserError('Notes are limited to 300 characters.');

    // ---- who is in it ----
    if (new Set(slotCharacterIds.map(String)).size !== slotCharacterIds.length) {
        throw new UserError('The same character can\'t be booked twice in one match.');
    }
    const characters = [];
    for (const v of slotCharacterIds) characters.push(await requireCharacter(guildId, v, { statuses: ['approved'] }));

    const teamMode = isTeamMatch(matchType);
    const sideTeams = {}; // 1/2 -> team row or null
    if (teamMode) {
        for (const side of [1, 2]) {
            const ids = characters.filter((_, i) => config.slots[i].team === side).map((c) => c.id);
            sideTeams[side] = await findTeamForCharacters(guildId, ids);
        }
        if (sideTeams[1] && sideTeams[2] && sideTeams[1].id === sideTeams[2].id) {
            throw new UserError('Both sides can\'t be the same team.');
        }
    }

    // ---- who won ----
    let winnerIdx = [];
    if (resultType === 'decisive') {
        if (config.winnerMode === 'single') {
            if (winnerIndex === null || winnerIndex < 0 || winnerIndex >= config.slots.length) {
                throw new UserError(`Winner must be a number from 1 to ${config.slots.length}.`);
            }
            winnerIdx = [winnerIndex];
        } else {
            if (![1, 2].includes(winningTeam)) throw new UserError('Winning team must be 1 or 2.');
            config.slots.forEach((s, i) => { if (s.team === winningTeam) winnerIdx.push(i); });
        }
    }
    const winnerSubject = (() => {
        if (!winnerIdx.length) return null;
        if (teamMode) return sideTeams[winningTeam] ? { type: 'team', id: String(sideTeams[winningTeam].id) } : null;
        return { type: 'character', id: String(characters[winnerIdx[0]].id) };
    })();
    const participantSubjects = teamMode
        ? [1, 2].filter((s) => sideTeams[s]).map((s) => ({ type: 'team', id: String(sideTeams[s].id) }))
        : characters.map((c) => ({ type: 'character', id: String(c.id) }));

    const settings = await getGuildSettings(guildId);
    const isRegularSingles = matchType === 'singles' && !titleValue && !contenderTitleValue;

    // ---- cooldown (regular singles only) ----
    let cooldownOverridden = false;
    if (isRegularSingles) {
        const left = await singlesCooldownHoursLeft(guildId, characters[0], characters[1], settings);
        if (left) {
            if (!overrideCooldown) {
                const who = settings.cooldown_scope === 'character' ? 'These two characters' : 'These two players';
                throw new UserError(`${who} already had a regular singles match recently. Wait about **${left}h** (cooldown is ${settings.singles_cooldown_hours}h), or set \`override_cooldown\` to true to book it anyway. The cooldown doesn't apply to title, #1 contender or tag matches.`);
            }
            cooldownOverridden = true;
        }
    }

    // ---- title / contender rules ----
    let title = null;
    let contenderTitle = null;
    if (titleValue) {
        title = await requireTitle(guildId, titleValue);
        await validateTitleMatch({ title, characters, config, matchType, teamMode, sideTeams, resultType });
    }
    if (contenderTitleValue) {
        contenderTitle = await requireTitle(guildId, contenderTitleValue);
        if (resultType !== 'decisive') throw new UserError('A #1 contender match needs a winner (not a draw or no contest).');
        validateContenderMatch({ contenderTitle, characters, teamMode, sideTeams, matchType });
    }

    // ---- write it all ----
    let effect = null;
    const matchId = await withTransaction(async (client) => {
        const { rows } = await client.query(
            `INSERT INTO matches (guild_id, match_type, result_type, is_title_match, is_contender_match, title_id,
                                  contender_title_id, logged_by, notes, cooldown_overridden)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [guildId, matchType, resultType, Boolean(title), Boolean(contenderTitle), title?.id || null,
                contenderTitle?.id || null, actor, notes, cooldownOverridden]
        );
        const mId = rows[0].id;

        for (let i = 0; i < config.slots.length; i++) {
            const side = config.slots[i].team;
            await client.query(
                `INSERT INTO match_participants (match_id, character_id, team_number, team_id, is_winner, owner_id, division)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [mId, characters[i].id, side, side && sideTeams[side] ? sideTeams[side].id : null, winnerIdx.includes(i), characters[i].owner_id, characters[i].division]
            );
        }

        if (title) {
            if (resultType === 'decisive') {
                const memberIds = winnerIdx.map((i) => characters[i].id);
                effect = await applyTitleResult(client, {
                    guildId, title, matchId: mId, subject: winnerSubject, memberIds,
                    participants: participantSubjects, actor
                });
            } else {
                effect = { kind: 'title', title_id: String(title.id), type: 'none' };
            }
        } else if (contenderTitle) {
            const winnerChar = characters[winnerIdx[0]];
            const set = await setContender(client, {
                guildId, title: contenderTitle, subject: winnerSubject, subjectDivision: winnerChar.division,
                earnedVia: 'contender_match', awardedBy: actor, sourceMatchId: mId
            });
            effect = { kind: 'contender', title_id: String(contenderTitle.id), contender_id: set.id, revoked_ids: set.revokedIds };
        }
        if (effect) await client.query(`UPDATE matches SET title_effect = $1 WHERE id = $2`, [JSON.stringify(effect), mId]);
        return mId;
    });

    await logAudit(guildId, actor, 'match_logged', { matchId, matchType, resultType, title: title?.name, contender: contenderTitle?.name });

    let defenseNumber = null;
    if (effect?.type === 'defense' && effect.reign_id) {
        const { rows } = await pool.query(`SELECT defenses FROM title_reigns WHERE id = $1`, [effect.reign_id]);
        defenseNumber = rows[0]?.defenses || null;
    }
    const card = await linkMatchToCard(guildId, matchId, matchType, characters.map((c) => c.id));

    return {
        matchId, matchType, label: config.label, config, characters, winnerIdx, resultType, notes,
        title, contenderTitle, sideTeams, winnerSubject, effect, cooldownOverridden, teamMode, card, defenseNumber
    };
}

async function validateTitleMatch({ title, characters, matchType, teamMode, sideTeams, resultType }) {
    const wrong = characters.filter((c) => c.division !== title.division);
    if (wrong.length) {
        throw new UserError(`The **${title.name}** is a ${DIVISION_LABELS[title.division]} title, but ${wrong.map((c) => `**${c.name}**`).join(', ')} ${wrong.length > 1 ? 'are' : 'is'} in a different division.`);
    }
    if (title.is_tag_title) {
        if (!teamMode) throw new UserError(`The **${title.name}** is a tag title. Use a tag match type (2v2, 3v3, 6-man or 8-man).`);
        for (const side of [1, 2]) {
            if (!sideTeams[side]) {
                throw new UserError(`Team ${side} isn't a registered team (the exact same wrestlers must be on a team made with \`/team create\`). Tag titles belong to registered teams.`);
            }
            if (sideTeams[side].division !== title.division) {
                throw new UserError(`**${sideTeams[side].name}** is in a different division than the **${title.name}**.`);
            }
        }
    } else if (teamMode) {
        throw new UserError(`The **${title.name}** is a singles title, so it can't be defended in a ${matchLabel(matchType)} match. Use singles, triple threat, fatal 4-way or 5-way.`);
    }

    // The champion has to be in the match (unless the belt is vacant)
    const current = await getCurrentReign(title.id);
    if (current && !isVacantStub(current)) {
        const champIn = title.is_tag_title
            ? [1, 2].some((s) => reignMatchesSubject(current, { type: 'team', id: sideTeams[s]?.id }))
            : characters.some((c) => reignMatchesSubject(current, { type: 'character', id: c.id }));
        if (!champIn) {
            const holder = current.team_name || current.character_name || current.reign_char_name || 'the champion';
            throw new UserError(`**${holder}** holds the **${title.name}** but isn't in this match. Add them, or vacate the title first with \`/championship vacate\`.`);
        }
    }
    void resultType;
}
// A backfilled reign with only free-text name and no character/team link can't be matched to participants.
function isVacantStub(reign) {
    return !reign.character_id && !reign.team_id;
}

function validateContenderMatch({ contenderTitle, characters, teamMode, sideTeams }) {
    const wrong = characters.filter((c) => c.division !== contenderTitle.division);
    if (wrong.length) {
        throw new UserError(`The **${contenderTitle.name}** is a ${DIVISION_LABELS[contenderTitle.division]} title, but ${wrong.map((c) => `**${c.name}**`).join(', ')} ${wrong.length > 1 ? 'are' : 'is'} in a different division.`);
    }
    if (contenderTitle.is_tag_title) {
        if (!teamMode) throw new UserError('A #1 contender match for a tag title must be a tag match.');
        if (!sideTeams[1] || !sideTeams[2]) throw new UserError('Both sides must be registered teams for a tag #1 contender match.');
    } else if (teamMode) {
        throw new UserError('A #1 contender match for a singles title can\'t be a team match.');
    }
}

/**
 * Deletes a match and reverses any title/contender change it caused.
 * Returns a summary of what was undone.
 */
async function undoMatch(guildId, matchId, actor) {
    const summary = await withTransaction(async (client) => {
        const { rows } = await client.query(`SELECT * FROM matches WHERE id = $1 AND guild_id = $2 FOR UPDATE`, [matchId, guildId]);
        const match = rows[0];
        if (!match) throw new UserError(`I couldn't find match #${matchId} on this server.`);
        await undoMatchEffect(client, match);
        const { rows: parts } = await client.query(
            `SELECT c.name, mp.is_winner FROM match_participants mp JOIN characters c ON c.id = mp.character_id WHERE mp.match_id = $1`, [matchId]);
        await client.query(`DELETE FROM matches WHERE id = $1`, [matchId]);
        return { match, parts };
    });
    await logAudit(guildId, actor, 'match_undone', {
        matchId, matchType: summary.match.match_type, participants: summary.parts.map((p) => p.name), effect: summary.match.title_effect?.type || null
    });
    return summary;
}

/**
 * Edits a match: notes always; winner/result only for plain matches
 * (title and #1 contender matches must be undone and re-logged so belts stay correct).
 */
async function editMatch(guildId, matchId, actor, { notes, winnerIndex = null, winningTeam = null, resultType = null }) {
    return withTransaction(async (client) => {
        const { rows } = await client.query(`SELECT * FROM matches WHERE id = $1 AND guild_id = $2 FOR UPDATE`, [matchId, guildId]);
        const match = rows[0];
        if (!match) throw new UserError(`I couldn't find match #${matchId} on this server.`);
        const changes = {};
        const wantsResultChange = winnerIndex !== null || winningTeam !== null || resultType !== null;

        if (wantsResultChange) {
            if (match.is_title_match || match.is_contender_match) {
                throw new UserError('Title and #1 contender matches affect belts, so the result can\'t be edited. Use `/match undo` and log it again. (Notes can still be edited.)');
            }
            const config = MATCH_CONFIG[match.match_type];
            const newResult = resultType || match.result_type;
            const { rows: parts } = await client.query(`SELECT id, team_number FROM match_participants WHERE match_id = $1 ORDER BY id`, [matchId]);
            let winners = [];
            if (newResult === 'decisive') {
                if (config.winnerMode === 'single') {
                    if (winnerIndex === null) throw new UserError(`Say which wrestler won (1-${parts.length}).`);
                    if (winnerIndex < 0 || winnerIndex >= parts.length) throw new UserError(`Winner must be 1-${parts.length}.`);
                    winners = [parts[winnerIndex].id];
                } else {
                    if (![1, 2].includes(winningTeam)) throw new UserError('Say which team won (1 or 2).');
                    winners = parts.filter((p) => p.team_number === winningTeam).map((p) => p.id);
                }
            }
            await client.query(`UPDATE match_participants SET is_winner = (id = ANY($2::bigint[])) WHERE match_id = $1`, [matchId, winners]);
            await client.query(`UPDATE matches SET result_type = $2 WHERE id = $1`, [matchId, newResult]);
            changes.result = newResult;
            changes.winners = winners.length;
        }
        if (notes !== null && notes !== undefined) {
            if (notes.length > 300) throw new UserError('Notes are limited to 300 characters.');
            await client.query(`UPDATE matches SET notes = $2 WHERE id = $1`, [matchId, notes || null]);
            changes.notes = notes;
        }
        if (!Object.keys(changes).length) throw new UserError('Nothing to change. Provide notes, a new winner, or a new result type.');
        await client.query(`UPDATE matches SET edited_at = now() WHERE id = $1`, [matchId]);
        await logAudit(guildId, actor, 'match_edited', { matchId, ...changes }, client);
        return { match, changes };
    });
}

module.exports = { logMatch, undoMatch, editMatch, singlesCooldownHoursLeft };
