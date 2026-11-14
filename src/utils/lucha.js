// 3.15: LuchaDerpy (🟣). The LuchaDerpy roster IS the Men's roster: every Men's superstar can also be used in
// LuchaDerpy. A 🟣 character is its own `characters` row (division 'luchaderpy') linked to its Men's superstar by
// base_character_id, so its matches, record, standings, rankings and titles never mix with Men's. That row is
// made the first time someone gets the superstar as 🟣, and is kept afterwards (its history stays with it).
// Rules:
//   • one superstar = one player at a time. If someone has Roman 🟢, nobody else can have Roman 🟣 (and the reverse)
//   • the same player may hold one superstar in both colors (🟢🟣), but only with staff approval
//   • every player gets 1 LuchaDerpy slot on top of their normal ones
//   • the 🟣 version uses the Men's name, picture, finisher and overall unless staff give it its own
const { pool } = require('../db/pool');
const { UserError } = require('./errors');

const LUCHA = 'luchaderpy';
const MAX_LUCHA_PER_PLAYER = 1;
const isLucha = (c) => (c?.division || c) === LUCHA;
/** Fields the 🟣 version copies from the Men's superstar (and keeps in step while they still match). */
const SHARED = ['image_url', 'overall', 'finisher', 'entrance_theme', 'alignment', 'bio', 'signatures', 'catchphrase', 'lore'];

/**
 * SQL: true when the Men's superstar `alias` is used as 🟣 by a real player. Pass `exceptParam` (e.g. '$2')
 * to ignore that player's own 🟣 (so they can still see/ask for their own superstar).
 */
const luchaTakenSql = (alias = 'c', exceptParam = null) =>
    `EXISTS (SELECT 1 FROM characters lx JOIN users lux ON lux.id = lx.owner_id WHERE lx.base_character_id = ${alias}.id AND lx.status = 'approved' AND NOT lux.is_placeholder${exceptParam ? ` AND lux.discord_id <> ${exceptParam}` : ''})`;

const ROW = `SELECT c.*, u.discord_id AS owner_discord_id, u.is_placeholder AS unclaimed FROM characters c JOIN users u ON u.id = c.owner_id`;

/** The 🟣 row of a Men's superstar, or null. */
async function luchaOf(menId, client = pool) {
    const { rows } = await client.query(`${ROW} WHERE c.base_character_id = $1`, [menId]);
    return rows[0] || null;
}

/** The other half of a superstar: for a Men's row its 🟣 row, for a 🟣 row its Men's row. null if none. */
async function otherHalf(c, client = pool) {
    if (!c) return null;
    if (isLucha(c)) {
        if (!c.base_character_id) return null;
        const { rows } = await client.query(`${ROW} WHERE c.id = $1`, [c.base_character_id]);
        return rows[0] || null;
    }
    if (c.division !== 'mens') return null;
    return luchaOf(c.id, client);
}

/**
 * Before `character` goes to the player `discordId`: throws if the other half of the superstar belongs to someone else.
 * Returns { dual: true } when the same player already has the other half (allowed, but staff should know).
 */
async function checkSuperstar(character, discordId, client = pool) {
    const other = await otherHalf(character, client);
    if (!other || other.unclaimed || other.status !== 'approved') return { dual: false, other: null };
    if (String(other.owner_discord_id) !== String(discordId)) {
        const mine = isLucha(character) ? '🟢 Men\'s' : '🟣 LuchaDerpy';
        throw new UserError(`**${character.name}** is already <@${other.owner_discord_id}>'s ${mine} character. A superstar can only belong to one player at a time.`);
    }
    return { dual: true, other };
}

/** How many 🟣 characters this player (users.id) has. */
async function luchaCount(guildId, ownerId, client = pool, exceptId = null) {
    const { rows } = await client.query(
        `SELECT COUNT(*)::int AS n FROM characters WHERE guild_id = $1 AND owner_id = $2 AND division = $3 AND status IN ('approved','pending') AND id <> $4`,
        [guildId, ownerId, LUCHA, exceptId || 0]);
    return rows[0].n;
}

async function requireLuchaRoom(guildId, ownerId, discordId, client = pool, exceptId = null) {
    if ((await luchaCount(guildId, ownerId, client, exceptId)) >= MAX_LUCHA_PER_PLAYER) {
        throw new UserError(`<@${discordId}> already has a 🟣 LuchaDerpy character (${MAX_LUCHA_PER_PLAYER} per player). Switch it, or have staff take it off them first.`);
    }
}

/**
 * Gets (or makes) the 🟣 row for a Men's superstar. A new one starts with no player (owned by the placeholder)
 * and copies the superstar's name, picture, finisher, overall and the rest. Returns the row.
 */
async function ensureLucha(guildId, menId, holderUserId, client = pool) {
    const { rows: base } = await client.query(`SELECT * FROM characters WHERE id = $1 AND guild_id = $2`, [menId, guildId]);
    const m = base[0];
    if (!m) throw new UserError('That superstar doesn\'t exist anymore.');
    if (m.division !== 'mens') throw new UserError(`**${m.name}** isn't on the Men's roster, so they can't be used in LuchaDerpy.`);
    if (m.status !== 'approved') throw new UserError(`**${m.name}** is ${m.status}, so they can't be used in LuchaDerpy right now.`);
    const existing = await luchaOf(menId, client);
    if (existing) return existing;
    await client.query(
        `INSERT INTO characters (guild_id, owner_id, name, division, base_character_id, ${SHARED.join(', ')}, status, submitted_by, approved_by, approved_at)
         SELECT guild_id, $2, name, $3, id, ${SHARED.join(', ')}, 'approved', submitted_by, approved_by, now() FROM characters WHERE id = $1
         ON CONFLICT DO NOTHING`, [menId, holderUserId, LUCHA]);
    return luchaOf(menId, client);
}

/**
 * After a Men's superstar was edited: the name always follows, and every shared field follows as long as the
 * 🟣 version still had the same value as before (so a picture staff gave the 🟣 version on purpose is kept).
 */
async function syncFromBase(menId, before = null, client = pool) {
    try {
        const { rows } = await client.query(`SELECT * FROM characters WHERE id = $1`, [menId]);
        const m = rows[0];
        if (!m || m.division !== 'mens') return;
        const sets = ['name = $2'];
        const params = [menId, m.name];
        for (const f of SHARED) {
            if (before && before[f] !== undefined) {
                params.push(m[f], before[f]);
                sets.push(`${f} = CASE WHEN ${f} IS NOT DISTINCT FROM $${params.length} THEN $${params.length - 1} ELSE ${f} END`);
            }
        }
        await client.query(`UPDATE characters SET ${sets.join(', ')} WHERE base_character_id = $1`, params);
    } catch (err) { console.error('LuchaDerpy sync failed:', err.message); }
}

/** For the roster and lists: Map menId → { discord_id, unclaimed, id } of each superstar's 🟣 row. */
async function luchaMap(guildId, client = pool) {
    const { rows } = await client.query(
        `SELECT c.id, c.base_character_id, c.status, c.overall, u.discord_id, u.is_placeholder FROM characters c JOIN users u ON u.id = c.owner_id
         WHERE c.guild_id = $1 AND c.division = $2 AND c.base_character_id IS NOT NULL`, [guildId, LUCHA]);
    return new Map(rows.map((r) => [String(r.base_character_id), r]));
}

/**
 * The 🟢 / 🟣 / ⚪ mark of a Men's superstar. `men` is the Men's row (is_placeholder, discord_id), `l` its 🟣 row or undefined.
 * Returns { mark, owner } where owner is the player's discord id (or null when open).
 */
function markOf(men, l) {
    const g = men && !men.is_placeholder && men.status !== 'retired';
    const p = l && !l.is_placeholder && l.status === 'approved';
    if (g && p) return { mark: '🟢🟣', owner: men.discord_id };
    if (g) return { mark: '🟢', owner: men.discord_id };
    if (p) return { mark: '🟣', owner: l.discord_id };
    return { mark: '⚪', owner: null };
}

/** The Men's superstar id behind a value that may be a Men's id or a 🟣 id. */
async function menIdOf(id, client = pool) {
    const { rows } = await client.query(`SELECT id, division, base_character_id FROM characters WHERE id = $1`, [id]);
    const r = rows[0];
    if (!r) return null;
    return r.division === LUCHA ? r.base_character_id : r.id;
}

/**
 * For staff, on a request where a player wants the same superstar in both colors: how long they've had the
 * other version, its record with them, its belts, their other characters and their last switch.
 * `character` is the version they are asking for. Returns '' when it isn't a both-colors request.
 */
async function dualDetails(guildId, discordId, character, client = pool) {
    try {
        const other = await otherHalf(character, client);
        if (!other || other.unclaimed || other.status !== 'approved' || String(other.owner_discord_id) !== String(discordId)) return '';
        const { rows: u } = await client.query(`SELECT id FROM users WHERE guild_id = $1 AND discord_id = $2`, [guildId, discordId]);
        const ownerId = u[0]?.id || 0;
        const haveColor = isLucha(other) ? '🟣 LuchaDerpy' : '🟢 Men\'s';
        const wantColor = isLucha(other) ? '🟢 Men\'s' : '🟣 LuchaDerpy';
        // when they got the other version: an approved claim/switch, a staff transfer/assign, else their first match with it
        const { rows: since } = await client.query(
            `SELECT GREATEST(
                (SELECT MAX(resolved_at) FROM pending_requests WHERE guild_id = $1 AND requested_by = $2 AND character_id = $3 AND status = 'approved' AND request_type IN ('character_claim','character_switch')),
                (SELECT MAX(created_at) FROM audit_log WHERE guild_id = $1 AND action IN ('character_transferred','character_assigned') AND COALESCE(details->>'to', details->>'owner') = $2 AND details->>'name' = $4)
             ) AS got,
             (SELECT MIN(m.created_at) FROM match_participants mp JOIN matches m ON m.id = mp.match_id WHERE mp.character_id = $3 AND mp.owner_id = $5) AS first_match`,
            [guildId, discordId, other.id, other.name, ownerId]);
        const got = since[0]?.got || since[0]?.first_match || null;
        const days = got ? Math.max(0, Math.floor((Date.now() - new Date(got).getTime()) / 86400000)) : null;
        const howLong = days === null ? '_not sure_' : `<t:${Math.floor(new Date(got).getTime() / 1000)}:D> (${days < 14 ? `${days} day${days === 1 ? '' : 's'}` : `${Math.floor(days / 7)} weeks`})`;
        const { rows: rec } = await client.query(
            `SELECT COUNT(*) FILTER (WHERE m.result_type = 'decisive' AND mp.is_winner)::int AS w,
                    COUNT(*) FILTER (WHERE m.result_type = 'decisive' AND NOT mp.is_winner)::int AS l,
                    COUNT(*) FILTER (WHERE m.result_type = 'draw')::int AS d
             FROM match_participants mp JOIN matches m ON m.id = mp.match_id WHERE mp.character_id = $1 AND mp.owner_id = $2`, [other.id, ownerId]);
        const r = rec[0] || { w: 0, l: 0, d: 0 };
        const belts = await require('./characterSwitch').heldTitles(other.id, client);
        const { rows: mine } = await client.query(
            `SELECT name, division FROM characters WHERE guild_id = $1 AND owner_id = $2 AND status = 'approved' AND id <> $3 ORDER BY regexp_replace(lower(name), '^the +', '')`, [guildId, ownerId, other.id]);
        const { DIVISION_LABELS } = require('./discordHelpers');
        const tag = (c) => (c.division === LUCHA ? `${c.name} 🟣` : c.division === 'mens' ? `${c.name} 🟢` : `${c.name} (${DIVISION_LABELS[c.division]})`);
        const { rows: sw } = await client.query(
            `SELECT MAX(resolved_at) AS last FROM pending_requests WHERE guild_id = $1 AND requested_by = $2 AND request_type = 'character_switch' AND status = 'approved'`, [guildId, discordId]);
        const last = sw[0]?.last ? `<t:${Math.floor(new Date(sw[0].last).getTime() / 1000)}:D>` : 'never';
        return [
            `⚠️ **Already their ${haveColor} character.** Asking to use **${other.name}** in ${wantColor} too.`,
            `• Had ${other.name} in ${haveColor.slice(3)} since: ${howLong}`,
            `• ${haveColor.slice(3)} record with ${other.name}: ${r.w}-${r.l}${r.d ? `-${r.d}` : ''}`,
            `• Currently holds: ${belts.length ? belts.join(', ') : 'no titles'}`,
            `• Their other characters: ${mine.length ? mine.map(tag).join(', ') : 'none'}`,
            `• Last switch: ${last}`
        ].join('\n');
    } catch (err) {
        console.error('LuchaDerpy request details failed:', err.message);
        return '';
    }
}

module.exports = {
    LUCHA, MAX_LUCHA_PER_PLAYER, SHARED, isLucha, luchaTakenSql, luchaOf, otherHalf, checkSuperstar,
    luchaCount, requireLuchaRoom, ensureLucha, syncFromBase, luchaMap, markOf, menIdOf, dualDetails
};
