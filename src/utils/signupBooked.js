// Signups ↔ card (3.3): a wrestler who signed up and is now on the RAW or SmackDown card shows as
// 🔴 BOOKED on the signup post (name kept, crossed out), so everyone can see who is still open.
// "On the card" = in a match on a card that was changed after the signup was opened, so an old,
// leftover card doesn't count. The post updates by itself a few seconds after any card change.
const { pool } = require('../db/pool');

const BRAND = { raw: 'RAW', smackdown: 'SmackDown' };

/** Map characterId → [{ brand, division, position }] for this signup's wrestlers who are on a card. */
async function bookedMap(signup) {
    const { rows } = await pool.query(
        `SELECT e.character_id::text AS id, cd.brand, cd.division, cdm.position
         FROM signup_entries e
         JOIN card_drafts cd ON cd.guild_id = $2 AND cd.updated_at >= $3
         JOIN card_draft_matches cdm ON cdm.draft_id = cd.id AND e.character_id = ANY(cdm.character_ids)
         WHERE e.signup_id = $1
         ORDER BY cd.brand, cdm.position`, [signup.id, signup.guild_id, signup.created_at]);
    const out = new Map();
    for (const r of rows) out.set(r.id, [...(out.get(r.id) || []), r]);
    return out;
}

/** "SmackDown" or "RAW + SmackDown" */
const where = (spots) => [...new Set(spots.map((s) => BRAND[s.brand] || s.brand))].join(' + ');

// ---------- keep the post up to date ----------
let botClient = null;
const timers = new Map();
const setClient = (c) => { botClient = c; };

/** Called after any card change: redraws the active signup post a few seconds later (several changes = one update). */
function onCardChange(guildId) {
    if (!botClient || !guildId) return;
    clearTimeout(timers.get(guildId));
    const t = setTimeout(async () => {
        timers.delete(guildId);
        try {
            const su = require('./signupUtils');
            const s = await su.activeSignup(guildId);
            if (s) await su.refreshSignupPost(botClient, s);
        } catch (err) { console.error('Signup booked refresh failed:', err.message); }
    }, 3000);
    if (t.unref) t.unref();
    timers.set(guildId, t);
}

/** Same as onCardChange, for code that only knows the draft id. */
async function onDraftChange(draftId, client = pool) {
    try {
        const { rows } = await client.query(`SELECT guild_id FROM card_drafts WHERE id = $1`, [draftId]);
        if (rows[0]) onCardChange(rows[0].guild_id);
    } catch (_) { /* never block a card change */ }
}

module.exports = { bookedMap, where, setClient, onCardChange, onDraftChange };
