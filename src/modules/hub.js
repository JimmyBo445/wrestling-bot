// 3.1 panels: one place to LOOK at everything, with edit buttons only for the people allowed to use them.
// Everyone can browse. Staff (admins + the staff role) also see Add / Remove / Rename / Undo... buttons,
// and every edit runs through the normal command, so all its usual checks still apply.
// Wrestlers' owners get Edit buttons for their own wrestlers (My Wrestlers / whois).
//
//   ui:pk / ui:pg   pick a wrestler (dropdown, pages, divisions) for any of the panels below
//   ui:sx           stats for one wrestler          ui:sd   standings (leaderboards, rankings, power, season, rivalries)
//   ui:lx           Legacy honor roll + votes       ui:tf   teams & factions
//   ui:tn           tournaments + bracket buttons   ui:m    buttons under a match result (rate / staff)
//   ui:k            contracts                       ui:mw   edit my wrestler (owner or staff)
//   ui:fd           feuds                           ui:ch   bot channels (staff)
//   ui:hi           Hall of Fame + injuries         ui:md   pop-up forms (modals) sent back
const {
    StringSelectMenuBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelSelectMenuBuilder, ChannelType, ActionRowBuilder, AttachmentBuilder
} = require('discord.js');
const { pool } = require('../db/pool');
const { isAdmin, requireAdmin, respond, EPHEMERAL, DIVISION_LABELS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { NOPING, btn, row, clip, homeRow, onPrivateMessage, show, capture, open, withNotice, ButtonStyle } = require('../utils/panelKit');

const SECTIONS = ['stand', 'stats', 'legacy', 'teams', 'feuds', 'tourn', 'contract'];
const KINDS = ['pk', 'pg', 'sx', 'sd', 'lx', 'tf', 'tn', 'm', 'k', 'mw', 'fd', 'ch', 'hi', 'md', 'uf'];
const P = ButtonStyle.Primary, S = ButtonStyle.Secondary, G = ButtonStyle.Success, D = ButtonStyle.Danger;
const tab = (id, label, active) => btn(id, label, active ? P : S);
const thisYear = () => new Date().getFullYear();
const select = (id, placeholder, options) => row(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).addOptions(options.slice(0, 25)));
const asError = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { if (e instanceof UserError) return { content: `⚠️ ${e.message}` }; throw e; } };

/** Rows plus a Home button (unless one is already there), at most 5 rows. */
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

/** Posts a copy of a command's answer in the channel (for things everyone should see: offers, inductions, brackets). */
async function postPublic(interaction, payload) {
    const files = (payload.files || []).map((f) => (f.attachment ? new AttachmentBuilder(f.attachment, { name: f.name }) : f));
    const { flags, ...rest } = payload; // eslint-disable-line no-unused-vars
    const ch = interaction.channel;
    if (!ch?.send) throw new UserError('I can\'t post in this channel.');
    try { await ch.send({ ...rest, files }); } catch (_) { throw new UserError('I couldn\'t post in this channel. Check I\'m allowed to send messages here.'); }
    return ch.id;
}

// ================================================================== pick a wrestler

const ALL = ['approved', 'retired'];
const PURPOSES = {
    st: { title: '📊 Stats: pick a wrestler', statuses: ALL, back: () => 'ui:h:home' },
    hh: { title: '🥊 Head-to-head: pick the other wrestler', statuses: ALL, back: (a) => `ui:sx:${a}:ov` },
    tp: { title: '📐 Tale of the tape: pick the other wrestler', statuses: ALL, back: (a) => `ui:sx:${a}:ov` },
    lg: { title: '🎖 Whose Legacy?', statuses: ALL, back: () => 'ui:lx:r:all:all' },
    lga: { title: '🎖 Give an accolade: pick the winner', statuses: ALL, staff: true, back: () => 'ui:lx:r:all:all' },
    'tm+': { title: '➕ Add a wrestler to the team', statuses: ['approved'], staff: true, lock: true, back: (a) => `ui:tf:v:t:${a}` },
    'fc+': { title: '➕ Add a wrestler to the faction', statuses: ['approved'], staff: true, lock: true, back: (a) => `ui:tf:v:f:${a}` },
    'tn+': { title: '➕ Add a wrestler to the tournament', statuses: ['approved'], staff: true, lock: true, back: (a) => `ui:tn:v:${a}` },
    fd1: { title: '🔥 New feud: pick the first wrestler', statuses: ['approved'], staff: true, back: () => 'ui:fd:l' },
    fd2: { title: '🔥 New feud: pick their rival', statuses: ['approved'], staff: true, back: () => 'ui:fd:l' },
    hof: { title: '🏛 Induct into the Hall of Fame', statuses: ALL, staff: true, back: () => 'ui:hi:h' },
    inj: { title: '🤕 Who is injured?', statuses: ['approved'], staff: true, back: () => 'ui:hi:i' },
    ko: { title: '📨 Offer a contract to…', statuses: ['approved'], staff: true, back: () => 'ui:k:h' }
};

async function pickerPayload(interaction, purpose, arg = '0', div = 'all', page = 0) {
    const cfg = PURPOSES[purpose];
    if (!cfg) throw new UserError('That button is from an older version. Run `/fnlw` again.');
    if (cfg.staff) requireAdmin(interaction, 'do that');
    const division = div === 'all' ? null : div;
    const params = [interaction.guildId, cfg.statuses, division];
    const { rows: cnt } = await pool.query(`SELECT COUNT(*)::int AS n FROM characters WHERE guild_id = $1 AND status = ANY($2::text[]) AND ($3::text IS NULL OR division = $3)`, params);
    const total = cnt[0].n;
    const pages = Math.max(1, Math.ceil(total / 25));
    const p = Math.min(Math.max(0, Number(page) || 0), pages - 1);
    const { rows } = await pool.query(
        `SELECT c.id, c.name, c.division, c.status FROM characters c
         WHERE c.guild_id = $1 AND c.status = ANY($2::text[]) AND ($3::text IS NULL OR c.division = $3)
         ORDER BY lower(c.name), c.id LIMIT 25 OFFSET $4`, [...params, p * 25]);
    const embed = new EmbedBuilder().setColor(0xC0392B).setTitle(cfg.title)
        .setDescription(total ? `${total} wrestler${total === 1 ? '' : 's'}${division ? ` in ${DIVISION_LABELS[division]}` : ''}. Pick one from the list${pages > 1 ? ' (◀ ▶ for more)' : ''}.` : 'There are no wrestlers to pick here.');
    const components = [];
    if (!cfg.lock) components.push(row(...[['all', 'All'], ...Object.entries(DIVISION_LABELS)].map(([d, l]) => tab(`ui:pg:${purpose}:${arg}:${d}:0`, l, d === div))));
    if (rows.length) {
        components.push(select(`ui:pk:${purpose}:${arg}`, 'Pick a wrestler', rows.map((c) => ({ label: clip(c.name, 100), value: String(c.id),
            description: clip(`${DIVISION_LABELS[c.division] || c.division}${c.status === 'retired' ? ' · retired' : ''}`, 100) }))));
    }
    const nav = [];
    if (pages > 1) {
        nav.push(btn(`ui:pg:${purpose}:${arg}:${div}:${p - 1}`, '◀', S, p === 0), btn(`ui:x:pg`, `${p + 1} / ${pages}`, S, true), btn(`ui:pg:${purpose}:${arg}:${div}:${p + 1}`, '▶', S, p >= pages - 1));
    }
    const back = cfg.back(arg);
    if (back !== 'ui:h:home') nav.push(btn(back, '◀ Back'));
    if (nav.length) components.push(row(...nav));
    return { embeds: [embed], components: withHome(components) };
}

async function onPick(interaction, purpose, arg, id) {
    const cfg = PURPOSES[purpose];
    if (!cfg) throw new UserError('That button is from an older version. Run `/fnlw` again.');
    if (cfg.staff) requireAdmin(interaction, 'do that');
    if (purpose === 'st') return statsPanel(interaction, id, 'ov');
    if (purpose === 'hh' || purpose === 'tp') return statsPanel(interaction, arg, purpose, id);
    if (purpose === 'lg') {
        return open(interaction, async () => ({ ...await capture(interaction, 'legacy', 'view', { character: id }), components: withHome([row(btn('ui:pg:lg:0:all:0', '🔎 Another wrestler'), btn('ui:lx:r:all:all', '◀ Honor roll'))]) }));
    }
    if (purpose === 'lga') return open(interaction, () => accoladePick(interaction, id), { backRows: [row(btn('ui:lx:r:all:all', '◀ Honor roll'))] });
    if (purpose === 'tm+' || purpose === 'fc+') {
        const t = purpose === 'tm+' ? 't' : 'f';
        return groupAction(interaction, t, arg, () => capture(interaction, t === 't' ? 'team' : 'faction', 'add-member', { [t === 't' ? 'team' : 'faction']: arg, character: id }));
    }
    if (purpose === 'tn+') return tournamentAction(interaction, arg, () => capture(interaction, 'tournament', 'add', { tournament: arg, wrestler1: id }));
    if (purpose === 'fd1') return show(interaction, await pickerPayload(interaction, 'fd2', id));
    if (purpose === 'fd2') {
        if (String(arg) === String(id)) throw new UserError('Pick two different wrestlers.');
        return interaction.showModal(modal(`ui:md:fds:${arg}:${id}`, 'Start a feud', [
            { id: 'name', label: 'Feud name (empty = their two names)', max: 60 },
            { id: 'story', label: 'What started it? (optional)', long: true, max: 300 }]));
    }
    if (purpose === 'hof') {
        return interaction.showModal(modal(`ui:md:hof:${id}`, 'Hall of Fame induction', [{ id: 'blurb', label: 'A line about their legacy (optional)', long: true, max: 180 }]));
    }
    if (purpose === 'inj') {
        return interaction.showModal(modal(`ui:md:inj:${id}`, 'Injury', [
            { id: 'days', label: 'How many days are they out? (1-365)', required: true, max: 3, placeholder: '14' },
            { id: 'reason', label: 'Reason (optional)', max: 60, placeholder: 'Torn ACL, kayfabe injury…' }]));
    }
    if (purpose === 'ko') return interaction.showModal(contractModal(`ui:md:ko:${id}`, 'Offer a contract'));
    throw new UserError('That button is from an older version. Run `/fnlw` again.');
}

// ================================================================== stats for one wrestler

const STAT_VIEWS = [['ov', '📊 Overview'], ['hi', '📜 Recent'], ['op', '🆚 Opponents'], ['bd', '🏅 Badges'], ['tl', '🕰 Timeline'],
    ['ti', '🏆 Titles'], ['lg', '🎖 Legacy'], ['pc', '🖼 Card'], ['hh', '🥊 Head-to-head'], ['tp', '📐 Tale of the tape']];

function statsRows(charId, view) {
    const b = ([k, label]) => tab(`ui:sx:${charId}:${k}`, label, k === view);
    return [row(...STAT_VIEWS.slice(0, 5).map(b)), row(...STAT_VIEWS.slice(5).map(b)), row(btn('ui:pg:st:0:all:0', '🔄 Another wrestler'), homeRow().components[0])];
}

async function statsPanel(interaction, charId, view = 'ov', other = null) {
    if ((view === 'hh' || view === 'tp') && !other) return open(interaction, () => pickerPayload(interaction, view, charId));
    const rows = statsRows(charId, view);
    return open(interaction, async () => {
        const { requireCharacter } = require('../utils/characterUtils');
        const c = await requireCharacter(interaction.guildId, charId, { statuses: ALL });
        let p;
        if (view === 'ov') p = await capture(interaction, 'stats', 'character', { character: c.id });
        else if (view === 'hi') p = await capture(interaction, 'stats', 'history', { character: c.id, count: 10 });
        else if (view === 'op') p = await capture(interaction, 'stats', 'opponents', { character: c.id });
        else if (view === 'bd') p = await capture(interaction, 'stats', 'badges', { character: c.id });
        else if (view === 'tl') p = await capture(interaction, 'stats', 'timeline', { character: c.id });
        else if (view === 'ti') p = await require('./menus').titleHistoryPayload(interaction.guildId, c.id);
        else if (view === 'lg') p = await capture(interaction, 'legacy', 'view', { character: c.id });
        else if (view === 'pc') p = await capture(interaction, 'character', 'profile', { character: c.id });
        else if (view === 'hh') p = await capture(interaction, 'stats', 'head-to-head', { character1: c.id, character2: other });
        else if (view === 'tp') p = await capture(interaction, 'stats', 'tape', { character1: c.id, character2: other });
        else throw new UserError('That button is from an older version. Run `/fnlw` again.');
        return { ...p, components: rows };
    }, { backRows: rows });
}

// ================================================================== standings

const STAND_TABS = [['lb', '📊 Leaderboards'], ['rk', '📈 Rankings'], ['pw', '⚡ Power'], ['ss', '📅 Season'], ['rv', '🔥 Rivalries']];
const divButtons = (prefix, current, withAll) => row(...[...(withAll ? [['all', 'All']] : []), ...Object.entries(DIVISION_LABELS)].map(([d, l]) => tab(`${prefix}:${d}`, l, d === current)));

async function standingsPanel(interaction, view = 'pw', a = null, b = null) {
    const tabs = row(...STAND_TABS.map(([k, l]) => tab(`ui:sd:${k}`, l, k === view || (view === 'sr' && k === 'ss') || (view === 'ch' && k === 'lb'))));
    return open(interaction, async () => {
        const guildId = interaction.guildId;
        if (view === 'lb' || view === 'ch') {
            const { buildLeaderboardEmbed, CATEGORY_LABELS } = require('../utils/leaderboardQueries');
            const { PERIOD_LABELS } = require('../utils/statsQueries');
            const cat = CATEGORY_LABELS[a] ? a : 'win_pct';
            const period = PERIOD_LABELS[b] ? b : 'all';
            const p = view === 'ch' ? await capture(interaction, 'stats', 'champions') : { embeds: [await buildLeaderboardEmbed(guildId, cat, period)] };
            return { ...p, components: [tabs,
                select(`ui:sd:lc:${period}`, 'Leaderboard category', Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ label, value, default: view === 'lb' && value === cat }))),
                select(`ui:sd:lp:${cat}`, 'Time period', Object.entries(PERIOD_LABELS).map(([value, label]) => ({ label, value, default: value === period }))),
                row(tab('ui:sd:ch', '👑 Most decorated players', view === 'ch'), homeRow().components[0])] };
        }
        if (view === 'rk') {
            const div = DIVISION_LABELS[a] ? a : 'mens';
            const p = await require('./rankings').rankingsPayload(interaction.guild, div);
            return { ...p, components: withHome([tabs, divButtons('ui:sd:rk', div, false)]) };
        }
        if (view === 'pw') {
            const div = DIVISION_LABELS[a] ? a : 'all';
            const { powerEmbed } = require('../utils/powerRankings');
            const { weekKey } = require('../utils/newsletter');
            const embeds = [];
            for (const d of div === 'all' ? Object.keys(DIVISION_LABELS) : [div]) embeds.push((await powerEmbed(guildId, d, weekKey())).embed);
            return { embeds, components: withHome([tabs, divButtons('ui:sd:pw', div, true)]) };
        }
        if (view === 'ss' || view === 'sr') {
            const y = Number(a) || thisYear();
            const years = [thisYear(), thisYear() - 1, thisYear() - 2];
            const yrRow = row(...years.map((x) => tab(`ui:sd:ss:${x}`, String(x), view === 'ss' && x === y)), tab(`ui:sd:sr:${y}`, `🖼 ${y} recap picture`, view === 'sr'));
            const p = await asError(() => capture(interaction, 'standings', view === 'ss' ? 'season-standings' : 'season-recap', { year: y }))();
            return { ...p, components: withHome([tabs, yrRow]) };
        }
        if (view === 'rv') {
            const period = ['all', '30d', '90d', '365d'].includes(a) ? a : 'all';
            const p = await asError(() => capture(interaction, 'stats', 'rivalries', { period }))();
            const { PERIOD_LABELS } = require('../utils/statsQueries');
            return { ...p, components: withHome([tabs, row(...Object.entries(PERIOD_LABELS).map(([k, l]) => tab(`ui:sd:rv:${k}`, l, k === period)))]) };
        }
        throw new UserError('That button is from an older version. Run `/fnlw` again.');
    }, { backRows: [tabs] });
}

// ================================================================== Legacy

async function legacyPanel(interaction, kind = 'all', year = 'all', notice = null) {
    return open(interaction, async () => {
        const L = require('../utils/legacy');
        const k = L.KINDS[kind] ? kind : null;
        const y = /^\d{4}$/.test(String(year)) ? Number(year) : null;
        const p = await require('../commands/legacy').honorRoll(interaction.guildId, { kind: k, year: y });
        const { rows: yrs } = await pool.query(`SELECT DISTINCT year FROM legacy WHERE guild_id = $1 ORDER BY year DESC LIMIT 4`, [interaction.guildId]);
        const { rows: polls } = await pool.query(`SELECT COUNT(*)::int AS n FROM award_polls WHERE guild_id = $1 AND status IN ('nominating','voting')`, [interaction.guildId]);
        const kindOpts = [{ label: 'All accolades', value: 'all', default: !k }, ...Object.entries(L.KINDS).map(([v, x]) => ({ label: x.label, value: v, default: v === k }))];
        const components = [select(`ui:lx:k:${y || 'all'}`, 'Show one accolade', kindOpts)];
        if (yrs.length) components.push(row(tab(`ui:lx:r:${k || 'all'}:all`, 'All years', !y), ...yrs.map((r) => tab(`ui:lx:r:${k || 'all'}:${r.year}`, String(r.year), r.year === y))));
        const actions = [btn('ui:pg:lg:0:all:0', '🔎 Look up a wrestler'), btn('ui:lx:v', `🗳 Votes (${polls[0].n} open)`)];
        if (isAdmin(interaction)) actions.push(btn('ui:pg:lga:0:all:0', '🎖 Give accolade', G));
        components.push(row(...actions));
        return withNotice({ ...p, components: withHome(components) }, notice);
    });
}

async function votesPanel(interaction) {
    return open(interaction, async () => {
        const AV = require('../utils/awardVotes');
        const { rows } = await pool.query(`SELECT * FROM award_polls WHERE guild_id = $1 AND status IN ('nominating','voting') ORDER BY id DESC LIMIT 20`, [interaction.guildId]);
        const embed = new EmbedBuilder().setColor(0xE8BF4A).setTitle('🗳 Award votes')
            .setDescription(rows.length ? rows.map((p) => `**${AV.pollName(p)}**: ${p.status === 'voting' ? 'voting is open' : 'taking nominations'}`).join('\n')
                : 'No votes are open right now.')
            .setFooter({ text: 'Votes are secret. Only the winner is announced.' });
        const components = [];
        if (rows.length) components.push(select('ui:lx:vp', 'Open a vote', rows.map((p) => ({ label: clip(AV.pollName(p), 100), value: String(p.id), description: p.status === 'voting' ? 'Vote now' : 'Nominations' }))));
        components.push(row(btn('ui:lx:r:all:all', '◀ Honor roll')));
        return { embeds: [embed], components: withHome(components) };
    });
}

async function votePanel(interaction, pollId) {
    return open(interaction, async () => {
        const AV = require('../utils/awardVotes');
        const p = await AV.getPoll(interaction.guildId, pollId);
        const payload = p.status === 'voting' ? await AV.votingPayload(p) : await AV.nominationsPayload(p);
        return { ...payload, components: withHome([...(payload.components || []), row(btn('ui:lx:v', '◀ All votes'))]) };
    });
}

/** Staff: which accolade did this wrestler win? */
async function accoladePick(interaction, charId) {
    requireAdmin(interaction, 'give accolades');
    const L = require('../utils/legacy');
    const { requireCharacter } = require('../utils/characterUtils');
    const c = await requireCharacter(interaction.guildId, charId, { statuses: ALL });
    const names = await L.awardNames(interaction.guildId);
    const opts = [['mitb', 'Money in the Bank'], ['rumble', 'Royal Rumble'], ['mvp', 'Face of FNLW MVP'], ...names.slice(0, 22).map((n, i) => [`a${i}`, n])];
    return {
        embeds: [new EmbedBuilder().setColor(0xE8BF4A).setTitle(`🎖 Give ${c.name} an accolade`).setDescription('Pick the accolade. Next you pick the year and whether to announce it.')],
        components: withHome([select(`ui:lx:ga:${c.id}`, 'Which accolade?', opts.map(([value, label]) => ({ label: clip(label, 100), value }))), row(btn('ui:pg:lga:0:all:0', '◀ Another wrestler'))])
    };
}

// ================================================================== teams & factions

const GROUP = { t: { cmd: 'team', opt: 'team', label: 'Tag Teams', one: 'team', table: 'teams' }, f: { cmd: 'faction', opt: 'faction', label: 'Factions', one: 'faction', table: 'factions' } };

async function groupList(interaction, t = 't', notice = null) {
    const g = GROUP[t] || GROUP.t;
    return open(interaction, async () => {
        const p = await capture(interaction, g.cmd, 'list');
        const { rows } = await pool.query(`SELECT id, name, division FROM ${g.table} WHERE guild_id = $1 AND status = 'active' ORDER BY lower(name) LIMIT 25`, [interaction.guildId]);
        const components = [row(tab('ui:tf:l:t', '👥 Tag Teams', t === 't'), tab('ui:tf:l:f', '🛡 Factions', t === 'f'))];
        if (rows.length) components.push(select(`ui:tf:o:${t}`, `Open a ${g.one}`, rows.map((r) => ({ label: clip(r.name, 100), value: String(r.id), description: DIVISION_LABELS[r.division] }))));
        if (isAdmin(interaction)) p.content = [p.content, `_New ${g.one}s: \`/${g.cmd} create\`_`].filter(Boolean).join('\n');
        return withNotice({ ...p, components: withHome(components) }, notice);
    });
}

async function groupMembers(t, id) {
    if (t === 't') return require('../utils/teamUtils').getTeamMembers(id);
    return require('../utils/factionUtils').getFactionMembers(id);
}

async function groupView(interaction, t, id, notice = null) {
    const g = GROUP[t] || GROUP.t;
    const back = row(btn(`ui:tf:l:${t}`, `◀ All ${g.label.toLowerCase()}`));
    return open(interaction, async () => {
        const p = await capture(interaction, g.cmd, 'profile', { [g.opt]: id });
        const { rows } = await pool.query(`SELECT * FROM ${g.table} WHERE id = $1 AND guild_id = $2`, [id, interaction.guildId]);
        const grp = rows[0];
        const components = [];
        if (isAdmin(interaction) && grp?.status === 'active') {
            const staff = [btn(`ui:pg:${t === 't' ? 'tm+' : 'fc+'}:${id}:${grp.division}:0`, '➕ Add member', G), btn(`ui:tf:rm:${t}:${id}`, '➖ Remove member')];
            if (t === 't') staff.push(btn(`ui:tf:rn:${id}`, '✏️ Rename'));
            staff.push(btn(`ui:tf:dq:${t}:${id}`, '💔 Disband', D));
            components.push(row(...staff));
        }
        components.push(back);
        return withNotice({ ...p, components: withHome(components) }, notice);
    }, { backRows: [back] });
}

/** Runs a staff change, then shows the team/faction again with what happened on top. */
async function groupAction(interaction, t, id, run) {
    requireAdmin(interaction, 'change teams and factions');
    let notice;
    try { notice = (await run()).content || '✅ Done.'; } catch (e) { if (!(e instanceof UserError)) throw e; notice = `⚠️ ${e.message}`; }
    const { rows } = await pool.query(`SELECT status FROM ${GROUP[t].table} WHERE id = $1`, [id]);
    if (rows[0]?.status !== 'active') return groupList(interaction, t, notice);
    return groupView(interaction, t, id, notice);
}

// ================================================================== tournaments

async function tournamentList(interaction, notice = null) {
    return open(interaction, async () => {
        const p = await asError(() => capture(interaction, 'tournament', 'list'))();
        const { rows } = await pool.query(`SELECT id, name, status FROM tournaments WHERE guild_id = $1 AND status <> 'cancelled' ORDER BY id DESC LIMIT 25`, [interaction.guildId]);
        const components = [];
        if (rows.length) components.push(select('ui:tn:o', 'Open a tournament', rows.map((r) => ({ label: clip(r.name, 100), value: String(r.id), description: r.status === 'signup' ? 'Not started' : r.status === 'active' ? 'In progress' : 'Finished' }))));
        if (isAdmin(interaction)) p.content = [p.content, '_New tournaments: `/tournament create`_'].filter(Boolean).join('\n');
        return withNotice({ ...p, components: withHome(components) }, notice);
    });
}

async function tournamentView(interaction, id, notice = null) {
    const back = row(btn('ui:tn:l', '◀ All tournaments'));
    return open(interaction, async () => {
        const T = require('../utils/tournamentUtils');
        const tour = await T.requireTournament(interaction.guildId, id);
        const p = await capture(interaction, 'tournament', 'bracket', { tournament: tour.id });
        const components = [];
        if (isAdmin(interaction)) {
            if (tour.status === 'signup') {
                components.push(row(btn(`ui:pg:tn+:${tour.id}:${tour.division}:0`, '➕ Add wrestler', G), btn(`ui:tn:rm:${tour.id}`, '➖ Remove wrestler'),
                    btn(`ui:tn:sq:${tour.id}`, '▶️ Start (draw the bracket)', P), btn(`ui:tn:cq:${tour.id}`, '✖ Cancel', D)));
            } else if (tour.status === 'active') {
                components.push(row(btn(`ui:tn:d:${tour.id}:0`, '🏁 Decide a match', P), btn(`ui:tn:post:${tour.id}`, '📣 Post bracket here'), btn(`ui:tn:cq:${tour.id}`, '✖ Cancel', D)));
            } else {
                components.push(row(btn(`ui:tn:post:${tour.id}`, '📣 Post bracket here')));
            }
        }
        if (tour.status === 'active') p.content = [p.content, '_Matches logged with `/match log` or your card move the bracket by themselves._'].filter(Boolean).join('\n');
        components.push(back);
        return withNotice({ ...p, components: withHome(components) }, notice);
    }, { backRows: [back] });
}

async function tournamentAction(interaction, id, run) {
    requireAdmin(interaction, 'run tournaments');
    let notice;
    try { notice = (await run()).content || '✅ Done.'; } catch (e) { if (!(e instanceof UserError)) throw e; notice = `⚠️ ${e.message}`; }
    return tournamentView(interaction, id, notice);
}

/** Staff: the undecided bracket matches, each with a button per wrestler. */
async function decidePanel(interaction, id, page = 0) {
    requireAdmin(interaction, 'decide bracket matches');
    return open(interaction, async () => {
        const T = require('../utils/tournamentUtils');
        const tour = await T.requireTournament(interaction.guildId, id, { statuses: ['active'] });
        const { rows } = await pool.query(
            `SELECT tm.id, tm.round, tm.slot, a.name AS a, b.name AS b FROM tournament_matches tm
             JOIN characters a ON a.id = tm.a_id JOIN characters b ON b.id = tm.b_id
             WHERE tm.tournament_id = $1 AND tm.winner_id IS NULL ORDER BY tm.round, tm.slot`, [tour.id]);
        const per = 3;
        const pages = Math.max(1, Math.ceil(rows.length / per));
        const pg = Math.min(Math.max(0, Number(page) || 0), pages - 1);
        const list = rows.slice(pg * per, pg * per + per);
        const embed = new EmbedBuilder().setColor(0xE8BF4A).setTitle(`🏁 ${tour.name}: decide a match`)
            .setDescription(rows.length ? `Tap who **advances**. Use this for forfeits and walkovers, or results you didn't log as a match.\n\n${list.map((m) => `**Round ${m.round}, match ${m.slot}:** ${m.a} vs ${m.b}`).join('\n')}`
                : 'No bracket matches are waiting right now. The next round fills in as matches are decided.');
        const components = list.map((m) => row(btn(`ui:tn:w:${tour.id}:${m.id}:1`, clip(`R${m.round} M${m.slot}: ${m.a} advances`, 80), G), btn(`ui:tn:w:${tour.id}:${m.id}:2`, clip(`${m.b} advances`, 80), G)));
        const nav = [btn(`ui:tn:v:${tour.id}`, '◀ Bracket')];
        if (pages > 1) nav.push(btn(`ui:tn:d:${tour.id}:${pg - 1}`, '◀', S, pg === 0), btn(`ui:tn:d:${tour.id}:${pg + 1}`, '▶', S, pg >= pages - 1));
        components.push(row(...nav));
        return { embeds: [embed], components: withHome(components) };
    });
}

// ================================================================== match result buttons

async function ratePanel(interaction, matchId, notice = null) {
    const FR = require('../utils/fanRatings');
    const [avg, mine] = [(await FR.averages([matchId])).get(String(matchId)), await FR.mine(matchId, interaction.user.id)];
    const embed = new EmbedBuilder().setColor(0xE8BF4A).setTitle(`⭐ Rate match #${matchId}`)
        .setDescription([avg ? `Fans: **⭐ ${avg.avg}** from ${avg.votes} rating${avg.votes === 1 ? '' : 's'}` : 'Nobody has rated it yet.',
            mine ? `Your rating: ${'⭐'.repeat(mine)}. Tap again to change it.` : 'Tap how many stars you give it. Only the average is shown.'].join('\n'));
    const payload = withNotice({ embeds: [embed], components: [row(...[1, 2, 3, 4, 5].map((n) => btn(`ui:m:rv:${matchId}:${n}`, '⭐'.repeat(n), n === mine ? P : S)))] }, notice);
    return show(interaction, payload);
}

async function matchStaffPanel(interaction, matchId, msgId, notice = null) {
    requireAdmin(interaction, 'edit or undo matches');
    const { rows } = await pool.query(`SELECT id, notes, stipulation, score FROM matches WHERE id = $1 AND guild_id = $2`, [matchId, interaction.guildId]);
    if (!rows[0]) return show(interaction, { content: `${notice ? `${notice}\n` : ''}Match #${matchId} isn't on record anymore (it was undone).`, components: [] });
    const m = rows[0];
    const embed = new EmbedBuilder().setColor(0x2ECC71).setTitle(`🛠 Match #${matchId}`)
        .setDescription([m.stipulation ? `Stipulation: ${m.stipulation}` : null, m.score ? `Score: ${m.score}` : null, m.notes ? `Notes: ${m.notes}` : null,
            '', 'To change the winner or the finish use `/match edit`. Title matches can only be undone and logged again.'].filter((x) => x !== null).join('\n'));
    return show(interaction, withNotice({ embeds: [embed], components: [row(btn(`ui:m:e:${matchId}`, '✏️ Edit notes / stipulation / score'), btn(`ui:m:u:${matchId}:${msgId || '0'}`, '↩️ Undo match', D))] }, notice));
}

// ================================================================== contracts

function contractModal(id, title, k = null) {
    return modal(id, title, [
        { id: 'months', label: 'Length in months (1-36)', required: true, max: 2, value: k?.months, placeholder: '12' },
        { id: 'salary', label: 'Pay per month in dollars', required: true, max: 10, value: k?.salary, placeholder: '50000' },
        { id: 'clauses', label: 'Special terms (optional)', max: 150, value: k?.clauses, placeholder: 'Main event guarantee' }]);
}
const contractValues = (interaction) => {
    const months = Number(field(interaction, 'months')), salary = Number(field(interaction, 'salary').replace(/[$,\s]/g, ''));
    if (!Number.isInteger(months) || months < 1 || months > 36) throw new UserError('Months must be a whole number from 1 to 36.');
    if (!Number.isInteger(salary) || salary < 0 || salary > 1000000000) throw new UserError('Pay must be a whole number of dollars (no cents).');
    return { months, salary, clauses: field(interaction, 'clauses') || null };
};

async function contractHome(interaction, view = 'h', notice = null) {
    return open(interaction, async () => {
        const cu = require('../utils/contractUtils');
        const tabs = row(tab('ui:k:h', '🙋 Mine', view === 'h'), tab('ui:k:t:list', '📝 Under contract', view === 'list'), tab('ui:k:t:free-agents', '🆓 Free agents', view === 'free-agents'), tab('ui:k:t:earnings', '💰 Earnings', view === 'earnings'));
        const components = [tabs];
        let p;
        if (view === 'h') {
            const { rows } = await pool.query(
                `SELECT c.id, c.name, c.division FROM characters c JOIN users u ON u.id = c.owner_id
                 WHERE c.guild_id = $1 AND u.discord_id = $2 AND c.status = 'approved' ORDER BY lower(c.name) LIMIT 25`, [interaction.guildId, interaction.user.id]);
            const lines = [];
            for (const c of rows) {
                const k = await cu.getActive(c.id);
                const { rows: pend } = await pool.query(`SELECT status FROM contracts WHERE character_id = $1 AND status IN ('offered','requested') LIMIT 1`, [c.id]);
                lines.push(`**${c.name}**: ${k ? `${cu.money(k.salary)}/mo until ${cu.prettyDate(k.end_date)}` : 'free agent'}${pend[0] ? ` · ${pend[0].status === 'offered' ? '📨 offer waiting for you' : '🙋 request waiting for staff'}` : ''}`);
            }
            const { rows: g } = await pool.query(`SELECT contract_win_bonus AS w, contract_title_bonus AS t FROM guilds WHERE guild_id = $1`, [interaction.guildId]);
            const embed = new EmbedBuilder().setColor(0xE8BF4A).setTitle('📝 Contracts')
                .setDescription([lines.length ? lines.join('\n') : 'You don\'t have any approved wrestlers yet.', '',
                    `Bonuses: **${cu.money(g[0].w)}** per win, **${cu.money(g[0].t)}** extra for a title-match win.`, '_Contracts are just for fun. They never affect booking._'].join('\n'));
            p = { embeds: [embed] };
            if (rows.length) components.push(select('ui:k:pick', 'Open one of your wrestlers\' contracts', rows.map((c) => ({ label: clip(c.name, 100), value: String(c.id), description: DIVISION_LABELS[c.division] }))));
        } else {
            p = await asError(() => capture(interaction, 'contract', view))();
        }
        if (isAdmin(interaction)) components.push(row(btn('ui:pg:ko:0:all:0', '📨 Offer a contract', G)));
        return withNotice({ ...p, components: withHome(components) }, notice);
    });
}

async function contractView(interaction, charId, notice = null) {
    const back = row(btn('ui:k:h', '◀ Contracts'));
    return open(interaction, async () => {
        const { requireCharacter } = require('../utils/characterUtils');
        const c = await requireCharacter(interaction.guildId, charId, { statuses: ALL });
        const p = await capture(interaction, 'contract', 'view', { character: c.id });
        const acts = [];
        if (c.owner_discord_id === interaction.user.id && c.status === 'approved') acts.push(btn(`ui:k:rq:${c.id}`, '🙋 Ask for a new deal', G));
        if (isAdmin(interaction)) {
            acts.push(btn(`ui:k:of:${c.id}`, '📨 Offer a contract', G));
            const { rows } = await pool.query(`SELECT 1 FROM contracts WHERE character_id = $1 AND status = 'active'`, [c.id]);
            if (rows.length) acts.push(btn(`ui:k:rl:${c.id}`, '✂️ Release', D));
        }
        return withNotice({ ...p, components: withHome([...(acts.length ? [row(...acts)] : []), back]) }, notice);
    }, { backRows: [back] });
}

// ================================================================== my wrestler (owner or staff)

async function requireEditable(interaction, charId) {
    const { requireCharacter } = require('../utils/characterUtils');
    const c = await requireCharacter(interaction.guildId, charId, { statuses: ['approved', 'retired', 'pending'] });
    if (c.owner_discord_id !== interaction.user.id && !isAdmin(interaction)) throw new UserError('Only the wrestler\'s player (or staff) can edit them.');
    return c;
}

async function editModal(interaction, what, charId) {
    const c = await requireEditable(interaction, charId);
    if (what === 'e') {
        return interaction.showModal(modal(`ui:md:ce:${c.id}`, `Edit ${c.name}`, [
            { id: 'name', label: 'Name', required: true, max: 40, value: c.name },
            { id: 'alignment', label: 'Face, heel or neutral', max: 10, value: c.alignment, placeholder: 'face / heel / neutral' },
            { id: 'bio', label: 'One-line bio (empty = none)', max: 120, value: c.bio },
            { id: 'finisher', label: 'Finisher (empty = none)', max: 40, value: c.finisher },
            { id: 'entrance_theme', label: 'Entrance theme (empty = none)', max: 60, value: c.entrance_theme }]));
    }
    if (what === 's') {
        return interaction.showModal(modal(`ui:md:cs:${c.id}`, `${c.name}: story & moves`, [
            { id: 'signatures', label: 'Signature moves, split by commas', max: 160, value: c.signatures },
            { id: 'catchphrase', label: 'Catchphrase or gimmick', max: 80, value: c.catchphrase },
            { id: 'story', label: 'Story (shown on the Story page)', long: true, max: 1500, value: c.lore }]));
    }
    return interaction.showModal(modal(`ui:md:cp:${c.id}`, `${c.name}: picture`, [
        { id: 'image_url', label: 'Picture link (https), or - to remove it', required: true, max: 400, placeholder: 'To upload a file instead, use /character picture' }]));
}

/** Builds the edit options: only what changed; a field emptied by the user becomes "-" (clear). */
function changedValues(interaction, c, map) {
    const out = {};
    for (const [input, col, opt] of map) {
        const v = field(interaction, input);
        const before = c[col] ? String(c[col]) : '';
        if (v === before) continue;
        out[opt || input] = v === '' ? '-' : v;
    }
    return out;
}

async function afterEdit(interaction, charId, notice) {
    return open(interaction, async () => {
        const p = await require('./menus').whoisPayload(interaction, { characterId: charId });
        return withNotice({ ...p, components: withHome(p.components || []) }, notice);
    });
}

// ================================================================== feuds

async function feudList(interaction, notice = null) {
    return open(interaction, async () => {
        const p = await asError(() => capture(interaction, 'feud', 'list'))();
        const { rows } = await pool.query(
            `SELECT f.id, f.name, f.status, a.name AS a, b.name AS b FROM feuds f JOIN characters a ON a.id = f.char_a JOIN characters b ON b.id = f.char_b
             WHERE f.guild_id = $1 ORDER BY (f.status = 'active') DESC, f.id DESC LIMIT 25`, [interaction.guildId]);
        const components = [];
        if (rows.length) components.push(select('ui:fd:o', 'Open a feud', rows.map((f) => ({ label: clip(f.name, 100), value: String(f.id), description: clip(`${f.a} vs ${f.b}${f.status === 'active' ? '' : ' · ended'}`, 100) }))));
        if (isAdmin(interaction)) components.push(row(btn('ui:pg:fd1:0:all:0', '🔥 Start a feud', G)));
        return withNotice({ ...p, components: withHome(components) }, notice);
    });
}

async function feudView(interaction, id, notice = null) {
    const back = row(btn('ui:fd:l', '◀ All feuds'));
    return open(interaction, async () => {
        const p = await capture(interaction, 'feud', 'view', { feud: id });
        const { rows } = await pool.query(`SELECT status FROM feuds WHERE id = $1 AND guild_id = $2`, [id, interaction.guildId]);
        const components = [];
        if (isAdmin(interaction) && rows[0]?.status === 'active') {
            components.push(row(btn(`ui:fd:lg:${id}`, '📖 Add a moment', G), btn(`ui:fd:ht:${id}`, '🌡 Set heat'), btn(`ui:fd:end:${id}`, '🏁 End feud', D)));
        }
        components.push(back);
        return withNotice({ ...p, components: withHome(components) }, notice);
    }, { backRows: [back] });
}

// ================================================================== channels (staff)

const CHANNELS = [
    ['pending', 'Approvals & streak prompts', 'pending_channel_id'], ['staff', 'Staff reminders & bot alerts', 'admin_channel_id'],
    ['matches', 'Match results copy', 'matches_channel_id'], ['monthly', 'Wrestler of the Month', 'monthly_channel_id'],
    ['newsletter', 'Weekly newsletter', 'newsletter_channel_id'], ['legacy', 'Legacy announcements', 'legacy_channel_id'],
    ['power', 'Weekly power rankings', 'power_channel_id'], ['reminders', 'Unfinished match pings (daily)', 'reminders_channel_id'],
    ['history', 'Championship history', 'history_channel_id']];

async function channelsPanel(interaction, notice = null) {
    requireAdmin(interaction, 'change bot channels');
    return open(interaction, async () => {
        const p = await capture(interaction, 'admin', 'channels');
        return withNotice({ ...p, components: withHome([select('ui:ch:k', 'Change where the bot posts…', CHANNELS.map(([value, label]) => ({ label, value }))), row(btn('ui:h:staff', '◀ Staff Tools'))]) }, notice);
    });
}

async function channelPick(interaction, key) {
    requireAdmin(interaction, 'change bot channels');
    const c = CHANNELS.find((x) => x[0] === key);
    if (!c) throw new UserError('That button is from an older version. Run `/fnlw` again.');
    const menu = new ChannelSelectMenuBuilder().setCustomId(`ui:ch:s:${key}`).setPlaceholder(`Pick the channel for: ${c[1]}`).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
    const buttons = [btn('ui:ch:h', '◀ Back')];
    if (!['pending', 'history'].includes(key)) buttons.push(btn(`ui:ch:off:${key}`, '🔕 Turn this off', D));
    return show(interaction, {
        embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`📺 ${c[1]}`).setDescription('Pick a channel below. It\'s saved as soon as you pick it.')],
        components: withHome([new ActionRowBuilder().addComponents(menu), row(...buttons)])
    });
}

async function setChannel(interaction, key, channelId) {
    requireAdmin(interaction, 'change bot channels');
    let notice;
    try {
        if (key === 'history') notice = (await capture(interaction, 'admin', 'history', { channel: channelId ? { id: channelId } : null })).content;
        else if (channelId) await capture(interaction, 'admin', 'channels', { [key]: { id: channelId } });
        else await capture(interaction, 'admin', 'channels', { turn_off: key });
        notice = `✅ Saved.${notice ? ` ${notice}` : ''}`;
    } catch (e) { if (!(e instanceof UserError)) throw e; notice = `⚠️ ${e.message}`; }
    return channelsPanel(interaction, clip(notice, 600));
}

// ================================================================== Hall of Fame & injuries

async function hofPanel(interaction, notice = null) {
    return open(interaction, async () => {
        const p = await asError(() => capture(interaction, 'directory', 'hof-list'))();
        const { rows } = await pool.query(`SELECT c.id, c.name FROM hall_of_fame h JOIN characters c ON c.id = h.character_id WHERE h.guild_id = $1 ORDER BY h.inducted_at DESC LIMIT 25`, [interaction.guildId]);
        const components = [];
        if (rows.length) components.push(select('ui:hi:hv', 'See a legend\'s Hall of Fame graphic', rows.map((r) => ({ label: clip(r.name, 100), value: String(r.id) }))));
        const nav = [btn('ui:h:roster', '◀ Roster'), btn('ui:hi:i', '🤕 Injuries')];
        if (isAdmin(interaction)) nav.push(btn('ui:pg:hof:0:all:0', '🏛 Induct someone', G));
        components.push(row(...nav));
        return withNotice({ ...p, components: withHome(components) }, notice);
    });
}

async function injuryPanel(interaction, notice = null) {
    return open(interaction, async () => {
        const p = await asError(() => capture(interaction, 'directory', 'injury-list'))();
        const components = [];
        const { ACTIVE } = require('../utils/injuryUtils');
        const { rows } = await pool.query(`SELECT c.id, c.name FROM injuries i JOIN characters c ON c.id = i.character_id WHERE c.guild_id = $1 AND ${ACTIVE} ORDER BY c.name LIMIT 25`, [interaction.guildId]);
        if (isAdmin(interaction) && rows.length) components.push(select('ui:hi:ic', '💪 Mark someone healthy again', rows.map((r) => ({ label: clip(r.name, 100), value: String(r.id) }))));
        const nav = [btn('ui:h:roster', '◀ Roster'), btn('ui:hi:h', '🏛 Hall of Fame')];
        if (isAdmin(interaction)) nav.push(btn('ui:pg:inj:0:all:0', '🤕 Add an injury', G));
        components.push(row(...nav));
        return withNotice({ ...p, components: withHome(components) }, notice);
    });
}

// ================================================================== unfinished matches (staff)

async function today(guildId) {
    const { rows } = await pool.query(`SELECT tz FROM guilds WHERE guild_id = $1`, [guildId]);
    return require('../utils/titleWatch').localNow(rows[0]?.tz).date;
}

const CARD_PICK = { all: 'Both cards', raw: 'RAW', smackdown: 'SmackDown' };
/** Unfinished matches, optionally only one card (raw / smackdown). */
async function unfinishedList(guildId, brand = 'all') {
    const list = await require('../utils/unfinished').listUnfinished(guildId, await today(guildId));
    return CARD_PICK[brand] && brand !== 'all' ? list.filter((m) => m.brand === brand) : list;
}

async function unfinishedPanel(interaction, notice = null, brand = 'all') {
    requireAdmin(interaction, 'see unfinished matches');
    if (!CARD_PICK[brand]) brand = 'all';
    return open(interaction, async () => {
        const U = require('../utils/unfinished');
        const list = await unfinishedList(interaction.guildId, brand);
        const { rows } = await pool.query(`SELECT reminders_channel_id FROM guilds WHERE guild_id = $1`, [interaction.guildId]);
        const auto = rows[0]?.reminders_channel_id;
        const lines = list.map((m) => U.matchLine(m));
        let desc = lines.length ? lines.join('\n') : `✅ Nothing unfinished${brand === 'all' ? '. Every match on a past card has a result.' : ` on the ${CARD_PICK[brand]} card.`}`;
        if (desc.length > 3800) desc = `${lines.slice(0, 30).join('\n')}\n…and ${lines.length - 30} more`;
        const embed = new EmbedBuilder().setColor(0xE67E22).setTitle(`⏳ Unfinished matches${brand === 'all' ? '' : `: ${CARD_PICK[brand]}`} (${list.length})`).setDescription(desc.slice(0, 4000))
            .setFooter({ text: auto ? `Daily pings: on (from noon, up to ${U.MAX_PINGS} days in a row per match)` : 'Daily pings: off. Turn them on in 📺 Channels → Unfinished match pings.' });
        const cards = row(...Object.entries(CARD_PICK).map(([k, l]) => tab(`ui:uf:h:${k}`, k === 'raw' ? '🟥 RAW' : k === 'smackdown' ? '🟦 SmackDown' : 'Both cards', k === brand)));
        const pingLabel = brand === 'all' ? '📣 Ping them here now' : `📣 Ping the ${CARD_PICK[brand]} players here`;
        const buttons = [btn(`ui:uf:p:${brand}`, pingLabel, P, !list.some((m) => m.players.length)), btn('ui:h:staff', '◀ Staff Tools')];
        if (!auto) buttons.push(btn('ui:ch:k:reminders', '🔔 Set up daily pings'));
        return withNotice({ embeds: [embed], components: withHome([cards, row(...buttons)]) }, notice);
    });
}

// ================================================================== home sections

function openSection(interaction, key) {
    if (key === 'stand') return standingsPanel(interaction, 'pw');
    if (key === 'stats') return open(interaction, () => pickerPayload(interaction, 'st'));
    if (key === 'legacy') return legacyPanel(interaction);
    if (key === 'teams') return groupList(interaction, 't');
    if (key === 'feuds') return feudList(interaction);
    if (key === 'tourn') return tournamentList(interaction);
    if (key === 'contract') return contractHome(interaction);
    throw new UserError('That button is from an older version. Run `/fnlw` again.');
}

// ================================================================== router

async function handle(interaction, parts) {
    const [, kind, a, b, c, d] = parts;
    const v = interaction.values?.[0];

    if (kind === 'pg') return open(interaction, () => pickerPayload(interaction, a, b, c, d));
    if (kind === 'pk') return onPick(interaction, a, b, v);

    if (kind === 'sx') return statsPanel(interaction, a, b);
    if (kind === 'sd') {
        if (a === 'lc') return standingsPanel(interaction, 'lb', v, b);
        if (a === 'lp') return standingsPanel(interaction, 'lb', b, v);
        return standingsPanel(interaction, a, b);
    }

    if (kind === 'lx') {
        if (a === 'r') return legacyPanel(interaction, b, c);
        if (a === 'k') return legacyPanel(interaction, v, b);
        if (a === 'v') return votesPanel(interaction);
        if (a === 'vp') return votePanel(interaction, v);
        if (a === 'ga') {
            requireAdmin(interaction, 'give accolades');
            return interaction.showModal(modal(`ui:md:lga:${b}:${v}`, 'Give the accolade', [
                { id: 'year', label: 'Year', required: true, max: 4, value: thisYear() },
                { id: 'notes', label: 'Note (optional), e.g. the show', max: 150 },
                { id: 'announce', label: 'Announce it in the Legacy channel? yes/no', required: true, max: 3, value: 'yes' }]));
        }
    }

    if (kind === 'tf') {
        if (a === 'l') return groupList(interaction, b);
        if (a === 'o') return groupView(interaction, b, v);
        if (a === 'v') return groupView(interaction, b, c);
        if (a === 'rm') {
            requireAdmin(interaction, 'change teams and factions');
            const members = await groupMembers(b, c);
            if (!members.length) throw new UserError('Nobody is in it.');
            return show(interaction, { content: 'Who leaves?', embeds: [], components: withHome([select(`ui:tf:rs:${b}:${c}`, 'Pick who to remove', members.map((m) => ({ label: clip(m.name, 100), value: String(m.id) }))), row(btn(`ui:tf:v:${b}:${c}`, '◀ Back'))]) });
        }
        if (a === 'rs') return groupAction(interaction, b, c, () => capture(interaction, GROUP[b].cmd, 'remove-member', { [GROUP[b].opt]: c, character: v }));
        if (a === 'rn') {
            requireAdmin(interaction, 'rename teams');
            const { rows } = await pool.query(`SELECT name FROM teams WHERE id = $1 AND guild_id = $2`, [b, interaction.guildId]);
            return interaction.showModal(modal(`ui:md:trn:${b}`, 'Rename the team', [{ id: 'name', label: 'New name', required: true, max: 40, value: rows[0]?.name }]));
        }
        if (a === 'dq') {
            requireAdmin(interaction, 'disband teams and factions');
            return show(interaction, { content: `Disband this ${GROUP[b].one}? Its record is kept${b === 't' ? ', and any tag title it holds becomes vacant' : ''}.`, embeds: [], components: [row(btn(`ui:tf:dy:${b}:${c}`, 'Yes, disband', D), btn(`ui:tf:v:${b}:${c}`, 'Cancel'))] });
        }
        if (a === 'dy') return groupAction(interaction, b, c, () => capture(interaction, GROUP[b].cmd, 'disband', { [GROUP[b].opt]: c }));
    }

    if (kind === 'tn') {
        if (a === 'l') return tournamentList(interaction);
        if (a === 'o') return tournamentView(interaction, v);
        if (a === 'v') return tournamentView(interaction, b);
        if (a === 'd') return decidePanel(interaction, b, c);
        if (a === 'w') return tournamentAction(interaction, b, () => capture(interaction, 'tournament', 'advance', { tournament: b, bracket_match: c, winner: d }));
        if (a === 'rm') {
            requireAdmin(interaction, 'change tournament entrants');
            const { rows } = await pool.query(`SELECT c.id, c.name FROM tournament_entrants te JOIN characters c ON c.id = te.character_id JOIN tournaments t ON t.id = te.tournament_id WHERE t.id = $1 AND t.guild_id = $2 ORDER BY c.name LIMIT 25`, [b, interaction.guildId]);
            if (!rows.length) throw new UserError('Nobody has entered yet.');
            return show(interaction, { content: 'Who comes out of the tournament?', embeds: [], files: [], components: withHome([select(`ui:tn:rs:${b}`, 'Pick a wrestler', rows.map((r) => ({ label: clip(r.name, 100), value: String(r.id) }))), row(btn(`ui:tn:v:${b}`, '◀ Back'))]) });
        }
        if (a === 'rs') return tournamentAction(interaction, b, () => capture(interaction, 'tournament', 'remove', { tournament: b, wrestler: v }));
        if (a === 'sq' || a === 'cq') {
            requireAdmin(interaction, 'run tournaments');
            const start = a === 'sq';
            return show(interaction, { content: start ? 'Start the tournament? The bracket is drawn at random and nobody else can join after this.' : 'Cancel this tournament? This can\'t be undone.', embeds: [], files: [], attachments: [],
                components: [row(btn(`ui:tn:${start ? 'sy' : 'cy'}:${b}`, start ? 'Yes, start it' : 'Yes, cancel it', start ? G : D), btn(`ui:tn:v:${b}`, 'Go back'))] });
        }
        if (a === 'sy') return tournamentAction(interaction, b, () => capture(interaction, 'tournament', 'start', { tournament: b }));
        if (a === 'cy') {
            requireAdmin(interaction, 'run tournaments');
            const r = await asError(() => capture(interaction, 'tournament', 'cancel', { tournament: b }))();
            return tournamentList(interaction, r.content);
        }
        if (a === 'post') {
            requireAdmin(interaction, 'post brackets');
            const p = await capture(interaction, 'tournament', 'bracket', { tournament: b });
            const ch = await postPublic(interaction, { ...p, components: [] });
            return tournamentView(interaction, b, `📣 Posted the bracket in <#${ch}>.`);
        }
    }

    if (kind === 'm') {
        if (a === 'r') return ratePanel(interaction, b);
        if (a === 'rv') {
            const n = Number(c);
            if (!(n >= 1 && n <= 5)) throw new UserError('Pick 1 to 5 stars.');
            const avg = await require('../utils/fanRatings').rate(interaction.guildId, b, interaction.user.id, n);
            return ratePanel(interaction, b, `✅ Thanks! You gave it ${'⭐'.repeat(n)}. Fans: ⭐ ${avg.avg} (${avg.votes}).`);
        }
        if (a === 's') return matchStaffPanel(interaction, b, c || (interaction.message?.id && !onPrivateMessage(interaction) ? interaction.message.id : '0'));
        if (a === 'e') {
            requireAdmin(interaction, 'edit matches');
            const { rows } = await pool.query(`SELECT notes, stipulation, score FROM matches WHERE id = $1 AND guild_id = $2`, [b, interaction.guildId]);
            if (!rows[0]) throw new UserError('That match isn\'t on record anymore.');
            return interaction.showModal(modal(`ui:md:me:${b}`, `Edit match #${b}`, [
                { id: 'notes', label: 'Notes (empty = none)', long: true, max: 300, value: rows[0].notes },
                { id: 'stipulation', label: 'Stipulation (empty = none)', max: 60, value: rows[0].stipulation },
                { id: 'score', label: 'Score, e.g. 2-1 (empty = none)', max: 20, value: rows[0].score }]));
        }
        if (a === 'u') {
            requireAdmin(interaction, 'undo matches');
            return show(interaction, { content: `Undo match **#${b}**? It's deleted, and any title or #1 contender change from it is reversed.`, embeds: [], components: [row(btn(`ui:m:uy:${b}:${c}`, 'Yes, undo it', D), btn(`ui:m:s:${b}:${c || '0'}`, 'Keep it'))] });
        }
        if (a === 'uy') {
            requireAdmin(interaction, 'undo matches');
            let notice;
            try { notice = (await capture(interaction, 'match', 'undo', { match_id: b })).content; } catch (e) { if (!(e instanceof UserError)) throw e; return show(interaction, { content: `⚠️ ${e.message}`, embeds: [], components: [] }); }
            if (c && c !== '0') {
                // mark the public result so nobody thinks it still counts
                try {
                    const msg = await interaction.channel.messages.fetch(c);
                    await msg.edit({ content: `${msg.content ? `${msg.content}\n` : ''}↩️ **This match was undone by staff.** It no longer counts.`, components: [], allowedMentions: NOPING });
                } catch (_) { /* gone or not mine */ }
            }
            return show(interaction, { content: notice || `↩️ Match #${b} was undone.`, embeds: [], components: [] });
        }
    }

    if (kind === 'k') {
        if (a === 'h') return contractHome(interaction, 'h');
        if (a === 't') return contractHome(interaction, b);
        if (a === 'pick') return contractView(interaction, v);
        if (a === 'v') return contractView(interaction, b);
        if (a === 'rq') return interaction.showModal(contractModal(`ui:md:kr:${b}`, 'Ask for a new deal'));
        if (a === 'of') { requireAdmin(interaction, 'offer contracts'); return interaction.showModal(contractModal(`ui:md:ko:${b}`, 'Offer a contract')); }
        if (a === 'rl') {
            requireAdmin(interaction, 'release contracts');
            return show(interaction, { content: 'Release this wrestler from their contract now? Their earnings so far are kept.', embeds: [], files: [], attachments: [], components: [row(btn(`ui:k:rly:${b}`, 'Yes, release', D), btn(`ui:k:v:${b}`, 'Cancel'))] });
        }
        if (a === 'rly') {
            requireAdmin(interaction, 'release contracts');
            const r = await asError(() => capture(interaction, 'contract', 'release', { character: b }))();
            return contractView(interaction, b, r.content);
        }
    }

    if (kind === 'mw') return editModal(interaction, a, b);

    if (kind === 'fd') {
        if (a === 'l') return feudList(interaction);
        if (a === 'o') return feudView(interaction, v);
        if (a === 'v') return feudView(interaction, b);
        requireAdmin(interaction, 'change feuds');
        if (a === 'lg') return interaction.showModal(modal(`ui:md:fdl:${b}`, 'Add a storyline moment', [{ id: 'text', label: 'What happened?', long: true, required: true, max: 300, placeholder: 'Promo, attack, challenge…' }]));
        if (a === 'ht') return interaction.showModal(modal(`ui:md:fdh:${b}`, 'Set the heat', [{ id: 'boost', label: 'Extra heat from -40 (colder) to 40 (hotter)', required: true, max: 3, placeholder: '10' }]));
        if (a === 'end') return interaction.showModal(modal(`ui:md:fde:${b}`, 'End the feud', [{ id: 'text', label: 'How did it end? (optional)', long: true, max: 300 }]));
    }

    if (kind === 'ch') {
        if (a === 'h') return channelsPanel(interaction);
        if (a === 'k') return channelPick(interaction, v || b);
        if (a === 's') return setChannel(interaction, b, v);
        if (a === 'off') return setChannel(interaction, b, null);
    }

    if (kind === 'hi') {
        if (a === 'h') return hofPanel(interaction);
        if (a === 'i') return injuryPanel(interaction);
        if (a === 'hv') {
            return open(interaction, async () => ({ ...await capture(interaction, 'directory', 'hof-view', { character: v }), components: withHome([row(btn('ui:hi:h', '◀ Hall of Fame'))]) }));
        }
        if (a === 'ic') {
            requireAdmin(interaction, 'clear injuries');
            const r = await asError(() => capture(interaction, 'directory', 'injury-clear', { character: v }))();
            return injuryPanel(interaction, r.content);
        }
    }

    if (kind === 'uf') {
        const brand = CARD_PICK[b] ? b : 'all';
        if (a === 'h') return unfinishedPanel(interaction, null, brand);
        if (a === 'p') {
            requireAdmin(interaction, 'ping players');
            const U = require('../utils/unfinished');
            const list = (await unfinishedList(interaction.guildId, brand)).filter((m) => m.players.length);
            if (!list.length) return unfinishedPanel(interaction, 'Nothing to ping: every unfinished match is with unclaimed wrestlers only, or there are none.', brand);
            try { await U.pingNow(interaction.channel, list); } catch (_) { return unfinishedPanel(interaction, '⚠️ I couldn\'t post in this channel. Check I\'m allowed to send messages here.', brand); }
            return unfinishedPanel(interaction, `📣 Pinged the players of ${list.length} ${brand === 'all' ? '' : `${CARD_PICK[brand]} `}match${list.length === 1 ? '' : 'es'} in <#${interaction.channel.id}>.`, brand);
        }
    }

    if (kind === 'md') return onModal(interaction, a, b, c);
    throw new UserError('That button is from an older version of the bot. Run `/fnlw` again.');
}

// ================================================================== pop-up forms sent back

async function onModal(interaction, what, a, b) {
    const run = async (fn) => { try { return (await fn()).content || '✅ Done.'; } catch (e) { if (!(e instanceof UserError)) throw e; return `⚠️ ${e.message}`; } };

    if (what === 'ce' || what === 'cs' || what === 'cp') {
        const c = await requireEditable(interaction, a);
        let values;
        if (what === 'ce') {
            values = changedValues(interaction, c, [['name', 'name'], ['alignment', 'alignment'], ['bio', 'bio'], ['finisher', 'finisher'], ['entrance_theme', 'entrance_theme']]);
            if (values.name === '-') delete values.name;
            if (values.alignment !== undefined) {
                const al = values.alignment.toLowerCase();
                if (al === '-') delete values.alignment;
                else if (!['face', 'heel', 'neutral'].includes(al)) return afterEdit(interaction, c.id, '⚠️ Alignment must be face, heel or neutral. Nothing was changed.');
                else values.alignment = al;
            }
        } else if (what === 'cs') {
            values = changedValues(interaction, c, [['signatures', 'signatures'], ['catchphrase', 'catchphrase'], ['story', 'lore']]);
        } else {
            values = { image_url: field(interaction, 'image_url') };
        }
        if (!Object.keys(values).length) return afterEdit(interaction, c.id, 'Nothing changed.');
        const notice = await run(() => capture(interaction, 'character', what === 'cs' ? 'story' : 'edit', { character: c.id, ...values }));
        return afterEdit(interaction, c.id, notice);
    }

    if (what === 'me') {
        requireAdmin(interaction, 'edit matches');
        const { rows } = await pool.query(`SELECT notes, stipulation, score FROM matches WHERE id = $1 AND guild_id = $2`, [a, interaction.guildId]);
        if (!rows[0]) throw new UserError('That match isn\'t on record anymore.');
        const vals = changedValues(interaction, rows[0], [['notes', 'notes'], ['stipulation', 'stipulation'], ['score', 'score']]);
        // /match edit clears notes with "-"; stipulation and score are cleared with an empty value
        if (vals.stipulation === '-') vals.stipulation = '';
        if (vals.score === '-') vals.score = '';
        if (!Object.keys(vals).length) return matchStaffPanel(interaction, a, '0', 'Nothing changed.');
        const notice = await run(() => capture(interaction, 'match', 'edit', { match_id: a, ...vals }));
        return matchStaffPanel(interaction, a, '0', notice);
    }

    if (what === 'kr' || what === 'ko') {
        let notice;
        try {
            const vals = contractValues(interaction);
            const p = await capture(interaction, 'contract', what === 'ko' ? 'offer' : 'request', { character: a, ...vals });
            const ch = await postPublic(interaction, p);
            notice = what === 'ko' ? `📨 Offer posted in <#${ch}>. Their player accepts it there.` : `🙋 Your request is posted in <#${ch}> for staff to approve.`;
        } catch (e) { if (!(e instanceof UserError)) throw e; notice = `⚠️ ${e.message}`; }
        return contractView(interaction, a, notice);
    }

    if (what === 'lga') {
        requireAdmin(interaction, 'give accolades');
        const L = require('../utils/legacy');
        let kind = b, awardName = null;
        if (/^a\d+$/.test(b)) { kind = 'award'; awardName = (await L.awardNames(interaction.guildId))[Number(b.slice(1))]; if (!awardName) return legacyPanel(interaction, 'all', 'all', '⚠️ That award name was changed. Try again.'); }
        const year = Number(field(interaction, 'year'));
        if (!Number.isInteger(year) || year < 2000 || year > 2100) return legacyPanel(interaction, 'all', 'all', '⚠️ The year must look like 2025. Nothing was given.');
        const announce = !/^n/i.test(field(interaction, 'announce'));
        const notice = await run(() => capture(interaction, 'legacy', 'award', { accolade: kind, character: a, year, award_name: awardName, notes: field(interaction, 'notes') || null, announce }));
        return legacyPanel(interaction, 'all', 'all', notice);
    }

    if (what === 'trn') return groupAction(interaction, 't', a, () => capture(interaction, 'team', 'rename', { team: a, name: field(interaction, 'name') }));

    if (what === 'fds') {
        requireAdmin(interaction, 'start feuds');
        const notice = await run(() => capture(interaction, 'feud', 'start', { wrestler1: a, wrestler2: b, name: field(interaction, 'name') || null, story: field(interaction, 'story') || null }));
        return feudList(interaction, notice);
    }
    if (what === 'fdl' || what === 'fdh' || what === 'fde') {
        requireAdmin(interaction, 'change feuds');
        let notice;
        if (what === 'fdh') {
            const boost = Number(field(interaction, 'boost'));
            if (!Number.isInteger(boost) || boost < -40 || boost > 40) return feudView(interaction, a, '⚠️ Heat must be a whole number from -40 to 40.');
            notice = await run(() => capture(interaction, 'feud', 'heat', { feud: a, boost }));
        } else {
            notice = await run(() => capture(interaction, 'feud', what === 'fdl' ? 'log' : 'end', { feud: a, text: field(interaction, 'text') || null }));
        }
        return feudView(interaction, a, notice);
    }

    if (what === 'hof') {
        requireAdmin(interaction, 'induct legends');
        let notice;
        try {
            const p = await capture(interaction, 'directory', 'hof-induct', { character: a, blurb: field(interaction, 'blurb') || null });
            const ch = await postPublic(interaction, p);
            notice = `🏛️ Inducted! The announcement is posted in <#${ch}>.`;
        } catch (e) { if (!(e instanceof UserError)) throw e; notice = `⚠️ ${e.message}`; }
        return hofPanel(interaction, notice);
    }
    if (what === 'inj') {
        requireAdmin(interaction, 'mark injuries');
        const days = Number(field(interaction, 'days'));
        if (!Number.isInteger(days) || days < 1 || days > 365) return injuryPanel(interaction, '⚠️ Days must be a whole number from 1 to 365.');
        const notice = await run(() => capture(interaction, 'directory', 'injury-add', { character: a, days, reason: field(interaction, 'reason') || null }));
        return injuryPanel(interaction, notice);
    }
    throw new UserError('That form is from an older version of the bot. Run `/fnlw` again.');
}

module.exports = { SECTIONS, KINDS, handle, openSection, statsPanel, standingsPanel, pickerPayload, unfinishedPanel };
