// 3.8: button screens that replace most typed subcommands of /admin, /booking, /card and /championship.
// The old subcommands still exist inside the bot (the buttons run them), they're just not listed in Discord.
//
//   ui:ad:*   /admin panel        (staff)
//   ui:adm:*  /admin panel forms  (staff)
//   ui:bk:*   /booking signups    (everyone; staff get the signup buttons)
//   ui:bkm:*  /booking signups forms
//   ui:ct:*   /card view → 🧰 More tools (staff)
//   ui:ctm:*  card tool forms
//   ui:cs:*   /championship list buttons (everyone)
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, RoleSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { requireAdmin, isAdmin, respond, EPHEMERAL, NO_MENTIONS, DIVISION_LABELS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { getGuildSettings } = require('../utils/ensureGuild');
const { btn, row, clip, homeRow, show, capture, open, withNotice, ButtonStyle } = require('../utils/panelKit');

const KINDS = ['ad', 'adm', 'bk', 'bkm', 'ct', 'ctm', 'cs'];
const P = ButtonStyle.Primary, S = ButtonStyle.Secondary, G = ButtonStyle.Success, D = ButtonStyle.Danger;
const select = (id, placeholder, options) => row(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).addOptions(options.slice(0, 25)));
const BRANDS = { raw: 'RAW', smackdown: 'SmackDown' };
const brandOf = (b) => (BRANDS[b] ? b : 'raw');
const otherBrand = (b) => (b === 'raw' ? 'smackdown' : 'raw');

function withHome(rows) {
    const has = rows.some((r) => (r.components || []).some((c) => c.data?.custom_id === 'ui:h:home'));
    return (has ? rows : [...rows, homeRow()]).slice(0, 5);
}

function modal(id, title, inputs) {
    const m = new ModalBuilder().setCustomId(id).setTitle(clip(title, 45));
    m.addComponents(...inputs.slice(0, 5).map((i) => {
        const t = new TextInputBuilder().setCustomId(i.id).setLabel(clip(i.label, 45))
            .setStyle(i.long ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(Boolean(i.required)).setMaxLength(i.max || 100);
        if (i.placeholder) t.setPlaceholder(clip(i.placeholder, 100));
        if (i.value !== undefined && i.value !== null && String(i.value) !== '') t.setValue(String(i.value).slice(0, i.max || 100));
        return new ActionRowBuilder().addComponents(t);
    }));
    return m;
}
const field = (interaction, k) => { try { return String(interaction.fields.getTextInputValue(k) ?? '').trim(); } catch (_) { return ''; } };

/** Runs a command quietly; a friendly error comes back as a ⚠️ line instead of stopping the panel. */
async function attempt(fn) {
    try { return await fn(); } catch (e) { if (e instanceof UserError) return { content: `⚠️ ${e.message}`, failed: true }; throw e; }
}
/** The short message a command answered with (its text, or its embed's text). */
const said = (p) => clip(p?.content || p?.embeds?.[0]?.data?.description || p?.embeds?.[0]?.description || '✅ Done.', 900);

/** Posts something in the channel the button was pressed in (for things everyone should see). */
async function postHere(interaction, payload) {
    const ch = interaction.channel;
    if (!ch?.send) throw new UserError('I can\'t post in this channel.');
    const files = (payload.files || []).map((f) => (f.attachment ? new AttachmentBuilder(f.attachment, { name: f.name }) : f));
    const { flags, failed, ...rest } = payload; // eslint-disable-line no-unused-vars
    try { await ch.send({ ...rest, files, allowedMentions: NO_MENTIONS }); } catch (_) { throw new UserError('I couldn\'t post in this channel. Check I\'m allowed to send messages here.'); }
}

// ================================================================== /admin panel

const backToAdmin = () => row(btn('ui:ad:h', '◀ Admin panel'));

async function adminHome(interaction, notice = null) {
    requireAdmin(interaction, 'use the admin tools');
    return open(interaction, async () => {
        const g = interaction.guildId;
        const st = await getGuildSettings(g);
        const { rows: p } = await pool.query(`SELECT COUNT(*)::int AS n FROM pending_requests WHERE guild_id = $1 AND status = 'pending'`, [g]);
        const pending = p[0].n;
        const reported = await require('./reports').pendingCount(g);
        const unfinished = (await require('../utils/unfinished').listUnfinished(g, require('../utils/titleWatch').localNow(st.tz).date)).length;
        const embed = new EmbedBuilder().setColor(0x2ECC71).setTitle('🛠 Admin panel').setDescription([
            `📥 **Waiting for approval:** ${pending}`,
            `📝 **Results players reported:** ${reported}`,
            `⏳ **Unfinished card matches:** ${unfinished}`,
            '',
            `👮 **Staff role:** ${st.staff_role_id ? `<@&${st.staff_role_id}>` : 'not set (only Manage Server)'} · 🕒 **Time zone:** ${st.tz || 'UTC'}`,
            '',
            'Press a button. Only you see this screen.'
        ].join('\n'));
        return withNotice({ embeds: [embed], components: [
            row(btn('ui:h:pending', `📥 Pending (${pending})`, P, pending === 0),
                btn('ui:rr:list', `📝 Reported results (${reported})`, reported ? D : S),
                btn('ui:uf:h', `⏳ Unfinished (${unfinished})`, unfinished ? D : S)),
            row(btn('ui:ch:h', '📺 Channels'), btn('ui:ad:ru', '📜 Rules'), btn('ui:ad:sr', '👮 Staff role'), btn('ui:ad:hi', '🏆 History channel'), btn('ui:ad:st', '⚙️ All settings')),
            row(btn('ui:ad:nl', '📰 Newsletter'), btn('ui:ad:rp', '📊 Staff report'), btn('ui:ad:ma', '🏅 Monthly awards'), btn('ui:ad:au', '📒 Audit log'), btn('ui:ad:dt', '💾 Backup & import')),
            row(btn('ui:h:staff', '🛠 Staff Tools'), btn('ui:h:home', '🏠 Home'))
        ] }, notice);
    });
}

async function rulesPanel(interaction, notice = null) {
    requireAdmin(interaction, 'change the rules');
    return open(interaction, async () => {
        const p = await capture(interaction, 'admin', 'rules');
        const st = await getGuildSettings(interaction.guildId);
        const byChar = st.cooldown_scope === 'character';
        const mile = st.milestones_enabled !== false;
        const rem = Boolean(st.rematch_enabled);
        return withNotice({ embeds: p.embeds || [], components: [
            row(btn('ui:ad:rn', '✏️ Change the numbers', P), btn('ui:ad:tz', '🕒 Time zone')),
            row(btn(`ui:ad:rt:cooldown_by:${byChar ? 'user' : 'character'}`, `Cooldown counts: ${byChar ? 'same characters' : 'same players'}`),
                btn(`ui:ad:rt:milestones:${mile ? 'off' : 'on'}`, `Milestone shout-outs: ${mile ? 'on' : 'off'}`, mile ? G : S),
                btn(`ui:ad:rt:rematches:${rem ? 'off' : 'on'}`, `Rematch clause: ${rem ? 'on' : 'off'}`, rem ? G : S)),
            backToAdmin(), homeRow()
        ] }, notice);
    });
}

const RULE_NUMBERS = [
    ['cooldown_hours', 'singles_cooldown_hours', 'Cooldown hours, same matchup (0 = off)', 0, 720],
    ['streak_wins', 'streak_threshold', 'Wins in a row for a title-shot prompt (0=off)', 0, 50],
    ['defense_days', 'defense_days', 'Warn after days with no title defense (0=off)', 0, 365],
    ['vacate_days', 'vacate_days', 'Auto-vacate after days champ is idle (0=off)', 0, 730],
    ['rematch_days', 'rematch_days', 'Days a lost champion\'s rematch lasts', 1, 365]
];

async function staffRolePanel(interaction, notice = null) {
    requireAdmin(interaction, 'change the staff role');
    return open(interaction, async () => {
        const p = await capture(interaction, 'admin', 'staff-role');
        const st = await getGuildSettings(interaction.guildId);
        const menu = new RoleSelectMenuBuilder().setCustomId('ui:ad:srs').setPlaceholder(st.staff_role_id ? 'Pick a different staff role' : 'Pick your staff role');
        const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('👮 Staff role').setDescription(clip(p.content || '', 4000));
        return withNotice({ embeds: [embed], components: [
            new ActionRowBuilder().addComponents(menu),
            row(btn('ui:ad:srx', 'Turn the staff role off', D, !st.staff_role_id), btn('ui:ad:h', '◀ Admin panel')),
            homeRow()
        ] }, notice);
    });
}

async function historyPanel(interaction, notice = null) {
    requireAdmin(interaction, 'change the history channel');
    return open(interaction, async () => {
        const st = await getGuildSettings(interaction.guildId);
        const has = Boolean(st.history_channel_id);
        const auto = st.history_auto !== false;
        const embed = new EmbedBuilder().setColor(0xE8BF4A).setTitle('🏆 Championship history channel').setDescription([
            'The bot keeps a post for every title there: every champion, reign length and defenses.',
            '',
            `**Channel:** ${has ? `<#${st.history_channel_id}>` : 'not set yet'}`,
            `**Updates by itself after title changes:** ${auto ? 'on' : 'off'}`
        ].join('\n'));
        return withNotice({ embeds: [embed], components: [
            row(btn('ui:ch:k:history', has ? '📺 Change the channel' : '📺 Pick a channel', P),
                btn(`ui:ad:ha:${auto ? 'off' : 'on'}`, `Auto updates: ${auto ? 'on' : 'off'}`, auto ? G : S, !has),
                btn('ui:ad:hu', '🔄 Update it now', S, !has)),
            backToAdmin(), homeRow()
        ] }, notice);
    });
}

async function newsletterPanel(interaction, notice = null) {
    requireAdmin(interaction, 'run the newsletter');
    return open(interaction, async () => {
        const g = interaction.guildId;
        const { rows } = await pool.query(`SELECT id, body FROM newsletter_entries WHERE guild_id = $1 AND posted_in IS NULL ORDER BY id`, [g]);
        const st = await getGuildSettings(g);
        const embed = new EmbedBuilder().setColor(0x3498DB).setTitle('📰 Weekly newsletter').setDescription(clip([
            `Posts every week in ${st.newsletter_channel_id ? `<#${st.newsletter_channel_id}>` : '_no channel yet (📺 Channels → Newsletter)_'}. Your own lines go under "From the office".`,
            '',
            rows.length ? `**Lines waiting (${rows.length}):**\n${rows.map((r) => `**#${r.id}** ${r.body}`).join('\n')}` : '_No lines waiting._'
        ].join('\n'), 4000));
        const comps = [row(btn('ui:ad:nla', '➕ Add a line', P), btn('ui:ad:nlp', '👁 Preview'), btn('ui:ad:nlq', '📣 Post it now', G))];
        if (rows.length) comps.push(select('ui:ad:nlr', '🗑 Delete a waiting line…', rows.map((r) => ({ label: clip(`#${r.id} ${r.body}`, 100), value: String(r.id) }))));
        comps.push(backToAdmin());
        return withNotice({ embeds: [embed], components: withHome(comps) }, notice);
    });
}

async function dataPanel(interaction, notice = null) {
    requireAdmin(interaction, 'make backups');
    return open(interaction, async () => {
        const st = await getGuildSettings(interaction.guildId);
        const on = Boolean(st.backup_user_id);
        const embed = new EmbedBuilder().setColor(0x95A5A6).setTitle('💾 Backup & import').setDescription([
            `**Weekly backup by DM:** ${on ? `on, to <@${st.backup_user_id}>` : 'off'}`,
            '',
            '**Import a spreadsheet** (characters, past results or title history): type `/admin data`, pick **Import**, choose what it contains and attach the .csv file. Buttons can\'t attach files, so that part stays typed.',
            'Not sure how the file should look? Press 📄 Example files.'
        ].join('\n'));
        return withNotice({ embeds: [embed], components: [
            row(btn('ui:ad:bu:now', '💾 DM me a backup now', P),
                btn(`ui:ad:bu:${on ? 'off' : 'on'}`, on ? 'Weekly backup: on (turn off)' : 'Weekly backup: off (turn on)', on ? G : S),
                btn('ui:ad:tpl', '📄 Example files')),
            backToAdmin(), homeRow()
        ] }, notice);
    });
}

/** A command's answer shown inside the admin panel with a Back button. */
function adminScreen(interaction, name, sub, values = {}, extraRows = [], back = 'ui:ad:h') {
    requireAdmin(interaction, 'use the admin tools');
    return open(interaction, async () => {
        const p = await capture(interaction, name, sub, values);
        return { ...p, components: withHome([...extraRows, row(btn(back, '◀ Back'))]) };
    }, { backRows: [row(btn(back, '◀ Back'))] });
}

async function handleAdmin(interaction, a, b, c) {
    requireAdmin(interaction, 'use the admin tools');
    const v = interaction.values?.[0];
    if (a === 'h') return adminHome(interaction);
    if (a === 'ru') return rulesPanel(interaction);
    if (a === 'rn') {
        const st = await getGuildSettings(interaction.guildId);
        return interaction.showModal(modal('ui:adm:rn', 'League rules (numbers)', RULE_NUMBERS.map(([id, col, label]) => ({ id, label, required: true, max: 3, value: st[col] ?? 0 }))));
    }
    if (a === 'tz') {
        const st = await getGuildSettings(interaction.guildId);
        return interaction.showModal(modal('ui:adm:tz', 'Time zone', [{ id: 'zone', label: 'Time zone, like America/Chicago', required: true, max: 60, value: st.tz || 'UTC', placeholder: 'America/Chicago' }]));
    }
    if (a === 'rt') {
        const r = await attempt(() => capture(interaction, 'admin', 'rules', { [b]: c }));
        return rulesPanel(interaction, r.failed ? r.content : '✅ Saved.');
    }
    if (a === 'sr') return staffRolePanel(interaction);
    if (a === 'srs' || a === 'srx') {
        const r = await attempt(() => capture(interaction, 'admin', 'staff-role', a === 'srs' ? { role: { id: v } } : { remove: true }));
        return staffRolePanel(interaction, r.failed ? r.content : (a === 'srs' ? '✅ Saved.' : '✅ The staff role is off.'));
    }
    if (a === 'hi') return historyPanel(interaction);
    if (a === 'ha' || a === 'hu') {
        // updating can take a few seconds (it edits the posts), so answer first
        const r = await attempt(() => capture(interaction, 'admin', 'history', a === 'ha' ? { auto: b } : {}));
        return historyPanel(interaction, r.failed ? r.content : (a === 'ha' ? '✅ Saved.' : said(r)));
    }
    if (a === 'st') return adminScreen(interaction, 'admin', 'settings');
    if (a === 'au') return adminScreen(interaction, 'admin', 'audit', { count: 15 });
    if (a === 'rp') return adminScreen(interaction, 'report', 'now');
    if (a === 'ma') return adminScreen(interaction, 'admin', 'monthly-awards', {}, [row(btn('ui:ad:map', '📣 Post it here', G))]);
    if (a === 'map') {
        const p = await capture(interaction, 'admin', 'monthly-awards');
        await postHere(interaction, p);
        return adminHome(interaction, `📣 Posted Wrestler of the Month in <#${interaction.channelId}>.`);
    }
    if (a === 'nl') return newsletterPanel(interaction);
    if (a === 'nla') return interaction.showModal(modal('ui:adm:nl', 'Add a newsletter line', [{ id: 'text', label: 'What should it say?', long: true, required: true, max: 300, placeholder: 'News, announcements, storyline teasers…' }]));
    if (a === 'nlr') {
        const r = await attempt(() => capture(interaction, 'newsletter', 'remove', { id: v }));
        return newsletterPanel(interaction, r.failed ? r.content : `🗑 Deleted line #${v}.`);
    }
    if (a === 'nlp') return adminScreen(interaction, 'newsletter', 'preview', {}, [], 'ui:ad:nl');
    if (a === 'nlq') {
        const st = await getGuildSettings(interaction.guildId);
        const where = st.newsletter_channel_id ? `<#${st.newsletter_channel_id}>` : 'this channel';
        return show(interaction, { content: `Post this week's newsletter now in ${where}? The waiting lines go out with it.`, embeds: [], components: [row(btn('ui:ad:nly', 'Yes, post it', G), btn('ui:ad:nl', 'Not yet'))] });
    }
    if (a === 'nly') {
        const r = await attempt(() => capture(interaction, 'newsletter', 'post'));
        if (r.failed) return newsletterPanel(interaction, r.content);
        if (r.embeds?.length) { await postHere(interaction, r); return newsletterPanel(interaction, `📣 Posted in <#${interaction.channelId}>.`); }
        return newsletterPanel(interaction, `📣 ${said(r)}`);
    }
    if (a === 'dt') return dataPanel(interaction);
    if (a === 'bu') {
        // a backup DM can take a moment
        const r = await attempt(() => capture(interaction, 'admin', 'backup', { action: b }));
        return dataPanel(interaction, said(r));
    }
    if (a === 'tpl') return adminScreen(interaction, 'admin', 'import-template', {}, [], 'ui:ad:dt');
    throw new UserError('That button is from an older version of the bot. Run `/admin panel` again.');
}

async function handleAdminForm(interaction, a) {
    requireAdmin(interaction, 'use the admin tools');
    if (a === 'rn') {
        const values = {};
        for (const [id, , label, min, max] of RULE_NUMBERS) {
            const raw = field(interaction, id);
            if (raw === '') continue;
            const n = Number(raw);
            if (!Number.isInteger(n) || n < min || n > max) return rulesPanel(interaction, `⚠️ "${label.replace(/\s*\(.*\)$/, '')}" has to be a whole number from ${min} to ${max}. Nothing was changed.`);
            values[id] = n;
        }
        const r = await attempt(() => capture(interaction, 'admin', 'rules', values));
        return rulesPanel(interaction, r.failed ? r.content : '✅ Saved.');
    }
    if (a === 'tz') {
        const r = await attempt(() => capture(interaction, 'admin', 'rules', { timezone: field(interaction, 'zone') }));
        return rulesPanel(interaction, r.failed ? r.content : '✅ Time zone saved. Show dates and reminders follow it now.');
    }
    if (a === 'nl') {
        const r = await attempt(() => capture(interaction, 'newsletter', 'add', { text: field(interaction, 'text') }));
        return newsletterPanel(interaction, said(r));
    }
    throw new UserError('That form is from an older version of the bot. Run `/admin panel` again.');
}

// ================================================================== /booking signups

async function bookingHome(interaction, notice = null) {
    return open(interaction, async () => {
        const su = require('../utils/signupUtils');
        const admin = isAdmin(interaction);
        const s = await su.latestSignup(interaction.guildId);
        const entries = s ? await su.getEntries(s.id) : [];
        const status = !s ? null : s.status === 'open' ? '🟢 open' : s.status === 'closed' ? '🔒 closed' : '✅ finished';
        const link = s?.channel_id && s?.message_id ? ` · [jump to the post](https://discord.com/channels/${interaction.guildId}/${s.channel_id}/${s.message_id})` : '';
        const lines = [
            s ? `**Latest signup: ${s.title}** · ${status} · ${entries.length} wrestler${entries.length === 1 ? '' : 's'}${s.deadline ? ` · closes after ${String(s.deadline).slice(0, 10)}` : ''}${link}` : '**No signup yet.**',
            '',
            '🙋 **Players:** press the button on the signup post to join with your wrestlers.',
            '🔎 **Suggest opponents** finds good matchups for a wrestler.',
            '📨 **Want a specific match?** Type `/booking request`.'
        ];
        if (admin) lines.push('', '🛠 **Staff:** the buttons below open, close and edit signups. `/card` → 🧰 More tools → ⚡ Auto-build books from the signup.');
        const embed = new EmbedBuilder().setColor(0x1ABC9C).setTitle('📝 Signups & booking').setDescription(lines.join('\n'));
        const comps = [row(btn('ui:pg:sug:0:all:0', '🔎 Suggest opponents', P))];
        if (admin) {
            const open_ = s?.status === 'open';
            comps.push(row(btn('ui:bk:op', '🆕 Open a signup', G), btn(`ui:bk:ls:${s?.id || 0}`, '📋 Who signed up', S, !s),
                btn(`ui:bk:cl:${s?.id || 0}`, '🔒 Close it', S, !open_), btn(`ui:bk:dn:${s?.id || 0}`, '✅ Mark it finished', S, !s || s.status === 'done')));
            comps.push(row(btn(`ui:pg:sga:${s?.id || 0}:all:0`, '➕ Sign a wrestler up', S, !open_), btn(`ui:bk:rm:${s?.id || 0}`, '➖ Take a wrestler off', S, !entries.length)));
        }
        return withNotice({ embeds: [embed], components: withHome(comps) }, notice);
    });
}

async function handleBooking(interaction, a, b, c) {
    const v = interaction.values?.[0];
    if (a === 'h') return bookingHome(interaction);
    if (a === 'se') return suggestFor(interaction, b, c === '1');
    requireAdmin(interaction, 'run signups');
    if (a === 'op') {
        return interaction.showModal(modal('ui:bkm:op', 'Open a signup (posts in this channel)', [
            { id: 'title', label: 'Name, e.g. RAW - Nov 3', required: true, max: 80 },
            { id: 'deadline', label: 'Close after (YYYY-MM-DD), empty = by hand', max: 10, placeholder: '2026-11-20' }]));
    }
    if (a === 'ls') {
        return open(interaction, async () => ({ ...await capture(interaction, 'signup', 'list', { signup: b }), components: withHome([row(btn('ui:bk:h', '◀ Back'))]) }), { backRows: [row(btn('ui:bk:h', '◀ Back'))] });
    }
    if (a === 'cl' || a === 'dn') {
        const r = await attempt(() => capture(interaction, 'signup', a === 'cl' ? 'close' : 'done', { signup: b }));
        return bookingHome(interaction, said(r));
    }
    if (a === 'rm') {
        const entries = await require('../utils/signupUtils').getEntries(b);
        if (!entries.length) return bookingHome(interaction, '⚠️ Nobody is on that signup.');
        return show(interaction, { content: 'Who comes off the signup?', embeds: [], components: withHome([
            select(`ui:bk:rs:${b}`, 'Pick a wrestler', entries.map((e) => ({ label: clip(e.name, 100), value: String(e.character_id), description: clip(DIVISION_LABELS[e.division] || e.division || '', 100) || undefined }))),
            row(btn('ui:bk:h', '◀ Back'))]) });
    }
    if (a === 'rs') {
        const r = await attempt(() => capture(interaction, 'signup', 'remove', { signup: b, character: v }));
        return bookingHome(interaction, said(r));
    }
    throw new UserError('That button is from an older version of the bot. Run `/booking signups` again.');
}

async function handleBookingForm(interaction, a) {
    requireAdmin(interaction, 'run signups');
    if (a === 'op') {
        const values = { title: field(interaction, 'title') };
        const dl = field(interaction, 'deadline');
        if (dl) values.deadline = dl;
        const r = await attempt(() => capture(interaction, 'signup', 'open', values));
        return bookingHome(interaction, r.failed ? r.content : `✅ Signup **${values.title}** is posted in this channel.${dl ? ` It closes by itself after ${dl}.` : ' Close it here when you\'re ready.'}`);
    }
    throw new UserError('That form is from an older version of the bot. Run `/booking signups` again.');
}

/** From the wrestler picker (hub.js): sign someone up, or suggest opponents. */
async function signupAdd(interaction, signupId, characterId) {
    const r = await attempt(() => capture(interaction, 'signup', 'add', { signup: signupId, character: characterId }));
    return bookingHome(interaction, said(r));
}
function suggestFor(interaction, characterId, everyone = false) {
    const back = [row(btn('ui:pg:sug:0:all:0', '🔎 Another wrestler'), btn(`ui:bk:se:${characterId}:${everyone ? 0 : 1}`, everyone ? '📝 Only the signup' : '🌐 Ignore the signup'), btn('ui:bk:h', '◀ Signups & booking'))];
    return open(interaction, async () => ({ ...await capture(interaction, 'matchmaking', 'suggest', { character: characterId, include_everyone: everyone || null }), components: withHome(back) }), { backRows: back });
}

// ================================================================== /card → 🧰 More tools

async function cardTools(interaction, brand, notice = null) {
    requireAdmin(interaction, 'build match cards');
    brand = brandOf(brand);
    return open(interaction, async () => {
        const svc = require('../utils/cardService');
        const { fmtYmd } = require('../utils/dates');
        const g = interaction.guildId;
        const showRow = await svc.getShow(g, brand);
        const drafts = await svc.filledDrafts(g, brand);
        let total = 0, logged = 0;
        for (const d of drafts) { const s = await svc.getDraftMatches(d.id); total += s.length; logged += s.filter((x) => x.match_id).length; }
        const { rows: gr } = await pool.query(`SELECT auto_recap FROM guilds WHERE guild_id = $1`, [g]);
        const autoRecap = gr[0]?.auto_recap !== false;
        const { rows: poll } = await pool.query(`SELECT id FROM motn_polls WHERE guild_id = $1 AND status = 'open' LIMIT 1`, [g]).catch(() => ({ rows: [] }));
        const L = BRANDS[brand];
        const embed = new EmbedBuilder().setColor(brand === 'raw' ? 0xC0392B : 0x2E86DE).setTitle(`🧰 ${L} card tools`).setDescription([
            `**Show:** ${showRow?.name || '_no name_'} · 📅 ${showRow?.show_date ? fmtYmd(showRow.show_date) : '_no date (📅 Schedule)_'}`,
            `**Matches:** ${total} (${logged} with a result)`,
            `**Auto recap when the last match is logged:** ${autoRecap ? 'on' : 'off'}`,
            `**Match of the Night vote:** ${poll.length ? 'open' : 'none open'}`,
            '',
            'Building: 🆕 starts an empty card, ⚡ books every division for you. Add single matches with `/card add`.',
            'After the show: 🧾 posts the results pictures here, ⭐ opens a Match of the Night vote here.'
        ].join('\n'));
        return withNotice({ embeds: [embed], components: [
            row(btn(`ui:ct:nw:${brand}`, '🆕 New card'), btn(`ui:ct:au:${brand}`, '⚡ Auto-build', P), btn(`ui:ct:rq:${brand}`, '📨 Add a match request'), btn(`ui:ct:sc:${brand}`, '📅 Schedule'), btn(`ui:ct:up:${brand}`, '🗓 Upcoming')),
            row(btn(`ui:ct:rc:${brand}`, '🧾 Post recap here', S, !logged), btn(`ui:ct:vo:${brand}`, '⭐ Open MOTN vote here', S, !logged), btn(`ui:ct:vc:${brand}`, '🔒 Close MOTN vote', S, !poll.length),
                btn(`ui:ct:ar:${brand}:${autoRecap ? 'off' : 'on'}`, `Auto recap: ${autoRecap ? 'on' : 'off'}`, autoRecap ? G : S)),
            row(btn(`cardui:bk:${brand}`, `◀ Back to the ${L} card`), btn(`ui:ct:v:${otherBrand(brand)}`, `🔁 ${BRANDS[otherBrand(brand)]} card`), btn(`ui:ct:cq:${brand}`, '🗑 Clear the card', D, !total && !showRow))
        ] }, notice);
    });
}

/** The card screen (same as /card view), opened from a panel button. */
function cardView(interaction, brand, notice = null) {
    requireAdmin(interaction, 'build match cards');
    return open(interaction, () => require('../utils/cardUi').viewMessage(interaction.guildId, brandOf(brand), { notice }));
}

async function handleCard(interaction, a, b, c) {
    requireAdmin(interaction, 'build match cards');
    const v = interaction.values?.[0];
    const brand = brandOf(b);
    const L = BRANDS[brand];
    if (a === 'h') return cardTools(interaction, brand);
    if (a === 'v') return cardView(interaction, brand);
    if (a === 'nw') return interaction.showModal(modal(`ui:ctm:nw:${brand}`, `New ${L} card (replaces the current one)`, [{ id: 'name', label: 'Show name (optional)', max: 40, placeholder: 'Monday Night Mayhem' }]));
    if (a === 'au') {
        return interaction.showModal(modal(`ui:ctm:au:${brand}`, `Auto-build the ${L} card`, [
            { id: 'matches', label: 'Matches per division (1-10)', required: true, max: 2, value: 3 },
            { id: 'name', label: 'Show name (optional)', max: 40 },
            { id: 'signup', label: 'Book from the current signup? yes/no', required: true, max: 3, value: 'yes' }]));
    }
    if (a === 'sc') {
        const showRow = await require('../utils/cardService').getShow(interaction.guildId, brand);
        const { fmtYmd } = require('../utils/dates');
        return interaction.showModal(modal(`ui:ctm:sc:${brand}`, `When is the ${L} show?`, [{ id: 'date', label: 'Date as YYYY-MM-DD (or - for no date)', required: true, max: 10, value: showRow?.show_date ? fmtYmd(showRow.show_date) : '', placeholder: '2026-11-20' }]));
    }
    if (a === 'up') {
        const back = [row(btn(`ui:ct:h:${brand}`, '◀ Card tools'))];
        return open(interaction, async () => ({ ...await capture(interaction, 'card', 'upcoming'), components: back }), { backRows: back });
    }
    if (a === 'rq') {
        const { rows } = await pool.query(
            `SELECT pr.id, a.name AS a, b.name AS b, pr.payload
             FROM pending_requests pr JOIN characters a ON a.id = pr.character_id JOIN characters b ON b.id = pr.challenger_character_id
             WHERE pr.guild_id = $1 AND pr.request_type = 'match_request' AND pr.status = 'approved'
               AND COALESCE(pr.payload->>'booked', 'no') <> 'yes' AND a.status = 'approved' AND b.status = 'approved'
             ORDER BY pr.id DESC LIMIT 25`, [interaction.guildId]);
        if (!rows.length) return cardTools(interaction, brand, 'No approved match requests are waiting to be booked.');
        return show(interaction, { content: `Which approved match request goes on the **${L}** card? It's added as a singles match.`, embeds: [], files: [], components: [
            select(`ui:ct:rqs:${brand}`, 'Pick a request', rows.map((r) => ({ label: clip(`${r.a} vs ${r.b}`, 100), value: String(r.id), description: r.payload?.note ? clip(r.payload.note, 100) : undefined }))),
            row(btn(`ui:ct:h:${brand}`, '◀ Card tools'))] });
    }
    if (a === 'rqs') {
        const r = await attempt(() => capture(interaction, 'card', 'request', { brand, request: v }));
        return cardView(interaction, brand, clip(r.failed ? r.content : (r.content || '').split('\n')[0], 600));
    }
    if (a === 'rc' || a === 'vo') {
        const r = await attempt(() => capture(interaction, 'card', a === 'rc' ? 'recap' : 'vote', { brand, channel: { id: interaction.channelId } }));
        return cardTools(interaction, brand, r.failed ? r.content : (a === 'rc' ? `🧾 Posted the ${L} recap in <#${interaction.channelId}>.` : `⭐ Match of the Night vote is open in <#${interaction.channelId}>.`));
    }
    if (a === 'vc') {
        const r = await attempt(() => capture(interaction, 'card', 'vote-close'));
        if (!r.failed) await postHere(interaction, { content: r.content });
        return cardTools(interaction, brand, r.failed ? r.content : `🔒 Vote closed. I announced the winner in <#${interaction.channelId}>.`);
    }
    if (a === 'ar') {
        const r = await attempt(() => capture(interaction, 'card', 'auto-recap', { enabled: c === 'on' }));
        return cardTools(interaction, brand, r.failed ? r.content : '✅ Saved.');
    }
    if (a === 'cq') {
        return show(interaction, { content: `Delete the whole **${L}** card? Matches that already have a result stay in the record books.`, embeds: [], files: [],
            components: [row(btn(`ui:ct:cy:${brand}`, 'Yes, delete it', D), btn(`ui:ct:h:${brand}`, 'Keep it'))] });
    }
    if (a === 'cy') {
        const r = await attempt(() => capture(interaction, 'card', 'clear', { brand }));
        return cardTools(interaction, brand, said(r));
    }
    if (a === 'tp' || a === 'tq') {
        // tale of the tape for one match on the card (b = draft id, c = position)
        const { getDraftById } = require('../utils/cardUi');
        const draft = await getDraftById(interaction.guildId, b);
        const back = row(btn(`cardui:mp:${b}:${c}`, '◀ Back to the match'));
        if (a === 'tq') {
            await interaction.deferUpdate();
            const p = await capture(interaction, 'card', 'tape', { brand: draft.brand, division: draft.division, number: c });
            await postHere(interaction, p);
            return interaction.editReply(await require('../utils/cardUi').matchPanel(interaction.guildId, b, Number(c), { notice: `📣 Posted the tale of the tape in <#${interaction.channelId}>.` }));
        }
        return open(interaction, async () => ({ ...await capture(interaction, 'card', 'tape', { brand: draft.brand, division: draft.division, number: c }),
            components: [row(btn(`ui:ct:tq:${b}:${c}`, '📣 Post it here', G)), back] }), { backRows: [back] });
    }
    throw new UserError('That button is from an older version of the bot. Run `/card view` again.');
}

async function handleCardForm(interaction, a, b) {
    requireAdmin(interaction, 'build match cards');
    const brand = brandOf(b);
    if (a === 'nw') {
        const r = await attempt(() => capture(interaction, 'card', 'new', { brand, name: field(interaction, 'name') || null }));
        return cardView(interaction, brand, r.failed ? r.content : `🆕 Started a fresh ${BRANDS[brand]} card. Add matches with \`/card add\`, or 🧰 More tools → ⚡ Auto-build.`);
    }
    if (a === 'au') {
        const n = Number(field(interaction, 'matches'));
        if (!Number.isInteger(n) || n < 1 || n > 10) return cardTools(interaction, brand, '⚠️ Matches per division has to be a number from 1 to 10.');
        const yn = field(interaction, 'signup').toLowerCase();
        const values = { brand, matches: n, name: field(interaction, 'name') || null };
        if (/^n/.test(yn)) values.use_signup = false;
        const r = await attempt(() => capture(interaction, 'card', 'auto', values));
        if (r.failed) return cardTools(interaction, brand, r.content);
        return open(interaction, async () => r); // /card auto already answers with the card screen
    }
    if (a === 'sc') {
        const r = await attempt(() => capture(interaction, 'card', 'schedule', { brand, date: field(interaction, 'date') }));
        return cardTools(interaction, brand, said(r));
    }
    throw new UserError('That form is from an older version of the bot. Run `/card view` again.');
}

// ================================================================== /championship (no title): list + buttons

const DIVS = Object.keys(DIVISION_LABELS);

/** The extra buttons under the champions list. */
function championshipRows() {
    return [
        row(...DIVS.slice(0, 5).map((d) => btn(`ui:cs:gs:${d}`, `🏅 Grand slam: ${clip(DIVISION_LABELS[d], 60)}`))),
        row(btn('ui:cs:cl', '🎯 #1 contenders'), btn('ui:cs:rm', '🔁 Rematches owed'))
    ];
}

async function championshipHome(interaction) {
    const titleVal = interaction.options.getString('title');
    if (titleVal) {
        const { requireTitle } = require('../utils/titleLogic');
        const title = await requireTitle(interaction.guildId, titleVal);
        await interaction.deferReply();
        return interaction.editReply(await require('./titlePanel').buildPanel(interaction.guild, title, isAdmin(interaction)));
    }
    const p = await capture(interaction, 'championship', 'list');
    return respond(interaction, { ...p, components: [...(p.components || []), ...championshipRows()].slice(0, 5), allowedMentions: NO_MENTIONS });
}

async function handleChampionship(interaction, a, b) {
    const tabs = (active) => row(...DIVS.slice(0, 5).map((d) => btn(`ui:cs:gs:${d}`, clip(DIVISION_LABELS[d], 80), d === active ? P : S)));
    if (a === 'gs') return open(interaction, async () => ({ ...await capture(interaction, 'championship', 'grand-slam', { division: b }), components: [tabs(b)] }), { backRows: [tabs(b)] });
    if (a === 'cl') return open(interaction, async () => ({ ...await capture(interaction, 'championship', 'contender-list', b ? { title: b } : {}), components: [] }));
    if (a === 'rm') return open(interaction, async () => ({ ...await capture(interaction, 'championship', 'rematches'), components: [] }));
    throw new UserError('That button is from an older version of the bot. Run `/championship` again.');
}

// ================================================================== routing

async function handle(interaction, parts) {
    const [, kind, a, b, c] = parts;
    if (kind === 'ad') return handleAdmin(interaction, a, b, c);
    if (kind === 'adm') return handleAdminForm(interaction, a, b);
    if (kind === 'bk') return handleBooking(interaction, a, b, c);
    if (kind === 'bkm') return handleBookingForm(interaction, a, b);
    if (kind === 'ct') return handleCard(interaction, a, b, c);
    if (kind === 'ctm') return handleCardForm(interaction, a, b);
    if (kind === 'cs') return handleChampionship(interaction, a, b);
    throw new UserError('That button is from an older version of the bot. Run the command again.');
}

module.exports = { KINDS, handle, adminHome, bookingHome, cardTools, championshipHome, championshipRows, signupAdd, suggestFor, EPHEMERAL };
