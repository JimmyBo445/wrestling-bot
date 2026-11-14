// 3.13: 🔄 Switch character. A player gives up one of their Men's/Women's characters for an 🟢 open one in the
// same division. Staff approve it. Records work like a transfer: the player keeps their own record, each character keeps
// its history (shown as 'All owners'), and the new player's record with a character starts at 0-0. Rules:
//   • not while the character they give up holds a title (singles, or with a tag team)
//   • same division only
//   • one approved switch every N days per player (/admin panel → Rules, default 14)
// On approval: the new character moves to them, card matches that haven't happened yet and signups switch over,
// and the old character becomes open (it leaves its teams and its contract ends, like an unclaim).
const { pool } = require('../db/pool');
const { UserError } = require('./errors');
const { DIVISION_LABELS } = require('./discordHelpers');

const SWITCH_DIVISIONS = ['mens', 'womens', 'luchaderpy']; // 3.15: 🟣 too, with its own cooldown

async function heldTitles(charId, client = pool) {
    const { rows } = await client.query(
        `SELECT t.name FROM title_reigns tr JOIN titles t ON t.id = tr.title_id
         WHERE tr.lost_date IS NULL AND (
            (tr.character_id = $1 AND tr.team_id IS NULL)
            OR tr.team_id IN (SELECT team_id FROM team_members WHERE character_id = $1 AND left_at IS NULL))`, [charId]);
    return rows.map((r) => r.name);
}

/** Days left before this player may switch again (0 = free to switch). 3.15: the 🟣 slot has its own timer. */
async function cooldownLeft(guildId, discordId, client = pool, excludeId = null, lucha = false) {
    const { rows: g } = await client.query(`SELECT switch_cooldown_days FROM guilds WHERE guild_id = $1`, [guildId]);
    const days = g[0]?.switch_cooldown_days ?? 14;
    if (!days) return { left: 0, days };
    const { rows } = await client.query(
        `SELECT MAX(pr.resolved_at) AS last FROM pending_requests pr LEFT JOIN characters fc ON fc.id = pr.challenger_character_id
         WHERE pr.guild_id = $1 AND pr.requested_by = $2 AND pr.request_type = 'character_switch' AND pr.status = 'approved' AND pr.id <> $3
           AND (COALESCE(fc.division, '') = 'luchaderpy') = $4`, [guildId, discordId, excludeId || 0, Boolean(lucha)]);
    if (!rows[0]?.last) return { left: 0, days };
    const next = new Date(rows[0].last).getTime() + days * 86400000;
    const left = Math.ceil((next - Date.now()) / 86400000);
    return { left: Math.max(0, left), days, next };
}

/** Throws a friendly UserError if this switch isn't allowed. Returns { from, to }. */
async function check(guildId, discordId, fromId, toId, client = pool, excludeId = null) {
    const { rows } = await client.query(
        `SELECT c.id, c.name, c.division, c.status, c.base_character_id, u.discord_id, u.is_placeholder FROM characters c JOIN users u ON u.id = c.owner_id
         WHERE c.guild_id = $1 AND c.id = ANY($2::bigint[])`, [guildId, [fromId, toId].filter(Boolean)]);
    const from = rows.find((r) => String(r.id) === String(fromId));
    const to = rows.find((r) => String(r.id) === String(toId));
    if (!from || from.status !== 'approved' || from.is_placeholder || String(from.discord_id) !== String(discordId)) throw new UserError('That isn\'t one of your active wrestlers anymore.');
    if (!SWITCH_DIVISIONS.includes(from.division)) throw new UserError('Switching is only for Men\'s, Women\'s and LuchaDerpy characters.');
    const belts = await heldTitles(from.id, client);
    if (belts.length) throw new UserError(`**${from.name}** holds the **${belts.join(', ')}**. Champions can't switch: drop the belt (or ask staff to vacate it) first.`);
    const lucha = from.division === 'luchaderpy';
    const cd = await cooldownLeft(guildId, discordId, client, excludeId, lucha);
    if (cd.left > 0) throw new UserError(`You can switch ${lucha ? 'your 🟣 LuchaDerpy character ' : ''}once every ${cd.days} days. Your next ${lucha ? '🟣 ' : ''}switch is <t:${Math.floor(cd.next / 1000)}:R>.`);
    if (!toId) return { from, to: null };
    if (!to || to.status !== 'approved' || !to.is_placeholder) throw new UserError('That character isn\'t open anymore. Pick another one.');
    if (to.division !== from.division) throw new UserError(`You can only switch within the same division (${DIVISION_LABELS[from.division]}).`);
    // 3.15: one superstar = one player (the same player may hold both colors; staff see that on the request)
    const { dual } = await require('./lucha').checkSuperstar({ ...to, unclaimed: to.is_placeholder }, discordId, client);
    return { from, to, dual };
}

/** Runs inside the approval transaction. Returns the line shown on the staff card. */
async function applyInTransaction(tx, guildId, r) {
    await tx.query(`SELECT id FROM characters WHERE id = ANY($1::bigint[]) FOR UPDATE`, [[r.challenger_character_id, r.character_id]]);
    const { from, to } = await check(guildId, r.requested_by, r.challenger_character_id, r.character_id, tx, r.id)
        .catch((e) => { if (e instanceof UserError) throw new UserError(`${e.message} This switch can't be approved right now; deny it instead.`); throw e; });
    const { rows: own } = await tx.query(`SELECT owner_id FROM characters WHERE id = $1`, [from.id]);
    await tx.query(`UPDATE characters SET owner_id = $1 WHERE id = $2`, [own[0].owner_id, to.id]);
    // card matches that haven't happened yet, and signups, switch to the new character
    await tx.query(
        `UPDATE card_draft_matches SET character_ids = array_replace(character_ids, $1::bigint, $2::bigint)
         WHERE match_id IS NULL AND $1::bigint = ANY(character_ids) AND draft_id IN (SELECT id FROM card_drafts WHERE guild_id = $3)`, [from.id, to.id, guildId]);
    await tx.query(
        `UPDATE signup_entries e SET character_id = $2 WHERE e.character_id = $1
           AND e.signup_id IN (SELECT id FROM signups WHERE guild_id = $3 AND status IN ('open','closed'))
           AND NOT EXISTS (SELECT 1 FROM signup_entries x WHERE x.signup_id = e.signup_id AND x.character_id = $2)`, [from.id, to.id, guildId]);
    return `${from.division === 'luchaderpy' ? '🟣 ' : ''}${from.name} → ${to.name} for <@${r.requested_by}> (${from.name} is open now)`;
}

/** After staff decide: make the old character open, refresh posts, and DM the player. Never throws. */
async function afterDecision(interaction, r, approve) {
    try {
        const { getCharacterById } = require('./characterUtils');
        const [from, to] = await Promise.all([getCharacterById(r.challenger_character_id), getCharacterById(r.character_id)]);
        if (approve && from && !from.unclaimed && String(from.owner_discord_id) === String(r.requested_by)) {
            await require('./unclaim').unclaimCharacter(interaction.client, interaction.guildId, from, interaction.user.id, interaction.client.user.id);
        }
        if (approve) {
            try { require('./signupBooked').onCardChange(interaction.guildId); } catch (_) { /* optional */ }
        }
        try {
            const u = await interaction.client.users.fetch(r.requested_by);
            await u.send(approve
                ? `🔄 Your switch was approved: you're now **${to?.name}**. **${from?.name}** is open for someone else.`
                : `🔄 Staff denied your switch from **${from?.name}** to **${to?.name}**.`);
        } catch (_) { /* DMs closed */ }
    } catch (err) { console.error('Character switch follow-up failed:', err.message); }
}

module.exports = { SWITCH_DIVISIONS, check, cooldownLeft, heldTitles, applyInTransaction, afterDecision };
