// Buttons and dropdowns that make the bot easy to use without remembering commands (2.20).
// Every component id starts with "ui:". Buttons that only SHOW information work for everyone;
// anything that changes data still goes through the normal admin/staff checks.
//
//   ui:h:<section>            home menu sections (/fnlw)
//   ui:l:<div>:<sort>:<page>  text roster (/directory list, home → Roster)
//   ui:w:...                  /whois: c = pick wrestler, o = who plays, p = profile card, s = stats, t = title history
//   ui:belt                   pick a title → belt card with History / Defenses / Lineage
//   ui:help                   /help category dropdown
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { pool } = require('../db/pool');
const { isAdmin, respond, EPHEMERAL, NO_MENTIONS, getDisplayNames, DIVISION_LABELS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { rosterRows, currentTitles, activeTeams, shortTitle } = require('../utils/rosterInfo');

const NOPING = NO_MENTIONS;
const btn = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
const row = (...c) => new ActionRowBuilder().addComponents(...c);
const daysSince = (d) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 864e5));
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/** True when the message the button sits on is private (only the clicker sees it), so it can be updated in place. */
function onPrivateMessage(interaction) {
    const f = interaction.message?.flags;
    if (!f) return false;
    if (typeof f.has === 'function') return f.has(MessageFlags.Ephemeral);
    return Boolean(Number(f) & 64);
}

/** Shows a result: replaces a private panel in place, or answers privately under a public message (so nobody else's view changes). */
async function show(interaction, payload) {
    if (onPrivateMessage(interaction)) return interaction.update({ content: null, embeds: [], files: [], attachments: [], components: [], ...payload });
    return respond(interaction, { ...payload, flags: EPHEMERAL, allowedMentions: NOPING });
}

/**
 * Runs an existing slash command from a button, privately (so a click never posts in the channel).
 * values = the options the command would have had.
 */
function privately(interaction, sub, values = {}) {
    const get = (n) => (values[n] === undefined || values[n] === null ? null : values[n]);
    const options = {
        getSubcommand: () => sub, getSubcommandGroup: () => null,
        getString: (n) => (get(n) === null ? null : String(get(n))), getInteger: (n) => (get(n) === null ? null : Number(get(n))),
        getBoolean: (n) => (get(n) === null ? null : Boolean(get(n))), getUser: (n) => get(n), getChannel: (n) => get(n), getRole: (n) => get(n),
        getAttachment: () => null, getFocused: () => ''
    };
    const priv = (p = {}) => ({ ...p, flags: (Number(p.flags) || 0) | EPHEMERAL });
    return new Proxy(interaction, {
        get(t, p) {
            if (p === 'options') return options;
            if (p === 'reply') return (x) => t.reply(priv(x));
            if (p === 'deferReply') return (x) => t.deferReply(priv(x));
            if (p === 'followUp') return (x) => t.followUp(priv(x));
            const v = Reflect.get(t, p, t);
            return typeof v === 'function' ? v.bind(t) : v;
        }
    });
}
const command = (interaction, name) => {
    const c = interaction.client.commands.get(name);
    if (!c) throw new UserError(`The /${name} command isn't available right now.`);
    return c;
};

// ------------------------------------------------------------------ home menu (/fnlw)

const homeRow = () => row(btn('ui:h:home', '🏠 Home'));

function homePayload(interaction, serverName) {
    const admin = isAdmin(interaction);
    const embed = new EmbedBuilder().setColor(0xC0392B).setTitle(`${serverName || 'FNLW'} · Home`)
        .setDescription([
            'Tap a button. Everything here is private: only you see it.',
            '',
            '🏆 **Champions**: who holds every belt',
            '📅 **Next Show**: the RAW and SmackDown cards',
            '📰 **Results**: the latest matches',
            '📋 **Roster**: every wrestler and who plays them',
            '🙋 **My Wrestlers**: your wrestlers, records and belts',
            '❓ **Help**: how to use the bot',
            admin ? '🛠 **Staff Tools**: approvals, cards, titles, settings' : null
        ].filter((x) => x !== null).join('\n'));
    const rows = [
        row(btn('ui:h:champs', '🏆 Champions', ButtonStyle.Primary), btn('ui:h:show', '📅 Next Show', ButtonStyle.Primary), btn('ui:h:results', '📰 Results', ButtonStyle.Primary)),
        row(btn('ui:h:roster', '📋 Roster'), btn('ui:h:mine', '🙋 My Wrestlers'), btn('ui:h:help', '❓ Help'))
    ];
    if (admin) rows.push(row(btn('ui:h:staff', '🛠 Staff Tools', ButtonStyle.Success)));
    return { embeds: [embed], components: rows, allowedMentions: NOPING };
}

async function championsPayload(guildId) {
    const { rows } = await pool.query(
        `SELECT t.id, t.name, t.division, tr.won_date, tr.defenses, tr.is_interim,
                COALESCE(tm.name, c.name, tr.reign_char_name) AS holder, tr.id AS reign_id
         FROM titles t
         LEFT JOIN title_reigns tr ON tr.title_id = t.id AND tr.lost_date IS NULL
         LEFT JOIN characters c ON c.id = tr.character_id LEFT JOIN teams tm ON tm.id = tr.team_id
         WHERE t.guild_id = $1 ORDER BY t.division, t.is_tag_title, t.name`, [guildId]);
    const { rows: own } = await pool.query(
        `SELECT ro.reign_id, u.discord_id FROM reign_owners ro JOIN users u ON u.id = ro.user_id
         JOIN title_reigns tr ON tr.id = ro.reign_id WHERE tr.guild_id = $1 AND tr.lost_date IS NULL ORDER BY u.id`, [guildId]);
    const players = new Map();
    for (const o of own) players.set(String(o.reign_id), [...(players.get(String(o.reign_id)) || []), `<@${o.discord_id}>`]);
    const embed = new EmbedBuilder().setColor(0xE8BF4A).setTitle('🏆 Champions');
    for (const div of Object.keys(DIVISION_LABELS)) {
        const list = rows.filter((r) => r.division === div);
        if (!list.length) continue;
        const lines = list.map((r) => (r.reign_id
            ? `**${shortTitle(r.name)}**: ${r.holder}${players.get(String(r.reign_id)) ? ` (${players.get(String(r.reign_id)).join(' & ')})` : ''}${r.is_interim ? ' _interim_' : ''} · ${daysSince(r.won_date)}d · ${r.defenses} def.`
            : `**${shortTitle(r.name)}**: _Vacant_`));
        embed.addFields({ name: DIVISION_LABELS[div], value: clip(lines.join('\n'), 1024) });
    }
    if (!rows.length) embed.setDescription('No titles yet.');
    const components = [];
    if (rows.length) {
        components.push(row(new StringSelectMenuBuilder().setCustomId('ui:belt').setPlaceholder('Open a title: belt, history, defenses, lineage')
            .addOptions(rows.slice(0, 25).map((r) => ({ label: clip(r.name, 100), value: String(r.id), description: clip(r.reign_id ? r.holder : 'Vacant', 100) })))));
    }
    return { embeds: [embed], components };
}

async function nextShowPayload(guildId) {
    const svc = require('../utils/cardService');
    const { CARD_BRANDS } = require('../utils/constants');
    const { fmtYmd } = require('../utils/dates');
    const embed = new EmbedBuilder().setColor(0x9B59B6).setTitle('📅 Next Show');
    let any = false;
    for (const brand of Object.keys(CARD_BRANDS)) {
        const drafts = await svc.filledDrafts(guildId, brand);
        if (!drafts.length) continue;
        any = true;
        const s = await svc.getShow(guildId, brand);
        const head = `${svc.brandLabel(brand)}${s?.name ? ` “${s.name}”` : ''}${s?.show_date ? ` · ${fmtYmd(s.show_date)}` : ''}`;
        const body = await svc.describeShow(guildId, brand);
        embed.addFields({ name: clip(head, 256), value: clip(body, 1024) });
    }
    if (!any) embed.setDescription('No show card has been posted yet. Check back soon!');
    else embed.setFooter({ text: '✅ = already happened · 🏆 = title match' });
    return { embeds: [embed] };
}

async function resultsPayload(guildId) {
    const { recentMatches } = require('../utils/statsQueries');
    const { matchLabel } = require('../utils/constants');
    const rows = await recentMatches(guildId, { limit: 10 });
    const embed = new EmbedBuilder().setColor(0x3498DB).setTitle('📰 Latest Results');
    if (!rows.length) return { embeds: [embed.setDescription('No matches logged yet.')] };
    embed.setDescription(rows.map((r) => {
        const when = `<t:${Math.floor(new Date(r.created_at).getTime() / 1000)}:R>`;
        const tag = r.title_name ? ` 🏆 ${r.title_name}` : r.contender_title_name ? ` 🎯 ${r.contender_title_name}` : '';
        const res = r.result_type === 'decisive' ? `**${r.winners}** def. ${r.others}` : `${[r.winners, r.others].filter(Boolean).join(', ')} (${r.result_type === 'draw' ? 'draw' : 'no contest'})`;
        return `${matchLabel(r.match_type)}${tag}: ${res} ${when}`;
    }).join('\n').slice(0, 4000));
    return { embeds: [embed] };
}

async function staffPayload(interaction) {
    const guildId = interaction.guildId;
    const { rows: p } = await pool.query(`SELECT COUNT(*)::int AS n FROM pending_requests WHERE guild_id = $1 AND status = 'pending'`, [guildId]);
    const embed = new EmbedBuilder().setColor(0x2ECC71).setTitle('🛠 Staff Tools').setDescription([
        `**Waiting for approval:** ${p[0].n}`,
        '',
        '**Shows:** `/card auto` builds a card · `/card view` edits it · `/card post` posts it',
        '**Results:** `/match log-…` or the 🎬 Record result button in `/card view`',
        '**Titles:** `/title match` · `/title vacate` · fix history with `/title reign-add` / `reign-edit`',
        '**People:** `/character assign` · `/character transfer` · `/team create`',
        '**Settings:** `/admin channels` · `/admin rules` · `/admin staff-role` · `/admin history`'
    ].join('\n'));
    return {
        embeds: [embed],
        components: [row(
            btn('ui:h:pending', `📥 Approvals (${p[0].n})`, ButtonStyle.Primary, p[0].n === 0),
            btn('ui:h:card:raw', '🟥 RAW card'), btn('ui:h:card:smackdown', '🟦 SmackDown card'), btn('ui:h:watch', '⏱ Title watch'))]
    };
}

async function handleHome(interaction, section, arg) {
    const guildId = interaction.guildId;
    const staffOnly = ['staff', 'pending', 'card', 'watch'];
    if (staffOnly.includes(section) && !isAdmin(interaction)) return respond(interaction, { content: 'Only admins and staff can use that.', flags: EPHEMERAL });
    // these open the normal staff screens privately
    if (section === 'pending') return command(interaction, 'admin').execute(privately(interaction, 'pending'));
    if (section === 'card') return command(interaction, 'card').execute(privately(interaction, 'view', { brand: arg }));
    if (section === 'watch') return command(interaction, 'title').execute(privately(interaction, 'watch'));

    let payload;
    if (section === 'home') payload = homePayload(interaction, interaction.guild?.name);
    else if (section === 'champs') payload = await championsPayload(guildId);
    else if (section === 'show') payload = await nextShowPayload(guildId);
    else if (section === 'results') payload = await resultsPayload(guildId);
    else if (section === 'roster') payload = await rosterListPayload(guildId, { division: 'all', sort: 'wrestler', page: 0 });
    else if (section === 'mine') payload = await whoisPayload(interaction, { ownerId: interaction.user.id, mine: true });
    else if (section === 'help') payload = helpPayload(interaction, 'start');
    else if (section === 'staff') payload = await staffPayload(interaction);
    else throw new UserError('That button is from an older version. Run `/fnlw` again.');
    if (section !== 'home') payload.components = [...(payload.components || []), homeRow()].slice(0, 5);
    return show(interaction, payload);
}

// ------------------------------------------------------------------ text roster with buttons

async function rosterListPayload(guildId, { division = 'all', sort = 'wrestler', page = 0, includeRetired = false } = {}) {
    const { buildRosterList, toMessages } = require('./rosterList');
    const pages = toMessages(await buildRosterList(guildId, { division: division === 'all' ? null : division, sort, includeRetired }));
    const p = Math.min(Math.max(0, page), pages.length - 1);
    const id = (d, s, n) => `ui:l:${d}:${s}:${n}`;
    const divRow = row(...[['all', 'All'], ...Object.entries(DIVISION_LABELS)].map(([d, l]) => btn(id(d, sort, 0), l, d === division ? ButtonStyle.Primary : ButtonStyle.Secondary)));
    const nav = [btn(id(division, sort === 'player' ? 'wrestler' : 'player', 0), sort === 'player' ? '🔤 A to Z' : '👥 By player')];
    if (pages.length > 1) {
        nav.push(btn(id(division, sort, p - 1), '◀', ButtonStyle.Secondary, p === 0), btn(`ui:x:${p}`, `${p + 1} / ${pages.length}`, ButtonStyle.Secondary, true), btn(id(division, sort, p + 1), '▶', ButtonStyle.Secondary, p >= pages.length - 1));
    }
    return { embeds: pages[p], components: [divRow, row(...nav)], allowedMentions: NOPING };
}

// ------------------------------------------------------------------ /whois

/** The /whois card: who plays a wrestler (or a player's list), with buttons to dig in. */
async function whoisPayload(interaction, { ownerId = null, characterId = null, mine = false } = {}) {
    const { requireCharacter } = require('../utils/characterUtils');
    const { characterSummary } = require('../utils/statsQueries');
    const guildId = interaction.guildId;
    let picked = null;
    if (characterId) {
        picked = await requireCharacter(guildId, characterId, { statuses: ['approved', 'retired'] });
        if (picked.unclaimed) {
            return { embeds: [new EmbedBuilder().setColor(0x95A5A6).setTitle(`Who is ${picked.name}?`)
                .setDescription(`**${picked.name}** (${DIVISION_LABELS[picked.division]}) has **no player** right now. They're unclaimed.`)],
            components: [row(btn(`ui:w:p:${picked.id}`, '🖼 Profile card'), btn(`ui:w:s:${picked.id}`, '📊 Stats'), btn(`ui:w:t:${picked.id}`, '🏆 Title history'))] };
        }
        ownerId = picked.owner_discord_id;
    }
    const chars = await rosterRows(guildId, { statuses: ['approved', 'retired'], ownerDiscordId: ownerId });
    chars.sort((a, b) => (a.status === 'retired') - (b.status === 'retired'));
    const name = (await getDisplayNames(interaction.guild, [ownerId])).get(ownerId) || 'that player';
    const embed = new EmbedBuilder().setColor(0xC0392B);
    if (picked) embed.setTitle(`Who is ${picked.name}?`).setDescription(`**${picked.name}** is played by <@${ownerId}> (${name}).`);
    else if (mine) embed.setTitle('🙋 My Wrestlers').setDescription(chars.length ? `You play **${chars.length}** wrestler${chars.length === 1 ? '' : 's'}.` : 'You don\'t have any wrestlers yet. Submit one with `/character submit`.');
    else embed.setTitle(`${name}'s wrestlers`).setDescription(chars.length ? `<@${ownerId}> plays **${chars.length}** wrestler${chars.length === 1 ? '' : 's'}.` : `<@${ownerId}> doesn't have any wrestlers yet.`);

    if (chars.length) {
        const [titles, teams] = await Promise.all([currentTitles(guildId), activeTeams(guildId)]);
        const lines = [];
        for (const c of chars) {
            const s = await characterSummary(c.id, null, c.owner_id);
            const rec = `${s.wins}-${s.losses}${s.draws ? `-${s.draws}` : ''}`;
            const belts = titles.get(String(c.id));
            const team = teams.get(String(c.id));
            const bits = [DIVISION_LABELS[c.division] || c.division, rec, belts && `🏆 ${belts.map(shortTitle).join(', ')}`, team && `Team: ${team.join(', ')}`].filter(Boolean);
            lines.push(`${String(c.id) === String(picked?.id) ? `**${c.name}** ◀` : `**${c.name}**`}${c.status === 'retired' ? ' _(retired)_' : ''}\n${bits.join(' · ')}`);
        }
        embed.addFields({ name: picked ? `All of ${name}'s wrestlers (${chars.length})` : 'Wrestlers', value: clip(lines.join('\n\n'), 1024) });
    }
    embed.setFooter({ text: 'Record is with this player · pick a wrestler below for their card, stats and titles' });

    const components = [];
    if (chars.length) {
        components.push(row(new StringSelectMenuBuilder().setCustomId('ui:w:c').setPlaceholder('Pick a wrestler')
            .addOptions(chars.slice(0, 25).map((c) => ({ label: clip(c.name, 100), value: String(c.id), description: clip(`${DIVISION_LABELS[c.division]}${c.status === 'retired' ? ' · retired' : ''}`, 100), default: String(c.id) === String(picked?.id) })))));
        const focus = picked || chars[0];
        components.push(row(btn(`ui:w:p:${focus.id}`, `🖼 ${clip(focus.name, 30)}'s card`), btn(`ui:w:s:${focus.id}`, '📊 Stats'), btn(`ui:w:t:${focus.id}`, '🏆 Title history')));
    }
    return { embeds: [embed], components, allowedMentions: NOPING };
}

/** Every title reign a wrestler has had (singles, or as part of a tag team). */
async function titleHistoryPayload(guildId, characterId) {
    const { requireCharacter } = require('../utils/characterUtils');
    const c = await requireCharacter(guildId, characterId, { statuses: ['approved', 'retired'] });
    const { rows } = await pool.query(
        `SELECT t.name, tr.won_date, tr.lost_date, tr.defenses, COALESCE(tm.name, tr.reign_char_name) AS team
         FROM title_reigns tr JOIN titles t ON t.id = tr.title_id LEFT JOIN teams tm ON tm.id = tr.team_id
         WHERE (tr.team_id IS NULL AND tr.character_id = $1)
            OR EXISTS (SELECT 1 FROM title_reign_members m WHERE m.reign_id = tr.id AND m.character_id = $1)
            OR EXISTS (SELECT 1 FROM team_members tmm WHERE tmm.team_id = tr.team_id AND tmm.character_id = $1
                       AND tmm.joined_at::date <= COALESCE(tr.lost_date, CURRENT_DATE) AND (tmm.left_at IS NULL OR tmm.left_at::date >= tr.won_date))
         ORDER BY tr.won_date`, [c.id]);
    const { fmtYmd } = require('../utils/dates');
    const embed = new EmbedBuilder().setColor(0xE8BF4A).setTitle(`🏆 ${c.name}: title history`);
    if (!rows.length) return { embeds: [embed.setDescription(`${c.name} hasn't held a title yet (or the old reigns aren't linked to them yet).`)] };
    embed.setDescription(rows.map((r) => {
        const days = Math.max(0, Math.round(((r.lost_date ? new Date(r.lost_date) : new Date()) - new Date(r.won_date)) / 864e5));
        const tag = r.team && c.name !== r.team ? ` (with ${r.team})` : '';
        return `${r.lost_date ? '' : '🏆 '}**${r.name}**${tag}\n${fmtYmd(r.won_date)} → ${r.lost_date ? fmtYmd(r.lost_date) : 'now'} · ${days} days · ${r.defenses} def.`;
    }).join('\n\n').slice(0, 4000));
    return { embeds: [embed] };
}

// ------------------------------------------------------------------ /help categories

const HELP = {
    start: { label: 'Getting started', emoji: '👋', text: [
        '**New here?** Submit a wrestler with `/character submit`. An admin approves it.',
        '**Your card:** `/character profile` shows your wrestler\'s card.',
        '**Everything in one place:** `/fnlw` opens the home menu with buttons.',
        '**Who plays who:** `/whois` a wrestler, or `/directory list` for the whole roster.'] },
    players: { label: 'Wrestlers & stats', emoji: '🤼', text: [
        '`/character submit` · `edit` · `picture` · `story` for your wrestlers',
        '`/character profile` the wrestler\'s card · `/stats user` your player card',
        '`/stats character` detailed stats · `/stats head-to-head` two wrestlers',
        '`/standings rankings` division ladders · `/standings leaderboard` top lists',
        '`/booking request` ask for a match · `/booking suggest` fresh opponents',
        '`/whois` who plays a wrestler · `/directory list` the whole roster'] },
    titles: { label: 'Titles', emoji: '🏆', text: [
        '`/championship list` every champion · `/championship panel` a belt with buttons',
        '`/championship history` past champions · `lineage` the picture · `defenses`',
        '`/championship contender-list` #1 contenders · `contender-challenge` ask for a shot',
        '`/stats champions` players with the most reigns'] },
    shows: { label: 'Shows & results', emoji: '📅', text: [
        '`/fnlw` → **Next Show** for the RAW and SmackDown cards',
        '`/fnlw` → **Results** for the latest matches',
        '`/booking` signups: tap the button on a signup post to say you\'re available',
        '`/tournament bracket` · `/feud list` · `/directory injury-list`'] },
    staff: { label: 'Staff tools', emoji: '🛠', staff: true, text: [
        '**Shows:** `/card auto` · `/card view` (edit, record results) · `/card post` · `/card schedule`',
        '**Results:** `/match log-…` · `/match undo` · `/match edit`',
        '**Titles:** `/title match` · `vacate` · `contender-award` · fix history: `/title reign-add` · `reign-edit` · `reign-remove` · `add-defense`',
        '**People:** `/character assign` · `transfer` · `unclaim` · `/team create` · `/directory injury-add`',
        '**Approvals:** `/admin pending`',
        '**Settings:** `/admin channels` · `/admin rules` · `/admin staff-role` · `/admin history` · `/admin settings`'] }
};

function helpPayload(interaction, cat = 'start') {
    const admin = isAdmin(interaction);
    const key = HELP[cat] && (!HELP[cat].staff || admin) ? cat : 'start';
    const h = HELP[key];
    const embed = new EmbedBuilder().setColor(0xC0392B).setTitle(`${h.emoji} Help: ${h.label}`).setDescription(h.text.join('\n'))
        .setFooter({ text: 'Pick a topic below · /help command:<name> lists every part of one command' });
    const menu = new StringSelectMenuBuilder().setCustomId('ui:help').setPlaceholder('Pick a help topic')
        .addOptions(Object.entries(HELP).filter(([, v]) => !v.staff || admin).map(([k, v]) => ({ label: v.label, value: k, emoji: v.emoji, default: k === key })));
    return { embeds: [embed], components: [row(menu)] };
}
const helpMenuRow = (interaction) => helpPayload(interaction).components[0];

// ------------------------------------------------------------------ button router

async function handle(interaction) {
    const id = interaction.customId;
    const parts = id.split(':');
    const kind = parts[1];

    if (kind === 'h') return handleHome(interaction, parts[2], parts[3]);

    if (kind === 'l') {
        const [, , division, sort, page] = parts;
        return show(interaction, await rosterListPayload(interaction.guildId, { division, sort, page: Number(page) || 0 }));
    }

    if (kind === 'belt') {
        const { requireTitle } = require('../utils/titleLogic');
        const title = await requireTitle(interaction.guildId, interaction.values[0]);
        await interaction.deferReply({ flags: EPHEMERAL });
        return interaction.editReply(await require('./titlePanel').buildPanel(interaction.guild, title, isAdmin(interaction)));
    }

    if (kind === 'help') {
        const payload = helpPayload(interaction, interaction.values?.[0]);
        if (onPrivateMessage(interaction)) {
            // keep the Home button when this help came from the home menu
            const fromHome = (interaction.message?.components || []).some((r) => (r.components || []).some((c) => (c.customId || c.data?.custom_id) === 'ui:h:home'));
            if (fromHome) payload.components.push(homeRow());
        }
        return show(interaction, payload);
    }

    if (kind === 'w') {
        const act = parts[2];
        if (act === 'c' || act === 'o') {
            const characterId = act === 'c' ? interaction.values[0] : parts[3];
            return show(interaction, await whoisPayload(interaction, { characterId }));
        }
        if (act === 'p') return command(interaction, 'character').execute(privately(interaction, 'profile', { character: parts[3] }));
        if (act === 's') return command(interaction, 'stats').execute(privately(interaction, 'character', { character: parts[3] }));
        if (act === 't') {
            const payload = await titleHistoryPayload(interaction.guildId, parts[3]);
            return respond(interaction, { ...payload, flags: EPHEMERAL, allowedMentions: NOPING });
        }
    }
    if (kind === 'sp') {
        // /stats user dropdown → that wrestler's profile card
        return command(interaction, 'character').execute(privately(interaction, 'profile', { character: interaction.values[0] }));
    }
    throw new UserError('That button is from an older version of the bot. Run the command again.');
}

module.exports = { handle, homePayload, whoisPayload, rosterListPayload, helpPayload, helpMenuRow, titleHistoryPayload, privately };
