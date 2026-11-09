// Signup help (3.4): "Don't see your wrestler?" inside the private sign-up picker.
//   ➕ Request a new wrestler: pick a division, fill a short form → the normal character approval.
//   🔄 Claim a wrestler: pick a wrestler that has no player → request in the staff room.
// Staff approve both as usual. If the signup is still open when staff approve, the wrestler is
// signed up automatically. Everything else about signups stays the same.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { pool } = require('../db/pool');
const { UserError } = require('./errors');
const { DIVISION_LABELS, respond, EPHEMERAL, NO_MENTIONS } = require('./discordHelpers');
const { MAX_CHARACTERS_PER_USER } = require('./constants');

const ACTIONS = ['new', 'newdiv', 'newform', 'claim', 'claimdiv', 'claimpick', 'claimgo'];
const DIVS = Object.keys(DIVISION_LABELS);
const btn = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
const row = (...c) => new ActionRowBuilder().addComponents(...c);

const HELP_TEXT = [
    '**Don\'t see your wrestler?**',
    '➕ New wrestler: tap **Request a new wrestler** (or `/character submit`)',
    '🔄 Wrestler with no player: tap **Claim a wrestler**',
    'Staff approve both. Once approved, you\'re signed up automatically.'
].join('\n');

/** How many wrestlers (approved or pending) this player has, and whether they're at the limit. */
async function slotsFor(guildId, discordId) {
    const { ensureUser } = require('./ensureGuild');
    const ownerId = await ensureUser(guildId, discordId);
    const { canAddCharacter } = require('./characterUtils');
    return { ownerId, full: !(await canAddCharacter(guildId, ownerId)) };
}
const LIMIT_TEXT = `⚠️ You already have the most wrestlers allowed (${MAX_CHARACTERS_PER_USER}, counting ones waiting for approval). Ask staff to retire one before you request or claim another.`;

/** The text + buttons added to the sign-up picker. */
async function pickerExtras(signup, guildId, discordId) {
    const { full } = await slotsFor(guildId, discordId);
    return {
        text: `${HELP_TEXT}${full ? `\n${LIMIT_TEXT}` : ''}`,
        row: row(btn(`signup:new:${signup.id}`, '➕ Request a new wrestler', ButtonStyle.Success), btn(`signup:claim:${signup.id}`, '🔄 Claim a wrestler'))
    };
}

const back = (signup) => btn(`signup:join:${signup.id}`, '◀ Back to sign-up');
const reply = (interaction, payload) => (interaction.message?.flags?.has?.(64) || Number(interaction.message?.flags) & 64
    ? interaction.update({ content: null, embeds: [], components: [], ...payload })
    : respond(interaction, { ...payload, flags: EPHEMERAL, allowedMentions: NO_MENTIONS }));

async function requireRoom(interaction) {
    const { full } = await slotsFor(interaction.guildId, interaction.user.id);
    if (full) throw new UserError(LIMIT_TEXT.replace('⚠️ ', ''));
}

// ------------------------------------------------------------------ new wrestler

function newForm(signup, division) {
    const input = (id, label, opts = {}) => {
        const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(opts.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
            .setRequired(Boolean(opts.required)).setMaxLength(opts.max || 100);
        if (opts.placeholder) t.setPlaceholder(opts.placeholder);
        return row(t);
    };
    return new ModalBuilder().setCustomId(`signup:newform:${signup.id}:${division}`).setTitle(`New ${DIVISION_LABELS[division]} wrestler`.slice(0, 45)).addComponents(
        input('name', 'Wrestler name', { required: true, max: 40 }),
        input('finisher', 'Finisher (optional)', { max: 40 }),
        input('alignment', 'Face, heel or neutral (optional)', { max: 10, placeholder: 'face / heel / neutral' }),
        input('bio', 'One-line bio (optional)', { max: 120 }),
        input('image_url', 'Picture link (optional)', { max: 400, placeholder: 'https://… (to upload a file, use /character submit)' }));
}

async function submitNew(interaction, signup, division) {
    const f = (k) => { try { return String(interaction.fields.getTextInputValue(k) || '').trim(); } catch (_) { return ''; } };
    const name = f('name');
    let alignment = f('alignment').toLowerCase() || null;
    if (alignment && !['face', 'heel', 'neutral'].includes(alignment)) throw new UserError('Alignment must be face, heel or neutral (or left empty). Nothing was sent, so try again.');
    if (!DIVS.includes(division)) throw new UserError('Pick a division first.');
    await requireRoom(interaction);
    const { capture } = require('./panelKit');
    const out = await capture(interaction, 'character', 'submit', {
        name, division, finisher: f('finisher') || null, alignment, bio: f('bio') || null, image_url: f('image_url') || null
    });
    // remember which signup it came from, so approving it also signs them up
    const { rows: upd } = await pool.query(
        `UPDATE pending_requests SET payload = jsonb_build_object('signup_id', $1::bigint, 'signup_title', $2::text)
         WHERE id = (SELECT pr.id FROM pending_requests pr JOIN characters c ON c.id = pr.character_id
                     WHERE pr.guild_id = $3 AND pr.request_type = 'character_submission' AND pr.status = 'pending'
                       AND pr.requested_by = $4 AND lower(c.name) = lower($5) ORDER BY pr.id DESC LIMIT 1)
         RETURNING *`,
        [signup.id, signup.title, interaction.guildId, interaction.user.id, name]);
    // redraw the approval card so staff can see it came from the signup
    if (upd[0]?.message_id && upd[0]?.channel_id) {
        try {
            const ch = await interaction.guild.channels.fetch(upd[0].channel_id);
            const msg = await ch.messages.fetch(upd[0].message_id);
            await msg.edit(await require('../handlers/pendingQueue').buildPendingMessage(upd[0]));
        } catch (_) { /* the card still works without the note */ }
    }
    return reply(interaction, {
        content: `${out.content || `**${name}** was sent to staff.`}\nOnce it's approved, **${name}** is signed up for **${signup.title}** automatically (if signups are still open).`,
        components: [row(back(signup))]
    });
}

// ------------------------------------------------------------------ claim a wrestler with no player

async function claimList(interaction, signup, division = 'all') {
    await requireRoom(interaction);
    const { rows } = await pool.query(
        `SELECT c.id, c.name, c.division FROM characters c JOIN users u ON u.id = c.owner_id
         WHERE c.guild_id = $1 AND c.status = 'approved' AND u.is_placeholder = true AND ($2::text IS NULL OR c.division = $2)
         ORDER BY lower(c.name) LIMIT 25`, [interaction.guildId, division === 'all' ? null : division]);
    const divRow = row(...[['all', 'All'], ...Object.entries(DIVISION_LABELS)].map(([d, l]) => btn(`signup:claimdiv:${signup.id}:${d}`, l, d === division ? ButtonStyle.Primary : ButtonStyle.Secondary)));
    const components = [divRow];
    if (rows.length) {
        components.push(row(new StringSelectMenuBuilder().setCustomId(`signup:claimpick:${signup.id}`).setPlaceholder('Pick the wrestler that should be yours')
            .addOptions(rows.map((c) => ({ label: c.name.slice(0, 100), value: String(c.id), description: DIVISION_LABELS[c.division] })))));
    }
    components.push(row(back(signup)));
    return reply(interaction, {
        content: rows.length
            ? '🔄 **Claim a wrestler**: these wrestlers have no player right now. Pick yours and staff will move it to you (with all its stats and history).'
            : `🔄 No wrestlers ${division === 'all' ? '' : `in ${DIVISION_LABELS[division]} `}are without a player right now. If yours is on someone else's account, ask staff to move it with \`/character transfer\`.`,
        components
    });
}

async function claimConfirm(interaction, signup, charId) {
    const { getCharacterById } = require('./characterUtils');
    const c = await getCharacterById(charId);
    if (!c || String(c.guild_id) !== String(interaction.guildId) || c.status !== 'approved' || !c.unclaimed) throw new UserError('That wrestler isn\'t available to claim anymore.');
    return reply(interaction, {
        content: `Ask staff to give you **${c.name}** (${DIVISION_LABELS[c.division]})?`,
        components: [row(btn(`signup:claimgo:${signup.id}:${c.id}`, `Yes, send the request`, ButtonStyle.Success), btn(`signup:claim:${signup.id}`, 'Pick another'))]
    });
}

async function claimSend(interaction, signup, charId) {
    await requireRoom(interaction);
    const { getCharacterById } = require('./characterUtils');
    const c = await getCharacterById(charId);
    if (!c || String(c.guild_id) !== String(interaction.guildId) || c.status !== 'approved' || !c.unclaimed) throw new UserError('That wrestler isn\'t available to claim anymore.');
    const { rows: dupe } = await pool.query(
        `SELECT 1 FROM pending_requests WHERE guild_id = $1 AND request_type = 'character_claim' AND status = 'pending' AND requested_by = $2 AND character_id = $3`,
        [interaction.guildId, interaction.user.id, c.id]);
    if (dupe.length) throw new UserError(`You already asked for **${c.name}**. Staff will get to it.`);
    const { postPendingCard } = require('../handlers/pendingQueue');
    await postPendingCard(interaction.guild, { type: 'character_claim', characterId: c.id, requestedBy: interaction.user.id, payload: { signup_id: String(signup.id), signup_title: signup.title }, staffRoom: true });
    return reply(interaction, {
        content: `🔄 Request sent! Staff will look at it. Once approved, **${c.name}** is yours and signed up for **${signup.title}** automatically (if signups are still open).`,
        components: [row(back(signup))]
    });
}

// ------------------------------------------------------------------ router (signup:<action>:<signupId>:…)

async function handle(interaction, action, signup, parts) {
    if (action === 'new') {
        await requireRoom(interaction);
        return reply(interaction, {
            content: '➕ **Request a new wrestler**: which division? Next you fill in a short form (name, plus optional finisher, alignment, bio and picture link).',
            components: [row(...Object.entries(DIVISION_LABELS).map(([d, l]) => btn(`signup:newdiv:${signup.id}:${d}`, l, ButtonStyle.Primary))), row(back(signup))]
        });
    }
    if (action === 'newdiv') {
        await requireRoom(interaction);
        return interaction.showModal(newForm(signup, parts[3]));
    }
    if (action === 'newform') return submitNew(interaction, signup, parts[3]);
    if (action === 'claim') return claimList(interaction, signup);
    if (action === 'claimdiv') return claimList(interaction, signup, parts[3]);
    if (action === 'claimpick') return claimConfirm(interaction, signup, interaction.values?.[0]);
    if (action === 'claimgo') return claimSend(interaction, signup, parts[3]);
    throw new UserError('That button is from an older version. Press Sign up / change again.');
}

/**
 * After staff approve a submission or claim that came from a signup: sign the wrestler up
 * (if that signup is still open) and let the player know by DM. Never throws.
 */
async function afterApproval(interaction, request) {
    try {
        const sid = request.payload?.signup_id;
        const { getCharacterById } = require('./characterUtils');
        const c = await getCharacterById(request.character_id);
        if (!c) return null;
        let signedUp = false, title = request.payload?.signup_title;
        if (sid) {
            const su = require('./signupUtils');
            const s = await su.getSignup(sid, interaction.guildId);
            if (s && s.status === 'open' && c.status === 'approved') {
                await su.addEntry(s, c);
                await su.refreshSignupPost(interaction.client, s);
                signedUp = true; title = s.title;
            }
        }
        const what = request.request_type === 'character_claim' ? `**${c.name}** is now yours` : `**${c.name}** was approved`;
        try {
            const user = await interaction.client.users.fetch(request.requested_by);
            await user.send(`✅ ${what}${signedUp ? ` and is signed up for **${title}**` : ''}.`);
        } catch (_) { /* DMs closed: fine */ }
        return signedUp ? `signed up for ${title}` : null;
    } catch (err) { console.error('Signup auto-add failed:', err.message); return null; }
}

module.exports = { ACTIONS, HELP_TEXT, pickerExtras, handle, afterApproval };
