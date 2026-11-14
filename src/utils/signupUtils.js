const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const { pool, withTransaction } = require('../db/pool');
const { UserError } = require('./errors');
const { ensureUser } = require('./ensureGuild');
const { injuredMap } = require('./injuryUtils');
const { DIVISION_LABELS, NO_MENTIONS } = require('./discordHelpers');

const DIV_ORDER = ['mens', 'womens', 'custom', 'custom_womens', 'luchaderpy'];
const MAX_ENTRY_NAMES = 12; // names shown per division on the public post
// 3.16: two kinds of sign-up that never mix: 'main' (Men's, Women's, Custom, Custom Women's) and 'luchaderpy' (🟣 only)
const LUCHA_KIND = 'luchaderpy';
const kindOf = (k) => (k === LUCHA_KIND ? LUCHA_KIND : 'main');
const kindDivs = (k) => (kindOf(k) === LUCHA_KIND ? ['luchaderpy'] : DIV_ORDER.filter((d) => d !== 'luchaderpy'));
const kindForDivision = (d) => (d === 'luchaderpy' ? LUCHA_KIND : 'main');
const kindLabel = (k) => (kindOf(k) === LUCHA_KIND ? '🟣 LuchaDerpy sign-up' : 'Sign-up');

async function getSignup(id, guildId) {
    const { rows } = await pool.query(`SELECT * FROM signups WHERE id = $1 AND guild_id = $2`, [id, guildId]);
    return rows[0] || null;
}

/** The signup an admin most likely means: the newest open one, else the newest closed one, else the newest finished one. */
async function latestSignup(guildId, { openOnly = false, kind = 'main' } = {}) {
    const { rows } = await pool.query(
        `SELECT * FROM signups WHERE guild_id = $1 AND kind = $2 ${openOnly ? `AND status = 'open'` : ''}
         ORDER BY (status = 'open') DESC, (status = 'closed') DESC, created_at DESC, id DESC LIMIT 1`, [guildId, kindOf(kind)]);
    return rows[0] || null;
}

/**
 * The signup that guides booking and matchmaking: the newest one that is open or closed but not yet marked done.
 * It stays in effect (no timer) until an admin runs `signup-done` or opens a new signup.
 */
async function activeSignup(guildId, kind = 'main') {
    const { rows } = await pool.query(
        `SELECT * FROM signups WHERE guild_id = $1 AND kind = $2 AND status IN ('open','closed') ORDER BY created_at DESC, id DESC LIMIT 1`, [guildId, kindOf(kind)]);
    return rows[0] || null;
}

/** Marks a signup finished so booking goes back to using everyone. */
async function markDone(signupId, guildId) {
    const { rowCount } = await pool.query(`UPDATE signups SET status = 'done', closed_at = COALESCE(closed_at, now()) WHERE id = $1 AND guild_id = $2 AND status <> 'done'`, [signupId, guildId]);
    return rowCount > 0;
}

async function resolveSignup(guildId, value) {
    if (value) {
        const s = await getSignup(value, guildId);
        if (!s) throw new UserError('I couldn\'t find that signup.');
        return s;
    }
    const s = await latestSignup(guildId);
    if (!s) throw new UserError('There are no signups yet. Open one with `/booking signups` → 🆕 Open a signup.');
    return s;
}

async function getEntries(signupId) {
    const { rows } = await pool.query(
        `SELECT e.character_id, e.division, e.owner_id, e.created_at, c.name, u.discord_id
         FROM signup_entries e JOIN characters c ON c.id = e.character_id JOIN users u ON u.id = e.owner_id
         WHERE e.signup_id = $1 ORDER BY regexp_replace(lower(c.name), '^the +', '')`, [signupId]);
    return rows;
}

async function signedUpIds(signupId) {
    const { rows } = await pool.query(`SELECT character_id FROM signup_entries WHERE signup_id = $1`, [signupId]);
    return new Set(rows.map((r) => String(r.character_id)));
}

/**
 * How many CLOSED signups each wrestler entered since their last match without being booked.
 * Used to put wrestlers who keep getting passed over first.
 */
async function passedOverCounts(guildId, characterIds) {
    const ids = [...new Set((characterIds || []).map(String))].filter((x) => /^\d+$/.test(x));
    if (!ids.length) return new Map();
    const { rows } = await pool.query(
        `SELECT e.character_id, COUNT(*)::int AS n
         FROM signup_entries e JOIN signups s ON s.id = e.signup_id
         WHERE s.guild_id = $1 AND s.status IN ('closed','done') AND e.character_id = ANY($2::bigint[])
           AND NOT EXISTS (SELECT 1 FROM match_participants mp JOIN matches m ON m.id = mp.match_id
                           WHERE mp.character_id = e.character_id AND m.created_at >= s.created_at)
         GROUP BY e.character_id`, [guildId, ids]);
    return new Map(rows.map((r) => [String(r.character_id), r.n]));
}

/** A player's characters that can sign up (approved, not injured). */
async function eligibleCharacters(guildId, discordId, kind = 'main') {
    const ownerId = await ensureUser(guildId, discordId);
    const { rows } = await pool.query(
        `SELECT id, name, division FROM characters WHERE guild_id = $1 AND owner_id = $2 AND status = 'approved' AND division = ANY($3::text[]) ORDER BY division, name`,
        [guildId, ownerId, kindDivs(kind)]);
    const inj = await injuredMap(rows.map((r) => r.id));
    return { ownerId, chars: rows.filter((r) => !inj.has(String(r.id))), injured: rows.filter((r) => inj.has(String(r.id))) };
}

/** Replaces this player's entries on a signup with exactly the characters chosen. */
async function setEntries(signup, guildId, discordId, characterIds) {
    if (signup.status !== 'open') throw new UserError('That signup is closed.');
    const { ownerId, chars } = await eligibleCharacters(guildId, discordId, signup.kind);
    const allowed = new Map(chars.map((c) => [String(c.id), c]));
    const chosen = [...new Set(characterIds.map(String))];
    for (const id of chosen) if (!allowed.has(id)) throw new UserError('One of those wrestlers can\'t sign up right now (not yours, not approved, or injured).');
    await withTransaction(async (client) => {
        await client.query(`DELETE FROM signup_entries WHERE signup_id = $1 AND owner_id = $2`, [signup.id, ownerId]);
        for (const id of chosen) {
            await client.query(`INSERT INTO signup_entries (signup_id, character_id, owner_id, division) VALUES ($1,$2,$3,$4)`,
                [signup.id, id, ownerId, allowed.get(id).division]);
        }
    });
    return chosen.map((id) => allowed.get(id));
}

async function addEntry(signup, character) {
    if (character.status !== 'approved') throw new UserError('Only approved wrestlers can sign up.');
    if (kindForDivision(character.division) !== kindOf(signup.kind)) {
        throw new UserError(kindOf(signup.kind) === LUCHA_KIND
            ? `**${signup.title}** is a 🟣 LuchaDerpy sign-up, so only LuchaDerpy characters can join. **${character.name}** is ${DIVISION_LABELS[character.division]}.`
            : `**${character.name}** is a 🟣 LuchaDerpy character. LuchaDerpy has its own sign-up (\`/booking signups\` → 🟣 LuchaDerpy).`);
    }
    await pool.query(
        `INSERT INTO signup_entries (signup_id, character_id, owner_id, division) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [signup.id, character.id, character.owner_id, character.division]);
}

async function removeEntry(signup, characterId) {
    const { rowCount } = await pool.query(`DELETE FROM signup_entries WHERE signup_id = $1 AND character_id = $2`, [signup.id, characterId]);
    return rowCount > 0;
}

const buttons = (signup) => [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`signup:join:${signup.id}`).setLabel('Sign up / change').setEmoji('✋').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`signup:leave:${signup.id}`).setLabel('Withdraw').setStyle(ButtonStyle.Secondary),
    // 3.5: staff-only (anyone sees them; only admins/staff can use them)
    new ButtonBuilder().setCustomId(`signup:close:${signup.id}`).setLabel('🔒 Close (staff)').setStyle(ButtonStyle.Secondary))];
const closedButtons = (signup) => [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`signup:done:${signup.id}`).setLabel('✅ Mark done (staff)').setStyle(ButtonStyle.Secondary))];

/** The public post: counts and names per division. */
async function buildSignupMessage(signup) {
    const entries = await getEntries(signup.id);
    const open = signup.status === 'open';
    const SB = require('./signupBooked');
    const booked = signup.status === 'done' ? new Map() : await SB.bookedMap(signup);
    const names = (list) => list.slice(0, MAX_ENTRY_NAMES).map((e) => e.name).join(', ') + (list.length > MAX_ENTRY_NAMES ? ` +${list.length - MAX_ENTRY_NAMES} more` : '');
    const lucha = kindOf(signup.kind) === LUCHA_KIND;
    const lines = kindDivs(signup.kind).map((d) => {
        const list = entries.filter((e) => e.division === d);
        if (!list.length) return `**${DIVISION_LABELS[d]}** (0): _nobody yet_`;
        const free = list.filter((e) => !booked.has(String(e.character_id)));
        const taken = list.filter((e) => booked.has(String(e.character_id)));
        const out = [`**${DIVISION_LABELS[d]}** (${list.length}${taken.length ? ` · ${free.length} still open` : ''}): ${free.length ? names(free) : '_everyone is booked_'}`];
        // 3.3: wrestlers already on a card stay listed, crossed out with a red 🔴 BOOKED
        if (taken.length) {
            out.push(`> 🔴 **Booked:** ${taken.slice(0, MAX_ENTRY_NAMES).map((e) => `~~${e.name}~~ (${SB.where(booked.get(String(e.character_id)))})`).join(', ')}${taken.length > MAX_ENTRY_NAMES ? ` +${taken.length - MAX_ENTRY_NAMES} more` : ''}`);
        }
        return out.join('\n');
    });
    const dl = signup.deadline ? `\nSignups close after **${new Date(signup.deadline).toISOString().slice(0, 10)}**.` : '';
    const shown = entries.filter((e) => kindDivs(signup.kind).includes(e.division)).length;
    const embed = new EmbedBuilder().setColor(!open ? 0x95A5A6 : lucha ? 0xA855F7 : 0x2ECC71)
        .setTitle(`${open ? '✋' : '🔒'} ${lucha ? '🟣 ' : ''}${signup.title}`)
        .setDescription(`${open ? (lucha
            ? '**LuchaDerpy sign-up.** Press **Sign up / change** and pick your 🟣 LuchaDerpy character. You can change it any time until it closes.'
            : 'Press **Sign up / change** and pick the wrestler(s) you want on this show. You can change your picks any time until it closes.') : 'Signups are closed.'}${dl}\n\n${lines.join('\n')}`)
        .setFooter({ text: `${shown} wrestler${shown === 1 ? '' : 's'} signed up${booked.size ? ` · ${booked.size} booked · 🔴 = already on a card` : ''}` });
    return { embeds: [embed], components: open ? buttons(signup) : signup.status === 'closed' ? closedButtons(signup) : [], allowedMentions: NO_MENTIONS };
}

/** Re-draws the public post (best effort). */
async function refreshSignupPost(client, signup) {
    if (!signup.channel_id || !signup.message_id) return;
    try {
        const ch = await client.channels.fetch(signup.channel_id);
        const msg = await ch?.messages?.fetch(signup.message_id);
        if (msg) await msg.edit(await buildSignupMessage(signup));
    } catch (err) { console.error('Signup post refresh failed:', err.message); }
}

/** Picker shown privately after pressing the button: every eligible wrestler, grouped by division in the description. */
async function buildPicker(signup, guildId, discordId) {
    const { chars, injured } = await eligibleCharacters(guildId, discordId, signup.kind);
    if (kindOf(signup.kind) === LUCHA_KIND) { // 3.16: only 🟣 characters; no "claim / make a wrestler" here
        const req = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ui:rq:h:luchaderpy').setLabel('🙋 Request a LuchaDerpy character').setStyle(ButtonStyle.Primary));
        if (!chars.length) {
            return { content: injured.length ? 'Your 🟣 LuchaDerpy character is injured right now, so it can\'t sign up.' : 'This sign-up is for 🟣 **LuchaDerpy** characters only, and you don\'t have one yet. Request one first; once staff approve it you can sign up here.', components: injured.length ? [] : [req] };
        }
        const mineL = await signedUpIds(signup.id);
        const menuL = new StringSelectMenuBuilder().setCustomId(`signup:pick:${signup.id}`)
            .setPlaceholder('Pick your LuchaDerpy character').setMinValues(0).setMaxValues(Math.min(chars.length, 25))
            .addOptions(chars.slice(0, 25).map((c) => ({ label: c.name.slice(0, 100), description: '🟣 LuchaDerpy', value: String(c.id), default: mineL.has(String(c.id)) })));
        return { content: `**${signup.title}** (🟣 LuchaDerpy) — pick your LuchaDerpy character, then press outside the menu to confirm. Picking none withdraws you.`, components: [new ActionRowBuilder().addComponents(menuL)] };
    }
    const help = await require('./signupHelp').pickerExtras(signup, guildId, discordId);
    if (!chars.length) {
        return { content: `${injured.length ? 'All your approved wrestlers are injured right now, so none can sign up.' : 'You have no approved wrestlers yet.'}\n\n${help.text}`, components: [help.row] };
    }
    const mine = await signedUpIds(signup.id);
    const menu = new StringSelectMenuBuilder().setCustomId(`signup:pick:${signup.id}`)
        .setPlaceholder('Pick the wrestlers for this show').setMinValues(0).setMaxValues(Math.min(chars.length, 25))
        .addOptions(chars.slice(0, 25).map((c) => ({ label: c.name.slice(0, 100), description: DIVISION_LABELS[c.division], value: String(c.id), default: mine.has(String(c.id)) })));
    const note = injured.length ? `\n_Not shown (injured): ${injured.map((c) => c.name).join(', ')}_` : '';
    return { content: `**${signup.title}** — which wrestler(s) do you want to bring? Pick as many as you like, then press outside the menu to confirm. Picking none withdraws you.${note}\n\n${help.text}`, components: [new ActionRowBuilder().addComponents(menu), help.row] };
}

/** Closes a signup, tidies the public post and sends the final list to the staff channel. */
async function closeSignup(client, signup, g = null) {
    const { rowCount, rows } = await pool.query(
        `UPDATE signups SET status = 'closed', closed_at = now() WHERE id = $1 AND status = 'open' RETURNING *`, [signup.id]);
    if (!rowCount) return null;
    const closed = rows[0];
    await refreshSignupPost(client, closed);
    try {
        const guildRow = g || (await pool.query(`SELECT * FROM guilds WHERE guild_id = $1`, [closed.guild_id])).rows[0];
        const id = guildRow?.admin_channel_id;
        if (id) {
            const ch = await client.channels.fetch(id).catch(() => null);
            if (ch?.isTextBased()) {
                const embed = await buildBookingList(closed);
                await ch.send({ content: `🔒 **${closed.title}** signups are closed. Here is who is available:`, embeds: [embed], allowedMentions: NO_MENTIONS });
            }
        }
    } catch (err) { console.error('Signup close post failed:', err.message); }
    return closed;
}

/** Admin list for booking: each wrestler with record and how often they were passed over. */
async function buildBookingList(signup, division = null) {
    const entries = (await getEntries(signup.id)).filter((e) => !division || e.division === division);
    const ids = entries.map((e) => e.character_id);
    const passed = await passedOverCounts(signup.guild_id, ids);
    const { rows: rec } = ids.length ? await pool.query(
        `SELECT mp.character_id,
                COUNT(*) FILTER (WHERE m.result_type = 'decisive' AND mp.is_winner)::int AS w,
                COUNT(*) FILTER (WHERE m.result_type = 'decisive' AND NOT mp.is_winner)::int AS l,
                MAX(m.created_at) AS last
         FROM match_participants mp JOIN matches m ON m.id = mp.match_id WHERE mp.character_id = ANY($1::bigint[]) GROUP BY mp.character_id`, [ids]) : { rows: [] };
    const recMap = new Map(rec.map((r) => [String(r.character_id), r]));
    const { rows: champs } = ids.length ? await pool.query(
        `SELECT character_id FROM title_reigns WHERE lost_date IS NULL AND team_id IS NULL AND character_id = ANY($1::bigint[])`, [ids]) : { rows: [] };
    const champSet = new Set(champs.map((r) => String(r.character_id)));
    const SB = require('./signupBooked');
    const booked = await SB.bookedMap(signup);
    const isBooked = (e) => booked.has(String(e.character_id));

    const embed = new EmbedBuilder().setColor(0x2ECC71).setTitle(`📋 ${signup.title} — available wrestlers`)
        .setFooter({ text: '👑 champion · ⏭️ passed over on earlier shows (book them first) · 🔴 already on a card · ⚡ Auto-build and 🔎 Suggest opponents use this list' });
    let count = 0;
    for (const d of DIV_ORDER) {
        const list = entries.filter((e) => e.division === d).sort((a, b) => isBooked(a) - isBooked(b) || (passed.get(String(b.character_id)) || 0) - (passed.get(String(a.character_id)) || 0) || a.name.localeCompare(b.name));
        if (!list.length) continue;
        count += list.length;
        const text = list.map((e) => {
            const r = recMap.get(String(e.character_id));
            const p = passed.get(String(e.character_id)) || 0;
            const last = r?.last ? ` · last <t:${Math.floor(new Date(r.last).getTime() / 1000)}:R>` : ' · no matches yet';
            if (isBooked(e)) {
                const spots = booked.get(String(e.character_id));
                return `🔴 ~~${e.name}~~ (<@${e.discord_id}>) · **booked** on ${spots.map((s) => `${{ raw: 'RAW', smackdown: 'SmackDown', luchaderpy: 'LuchaDerpy' }[s.brand] || s.brand} #${s.position}`).join(', ')}`;
            }
            return `${champSet.has(String(e.character_id)) ? '👑 ' : ''}**${e.name}** (<@${e.discord_id}>) ${r ? `${r.w}-${r.l}` : '0-0'}${last}${p ? ` · ⏭️ passed over ×${p}` : ''}`;
        }).join('\n').slice(0, 1020);
        const nb = list.filter(isBooked).length;
        embed.addFields({ name: `${DIVISION_LABELS[d]} (${list.length}${nb ? ` · ${list.length - nb} open · ${nb} booked` : ''})`, value: text });
    }
    if (!count) embed.setDescription('_Nobody has signed up yet._');
    return embed;
}

module.exports = {
    getSignup, latestSignup, activeSignup, markDone, resolveSignup, getEntries, signedUpIds, passedOverCounts,
    eligibleCharacters, setEntries, addEntry, removeEntry, buildSignupMessage, refreshSignupPost,
    buildPicker, closeSignup, buildBookingList, DIV_ORDER, LUCHA_KIND, kindOf, kindDivs, kindForDivision, kindLabel
};
