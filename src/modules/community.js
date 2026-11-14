// 3.10: things for members, and two staff screens
//   ui:mr:*   📨 My requests (players see and cancel their own waiting requests)
//   ui:mk:* / ui:mkm:*   🆕 Make a wrestler (from the menu post)
//   ui:mp:*   📌 Menu post settings (staff, in /admin panel)
//   ui:us:*   📈 Bot usage (staff, in /admin panel)
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { pool } = require('../db/pool');
const { requireAdmin, DIVISION_LABELS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { btn, row, clip, homeRow, show, open, capture, withNotice, ButtonStyle } = require('../utils/panelKit');

const KINDS = ['mr', 'mk', 'mkm', 'mp', 'us', 'ov', 'ovm'];
const P = ButtonStyle.Primary, S = ButtonStyle.Secondary, D = ButtonStyle.Danger;
const DAYS = 30;
const ts = (d) => `<t:${Math.floor(new Date(d).getTime() / 1000)}:R>`;
const select = (id, placeholder, options) => row(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).addOptions(options.slice(0, 25)));
function withHome(rows) {
    const has = rows.some((r) => (r.components || []).some((c) => c.data?.custom_id === 'ui:h:home'));
    return (has ? rows : [...rows, homeRow()]).slice(0, 5);
}

const STATUS = {
    pending: '⏳ waiting for staff', approved: '✅ approved', denied: '❌ denied', cancelled: '✖ you cancelled it', dismissed: '➖ closed', closed: '➖ closed'
};

// ================================================================== 📨 My requests

async function loadRequests(guildId, uid) {
    const { rows: reqs } = await pool.query(
        `SELECT pr.*, c.name AS char_name, c2.name AS opp_name, t.name AS title_name, tm.name AS team_name
         FROM pending_requests pr
         LEFT JOIN characters c ON c.id = pr.character_id
         LEFT JOIN characters c2 ON c2.id = pr.challenger_character_id
         LEFT JOIN titles t ON t.id = pr.title_id
         LEFT JOIN teams tm ON tm.id = pr.team_id
         WHERE pr.guild_id = $1 AND pr.requested_by = $2
           AND pr.request_type IN ('character_submission','character_claim','match_request','contender_challenge')
           AND (pr.status = 'pending' OR COALESCE(pr.resolved_at, pr.created_at) > now() - make_interval(days => $3))
         ORDER BY (pr.status = 'pending') DESC, pr.created_at DESC LIMIT 40`, [guildId, uid, DAYS]);
    const { rows: reps } = await pool.query(
        `SELECT r.*, (SELECT string_agg(c.name, ' vs ' ORDER BY array_position(r.character_ids, c.id)) FROM characters c WHERE c.id = ANY(r.character_ids)) AS names
         FROM match_reports r WHERE r.guild_id = $1 AND r.reporter = $2
           AND (r.status = 'pending' OR COALESCE(r.resolved_at, r.created_at) > now() - make_interval(days => $3))
         ORDER BY (r.status = 'pending') DESC, r.created_at DESC LIMIT 15`, [guildId, uid, DAYS]);
    return { reqs, reps };
}

function requestLine(r) {
    const st = STATUS[r.status] || r.status;
    if (r.request_type === 'character_submission') return `**${r.char_name || 'New wrestler'}**: new wrestler · ${st} · ${ts(r.created_at)}`;
    if (r.request_type === 'character_claim') return `**${r.char_name || 'a wrestler'}**: claim · ${st} · ${ts(r.created_at)}`;
    if (r.request_type === 'match_request') {
        const booked = r.status === 'approved' && r.payload?.booked === 'yes' ? ' · 📅 on a card' : '';
        return `**${r.char_name || '?'} vs ${r.opp_name || '?'}**${r.payload?.note ? ` _(${clip(r.payload.note, 40)})_` : ''} · ${st}${booked} · ${ts(r.created_at)}`;
    }
    return `**${r.team_name || r.opp_name || r.char_name || '?'}** for the **${r.title_name || 'title'}** · ${st} · ${ts(r.created_at)}`;
}
const reportLine = (r) => `**${r.names || 'Card match'}**${r.match_id ? ` (match #${r.match_id})` : ''} · ${r.status === 'closed' && r.deny_reason === 'cancelled by the player' ? STATUS.cancelled : STATUS[r.status] || r.status}${r.status === 'denied' && r.deny_reason ? `: ${clip(r.deny_reason, 60)}` : ''} · ${ts(r.created_at)}`;

async function myRequests(interaction, notice = null) {
    return open(interaction, async () => {
        const { reqs, reps } = await loadRequests(interaction.guildId, interaction.user.id);
        const embed = new EmbedBuilder().setColor(0x3498DB).setTitle('📨 My requests')
            .setFooter({ text: `Waiting requests always show; finished ones for ${DAYS} days.` });
        const group = (types) => reqs.filter((r) => types.includes(r.request_type)).map(requestLine);
        const add = (name, lines) => { if (lines.length) embed.addFields({ name, value: clip(lines.join('\n'), 1024) }); };
        add('🆕 New wrestlers & claims', group(['character_submission', 'character_claim']));
        add('🥊 Match requests', group(['match_request']));
        add('⚔️ Title challenges', group(['contender_challenge']));
        add('📝 Reported results', reps.map(reportLine));
        if (!reqs.length && !reps.length) {
            embed.setDescription('Nothing here yet. When you ask staff for something (a new wrestler, a match, a title shot, a result), it shows up here so you can see where it stands.');
        }
        const waiting = [
            ...reqs.filter((r) => r.status === 'pending').map((r) => ({ label: clip(requestLine(r).replace(/\*\*/g, '').split(' · ')[0], 100), value: `p:${r.id}` })),
            ...reps.filter((r) => r.status === 'pending').map((r) => ({ label: clip(`Result: ${r.names || 'card match'}`, 100), value: `r:${r.id}` }))
        ];
        const comps = [];
        if (waiting.length) comps.push(select('ui:mr:c', '✖ Cancel a waiting request…', waiting));
        comps.push(row(btn('ui:h:mine', '🙋 My wrestlers'), btn('ui:mr:h', '🔄 Refresh')));
        return withNotice({ embeds: [embed], components: withHome(comps) }, notice);
    });
}

async function cancelRequest(interaction, kind, id) {
    const uid = interaction.user.id;
    if (kind === 'p') {
        const { rows } = await pool.query(
            `UPDATE pending_requests SET status = 'cancelled', resolved_by = $3, resolved_at = now()
             WHERE id = $1 AND guild_id = $2 AND requested_by = $3 AND status = 'pending' RETURNING *`, [id, interaction.guildId, uid]);
        const r = rows[0];
        if (!r) return 'That request isn\'t waiting anymore (staff may have just answered it).';
        if (r.request_type === 'character_submission' && r.character_id) {
            await pool.query(`UPDATE characters SET status = 'denied' WHERE id = $1 AND status = 'pending'`, [r.character_id]);
        }
        // tell staff on the approval card, and take its buttons away
        if (r.channel_id && r.message_id) {
            try {
                const ch = await interaction.client.channels.fetch(r.channel_id);
                const msg = await ch.messages.fetch(r.message_id);
                await msg.edit({ content: `✖ Cancelled by <@${uid}>. Nothing to do here.`, components: [], allowedMentions: { parse: [] } });
            } catch (_) { /* card gone */ }
        }
        await require('../utils/audit').logAudit(interaction.guildId, uid, 'request_cancelled', { id: r.id, type: r.request_type });
        return '✖ Cancelled. Staff can\'t approve it anymore.';
    }
    const { rows } = await pool.query(
        `UPDATE match_reports SET status = 'closed', deny_reason = 'cancelled by the player', resolved_by = $3, resolved_at = now()
         WHERE id = $1 AND guild_id = $2 AND reporter = $3 AND status = 'pending' RETURNING id`, [id, interaction.guildId, uid]);
    if (!rows[0]) return 'That report isn\'t waiting anymore (staff may have just answered it).';
    await require('./reports').refreshPost(interaction.client, rows[0].id);
    return '✖ Cancelled your reported result. You can report it again any time.';
}

async function handleRequests(interaction, a, b, c) {
    if (a === 'h') return myRequests(interaction);
    if (a === 'c') {
        const [kind, id] = String(interaction.values?.[0] || '').split(':');
        return show(interaction, { content: 'Cancel this request? Staff won\'t be able to approve it after this.', embeds: [],
            components: [row(btn(`ui:mr:y:${kind}:${id}`, 'Yes, cancel it', D), btn('ui:mr:h', 'Keep it'))] });
    }
    if (a === 'y') return myRequests(interaction, await cancelRequest(interaction, b, c));
    throw new UserError('That button is from an older version of the bot. Open 📨 My requests again.');
}

// ================================================================== 🆕 Make a wrestler

function makeStart(interaction) {
    return show(interaction, {
        content: '🆕 **Make a wrestler.** Which division? Next you fill in a short form (name, plus optional finisher, alignment, bio and picture link). Staff approve it.\n_To upload a picture file instead of a link, use `/character submit`._',
        embeds: [],
        components: withHome([row(...Object.entries(DIVISION_LABELS).map(([d, l]) => btn(`ui:mk:d:${d}`, l, P)))])
    });
}
function makeForm(division) {
    const input = (id, label, opts = {}) => {
        const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(opts.long ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(Boolean(opts.required)).setMaxLength(opts.max || 100);
        if (opts.placeholder) t.setPlaceholder(opts.placeholder);
        return new ActionRowBuilder().addComponents(t);
    };
    return new ModalBuilder().setCustomId(`ui:mkm:${division}`).setTitle(clip(`New ${DIVISION_LABELS[division]} wrestler`, 45)).addComponents(
        input('name', 'Wrestler name', { required: true, max: 40 }),
        input('finisher', 'Finisher (optional)', { max: 40 }),
        input('alignment', 'Face, heel or neutral (optional)', { max: 10, placeholder: 'face / heel / neutral' }),
        input('bio', 'One-line bio (optional)', { max: 120 }),
        input('image_url', 'Picture link (optional)', { max: 400, placeholder: 'https://…' }));
}
async function makeSubmit(interaction, division) {
    const f = (k) => { try { return String(interaction.fields.getTextInputValue(k) || '').trim(); } catch (_) { return ''; } };
    if (!DIVISION_LABELS[division]) throw new UserError('Pick a division first.');
    const alignment = f('alignment').toLowerCase() || null;
    const back = [row(btn('ui:mk:h', '🆕 Make another'), btn('ui:mr:h', '📨 My requests'))];
    if (alignment && !['face', 'heel', 'neutral'].includes(alignment)) {
        return show(interaction, { content: '⚠️ Alignment must be face, heel or neutral (or left empty). Nothing was sent, so try again.', embeds: [], components: withHome(back) });
    }
    let content;
    try {
        const out = await capture(interaction, 'character', 'submit', { name: f('name'), division, finisher: f('finisher') || null, alignment, bio: f('bio') || null, image_url: f('image_url') || null });
        content = out.content || `**${f('name')}** was sent to staff.`;
    } catch (e) { if (!(e instanceof UserError)) throw e; content = `⚠️ ${e.message}`; }
    return show(interaction, { content: `${content}\nYou can follow it in 📨 My requests.`, embeds: [], components: withHome(back) });
}

// ================================================================== 📌 Menu post (staff)

async function menuPanel(interaction, notice = null) {
    requireAdmin(interaction, 'set up the menu post');
    return open(interaction, async () => {
        const { rows } = await pool.query(`SELECT menu_channel_id, menu_message_id FROM guilds WHERE guild_id = $1`, [interaction.guildId]);
        const g = rows[0] || {};
        const embed = new EmbedBuilder().setColor(0xC0392B).setTitle('📌 Menu post').setDescription([
            'A post with big buttons for everyone: make a wrestler, my wrestlers, report a result, my requests, champions, next show, results, roster, stats, standings, legacy and help. Each button only answers the person who pressed it.',
            '',
            'It **stays at the bottom** of its channel: about 10 seconds after someone posts there, the bot moves it back down. If it gets deleted, the bot puts it back.',
            '',
            `**Channel:** ${g.menu_channel_id ? `<#${g.menu_channel_id}>` : 'not set yet'}`,
            '**Tip:** a quiet channel like #start-here works best.'
        ].join('\n'));
        const menu = new ChannelSelectMenuBuilder().setCustomId('ui:mp:s').setPlaceholder(g.menu_channel_id ? 'Move it to another channel' : 'Pick the channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
        return withNotice({ embeds: [embed], components: [
            new ActionRowBuilder().addComponents(menu),
            row(btn('ui:mp:r', '🔄 Post it again now', S, !g.menu_channel_id), btn('ui:mp:x', '🔕 Turn it off', D, !g.menu_channel_id), btn('ui:mp:v', '👁 Preview')),
            row(btn('ui:ad:h', '◀ Admin panel')), homeRow()
        ] }, notice);
    });
}

async function handleMenu(interaction, a) {
    requireAdmin(interaction, 'set up the menu post');
    const MP = require('../utils/menuPost');
    if (a === 'h') return menuPanel(interaction);
    if (a === 'v') {
        const p = MP.payload(interaction.guild?.name);
        return show(interaction, { ...p, content: '👁 **Preview** (only you see this; the buttons work):', components: [...p.components, row(btn('ui:mp:h', '◀ Back'))] });
    }
    if (a === 's') {
        const channelId = interaction.values?.[0];
        await interaction.deferUpdate?.();
        const id = await MP.setChannel(interaction.client, interaction.guildId, channelId);
        await require('../utils/audit').logAudit(interaction.guildId, interaction.user.id, 'menu_post_channel', { channel: channelId });
        return menuPanelAfterDefer(interaction, id ? `✅ Posted the menu in <#${channelId}>.` : `⚠️ I couldn't post in <#${channelId}>. Check I can see the channel and send messages there.`);
    }
    if (a === 'r') {
        await interaction.deferUpdate?.();
        const id = await MP.repost(interaction.client, interaction.guildId);
        return menuPanelAfterDefer(interaction, id ? '✅ Posted it again at the bottom.' : '⚠️ I couldn\'t post it. Check I can see the channel and send messages there.');
    }
    if (a === 'x') {
        await interaction.deferUpdate?.();
        await MP.setChannel(interaction.client, interaction.guildId, null);
        await require('../utils/audit').logAudit(interaction.guildId, interaction.user.id, 'menu_post_off', {});
        return menuPanelAfterDefer(interaction, '🔕 The menu post is off (and I removed it).');
    }
    throw new UserError('That button is from an older version of the bot. Open /admin panel again.');
}

/** Same as menuPanel, for when the click was already acknowledged (posting can take a moment). */
async function menuPanelAfterDefer(interaction, notice) {
    const proxy = new Proxy(interaction, {
        get(t, p) {
            if (p === 'deferUpdate' || p === 'deferReply') return async () => {};
            const v = Reflect.get(t, p, t);
            return typeof v === 'function' ? v.bind(t) : v;
        }
    });
    return menuPanel(proxy, notice);
}

// ================================================================== 📈 Bot usage (staff)

async function usagePanel(interaction, days) {
    requireAdmin(interaction, 'see bot usage');
    const d = [7, 30, 90].includes(Number(days)) ? Number(days) : 7;
    return open(interaction, async () => ({
        embeds: [await require('../utils/usage').usageEmbed(interaction.guildId, d)],
        components: [row(...[7, 30, 90].map((x) => btn(`ui:us:${x}`, `${x} days`, x === d ? P : S))), row(btn('ui:ad:h', '◀ Admin panel')), homeRow()]
    }));
}

// ================================================================== 🔢 Overall (staff, 3.11)

async function overallForm(interaction, charId) {
    requireAdmin(interaction, 'set overall ratings');
    const { rows } = await pool.query(`SELECT name, overall FROM characters WHERE id = $1 AND guild_id = $2`, [charId, interaction.guildId]);
    if (!rows[0]) throw new UserError('That wrestler doesn\'t exist anymore.');
    const t = new TextInputBuilder().setCustomId('overall').setLabel('Overall 1-99 (empty = hide it)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2);
    if (rows[0].overall) t.setValue(String(rows[0].overall));
    return interaction.showModal(new ModalBuilder().setCustomId(`ui:ovm:${charId}`).setTitle(clip(`Overall: ${rows[0].name}`, 45)).addComponents(new ActionRowBuilder().addComponents(t)));
}
async function overallSave(interaction, charId) {
    requireAdmin(interaction, 'set overall ratings');
    let raw = '';
    try { raw = String(interaction.fields.getTextInputValue('overall') || '').trim(); } catch (_) { raw = ''; }
    const hub = require('./hub');
    if (raw && !/^\d{1,2}$/.test(raw)) return hub.wrestlerStaffPanel(interaction, charId, '⚠️ The overall has to be a number from 1 to 99. Nothing was changed.');
    const n = raw ? Number(raw) : null;
    if (n !== null && (n < 1 || n > 99)) return hub.wrestlerStaffPanel(interaction, charId, '⚠️ The overall has to be a number from 1 to 99. Nothing was changed.');
    const { rows } = await pool.query(`UPDATE characters SET overall = $3 WHERE id = $1 AND guild_id = $2 RETURNING name`, [charId, interaction.guildId, n]);
    if (!rows[0]) throw new UserError('That wrestler doesn\'t exist anymore.');
    await require('../utils/audit').logAudit(interaction.guildId, interaction.user.id, 'character_overall', { character: Number(charId), overall: n });
    return hub.wrestlerStaffPanel(interaction, charId, n ? `✅ **${rows[0].name}** is now **${n} Overall**. The roster channel updates in a few seconds.` : `✅ Removed **${rows[0].name}**'s overall.`);
}

// ================================================================== routing

async function handle(interaction, parts) {
    const [, kind, a, b, c] = parts;
    if (kind === 'mr') return handleRequests(interaction, a, b, c);
    if (kind === 'mk') return a === 'd' ? interaction.showModal(makeForm(b)) : makeStart(interaction);
    if (kind === 'mkm') return makeSubmit(interaction, a);
    if (kind === 'mp') return handleMenu(interaction, a);
    if (kind === 'us') return usagePanel(interaction, a);
    if (kind === 'ov') return overallForm(interaction, a);
    if (kind === 'ovm') return overallSave(interaction, a);
    throw new UserError('That button is from an older version of the bot.');
}

module.exports = { KINDS, handle, myRequests, menuPanel, usagePanel, cancelRequest };
