const { pool } = require('../db/pool');
const { UserError } = require('./errors');
const { parseId } = require('./characterUtils');

async function autocompleteTitles(interaction, focusedValue, { tagOnly = null } = {}) {
    const params = [interaction.guildId, `%${focusedValue.replace(/[%_]/g, '')}%`];
    let extra = '';
    if (tagOnly !== null) { params.push(tagOnly); extra = 'AND is_tag_title = $3'; }
    const { rows } = await pool.query(
        `SELECT id, name, is_vacant FROM titles WHERE guild_id = $1 AND name ILIKE $2 ${extra} ORDER BY division, name LIMIT 25`,
        params
    );
    return rows.map((r) => ({ name: `${r.name}${r.is_vacant ? ' (Vacant)' : ''}`.slice(0, 100), value: String(r.id) }));
}

async function requireTitle(guildId, value, client = pool) {
    const id = parseId(value);
    const { rows } = id ? await client.query(`SELECT * FROM titles WHERE id = $1`, [id]) : { rows: [] };
    if (!rows[0] || rows[0].guild_id !== guildId) throw new UserError('I could not find that title. Pick one from the dropdown list that appears as you type.');
    return rows[0];
}

/** The reign row that is currently active (lost_date IS NULL), or null. `lock` adds FOR UPDATE. */
async function getCurrentReign(titleId, client = pool, lock = false) {
    const { rows } = await client.query(
        `SELECT tr.*, c.name AS character_name, tm.name AS team_name
         FROM title_reigns tr
         LEFT JOIN characters c ON c.id = tr.character_id
         LEFT JOIN teams tm ON tm.id = tr.team_id
         WHERE tr.title_id = $1 AND tr.lost_date IS NULL
         ORDER BY tr.won_date DESC, tr.id DESC LIMIT 1 ${lock ? 'FOR UPDATE OF tr' : ''}`,
        [titleId]
    );
    return rows[0] || null;
}

function reignMatchesSubject(reign, subject) {
    if (!reign) return false;
    if (subject.type === 'team') return reign.team_id !== null && String(reign.team_id) === String(subject.id);
    return reign.team_id === null && reign.character_id !== null && String(reign.character_id) === String(subject.id);
}

async function setVacancy(client, titleId) {
    await client.query(
        `UPDATE titles SET is_vacant = NOT EXISTS (SELECT 1 FROM title_reigns WHERE title_id = $1 AND lost_date IS NULL)
         WHERE id = $1`,
        [titleId]
    );
}

async function startReign(client, { guildId, title, subject, memberIds, matchId, actor, notes = null }) {
    const { rows } = await client.query(
        `INSERT INTO title_reigns (guild_id, title_id, character_id, team_id, won_match_id, won_date, entered_by, notes)
         VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7) RETURNING id`,
        [guildId, title.id, subject.type === 'character' ? subject.id : null, subject.type === 'team' ? subject.id : null, matchId, actor, notes]
    );
    const reignId = rows[0].id;
    if (subject.type === 'team') {
        for (const cid of memberIds) {
            await client.query(`INSERT INTO title_reign_members (reign_id, character_id) VALUES ($1, $2)`, [reignId, cid]);
        }
    }
    return reignId;
}

/**
 * Applies the outcome of a decisive title match inside a transaction and returns
 * an "effect" object that is stored on the match so it can be undone later.
 *
 *   subject:  { type:'character'|'team', id }  the winner
 *   memberIds: character ids of the winning side (used to remember team members)
 *   participants: [{type,id}] everyone who took part (to decide if a contender got their shot)
 */
async function applyTitleResult(client, { guildId, title, matchId, subject, memberIds, participants, actor }) {
    const current = await getCurrentReign(title.id, client, true);
    const effect = { kind: 'title', title_id: String(title.id) };

    if (!current) {
        effect.type = 'new_reign';
        effect.new_reign_id = String(await startReign(client, { guildId, title, subject, memberIds, matchId, actor }));
    } else if (reignMatchesSubject(current, subject)) {
        await client.query(`UPDATE title_reigns SET defenses = defenses + 1 WHERE id = $1`, [current.id]);
        effect.type = 'defense';
        effect.reign_id = String(current.id);
    } else {
        await client.query(`UPDATE title_reigns SET lost_date = CURRENT_DATE WHERE id = $1`, [current.id]);
        effect.type = 'title_change';
        effect.prev_reign_id = String(current.id);
        effect.new_reign_id = String(await startReign(client, { guildId, title, subject, memberIds, matchId, actor }));
    }
    await setVacancy(client, title.id);

    // A #1 contender who actually took part has now had their shot.
    const { rows: cRows } = await client.query(
        `SELECT * FROM contenders WHERE title_id = $1 AND status = 'active' FOR UPDATE`, [title.id]
    );
    const contender = cRows[0];
    if (contender) {
        const took = participants.some((p) =>
            (p.type === 'team' && contender.team_id && String(p.id) === String(contender.team_id)) ||
            (p.type === 'character' && contender.character_id && String(p.id) === String(contender.character_id)));
        if (took) {
            await client.query(
                `UPDATE contenders SET status = 'fulfilled', resolved_at = now(), fulfilled_match_id = $2 WHERE id = $1`,
                [contender.id, matchId]
            );
            effect.fulfilled_contender_id = String(contender.id);
        }
    }
    return effect;
}

/** Ends the current reign (if any) without a winner. Returns the ended reign or null. */
async function vacateTitle(client, titleId) {
    const current = await getCurrentReign(titleId, client, true);
    if (!current) return null;
    await client.query(`UPDATE title_reigns SET lost_date = CURRENT_DATE WHERE id = $1`, [current.id]);
    await setVacancy(client, titleId);
    return current;
}

/**
 * Reverses what applyTitleResult / contender matches did. Throws UserError
 * if the situation has moved on (so history is never corrupted).
 */
async function undoMatchEffect(client, match) {
    const effect = match.title_effect;
    if (!effect) return;

    if (effect.kind === 'title') {
        const titleId = effect.title_id;
        const { rows: later } = await client.query(
            `SELECT id FROM matches WHERE title_id = $1 AND id > $2 AND title_effect IS NOT NULL AND title_effect->>'type' <> 'none' LIMIT 1`,
            [titleId, match.id]
        );
        if (later.length) throw new UserError(`A later title match (#${later[0].id}) for this belt exists. Undo that one first.`);

        const needReign = effect.type === 'defense' ? effect.reign_id : effect.new_reign_id;
        if (needReign) {
            const { rows } = await client.query(`SELECT lost_date FROM title_reigns WHERE id = $1`, [needReign]);
            if (!rows[0]) throw new UserError('That reign was already removed, so this match can no longer be undone.');
            if (rows[0].lost_date !== null) throw new UserError('The title was vacated or changed hands after this match. Undo or fix those changes first.');
        }

        if (effect.type === 'defense') {
            await client.query(`UPDATE title_reigns SET defenses = GREATEST(defenses - 1, 0) WHERE id = $1`, [effect.reign_id]);
        } else if (effect.type === 'new_reign' || effect.type === 'title_change') {
            await client.query(`DELETE FROM title_reigns WHERE id = $1`, [effect.new_reign_id]);
            if (effect.type === 'title_change') {
                await client.query(`UPDATE title_reigns SET lost_date = NULL WHERE id = $1`, [effect.prev_reign_id]);
            }
        }
        await setVacancy(client, titleId);

        if (effect.fulfilled_contender_id) {
            // Only bring the contender back if nobody else has taken the spot meanwhile.
            const { rows: active } = await client.query(`SELECT 1 FROM contenders WHERE title_id = $1 AND status = 'active'`, [titleId]);
            if (!active.length) {
                await client.query(
                    `UPDATE contenders SET status = 'active', resolved_at = NULL, fulfilled_match_id = NULL WHERE id = $1`,
                    [effect.fulfilled_contender_id]
                );
            }
        }
    } else if (effect.kind === 'contender') {
        const { rows } = await client.query(`SELECT status FROM contenders WHERE id = $1`, [effect.contender_id]);
        if (rows[0] && rows[0].status !== 'active') {
            throw new UserError('That #1 contender spot has already been used or changed. Fix that first, then undo this match.');
        }
        await client.query(`DELETE FROM contenders WHERE id = $1`, [effect.contender_id]);
        for (const id of effect.revoked_ids || []) {
            const { rows: active } = await client.query(
                `SELECT 1 FROM contenders WHERE title_id = $1 AND status = 'active'`, [effect.title_id]);
            if (!active.length) {
                await client.query(`UPDATE contenders SET status = 'active', resolved_at = NULL WHERE id = $1`, [id]);
            }
        }
    }
}

/** Human-friendly name of whoever holds a reign row (character, team, or backfilled text). */
function reignHolderName(r) {
    return r.team_name || r.character_name || r.reign_char_name || 'Unknown';
}

module.exports = {
    autocompleteTitles, requireTitle, getCurrentReign, reignMatchesSubject, setVacancy,
    startReign, applyTitleResult, vacateTitle, undoMatchEffect, reignHolderName
};
