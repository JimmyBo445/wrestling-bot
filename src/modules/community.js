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

const KINDS = ['mr', 'mk', 'mkm', 'mp', 'us', 'ov', 'ovm', 'rq', 'sw', 'rqm', 'swm'];
const P = ButtonStyle.Primary, S = ButtonStyle.Secondary, G = ButtonStyle.Success, D = ButtonStyle.Danger;
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
        `SELECT pr.*, c.name AS char_name, c.division AS char_division, c2.name AS opp_name, t.name AS title_name, tm.name AS team_name
         FROM pending_requests pr
         LEFT JOIN characters c ON c.id = pr.character_id
         LEFT JOIN characters c2 ON c2.id = pr.challenger_character_id
         LEFT JOIN titles t ON t.id = pr.title_id
         LEFT JOIN teams tm ON tm.id = pr.team_id
         WHERE pr.guild_id = $1 AND pr.requested_by = $2
           AND pr.request_type IN ('character_submission','character_claim','character_switch','match_request','contender_challenge')
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
    const ld = r.char_division === 'luchaderpy' ? '🟣 LuchaDerpy ' : ''; // 3.15
    if (r.request_type === 'character_claim') return `**${r.char_name || 'a wrestler'}**: ${ld}claim · ${st} · ${ts(r.created_at)}`;
    if (r.request_type === 'character_switch') return `**${r.opp_name || '?'} → ${r.char_name || '?'}**: ${ld}switch · ${st} · ${ts(r.created_at)}`;
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
        add('🆕 New wrestlers, claims & switches', group(['character_submission', 'character_claim', 'character_switch']));
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

const MAKE_DIVISIONS = ['custom', 'custom_womens']; // 3.12: Men's and Women's characters are requested (claimed), not made

function makeStart(interaction) {
    return show(interaction, {
        content: '🆕 **Make a custom wrestler.** Which division? Next you fill in a short form (name, plus optional finisher, alignment, bio and picture link). Staff approve it.\n_Want a Men\'s or Women\'s character instead? Press 🙋 Request a character._\n_To upload a picture file instead of a link, use `/character submit`._',
        embeds: [],
        components: withHome([row(...MAKE_DIVISIONS.map((d) => btn(`ui:mk:d:${d}`, DIVISION_LABELS[d], P)), btn('ui:rq:h:mw', '🙋 Request a character'))])
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
    if (!MAKE_DIVISIONS.includes(division)) throw new UserError('Men\'s and Women\'s characters can\'t be made, only requested. Press 🙋 Request a character.');
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

// ================================================================== 🙋 Request a character (3.12)
// Men's and Women's characters aren't made by players: they ask for an 🟢 open one (a wrestler in the bot
// that nobody plays) and staff approve it, exactly like 🔄 Claim a wrestler on the signup post.

const REQ_DIVISIONS = ['mens', 'womens', 'luchaderpy']; // 3.15: 🟣 LuchaDerpy uses the Men's roster
const scopeDivs = (scope) => (REQ_DIVISIONS.includes(scope) ? [scope] : REQ_DIVISIONS);
const SORT = (a) => `regexp_replace(lower(${a}.name), '^the +', '')`; // 3.15: A–Z ignores a leading "The"

/**
 * One page of open characters in a division, optionally only names containing `search`.
 * 3.15: a Men's superstar is open only if nobody has it as 🟢 or 🟣. With `discordId`, that player also sees
 * superstars they already have in the other color (asking for both needs staff approval); those rows have `dual`.
 * For 'luchaderpy' the rows are Men's superstars (ids are the Men's ids).
 */
async function openPage(guildId, div, page = 0, search = '', discordId = null) {
    const like = search ? `%${String(search).trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
    const me = discordId ? String(discordId) : '';
    let where;
    if (div === 'luchaderpy') {
        where = `c.guild_id = $1 AND c.status = 'approved' AND c.division = 'mens' AND $2::text = 'luchaderpy' AND ($3::text IS NULL OR c.name ILIKE $3)
                 AND (u.is_placeholder OR u.discord_id = $6) AND NOT ${require('../utils/lucha').luchaTakenSql('c')}`;
    } else {
        where = `c.guild_id = $1 AND c.status = 'approved' AND u.is_placeholder = true AND c.division = $2 AND ($3::text IS NULL OR c.name ILIKE $3)
                 AND ($2 <> 'mens' OR NOT ${require('../utils/lucha').luchaTakenSql('c', '$6')})`;
    }
    const { rows: cnt } = await pool.query(`SELECT COUNT(*)::int AS n FROM characters c JOIN users u ON u.id = c.owner_id WHERE ${where} AND $4::text IS NOT NULL AND $5::int IS NOT NULL`, [guildId, div, like, '', 0, me]);
    const total = cnt[0].n;
    const pages = search ? 1 : Math.max(1, Math.ceil(total / 25));
    const p = Math.min(Math.max(0, Number(page) || 0), pages - 1);
    const { rows } = await pool.query(
        `SELECT c.id, c.name, c.overall,
                (NOT u.is_placeholder OR EXISTS (SELECT 1 FROM characters lx JOIN users lux ON lux.id = lx.owner_id WHERE lx.base_character_id = c.id AND lx.status = 'approved' AND NOT lux.is_placeholder)) AS dual
         FROM characters c JOIN users u ON u.id = c.owner_id WHERE ${where}
         ORDER BY ($3::text IS NOT NULL AND lower(c.name) LIKE lower($4) || '%') DESC, ${SORT('c')}, c.id LIMIT 25 OFFSET $5`,
        [guildId, div, like, String(search || '').trim(), p * 25, me]);
    // 3.17: the first letter of every open name in order, for the letter buttons
    const { rows: ls } = search ? { rows: [] } : await pool.query(
        `SELECT upper(left(${SORT('c')}, 1)) AS l FROM characters c JOIN users u ON u.id = c.owner_id WHERE ${where} AND $4::text IS NOT NULL AND $5::int IS NOT NULL ORDER BY ${SORT('c')}, c.id`,
        [guildId, div, like, '', 0, me]);
    return { total, pages, p, rows, letters: ls.map((r) => r.l || '#') };
}

/**
 * 3.17: letter buttons instead of ◀ ▶. Up to 5 buttons like "A–D", each jumping to that part of the A–Z list.
 * With more than 5 pages a button covers several pages (the nav row then also has ◀ ▶).
 */
function letterRow(letters, pages, p, idFor) {
    if (pages <= 1) return null;
    const n = Math.min(5, pages);
    const out = [];
    for (let k = 0; k < n; k++) {
        const first = Math.floor((k * pages) / n), last = Math.floor(((k + 1) * pages) / n) - 1;
        const a = letters[first * 25] || '?', z = letters[Math.min(letters.length, (last + 1) * 25) - 1] || a;
        out.push(btn(idFor(first), a === z ? a : `${a}–${z}`, p >= first && p <= last ? P : S));
    }
    return row(...out);
}
/** 3.17: search results as buttons (one tap on the name), up to 15. */
const MAX_RESULT_BUTTONS = 15;
function resultRows(rows, idFor) {
    const out = [];
    const list = rows.slice(0, MAX_RESULT_BUTTONS);
    for (let i = 0; i < list.length; i += 5) out.push(row(...list.slice(i, i + 5).map((r) => btn(idFor(r.id), clip(`${r.name}${r.overall ? ` (${r.overall})` : ''}`, 80), G))));
    return out;
}
/** 3.17: the player's own approved characters in a division (for "add another, or switch?"). */
async function mineIn(guildId, discordId, division, client = pool) {
    const { rows } = await client.query(
        `SELECT c.id, c.name FROM characters c JOIN users u ON u.id = c.owner_id
         WHERE c.guild_id = $1 AND u.discord_id = $2 AND NOT u.is_placeholder AND c.status = 'approved' AND c.division = $3 ORDER BY ${SORT('c')}`, [guildId, String(discordId), division]);
    return rows;
}
const optionFor = (r) => ({ label: clip(r.name, 100), value: String(r.id), description: clip([r.overall && `${r.overall} Overall`, r.dual && 'You have them in the other color: staff decide'].filter(Boolean).join(' · '), 100) || undefined });
const divName = (d) => (d === 'luchaderpy' ? '🟣 LuchaDerpy' : DIVISION_LABELS[d]);

/** 3.17: the name box is optional: leaving it empty shows the whole A–Z list. */
function searchForm(id, title) {
    return new ModalBuilder().setCustomId(id).setTitle(clip(title, 45)).addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('name').setLabel('Name, or leave empty for the full list').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(40).setPlaceholder('Roman')));
}
const searchText = (interaction) => { try { return String(interaction.fields.getTextInputValue('name') || '').trim(); } catch (_) { return ''; } };

async function requestList(interaction, scope, div, page = 0, search = '') {
    const divs = scopeDivs(scope);
    if (!divs.includes(div)) div = divs[0];
    const { total, pages, p, rows, letters } = await openPage(interaction.guildId, div, page, search, interaction.user.id);
    const comps = [];
    if (search) comps.push(...resultRows(rows, (id) => `ui:rq:b:${scope}:${div}:${id}`)); // 3.17: tap the name
    else {
        if (divs.length > 1) comps.push(row(...divs.map((d) => btn(`ui:rq:l:${scope}:${d}`, divName(d), d === div ? P : S))));
        const lr = letterRow(letters, pages, p, (pg) => `ui:rq:l:${scope}:${div}:${pg}:j`);
        if (lr) comps.push(lr);
        if (rows.length) comps.push(select(`ui:rq:p:${scope}:${div}`, `Pick the ${DIVISION_LABELS[div]} character you want`, rows.map(optionFor)));
    }
    const nav = [btn(`ui:rq:s:${scope}:${div}`, search ? '🔎 Search again' : '🔎 Search by name', P)];
    if (search) nav.push(btn(`ui:rq:l:${scope}:${div}:0`, '📋 Full list'));
    else if (pages > 5) nav.push(btn(`ui:rq:l:${scope}:${div}:${p - 1}`, '◀', S, p === 0), btn(`ui:rq:l:${scope}:${div}:${p + 1}`, '▶', S, p >= pages - 1));
    nav.push(btn('ui:mr:h', '📨 My requests'));
    comps.push(row(...nav));
    const lucha = div === 'luchaderpy';
    return show(interaction, {
        content: search
            ? (rows.length
                ? `🔎 Open ${DIVISION_LABELS[div]} characters matching **${clip(search, 40)}**${total > MAX_RESULT_BUTTONS ? ` (first ${MAX_RESULT_BUTTONS} of ${total}; type more of the name to narrow it down)` : ''}. **Tap the one you want.**`
                : `🔎 No open ${DIVISION_LABELS[div]} character matches **${clip(search, 40)}**. They may be taken already. Try part of the name with 🔎 Search again, or see the 📋 Full list.`)
            : rows.length
                ? (lucha
                    ? `🟣 **Request a LuchaDerpy character.** LuchaDerpy uses the Men's roster: these superstars have no player right now (⚪ open). Pick one for your 🟣 LuchaDerpy slot (on top of your normal ones) and staff will give it to you.${pages > 1 ? ` (${total} open: tap a letter button to jump, or 🔎 search)` : ''}`
                    : `🙋 **Request a ${DIVISION_LABELS[div]} character.** These have no player right now (⚪ open). Pick one and staff will give it to you.${pages > 1 ? ` (${total} open: tap a letter button to jump, or 🔎 search)` : ''}`)
                : `🙋 There are no open ${DIVISION_LABELS[div]} characters right now. Ask staff if you're after someone who isn't on the roster yet.`,
        embeds: [],
        components: withHome(comps)
    });
}

/**
 * The character a request is for. For LuchaDerpy, `charId` is the Men's superstar and this returns its 🟣 version
 * (made the first time). Throws if it isn't open for this player anymore.
 */
async function openChar(interaction, charId, div = null) {
    const { getCharacterById } = require('../utils/characterUtils');
    const L = require('../utils/lucha');
    let c = await getCharacterById(charId);
    const gone = () => new UserError('That character isn\'t open anymore. Pick another one.');
    if (!c || String(c.guild_id) !== String(interaction.guildId) || c.status !== 'approved') throw gone();
    if (div === 'luchaderpy' && c.division === 'mens') {
        const holder = await require('../utils/unclaim').placeholderUserId(interaction.guildId, interaction.client.user.id);
        c = await getCharacterById((await L.ensureLucha(interaction.guildId, c.id, holder)).id);
    }
    if (!c.unclaimed || !REQ_DIVISIONS.includes(c.division)) throw gone();
    try { const { dual } = await L.checkSuperstar(c, interaction.user.id); c.dual = dual; } catch (e) { if (e instanceof UserError) throw gone(); throw e; }
    return c;
}

async function handleRequestChar(interaction, a, b, c) {
    if (a === 'h') {
        // 3.17: with one division the name box opens straight away (empty = the full list)
        const divs = scopeDivs(b || 'mw');
        if (divs.length === 1 && interaction.isButton?.()) return interaction.showModal(searchForm(`ui:rqm:${b}:${divs[0]}`, `Find an open ${DIVISION_LABELS[divs[0]]} character`));
        return requestList(interaction, b || 'mw', divs[0]);
    }
    if (a === 'l') return requestList(interaction, b, c, (interaction.customId.split(':')[5]) || 0);
    if (a === 's') return interaction.showModal(searchForm(`ui:rqm:${b}:${c}`, `Search open ${DIVISION_LABELS[c] || ''} characters`));
    if (a === 'p' || a === 'b') {
        const ch = await openChar(interaction, a === 'b' ? interaction.customId.split(':')[5] : interaction.values?.[0], c);
        const lucha = ch.division === 'luchaderpy';
        const both = ch.dual ? `\n⚠️ You already have **${ch.name}** as ${lucha ? '🟢 Men\'s' : '🟣 LuchaDerpy'}. Using the same superstar in both is up to staff.` : '';
        const again = btn(`ui:rq:l:${b || 'mw'}:${c}:0`, 'Pick another');
        // 3.17: already have a character in this division → add another, or switch?
        const mine = await mineIn(interaction.guildId, interaction.user.id, ch.division);
        if (mine.length && !lucha) {
            return show(interaction, { embeds: [],
                content: `You already have **${mine.map((m) => m.name).join('**, **')}** (${DIVISION_LABELS[ch.division]}). What do you want to do with **${ch.name}**?\n`
                    + `• **➕ Add:** you keep ${mine.length > 1 ? 'your characters' : `**${mine[0].name}**`} and **${ch.name}** becomes an extra character.\n`
                    + `• **🔄 Switch:** you give up one character and get **${ch.name}** instead. The one you give up becomes open for someone else.\nStaff approve either one.${both}`,
                components: [row(btn(`ui:rq:y:${ch.id}`, clip(`➕ Add ${ch.name} (keep mine)`, 80), G),
                    ...mine.slice(0, 3).map((m) => btn(`ui:sw:tb:${m.id}:${ch.id}`, clip(`🔄 Switch: give up ${m.name}`, 80), P)), again)] });
        }
        if (lucha && mine.length) {
            return show(interaction, { embeds: [],
                content: `You already have a 🟣 LuchaDerpy character: **${mine[0].name}** (1 per player). Do you want to **switch** it for **${ch.name}**? **${mine[0].name}** becomes open for someone else. Staff approve it.${both}`,
                components: [row(btn(`ui:sw:tb:${mine[0].id}:${ch.id}`, clip(`🔄 Switch: give up ${mine[0].name}`, 80), P), again)] });
        }
        return show(interaction, { content: `Ask staff to give you **${ch.name}** ${lucha ? 'for your 🟣 **LuchaDerpy** slot' : `(${DIVISION_LABELS[ch.division]})`}?${both}`, embeds: [],
            components: [row(btn(`ui:rq:y:${ch.id}`, 'Yes, send the request', G), again)] });
    }
    if (a === 'y') {
        const ch = await openChar(interaction, b);
        if (ch.division === 'luchaderpy') {
            const { ensureUser } = require('../utils/ensureGuild');
            await require('../utils/lucha').requireLuchaRoom(interaction.guildId, await ensureUser(interaction.guildId, interaction.user.id), interaction.user.id);
            const { rows: waiting } = await pool.query(
                `SELECT 1 FROM pending_requests pr JOIN characters c ON c.id = pr.character_id WHERE pr.guild_id = $1 AND pr.request_type = 'character_claim' AND pr.status = 'pending' AND pr.requested_by = $2 AND c.division = 'luchaderpy'`,
                [interaction.guildId, interaction.user.id]);
            if (waiting.length) throw new UserError('You already asked for a 🟣 LuchaDerpy character. Staff will get to it (see 📨 My requests), or cancel it there to ask for someone else.');
        } else await require('../utils/signupHelp').requireRoom(interaction);
        const { rows: dupe } = await pool.query(
            `SELECT 1 FROM pending_requests WHERE guild_id = $1 AND request_type = 'character_claim' AND status = 'pending' AND requested_by = $2 AND character_id = $3`,
            [interaction.guildId, interaction.user.id, ch.id]);
        if (dupe.length) throw new UserError(`You already asked for **${ch.name}**. Staff will get to it (see 📨 My requests).`);
        await require('../handlers/pendingQueue').postPendingCard(interaction.guild, { type: 'character_claim', characterId: ch.id, requestedBy: interaction.user.id, payload: { from: 'request' }, staffRoom: true });
        const keep = ch.division === 'luchaderpy' ? [] : await mineIn(interaction.guildId, interaction.user.id, ch.division);
        return show(interaction, { content: keep.length
            ? `➕ Request sent to **add ${ch.name}** as another character. You keep **${keep.map((m) => m.name).join('**, **')}**. Staff will look at it and you'll get a DM.`
            : `🙋 Request sent! Staff will look at it. Once approved, **${ch.name}** is yours${ch.division === 'luchaderpy' ? ' in 🟣 LuchaDerpy' : ''} and you'll get a DM.`, embeds: [],
            components: withHome([row(btn('ui:mr:h', '📨 My requests'))]) });
    }
    throw new UserError('That button is from an older version of the bot.');
}

// ================================================================== 🔄 Switch character (3.13)

async function switchStart(interaction, scope) {
    const divs = scopeDivs(scope);
    const { rows } = await pool.query(
        `SELECT c.id, c.name, c.division FROM characters c JOIN users u ON u.id = c.owner_id
         WHERE c.guild_id = $1 AND u.discord_id = $2 AND c.status = 'approved' AND c.division = ANY($3::text[]) ORDER BY regexp_replace(lower(c.name), '^the +', '')`,
        [interaction.guildId, interaction.user.id, divs]);
    if (!rows.length) {
        return show(interaction, { content: `🔄 You don't have a ${divs.map((d) => DIVISION_LABELS[d]).join(' or ')} character to switch. Press 🙋 Request a character to ask for an open one.`, embeds: [],
            components: withHome([row(btn(`ui:rq:h:${scope}`, '🙋 Request a character', G))]) });
    }
    if (rows.length === 1) return switchFind(interaction, rows[0].id);
    return show(interaction, { content: '🔄 **Switch character.** Which of your characters do you want to give up?', embeds: [],
        components: withHome([select('ui:sw:f', 'Pick the one to switch out', rows.map((r) => ({ label: clip(r.name, 100), value: String(r.id), description: DIVISION_LABELS[r.division] })))]) });
}

/** 3.17: opens the name box straight away (empty = the full list). Checks first that this character can be switched. */
async function switchFind(interaction, fromId) {
    const { from } = await require('../utils/characterSwitch').check(interaction.guildId, interaction.user.id, fromId, null);
    if (!interaction.isButton?.() && !interaction.isStringSelectMenu?.()) return switchList(interaction, from.id);
    return interaction.showModal(searchForm(`ui:swm:${from.id}`, clip(`Switch ${from.name} for…`, 45)));
}

async function switchList(interaction, fromId, page = 0, search = '') {
    const CS = require('../utils/characterSwitch');
    const { from } = await CS.check(interaction.guildId, interaction.user.id, fromId, null);
    const { total, pages, p, rows, letters } = await openPage(interaction.guildId, from.division, page, search, interaction.user.id);
    const comps = [];
    if (search) comps.push(...resultRows(rows, (id) => `ui:sw:tb:${from.id}:${id}`)); // 3.17: tap the name
    else {
        const lr = letterRow(letters, pages, p, (pg) => `ui:sw:l:${from.id}:${pg}:j`);
        if (lr) comps.push(lr);
        if (rows.length) comps.push(select(`ui:sw:t:${from.id}`, `Switch ${clip(from.name, 60)} for…`, rows.map(optionFor)));
    }
    const nav = [btn(`ui:sw:s:${from.id}`, search ? '🔎 Search again' : '🔎 Search by name', P)];
    if (search) nav.push(btn(`ui:sw:l:${from.id}:0`, '📋 Full list'));
    else if (pages > 5) nav.push(btn(`ui:sw:l:${from.id}:${p - 1}`, '◀', S, p === 0), btn(`ui:sw:l:${from.id}:${p + 1}`, '▶', S, p >= pages - 1));
    nav.push(btn('ui:mr:h', '📨 My requests'));
    comps.push(row(...nav));
    return show(interaction, {
        content: search
            ? (rows.length
                ? `🔎 Open ${DIVISION_LABELS[from.division]} characters matching **${clip(search, 40)}**${total > MAX_RESULT_BUTTONS ? ` (first ${MAX_RESULT_BUTTONS} of ${total}; type more of the name)` : ''}. **Tap the one you want** to switch **${from.name}** for.`
                : `🔎 No open ${DIVISION_LABELS[from.division]} character matches **${clip(search, 40)}**. They may be taken already. Try part of the name with 🔎 Search again, or see the 📋 Full list.`)
            : rows.length
            ? `🔄 **Switch ${from.name}** for an ⚪ open ${from.division === 'luchaderpy' ? '🟣 LuchaDerpy (Men\'s roster)' : DIVISION_LABELS[from.division]} character. Staff approve it, and **${from.name}** becomes open for someone else.${pages > 1 ? ' Tap a letter button to jump, or 🔎 search.' : ''}`
            : `🔄 There are no open ${DIVISION_LABELS[from.division]} characters to switch to right now.`,
        embeds: [], components: withHome(comps)
    });
}

async function handleSwitch(interaction, a, b, c) {
    const CS = require('../utils/characterSwitch');
    if (a === 'h') return switchStart(interaction, b || 'mw');
    if (a === 'o') return switchFind(interaction, b);
    if (a === 'f') return switchFind(interaction, interaction.values?.[0]);
    if (a === 'l') return switchList(interaction, b, c);
    if (a === 's') return interaction.showModal(searchForm(`ui:swm:${b}`, 'Search open characters'));
    if (a === 't' || a === 'tb') {
        let toId = a === 'tb' ? c : interaction.values?.[0];
        // 3.15: a 🟣 switch picks a Men's superstar; its LuchaDerpy version is what they switch to
        const { rows: fr } = await pool.query(`SELECT division FROM characters WHERE id = $1 AND guild_id = $2`, [b, interaction.guildId]);
        if (fr[0]?.division === 'luchaderpy') toId = (await openChar(interaction, toId, 'luchaderpy')).id;
        const { from, to, dual } = await CS.check(interaction.guildId, interaction.user.id, b, toId);
        const both = dual ? `\n⚠️ You already have **${to.name}** in the other color. Using the same superstar in both is up to staff.` : '';
        // 3.17: be clear this is a switch, and offer "add as another" instead (not for the single 🟣 slot)
        const canAdd = from.division !== 'luchaderpy';
        return show(interaction, { embeds: [],
            content: `🔄 **This is a switch:** you **give up ${from.name}** and get **${to.name}**. Once staff approve it, **${from.name}** becomes open for someone else. You can switch again after the cooldown.${canAdd ? `\nWant to keep **${from.name}** too? Press ➕ to ask for **${to.name}** as an extra character instead.` : ''}${both}`,
            components: [row(btn(`ui:sw:y:${from.id}:${to.id}`, clip(`🔄 Yes, switch (give up ${from.name})`, 80), G),
                ...(canAdd ? [btn(`ui:rq:y:${to.id}`, clip(`➕ Keep ${from.name}, add ${to.name}`, 80), P)] : []), btn(`ui:sw:l:${from.id}:0`, 'Pick another'))] });
    }
    if (a === 'y') {
        const { from, to } = await CS.check(interaction.guildId, interaction.user.id, b, c);
        const { rows: dupe } = await pool.query(
            `SELECT 1 FROM pending_requests WHERE guild_id = $1 AND request_type = 'character_switch' AND status = 'pending' AND requested_by = $2`, [interaction.guildId, interaction.user.id]);
        if (dupe.length) throw new UserError('You already have a switch waiting for staff. Cancel it in 📨 My requests to ask for a different one.');
        await require('../handlers/pendingQueue').postPendingCard(interaction.guild, { type: 'character_switch', characterId: to.id, challengerCharacterId: from.id, requestedBy: interaction.user.id, staffRoom: true });
        return show(interaction, { content: `🔄 Switch request sent! Once staff approve it, you're **${to.name}**, **${from.name}** becomes open, and you'll get a DM.`, embeds: [],
            components: withHome([row(btn('ui:mr:h', '📨 My requests'))]) });
    }
    throw new UserError('That button is from an older version of the bot.');
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
    // 3.15.1: one overall per superstar: setting it on either version sets both
    const { rows: b } = await pool.query(`SELECT COALESCE(base_character_id, id) AS id FROM characters WHERE id = $1 AND guild_id = $2`, [charId, interaction.guildId]);
    const baseId = b[0]?.id || charId;
    const { rows } = await pool.query(`UPDATE characters SET overall = $3 WHERE guild_id = $2 AND (id = $1 OR base_character_id = $1) RETURNING name`, [baseId, interaction.guildId, n]);
    if (!rows[0]) throw new UserError('That wrestler doesn\'t exist anymore.');
    await require('../utils/audit').logAudit(interaction.guildId, interaction.user.id, 'character_overall', { character: Number(charId), overall: n });
    return hub.wrestlerStaffPanel(interaction, charId, n ? `✅ **${rows[0].name}** is now **${n} Overall**. The roster channel updates in a few seconds.` : `✅ Removed **${rows[0].name}**'s overall.`);
}

// ================================================================== routing

async function handle(interaction, parts) {
    const [, kind, a, b, c] = parts;
    if (kind === 'mr') return handleRequests(interaction, a, b, c);
    if (kind === 'mk') {
        if (a !== 'd') return makeStart(interaction);
        if (!MAKE_DIVISIONS.includes(b)) throw new UserError('Men\'s and Women\'s characters can\'t be made, only requested. Press 🙋 Request a character.');
        return interaction.showModal(makeForm(b));
    }
    if (kind === 'rq') return handleRequestChar(interaction, a, b, c);
    if (kind === 'sw') return handleSwitch(interaction, a, b, c);
    if (kind === 'rqm') return requestList(interaction, a, b, 0, searchText(interaction));
    if (kind === 'swm') return switchList(interaction, a, 0, searchText(interaction));
    if (kind === 'mkm') return makeSubmit(interaction, a);
    if (kind === 'mp') return handleMenu(interaction, a);
    if (kind === 'us') return usagePanel(interaction, a);
    if (kind === 'ov') return overallForm(interaction, a);
    if (kind === 'ovm') return overallSave(interaction, a);
    throw new UserError('That button is from an older version of the bot.');
}

module.exports = { KINDS, handle, myRequests, menuPanel, usagePanel, cancelRequest, mineIn };
