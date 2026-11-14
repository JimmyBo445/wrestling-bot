// Buttons and dropdowns that make the bot easy to use without remembering commands (2.20).
// Every component id starts with "ui:". Buttons that only SHOW information work for everyone;
// anything that changes data still goes through the normal admin/staff checks.
//
//   ui:h:<section>            home menu sections (/fnlw)
//   ui:l:<div>:<sort>:<page>  text roster (/directory list, home → Roster)
//   ui:w:...                  /whois: c = pick wrestler, o = who plays, p = profile card, s = stats, t = title history
//   ui:belt                   pick a title → belt card with History / Defenses / Lineage
//   ui:help                   /help category dropdown
const { ButtonStyle, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { isAdmin, respond, EPHEMERAL, getDisplayNames, DIVISION_LABELS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { rosterRows, currentTitles, activeTeams, shortTitle } = require('../utils/rosterInfo');

const { NOPING, btn, row, clip, homeRow, onPrivateMessage, show, privately, command } = require('../utils/panelKit');
const daysSince = (d) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 864e5));

// ------------------------------------------------------------------ home menu (/fnlw)

function homePayload(interaction, serverName) {
    const admin = isAdmin(interaction);
    const embed = new EmbedBuilder().setColor(0xC0392B).setTitle(`${serverName || 'FNLW'} · Home`)
        .setDescription([
            'Tap a button. Everything here is private: only you see it.',
            '',
            '🏆 **Champions** · 📅 **Next Show** · 📰 **Results** · 📈 **Standings**',
            '📋 **Roster** (plus Hall of Fame and injuries) · 🙋 **My Wrestlers** (edit yours here)',
            '📊 **Stats** for any wrestler · 🎖 **Legacy** honor roll and award votes',
            '👥 **Teams & Factions** · 🔥 **Feuds** · 🏟 **Tournaments** · 📝 **Contracts**',
            '❓ **Help**: how to use the bot',
            admin ? '🛠 **Staff Tools**: approvals, cards, titles, channels. Staff also get edit buttons inside every section.' : null
        ].filter((x) => x !== null).join('\n'));
    const rows = [
        row(btn('ui:h:champs', '🏆 Champions', ButtonStyle.Primary), btn('ui:h:show', '📅 Next Show', ButtonStyle.Primary), btn('ui:h:results', '📰 Results', ButtonStyle.Primary), btn('ui:h:stand', '📈 Standings', ButtonStyle.Primary)),
        row(btn('ui:h:roster', '📋 Roster'), btn('ui:h:mine', '🙋 My Wrestlers'), btn('ui:h:stats', '📊 Stats'), btn('ui:h:legacy', '🎖 Legacy')),
        row(btn('ui:h:teams', '👥 Teams & Factions'), btn('ui:h:feuds', '🔥 Feuds'), btn('ui:h:tourn', '🏟 Tournaments'), btn('ui:h:contract', '📝 Contracts'), btn('ui:h:help', '❓ Help'))
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
    const fans = await require('../utils/fanRatings').averages(rows.map((r) => r.id));
    embed.setFooter({ text: '⭐ = fan rating · rate a match with the ⭐ button under its result' });
    embed.setDescription(rows.map((r) => {
        const when = `<t:${Math.floor(new Date(r.created_at).getTime() / 1000)}:R>`;
        const tag = r.title_name ? ` 🏆 ${r.title_name}` : r.contender_title_name ? ` 🎯 ${r.contender_title_name}` : '';
        const res = r.result_type === 'decisive' ? `**${r.winners}** def. ${r.others}` : `${[r.winners, r.others].filter(Boolean).join(', ')} (${r.result_type === 'draw' ? 'draw' : 'no contest'})`;
        const f = fans.get(String(r.id));
        return `${matchLabel(r.match_type)}${tag}: ${res} ${when}${f ? ` · ⭐ ${f.avg}` : ''}`;
    }).join('\n').slice(0, 4000));
    return { embeds: [embed] };
}

async function staffPayload(interaction) {
    const guildId = interaction.guildId;
    const { rows: p } = await pool.query(`SELECT COUNT(*)::int AS n FROM pending_requests WHERE guild_id = $1 AND status = 'pending'`, [guildId]);
    const { rows: tzr } = await pool.query(`SELECT tz FROM guilds WHERE guild_id = $1`, [guildId]);
    const reported = await require('./reports').pendingCount(guildId);
    const unfinished = (await require('../utils/unfinished').listUnfinished(guildId, require('../utils/titleWatch').localNow(tzr[0]?.tz).date)).length;
    const embed = new EmbedBuilder().setColor(0x2ECC71).setTitle('🛠 Staff Tools').setDescription([
        `**Waiting for approval:** ${p[0].n}`,
        '',
        '**Shows:** `/card view` → the card with buttons. 🧰 More tools there: auto-build, schedule, recap, MOTN vote, clear',
        '**Signups:** `/booking signups` · **Settings and more:** `/admin panel` (🛠 Admin panel below)',
        '**Results:** `/match log` (any match type) or the 🎬 Record result button in `/card view` · `/fnlw` → Results → 🎟 tags a PLE',
        '**Legacy:** `/legacy` → 🎖 Give accolade · 🗳 Open a vote · 🏷 Award names',
        '**Titles:** `/title manage` → pick a belt: log match, contender, vacate, interim, fix reigns',
        '**People:** `/character assign` · 🛠 Staff on a wrestler (`/whois`) · `/team create`'
    ].join('\n'));
    return {
        embeds: [embed],
        components: [row(
            btn('ui:h:pending', `📥 Approvals (${p[0].n})`, ButtonStyle.Primary, p[0].n === 0),
            btn('ui:h:card:raw', '🟥 RAW card'), btn('ui:h:card:smackdown', '🟦 SmackDown card'), btn('ui:h:watch', '⏱ Title watch'), btn('ui:ch:h', '📺 Channels')),
            row(btn('ui:uf:h', `⏳ Unfinished matches (${unfinished})`, unfinished ? ButtonStyle.Danger : ButtonStyle.Secondary),
                btn('ui:rr:list', `📝 Reported results (${reported})`, reported ? ButtonStyle.Danger : ButtonStyle.Secondary),
                btn('ui:ad:h', '🛠 Admin panel', ButtonStyle.Primary), btn('ui:bk:h', '📝 Signups'))]
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
    // 3.1 sections live in hub.js
    if (require('./hub').SECTIONS.includes(section)) return require('./hub').openSection(interaction, section);

    let payload;
    if (section === 'home') payload = homePayload(interaction, interaction.guild?.name);
    else if (section === 'champs') payload = await championsPayload(guildId);
    else if (section === 'show') payload = await nextShowPayload(guildId);
    else if (section === 'results') { payload = await resultsPayload(guildId); payload.components = [...(payload.components || []), require('./screens').resultsStaffRow(interaction)]; }
    else if (section === 'roster') payload = await rosterListPayload(guildId, { division: 'all', sort: 'wrestler', page: 0, extras: true });
    else if (section === 'mine') payload = await whoisPayload(interaction, { ownerId: interaction.user.id, mine: true });
    else if (section === 'help') payload = helpPayload(interaction, 'start');
    else if (section === 'staff') payload = await staffPayload(interaction);
    else throw new UserError('That button is from an older version. Run `/fnlw` again.');
    if (section !== 'home') payload.components = [...(payload.components || []), homeRow()].slice(0, 5);
    return show(interaction, payload);
}

// ------------------------------------------------------------------ text roster with buttons

async function rosterListPayload(guildId, { division = 'all', sort = 'wrestler', page = 0, includeRetired = false, extras = false } = {}) {
    const { buildRosterList, toMessages } = require('./rosterList');
    const pages = toMessages(await buildRosterList(guildId, { division: division === 'all' ? null : division, sort, includeRetired }));
    const p = Math.min(Math.max(0, page), pages.length - 1);
    // extras = opened from the home menu: also offer the Hall of Fame and the injury report (ids end in :x)
    const id = (d, s, n) => `ui:l:${d}:${s}:${n}${extras ? ':x' : ''}`;
    const divRow = row(...[['all', 'All'], ...Object.entries(DIVISION_LABELS)].map(([d, l]) => btn(id(d, sort, 0), l, d === division ? ButtonStyle.Primary : ButtonStyle.Secondary)));
    const nav = [btn(id(division, sort === 'player' ? 'wrestler' : 'player', 0), sort === 'player' ? '🔤 A to Z' : '👥 By player')];
    if (pages.length > 1) {
        nav.push(btn(id(division, sort, p - 1), '◀', ButtonStyle.Secondary, p === 0), btn(`ui:x:${p}`, `${p + 1} / ${pages.length}`, ButtonStyle.Secondary, true), btn(id(division, sort, p + 1), '▶', ButtonStyle.Secondary, p >= pages.length - 1));
    }
    const components = [divRow, row(...nav)];
    if (extras) components.push(row(btn('ui:dr:p', '🗂 Roster cards'), btn('ui:hi:h', '🏛 Hall of Fame'), btn('ui:hi:i', '🤕 Injuries')));
    return { embeds: pages[p], components, allowedMentions: NOPING };
}

// ------------------------------------------------------------------ /whois

/** The /whois card: who plays a wrestler (or a player's list), with buttons to dig in. */
async function whoisPayload(interaction, { ownerId = null, characterId = null, mine = false, actions = true } = {}) {
    const { requireCharacter } = require('../utils/characterUtils');
    const { characterSummary } = require('../utils/statsQueries');
    const guildId = interaction.guildId;
    let reportable = 0; // 3.7: card matches this player can report
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
            const bits = [DIVISION_LABELS[c.division] || c.division, c.overall && `${c.overall} Overall`, rec, belts && `🏆 ${belts.map(shortTitle).join(', ')}`, team && `Team: ${team.join(', ')}`].filter(Boolean);
            lines.push(`${String(c.id) === String(picked?.id) ? `**${c.name}** ◀` : `**${c.name}**`}${c.status === 'retired' ? ' _(retired)_' : ''}\n${bits.join(' · ')}`);
        }
        embed.addFields({ name: picked ? `All of ${name}'s wrestlers (${chars.length})` : 'Wrestlers', value: clip(lines.join('\n\n'), 1024) });
    }
    if (mine) {
        // 3.2: matches from past cards this player still owes
        const { rows: tzr } = await pool.query(`SELECT tz FROM guilds WHERE guild_id = $1`, [guildId]);
        const U = require('../utils/unfinished');
        const owed = await U.unfinishedFor(guildId, require('../utils/titleWatch').localNow(tzr[0]?.tz).date, interaction.user.id);
        if (owed.length) embed.addFields({ name: `⏳ You have ${owed.length} unfinished match${owed.length === 1 ? '' : 'es'}`, value: clip(`${owed.map((m) => U.matchLine(m)).join('\n')}\nPlay ${owed.length === 1 ? 'it' : 'them'}, then tap **📝 Report a result** below.`, 1024) });
        reportable = (await require('./reports').reportable(guildId, interaction.user.id)).length;
    }
    embed.setFooter({ text: 'Record is with this player · pick a wrestler below for their card, stats and titles' });

    const components = [];
    if (chars.length) {
        components.push(row(new StringSelectMenuBuilder().setCustomId('ui:w:c').setPlaceholder('Pick a wrestler')
            .addOptions(chars.slice(0, 25).map((c) => ({ label: clip(c.name, 100), value: String(c.id), description: clip(`${DIVISION_LABELS[c.division]}${c.status === 'retired' ? ' · retired' : ''}`, 100), default: String(c.id) === String(picked?.id) })))));
        const focus = picked || chars[0];
        const charBtns = [btn(`ui:w:p:${focus.id}`, `🖼 ${clip(focus.name, 30)}'s card`), btn(`ui:w:s:${focus.id}`, '📊 Stats'), btn(`ui:w:t:${focus.id}`, '🏆 Title history')];
        if (mine) charBtns.push(btn('ui:rp:h', `📝 Report a result${reportable ? ` (${reportable})` : ''}`, reportable ? ButtonStyle.Primary : ButtonStyle.Secondary), btn('ui:mr:h', '📨 My requests')); // 3.7, 3.10
        components.push(row(...charBtns));
        // 3.1: the owner (or staff) can edit right here. Nobody else ever sees these buttons.
        if (actions && (String(ownerId) === String(interaction.user.id) || isAdmin(interaction))) {
            const acts = [btn(`ui:mw:e:${focus.id}`, '✏️ Edit details'), btn(`ui:mw:s:${focus.id}`, '📖 Story & moves'), btn(`ui:mw:p:${focus.id}`, '🖼 Picture'), btn(`ui:k:v:${focus.id}`, '📝 Contract')];
            if (isAdmin(interaction)) acts.push(btn(`ui:ws:v:${focus.id}`, '🛠 Staff', ButtonStyle.Danger)); // 3.5: retire, transfer, division…
            components.push(row(...acts));
        }
    }
    if (mine && !chars.length) components.push(row(btn('ui:mk:h', '🆕 Make a wrestler', ButtonStyle.Success), btn('ui:mr:h', '📨 My requests')));
    return { embeds: [embed], components, allowedMentions: NOPING };
}

/** Every title reign a wrestler has had (singles, or as part of a tag team). */
async function titleHistoryPayload(guildId, characterId) {
    const { requireCharacter } = require('../utils/characterUtils');
    const c = await requireCharacter(guildId, characterId, { statuses: ['approved', 'retired'] });
    const { rows } = await pool.query(
        `SELECT t.name, tr.won_date, tr.lost_date, tr.defenses, COALESCE(tm.name, tr.reign_char_name) AS team, (SELECT wm.ple FROM matches wm WHERE wm.id = tr.won_match_id) AS won_ple
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
        return `${r.lost_date ? '' : '🏆 '}**${r.name}**${tag}\n${fmtYmd(r.won_date)} → ${r.lost_date ? fmtYmd(r.lost_date) : 'now'} · ${days} days · ${r.defenses} def.${r.won_ple ? ` · won at ${r.won_ple}` : ''}`;
    }).join('\n\n').slice(0, 4000));
    return { embeds: [embed] };
}

// ------------------------------------------------------------------ /help categories

const HELP = {
    start: { label: 'Getting started', emoji: '👋', text: [
        '**New here?** Submit a wrestler with `/character submit`. An admin approves it.',
        '**Your card:** `/character profile` shows your wrestler\'s card.',
        '**Everything in one place:** `/fnlw` opens the home menu with buttons. `/fnlw go:` jumps to one section.',
        '**Played your card match?** `/fnlw` → 🙋 My Wrestlers → 📝 Report a result, or `/match report` (add a screenshot there). Staff approve it.',
        '**Your wrestlers:** `/fnlw` → 🙋 My Wrestlers has ✏️ Edit, 📖 Story, 🖼 Picture and 📝 Contract buttons.',
        '**Waiting on staff?** 🙋 My Wrestlers → 📨 My requests shows every request you sent, and lets you cancel one.',
        '**Who plays who:** `/whois` a wrestler, or `/directory` for the whole roster.'] },
    players: { label: 'Wrestlers & stats', emoji: '🤼', text: [
        '`/character submit` a new wrestler · `/character picture` change the picture · `/character profile` the card',
        'Edit your wrestler or their story: `/fnlw` → 🙋 My Wrestlers → ✏️ Edit / 📖 Story',
        '`/stats wrestler:` every stat as tabs (record, recent, opponents, badges, timeline, titles, 🥊 head-to-head, 📐 tape)',
        '`/stats player:` a player\'s card, with 🆚 to compare two players',
        '`/standings` power rankings, leaderboards, division rankings, season and rivalries as tabs',
        '`/booking request` ask for a match · `/booking signups` signups and 🔎 Suggest opponents',
        '`/whois` who plays a wrestler · `/directory` the whole roster',
        'Add `show_everyone:True` to share a screen with the channel (otherwise only you see it).'] },
    titles: { label: 'Titles', emoji: '🏆', text: [
        '`/championship` every title and champion, with 🏅 Grand slam, 🎯 #1 contenders and 🔁 Rematches buttons',
        '`/championship title:` one belt with buttons: 📜 History · 🛡 Defenses · 🕰 Lineage · 📚 Records · 🎯 Contenders',
        '⚔️ **Challenge for it** on a belt asks staff to make you the #1 contender',
        '`/legacy` the honor roll and award votes · `/legacy wrestler:` one wrestler\'s accolades',
        '**Award votes:** press 🙋 Nominate someone on the vote post (when it\'s open to everyone), then pick from the menu to vote'] },
    shows: { label: 'Shows & results', emoji: '📅', text: [
        '`/fnlw` → **Next Show** for the RAW and SmackDown cards',
        '`/fnlw` → **Results** for the latest matches and 🎆 PLEs',
        '`/booking signups` signups: tap the button on a signup post to say you\'re available',
        '`/tournament view` brackets · `/feud` storylines · `/directory page:Injury report` who is hurt · `/contract` contracts',
        '**Rate matches:** tap ⭐ under any result. Only the average is shown.'] },
    staff: { label: 'Staff tools', emoji: '🛠', staff: true, text: [
        '**Shows:** `/card view` shows the card with 📣 Post here and match buttons (edit, move, remove, 🎬 record, 📼 tape). 🧰 **More tools**: 🆕 New card · ⚡ Auto-build · 📨 Match requests · 📅 Schedule · 🧾 Recap · ⭐ MOTN vote · 🗑 Clear',
        '**Signups:** `/booking signups` → open, list, close, add or remove wrestlers',
        '**Results:** `/match log` (pick the type, wrestlers, winner; add `title:` for a title match) · 🛠 under a result = edit or undo · `/fnlw` → Results → 🎟 tags a PLE',
        '**Titles:** `/title manage` → a belt: 🎬 log match, 🎯 contender, 🚫 vacate, 🩹 interim, 🔗 unify, 🔁 rematches, 📜 fix any reign or defense, ➕ add an old reign · `/title belt-image`',
        '**People:** `/character assign` · 🛠 Staff on a wrestler (`/whois`): retire, restore, move division, transfer, unclaim · `/team create` · `/team view`',
        '**Legacy:** `/legacy` → 🎖 Give accolade · 🗳 Open a vote · 🏷 Award names · `/legacy wrestler:` → 🗑 Take back',
        '**Award votes:** `/legacy` → 🗳 Open a vote → 🙋 Nominate on the vote post → ▶️ Start voting → 🔒 Close vote (only the winner is announced)',
        '**Buttons:** every `/fnlw` section shows staff-only edit buttons (add/remove members, decide bracket matches, give accolades, injuries, Hall of Fame, feud moments, contracts). 🛠 under a result = edit or undo it.',
        '**Reported results:** players report their card matches; approve, fix or deny them in the staff room or 🛠 Staff Tools → 📝 Reported results.',
        '**Unfinished matches:** `/admin panel` → ⏳ Unfinished lists matches from past cards with no result, with a 📣 ping button. Daily pings: 📺 Channels.',
        '**Approvals:** `/admin pending`',
        '**Menu post:** `/admin panel` → 📌 Menu post puts a button menu for everyone in a channel (it stays at the bottom). **📈 Bot usage** shows what people use (counts only; also in the Monday staff report).',
        '**Live roster channel:** `/admin panel` → 📺 Channels → Live roster. One post per division ("Jey Uso (91 Overall) : @player") that updates itself. Set a wrestler\'s overall with 🛠 Staff on the wrestler (`/whois`) → 🔢 Set overall.',
        '**Everything else:** `/admin panel` → 📺 Channels · 📜 Rules · 👮 Staff role · 🏆 History channel · 📰 Newsletter · 📊 Staff report · 🏅 Monthly awards · 📒 Audit log · 💾 Backups. Spreadsheet import: `/admin data`.'] }
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
        const [, , division, sort, page, x] = parts;
        const payload = await rosterListPayload(interaction.guildId, { division, sort, page: Number(page) || 0, extras: x === 'x' });
        if (x === 'x') payload.components.push(homeRow());
        return show(interaction, payload);
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
        if (act === 's') return require('./hub').statsPanel(interaction, parts[3], 'ov');
        if (act === 't') {
            const payload = await titleHistoryPayload(interaction.guildId, parts[3]);
            return respond(interaction, { ...payload, flags: EPHEMERAL, allowedMentions: NOPING });
        }
    }
    if (kind === 'av') {
        // award vote: secret, one per person, can be changed until it closes
        const AV = require('../utils/awardVotes');
        const p = await AV.getPoll(interaction.guildId, parts[2]);
        if (p.vote_who === 'admins' && !isAdmin(interaction)) return respond(interaction, { content: 'Only admins and staff vote on this one.', flags: EPHEMERAL });
        const n = await AV.castVote(p, interaction.user.id, interaction.values[0]);
        return respond(interaction, { content: `🗳 Your vote for **${n.label}** is saved. It's secret, and you can change it until voting closes.`, flags: EPHEMERAL, allowedMentions: NOPING });
    }
    if (kind === 'lg') {
        const v = interaction.values?.[0];
        return show(interaction, await require('../commands/legacy').honorRoll(interaction.guildId, { kind: v === 'all' ? null : v }));
    }
    if (kind === 'sp') {
        // /stats user dropdown → that wrestler's profile card
        return command(interaction, 'character').execute(privately(interaction, 'profile', { character: interaction.values[0] }));
    }
    const hub = require('./hub');
    if (hub.KINDS.includes(kind)) return hub.handle(interaction, parts);
    const reports = require('./reports');
    if (reports.KINDS.includes(kind)) return reports.handle(interaction, parts);
    const panels = require('./staffPanels');
    if (panels.KINDS.includes(kind)) return panels.handle(interaction, parts);
    const screens = require('./screens');
    if (screens.KINDS.includes(kind)) return screens.handle(interaction, parts);
    const community = require('./community');
    if (community.KINDS.includes(kind)) return community.handle(interaction, parts);
    throw new UserError('That button is from an older version of the bot. Run the command again.');
}

module.exports = { handle, homePayload, whoisPayload, rosterListPayload, helpPayload, helpMenuRow, titleHistoryPayload, privately };
