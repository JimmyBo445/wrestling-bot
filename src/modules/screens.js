// 3.9: the button screens behind the shortened commands
//   /stats, /standings, /legacy, /directory, /feud, /contract   one command each (+ show_everyone)
//   /team view, /tournament view                                 the team / tournament screens
//   /title manage                                                staff screen for one belt (reigns fixed with forms)
// plus the buttons they need that didn't exist yet:
//   ui:sv:*   player vs player          ui:lz:* / ui:lzm:*   Legacy staff (take back, award names, open a vote)
//   ui:nm:*   nominate from a vote post ui:dr:*              roster cards by division
//   ui:kb / ui:kbm  contract bonuses    ui:pl / ui:plm       PLE history and tagging (Results screen)
//   ui:tt:* / ui:ttm:*  /title manage
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { pool } = require('../db/pool');
const { requireAdmin, isAdmin, DIVISION_LABELS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { btn, row, clip, homeRow, show, capture, open, withNotice, ButtonStyle } = require('../utils/panelKit');

const KINDS = ['sv', 'lz', 'lzm', 'nm', 'dr', 'kb', 'kbm', 'pl', 'plm', 'tt', 'ttm'];
const P = ButtonStyle.Primary, S = ButtonStyle.Secondary, G = ButtonStyle.Success, D = ButtonStyle.Danger;
const ALL = ['approved', 'retired'];
const thisYear = () => new Date().getFullYear();
const select = (id, placeholder, options) => row(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).addOptions(options.slice(0, 25)));
const hub = () => require('./hub');
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

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
async function attempt(fn) {
    try { return await fn(); } catch (e) { if (e instanceof UserError) return { content: `⚠️ ${e.message}`, failed: true }; throw e; }
}
const said = (p) => clip(p?.content || p?.embeds?.[0]?.data?.description || '✅ Done.', 900);
/** A wrestler from the list (an id) or typed by name. */
async function findChar(guildId, value, statuses = ALL) {
    const { requireCharacter } = require('../utils/characterUtils');
    let v = String(value || '').trim();
    if (v && !/^\d+$/.test(v)) {
        const { rows } = await pool.query(`SELECT id FROM characters WHERE guild_id = $1 AND lower(name) = lower($2) AND status = ANY($3::text[]) LIMIT 1`, [guildId, v, statuses]);
        if (rows[0]) v = String(rows[0].id);
    }
    return requireCharacter(guildId, v, { statuses });
}

// ================================================================== /stats

/** A player as the stats commands expect it, named the way the server shows them. */
async function playerUser(interaction, id) {
    let member = null, user = null;
    try { member = (await interaction.guild.members.fetch({ user: id })); member = member?.get ? member.get(id) : member; } catch (_) { member = null; }
    try { user = await interaction.client.users.fetch(id); } catch (_) { user = null; }
    const name = member?.displayName || user?.globalName || user?.displayName || user?.username || 'Player';
    return { id, username: user?.username || name, displayName: name, globalName: user?.globalName || null, bot: false };
}

async function statsScreen(interaction) {
    const w = interaction.options.getString('wrestler');
    const player = interaction.options.getUser('player');
    if (w) return hub().statsPanel(interaction, (await findChar(interaction.guildId, w)).id, 'ov');
    if (player) return playerScreen(interaction, player.id);
    return open(interaction, () => hub().pickerPayload(interaction, 'st'));
}

async function playerScreen(interaction, uid) {
    const back = [row(btn('ui:pg:st:0:all:0', '🔎 A wrestler\'s stats'))];
    return open(interaction, async () => {
        const user = await playerUser(interaction, uid);
        const p = await capture(interaction, 'stats', 'user', { user });
        const menu = new UserSelectMenuBuilder().setCustomId(`ui:sv:${uid}`).setPlaceholder('🆚 Compare with another player');
        return { ...p, components: withHome([new ActionRowBuilder().addComponents(menu), ...back]) };
    }, { backRows: back });
}

async function handleVersus(interaction, uid) {
    const other = interaction.values?.[0];
    const back = [row(btn(`ui:sv:${uid}:b`, '◀ Back to the player'))];
    if (!other) return playerScreen(interaction, uid);
    if (other === 'b') return playerScreen(interaction, uid);
    return open(interaction, async () => {
        const fetchU = (id) => playerUser(interaction, id);
        const p = await capture(interaction, 'stats', 'versus', { player1: await fetchU(uid), player2: await fetchU(other) });
        return { ...p, components: withHome(back) };
    }, { backRows: back });
}

// ================================================================== /standings

const BOARDS = { pw: 'pw', lb: 'lb', rk: 'rk', ss: 'ss', rv: 'rv' };
function standingsScreen(interaction) {
    return hub().standingsPanel(interaction, BOARDS[interaction.options.getString('board')] || 'pw');
}

// ================================================================== /legacy

async function legacyScreen(interaction) {
    const w = interaction.options.getString('wrestler');
    const player = interaction.options.getUser('player');
    if (w) return legacyWrestler(interaction, (await findChar(interaction.guildId, w)).id);
    if (player) {
        const back = [row(btn('ui:lx:r:all:all', '🏆 Honor roll'))];
        return open(interaction, async () => ({ ...await capture(interaction, 'legacy', 'view', { player }), components: withHome(back) }), { backRows: back });
    }
    return hub().legacyPanel(interaction);
}

/** One wrestler's accolades; staff can take one back. */
async function legacyWrestler(interaction, charId, notice = null) {
    const nav = row(btn('ui:pg:lg:0:all:0', '🔎 Another wrestler'), btn('ui:lx:r:all:all', '🏆 Honor roll'));
    return open(interaction, async () => {
        const p = await capture(interaction, 'legacy', 'view', { character: charId });
        const comps = [];
        if (isAdmin(interaction)) {
            const L = require('../utils/legacy');
            const { rows } = await pool.query(`SELECT * FROM legacy WHERE guild_id = $1 AND character_id = $2 ORDER BY year DESC, id DESC LIMIT 25`, [interaction.guildId, charId]);
            if (rows.length) comps.push(select(`ui:lz:rm:${charId}`, '🗑 Take back an accolade (staff)', rows.map((r) => ({ label: clip(L.accoladeName(r), 100), value: String(r.id) }))));
            comps.push(row(btn('ui:pg:lga:0:all:0', '🎖 Give an accolade', G)));
        }
        comps.push(nav);
        return withNotice({ ...p, components: withHome(comps) }, notice);
    }, { backRows: [nav] });
}

async function awardNamesPanel(interaction, notice = null) {
    requireAdmin(interaction, 'change award names');
    return open(interaction, async () => {
        const names = await require('../utils/legacy').awardNames(interaction.guildId);
        const embed = new EmbedBuilder().setColor(0xE8BF4A).setTitle('🏷 Year-end award names')
            .setDescription(names.length ? names.map((n) => `• ${n}`).join('\n').slice(0, 4000) : '_No award names yet._')
            .setFooter({ text: 'These are the awards you can give or open a vote for.' });
        const opts = names.slice(0, 25).map((n, i) => ({ label: clip(n, 100), value: String(i) }));
        const comps = [row(btn('ui:lz:ana', '➕ Add a name', G), btn('ui:lx:r:all:all', '◀ Honor roll'))];
        if (opts.length) {
            comps.push(select('ui:lz:anr', '✏️ Rename one…', opts));
            comps.push(select('ui:lz:anx', '🗑 Remove one…', opts));
        }
        return withNotice({ embeds: [embed], components: withHome(comps) }, notice);
    });
}

async function openVotePicker(interaction) {
    requireAdmin(interaction, 'open award votes');
    const names = await require('../utils/legacy').awardNames(interaction.guildId);
    const opts = [{ label: 'Face of FNLW MVP', value: 'mvp' }, ...names.slice(0, 24).map((n, i) => ({ label: clip(n, 100), value: `a${i}` }))];
    return show(interaction, { content: '🗳 What is the vote for? Next you pick the year and who can nominate and vote.', embeds: [], files: [],
        components: withHome([select('ui:lz:vk', 'Pick the award', opts), row(btn('ui:lx:r:all:all', '◀ Honor roll'))]) });
}

async function handleLegacy(interaction, a, b) {
    const v = interaction.values?.[0];
    const L = require('../utils/legacy');
    requireAdmin(interaction, 'manage Legacy accolades');
    if (a === 'rm') {
        const r = await attempt(() => capture(interaction, 'legacy', 'remove', { accolade: v }));
        return legacyWrestler(interaction, b, r.failed ? r.content : `🗑 ${said(r)}`);
    }
    if (a === 'an') return awardNamesPanel(interaction);
    if (a === 'ana') return interaction.showModal(modal('ui:lzm:add', 'Add an award name', [{ id: 'name', label: 'Award name', required: true, max: 50, placeholder: 'Rookie of the Year' }]));
    if (a === 'anr') {
        const names = await L.awardNames(interaction.guildId);
        return interaction.showModal(modal(`ui:lzm:ren:${v}`, 'Rename the award', [{ id: 'name', label: 'New name', required: true, max: 50, value: names[Number(v)] }]));
    }
    if (a === 'anx') {
        const names = await L.awardNames(interaction.guildId);
        const name = names[Number(v)];
        if (!name) return awardNamesPanel(interaction, '⚠️ That name is gone already.');
        const r = await attempt(() => capture(interaction, 'legacy', 'award-names', { action: 'remove', name }));
        return awardNamesPanel(interaction, r.failed ? r.content : `🗑 Removed **${name}**.`);
    }
    if (a === 'vo') return openVotePicker(interaction);
    if (a === 'vk') {
        const names = await L.awardNames(interaction.guildId);
        const label = v === 'mvp' ? 'Face of FNLW MVP' : names[Number(String(v).slice(1))] || 'award';
        return interaction.showModal(modal(`ui:lzm:vo:${v}`, clip(`Vote: ${label}`, 45), [
            { id: 'year', label: 'Year', required: true, max: 4, value: thisYear() },
            { id: 'nominees', label: 'Who can nominate? staff / everyone', required: true, max: 10, value: 'staff' },
            { id: 'voters', label: 'Who can vote? everyone / staff', required: true, max: 10, value: 'everyone' }]));
    }
    throw new UserError('That button is from an older version of the bot. Run `/legacy` again.');
}

const who = (s) => (/^(e|all|any)/i.test(String(s).trim()) ? 'everyone' : 'admins');

async function handleLegacyForm(interaction, a, b) {
    requireAdmin(interaction, 'manage Legacy accolades');
    const L = require('../utils/legacy');
    if (a === 'add') {
        const r = await attempt(() => capture(interaction, 'legacy', 'award-names', { action: 'add', name: field(interaction, 'name') }));
        return awardNamesPanel(interaction, r.failed ? r.content : `✅ Added **${field(interaction, 'name')}**.`);
    }
    if (a === 'ren') {
        const names = await L.awardNames(interaction.guildId);
        const old = names[Number(b)];
        if (!old) return awardNamesPanel(interaction, '⚠️ That name is gone already.');
        const r = await attempt(() => capture(interaction, 'legacy', 'award-names', { action: 'rename', name: old, new_name: field(interaction, 'name') }));
        return awardNamesPanel(interaction, r.failed ? r.content : `✏️ Renamed **${old}** to **${field(interaction, 'name')}**.`);
    }
    if (a === 'vo') {
        const year = Number(field(interaction, 'year'));
        if (!Number.isInteger(year) || year < 2000 || year > 2100) return hub().legacyPanel(interaction, 'all', 'all', '⚠️ The year has to look like 2026. No vote was opened.');
        const values = { accolade: b === 'mvp' ? 'mvp' : 'award', year, nominees_by: who(field(interaction, 'nominees')), voters: who(field(interaction, 'voters')) };
        if (b !== 'mvp') values.award_name = (await L.awardNames(interaction.guildId))[Number(String(b).slice(1))];
        const r = await attempt(() => capture(interaction, 'legacy', 'vote-open', values));
        return hub().legacyPanel(interaction, 'all', 'all', r.failed ? r.content : said(r).replace(/Add nominees with[^.]*\./, 'Nominees are added with the 🙋 button on the vote post; staff press ▶️ Start voting when ready.'));
    }
    throw new UserError('That form is from an older version of the bot. Run `/legacy` again.');
}

// nominate from the vote post (anyone, if the vote allows it)
async function nominatePick(interaction, pollId, charId) {
    const c = await findChar(interaction.guildId, charId);
    return show(interaction, { content: `🙋 Nominate **${c.name}**? For a rivalry or a match, add the other wrestler too.`, embeds: [], files: [],
        components: withHome([row(btn(`ui:nm:y:${pollId}:${c.id}`, `✅ Nominate ${clip(c.name, 60)}`, G), btn(`ui:pg:nom2:${pollId}.${c.id}:all:0`, '➕ Add a second wrestler'), btn(`ui:pg:nom:${pollId}:all:0`, '◀ Pick again'))]) });
}
async function nominate(interaction, pollId, a, b = null) {
    const r = await attempt(() => capture(interaction, 'legacy', 'nominate', { vote: pollId, character: a, character2: b }));
    return show(interaction, { content: said(r), embeds: [], files: [], components: withHome([row(btn(`ui:pg:nom:${pollId}:all:0`, '🙋 Nominate someone else'))]) });
}

// ================================================================== /directory

async function directoryScreen(interaction) {
    const page = interaction.options.getString('page') || 'list';
    const division = interaction.options.getString('division');
    if (page === 'hof') return hub().hofPanel(interaction);
    if (page === 'injuries') return hub().injuryPanel(interaction);
    if (page === 'roster') {
        if (!division) return open(interaction, async () => rosterPick());
        return require('../commands/directory').execute(require('../utils/umbrella').proxyFor(interaction, 'roster'));
    }
    return open(interaction, async () => {
        const p = await require('./menus').rosterListPayload(interaction.guildId, { division: division || 'all', sort: 'wrestler', page: 0, extras: true });
        return { ...p, components: withHome(p.components || []) };
    });
}
function rosterPick() {
    return { content: '🗂 **Roster cards**: pick a division to flip through its wrestlers.', embeds: [], files: [],
        components: withHome([row(...Object.entries(DIVISION_LABELS).map(([d, l]) => btn(`ui:dr:${d}`, l))), row(btn('ui:h:roster', '◀ Roster list'))]) };
}
async function handleRoster(interaction, a) {
    if (a === 'p' || !DIVISION_LABELS[a]) return show(interaction, rosterPick());
    const { privately } = require('../utils/panelKit');
    return require('../commands/directory').execute(privately(interaction, 'roster', { division: a }));
}

// ================================================================== /feud, /contract

async function feudScreen(interaction) {
    const f = interaction.options.getString('feud');
    if (!f) return hub().feudList(interaction);
    const feud = await require('../utils/feudUtils').requireFeud(interaction.guildId, f);
    return hub().feudView(interaction, feud.id);
}

async function contractScreen(interaction) {
    const w = interaction.options.getString('wrestler');
    if (!w) return hub().contractHome(interaction);
    return hub().contractView(interaction, (await findChar(interaction.guildId, w, ['approved'])).id);
}

async function handleBonuses(interaction) {
    requireAdmin(interaction, 'change bonuses');
    const { rows } = await pool.query(`SELECT contract_win_bonus AS w, contract_title_bonus AS t FROM guilds WHERE guild_id = $1`, [interaction.guildId]);
    return interaction.showModal(modal('ui:kbm', 'Contract bonuses', [
        { id: 'win', label: 'Bonus per match win', required: true, max: 9, value: rows[0]?.w ?? 0 },
        { id: 'title_win', label: 'Extra for winning a title match', required: true, max: 9, value: rows[0]?.t ?? 0 }]));
}
async function handleBonusesForm(interaction) {
    requireAdmin(interaction, 'change bonuses');
    const win = Number(field(interaction, 'win').replace(/[$,]/g, ''));
    const tw = Number(field(interaction, 'title_win').replace(/[$,]/g, ''));
    if (![win, tw].every((n) => Number.isInteger(n) && n >= 0 && n <= 100000000)) return hub().contractHome(interaction, 'h', '⚠️ Bonuses have to be whole numbers (no decimals). Nothing was changed.');
    const r = await attempt(() => capture(interaction, 'contract', 'bonuses', { win, title_win: tw }));
    return hub().contractHome(interaction, 'h', said(r));
}

// ================================================================== /team view, /tournament view

async function teamScreen(interaction) {
    const g = interaction.options.getString('group');
    if (!g) return hub().groupList(interaction, 't');
    const m = /^([tf]):(\d+)$/.exec(g);
    if (m) return hub().groupView(interaction, m[1], m[2]);
    const { rows } = await pool.query(
        `SELECT 't' AS t, id FROM teams WHERE guild_id = $1 AND status = 'active' AND lower(name) = lower($2)
         UNION ALL SELECT 'f', id FROM factions WHERE guild_id = $1 AND status = 'active' AND lower(name) = lower($2) LIMIT 1`, [interaction.guildId, g.trim()]);
    if (!rows[0]) throw new UserError('I couldn\'t find that tag team or faction. Pick one from the list that appears as you type.');
    return hub().groupView(interaction, rows[0].t, rows[0].id);
}

async function tournamentScreen(interaction) {
    const t = interaction.options.getString('tournament');
    if (!t) return hub().tournamentList(interaction);
    const tour = await require('../utils/tournamentUtils').requireTournament(interaction.guildId, t);
    return hub().tournamentView(interaction, tour.id);
}

// ================================================================== Results screen: PLEs

function resultsStaffRow(interaction) {
    const b = [btn('ui:pl:h', '🎆 PLEs')];
    if (isAdmin(interaction)) b.push(btn('ui:pl:q', '🎟 Tag today\'s matches as a PLE'));
    return row(...b);
}
async function handlePle(interaction, a) {
    const back = [row(btn('ui:h:results', '◀ Results'))];
    if (a === 'h') {
        // PLE history is for everyone (the /match ple command itself is staff-only)
        return open(interaction, async () => {
            const Pl = require('../utils/ple');
            const [list, leaders] = await Promise.all([Pl.pleList(interaction.guildId), Pl.pleLeaders(interaction.guildId, 10)]);
            const embed = new EmbedBuilder().setTitle('🎆 Premium Live Events').setColor(0x9B59B6)
                .setDescription(list.length ? list.map((r) => `**${r.ple} ${r.year}** · ${r.matches} match${r.matches === 1 ? '' : 'es'}`).join('\n').slice(0, 2000) : 'No PLEs tagged yet.');
            if (leaders.length) embed.addFields({ name: 'Most PLE wins', value: leaders.map((r, i) => `${i + 1}. **${r.name}**${r.discord_id ? ` (<@${r.discord_id}>)` : ''}: ${r.w}-${r.l}`).join('\n').slice(0, 1024) });
            return { embeds: [embed], components: withHome(back) };
        });
    }
    requireAdmin(interaction, 'tag PLEs');
    if (a === 'q') {
        return interaction.showModal(modal('ui:plm', 'Tag matches as a PLE', [
            { id: 'event', label: 'PLE name', required: true, max: 40, placeholder: 'WrestleMania' },
            { id: 'date', label: 'Day the matches were logged (empty = today)', max: 10, placeholder: 'YYYY-MM-DD' }]));
    }
    throw new UserError('That button is from an older version of the bot. Run `/fnlw` again.');
}
async function handlePleForm(interaction) {
    requireAdmin(interaction, 'tag PLEs');
    const values = { event: field(interaction, 'event') };
    if (field(interaction, 'date')) values.date = field(interaction, 'date');
    const r = await attempt(() => capture(interaction, 'match', 'ple', values));
    const back = [row(btn('ui:pl:h', '🎆 PLEs'), btn('ui:h:results', '◀ Results'))];
    return open(interaction, async () => ({ content: said(r), embeds: r.failed ? [] : (r.embeds || []), components: withHome(back) }));
}

// ================================================================== /title manage (staff)

async function reignsOf(titleId) {
    const { rows } = await pool.query(
        `SELECT tr.*, COALESCE(t.name, c.name, tr.reign_char_name) AS holder
         FROM title_reigns tr LEFT JOIN teams t ON t.id = tr.team_id LEFT JOIN characters c ON c.id = tr.character_id
         WHERE tr.title_id = $1 ORDER BY tr.won_date DESC, tr.id DESC`, [titleId]);
    return rows;
}
const reignLabel = (r) => `${r.holder || 'Unknown'} · ${ymd(r.won_date)} → ${r.lost_date ? ymd(r.lost_date) : 'now'}${r.is_interim ? ' (interim)' : ''}`;

async function titleHome(interaction, notice = null) {
    requireAdmin(interaction, 'run the belts');
    return open(interaction, async () => {
        const { rows } = await pool.query(`SELECT id, name, division, is_vacant FROM titles WHERE guild_id = $1 ORDER BY division, name LIMIT 25`, [interaction.guildId]);
        const embed = new EmbedBuilder().setColor(0xE8BF4A).setTitle('🏆 Run the belts').setDescription('Pick a belt to log a title match, change the #1 contender, vacate it, crown an interim champion, or fix its history.\nBelt pictures: `/title belt-image`.');
        const comps = [];
        if (rows.length) comps.push(select('ui:tt:o', 'Pick a belt', rows.map((t) => ({ label: clip(t.name, 100), value: String(t.id), description: clip(`${DIVISION_LABELS[t.division] || t.division}${t.is_vacant ? ' · vacant' : ''}`, 100) }))));
        comps.push(row(btn('ui:tt:w', '⏱ Title watch'), btn('ui:tt:rw:0', '🔁 Rematches owed')));
        return withNotice({ embeds: [embed], components: withHome(comps) }, notice);
    });
}

async function titleScreen(interaction, titleId, notice = null) {
    requireAdmin(interaction, 'run the belts');
    const { requireTitle, getCurrentReign, reignHolderName } = require('../utils/titleLogic');
    const back = row(btn('ui:tt:l', '◀ All belts'));
    return open(interaction, async () => {
        const title = await requireTitle(interaction.guildId, titleId);
        const cur = await getCurrentReign(title.id);
        const { rows: con } = await pool.query(
            `SELECT COALESCE(tm.name, c.name) AS name FROM contenders co LEFT JOIN characters c ON c.id = co.character_id LEFT JOIN teams tm ON tm.id = co.team_id
             WHERE co.title_id = $1 AND co.status = 'active' LIMIT 1`, [title.id]);
        const reigns = await reignsOf(title.id);
        const embed = new EmbedBuilder().setColor(0xE8BF4A).setTitle(`🏆 ${title.name}`).setDescription([
            `**Champion:** ${cur ? `${reignHolderName(cur)}${cur.is_interim ? ' _(interim)_' : ''} since ${ymd(cur.won_date)} · ${cur.defenses} defenses` : '_Vacant_'}`,
            `**#1 contender:** ${con[0]?.name || '_none_'}`,
            `**Reigns on record:** ${reigns.length}`,
            '',
            '🎬 Log match records a title match the quick way. For a vacant belt or extra details (stipulation, finish), use `/match log` with `title:`.',
            'To fix the history, pick a reign from the 📜 menu, or ➕ add an old one.'
        ].join('\n'));
        const comps = [
            row(btn(`chmp:log:${title.id}`, '🎬 Log match', P), btn(`chmp:sc:${title.id}`, '🎯 Set contender'), btn(`chmp:cc:${title.id}`, '✖ Clear contender'), btn(`chmp:vac:${title.id}`, '🚫 Vacate', D)),
            row(btn(`ui:tt:in:${title.id}`, '🩹 Interim champion'), btn(`ui:tt:un:${title.id}`, '🔗 Unify'), btn(`ui:tt:rw:${title.id}`, '🔁 Waive a rematch'), btn('ui:tt:w', '⏱ Title watch'))
        ];
        if (reigns.length) comps.push(select(`ui:tt:rg:${title.id}`, '📜 Fix a reign…', reigns.slice(0, 25).map((r) => ({ label: clip(reignLabel(r), 100), value: String(r.id), description: `${r.defenses} defenses${r.notes ? ` · ${clip(r.notes, 60)}` : ''}` }))));
        comps.push(row(btn(`ui:tt:ra:${title.id}`, '➕ Add an old reign', G), back.components[0]));
        return withNotice({ embeds: [embed], components: comps.slice(0, 5) }, notice);
    }, { backRows: [back] });
}

async function reignRowById(guildId, reignId) {
    const { rows } = await pool.query(
        `SELECT tr.*, COALESCE(t.name, c.name, tr.reign_char_name) AS holder FROM title_reigns tr LEFT JOIN teams t ON t.id = tr.team_id LEFT JOIN characters c ON c.id = tr.character_id
         WHERE tr.id = $1 AND tr.guild_id = $2`, [reignId, guildId]);
    if (!rows[0]) throw new UserError('That reign isn\'t on record anymore.');
    return rows[0];
}

async function reignScreen(interaction, reignId, notice = null) {
    requireAdmin(interaction, 'fix title history');
    return open(interaction, async () => {
        const r = await reignRowById(interaction.guildId, reignId);
        const { rows: t } = await pool.query(`SELECT name FROM titles WHERE id = $1`, [r.title_id]);
        const { rows: defs } = await pool.query(`SELECT id, opponent, defended_on, notes FROM reign_defenses WHERE reign_id = $1 ORDER BY defended_on NULLS LAST, id`, [r.id]);
        const embed = new EmbedBuilder().setColor(0xE8BF4A).setTitle(`📜 ${t[0]?.name}: ${r.holder || 'Unknown'}`).setDescription([
            `**Won:** ${ymd(r.won_date)} · **Lost:** ${r.lost_date ? ymd(r.lost_date) : 'still champion'}`,
            `**Defenses:** ${r.defenses}${r.is_interim ? ' · **interim**' : ''}${r.is_backfilled ? ' · added by hand' : ' · from a logged match'}`,
            r.notes ? `**Notes:** ${r.notes}` : null,
            defs.length ? `\n**Defenses written down:**\n${defs.map((d) => `• ${d.opponent}${d.defended_on ? ` (${ymd(d.defended_on)})` : ''}${d.notes ? ` · ${d.notes}` : ''}`).join('\n')}` : null
        ].filter(Boolean).join('\n').slice(0, 4000));
        const comps = [row(btn(`ui:tt:re:${r.id}`, '✏️ Dates, defenses, notes', P), btn(`ui:tt:rc:${r.id}`, '👤 Change champion'), btn(`ui:tt:da:${r.id}`, '➕ Add a defense'), btn(`ui:tt:rx:${r.id}`, '🗑 Delete reign', D))];
        if (defs.length) comps.push(select(`ui:tt:dx:${r.id}`, '➖ Remove a written-down defense…', defs.slice(0, 25).map((d) => ({ label: clip(`${d.opponent}${d.defended_on ? ` (${ymd(d.defended_on)})` : ''}`, 100), value: String(d.id) }))));
        comps.push(row(btn(`ui:tt:t:${r.title_id}`, '◀ Back to the belt')));
        return withNotice({ embeds: [embed], components: comps }, notice);
    });
}

/** A typed champion name → the options /title reign-add and reign-edit understand. */
async function holderValues(guildId, title, text, partner = '') {
    const name = String(text || '').trim();
    if (!name) throw new UserError('Type the champion\'s name.');
    if (title.is_tag_title) {
        const { rows } = await pool.query(`SELECT id FROM teams WHERE guild_id = $1 AND lower(name) = lower($2) ORDER BY (status = 'active') DESC LIMIT 1`, [guildId, name]);
        if (rows[0]) return { team: String(rows[0].id) };
    }
    const { rows: c } = await pool.query(`SELECT id FROM characters WHERE guild_id = $1 AND lower(name) = lower($2) LIMIT 1`, [guildId, name]);
    if (c[0]) {
        const out = { character: String(c[0].id) };
        if (title.is_tag_title && partner.trim()) {
            const { rows: p2 } = await pool.query(`SELECT id FROM characters WHERE guild_id = $1 AND lower(name) = lower($2) LIMIT 1`, [guildId, partner.trim()]);
            if (!p2[0]) throw new UserError(`I don't have a wrestler called **${partner.trim()}**. Leave the partner empty to just use the name.`);
            out.partner = String(p2[0].id);
        }
        return out;
    }
    return { champion_name: name };
}

/** Wrestlers (singles) or teams (tag) in the belt's division, for interim / unify. */
async function contendersFor(title) {
    if (title.is_tag_title) {
        const { rows } = await pool.query(`SELECT id, name FROM teams WHERE guild_id = $1 AND division = $2 AND status = 'active' ORDER BY lower(name) LIMIT 25`, [title.guild_id, title.division]);
        return rows;
    }
    return null; // singles: the wrestler picker (it pages through big divisions)
}

async function handleTitle(interaction, a, b, c) {
    requireAdmin(interaction, 'run the belts');
    const v = interaction.values?.[0];
    const { requireTitle } = require('../utils/titleLogic');
    if (a === 'l') return titleHome(interaction);
    if (a === 'o') return titleScreen(interaction, v);
    if (a === 't') return titleScreen(interaction, b);
    if (a === 'w') {
        const back = [row(btn('ui:tt:l', '◀ All belts'))];
        return open(interaction, async () => ({ ...await capture(interaction, 'title', 'watch'), components: back }), { backRows: back });
    }
    if (a === 'rw') {
        const params = [interaction.guildId];
        let extra = '';
        if (b && b !== '0') { params.push(b); extra = 'AND rr.title_id = $2'; }
        const { rows } = await pool.query(
            `SELECT rr.id, rr.holder_name, rr.expires_on, t.name AS title_name FROM rematch_rights rr JOIN titles t ON t.id = rr.title_id
             WHERE rr.guild_id = $1 AND rr.status = 'active' ${extra} ORDER BY rr.expires_on LIMIT 25`, params);
        const backId = b && b !== '0' ? `ui:tt:t:${b}` : 'ui:tt:l';
        if (!rows.length) return show(interaction, { content: 'Nobody is owed a rematch right now.', embeds: [], files: [], components: [row(btn(backId, '◀ Back'))] });
        return show(interaction, { content: '🔁 **Rematches owed.** Pick one to cancel it (the champion who lost no longer gets a guaranteed rematch).', embeds: [], files: [],
            components: [select(`ui:tt:rws:${b || 0}`, 'Cancel a rematch…', rows.map((r) => ({ label: clip(`${r.holder_name} · ${r.title_name}`, 100), value: String(r.id), description: `Until ${ymd(r.expires_on)}` }))), row(btn(backId, '◀ Back'))] });
    }
    if (a === 'rws') {
        const r = await attempt(() => capture(interaction, 'title', 'waive-rematch', { rematch: v }));
        const note = r.failed ? r.content : '✅ Rematch cancelled.';
        return b && b !== '0' ? titleScreen(interaction, b, note) : titleHome(interaction, note);
    }
    if (a === 'in' || a === 'un') {
        const title = await requireTitle(interaction.guildId, b);
        const teams = await contendersFor(title);
        const what = a === 'in' ? 'Who is the interim champion?' : 'Who is the undisputed champion after unifying?';
        if (!teams) return open(interaction, () => hub().pickerPayload(interaction, a === 'in' ? 'tin' : 'tun', String(title.id), title.division, 0));
        if (!teams.length) return titleScreen(interaction, title.id, '⚠️ There are no active teams in this division.');
        return show(interaction, { content: `**${title.name}**: ${what}`, embeds: [], files: [], components: [select(`ui:tt:${a}s:${title.id}`, 'Pick a team', teams.map((t) => ({ label: clip(t.name, 100), value: String(t.id) }))), row(btn(`ui:tt:t:${title.id}`, '◀ Back'))] });
    }
    if (a === 'ins' || a === 'uns') return crown(interaction, a === 'ins' ? 'interim' : 'unify', b, { team: v });
    if (a === 'rg') return reignScreen(interaction, v);
    if (a === 'r') return reignScreen(interaction, b);
    if (a === 'ra') {
        const title = await requireTitle(interaction.guildId, b);
        const inputs = [
            { id: 'champion', label: title.is_tag_title ? 'Champion: a team or wrestler in the bot, or a name' : 'Champion: a wrestler in the bot, or any name', required: true, max: 60 },
            { id: 'won', label: 'Won on (YYYY-MM-DD)', required: true, max: 10 },
            { id: 'lost', label: 'Lost on (YYYY-MM-DD, empty = still champion)', max: 10 },
            { id: 'defenses', label: 'Defenses', max: 3, value: 0 },
            { id: 'notes', label: 'Notes (optional)', max: 200, long: true }];
        return interaction.showModal(modal(`ui:ttm:ra:${title.id}`, clip(`Add an old ${title.name} reign`, 45), inputs));
    }
    // one reign (b = reign id)
    const r = await reignRowById(interaction.guildId, b);
    if (a === 're') {
        return interaction.showModal(modal(`ui:ttm:re:${r.id}`, 'Fix this reign', [
            { id: 'won', label: 'Won on (YYYY-MM-DD)', required: true, max: 10, value: ymd(r.won_date) },
            { id: 'lost', label: 'Lost on (YYYY-MM-DD, empty = still champion)', max: 10, value: r.lost_date ? ymd(r.lost_date) : '' },
            { id: 'defenses', label: 'Defenses', required: true, max: 3, value: r.defenses },
            { id: 'notes', label: 'Notes (empty = none)', max: 200, long: true, value: r.notes },
            { id: 'interim', label: 'Interim reign? yes / no', required: true, max: 3, value: r.is_interim ? 'yes' : 'no' }]));
    }
    if (a === 'rc') {
        const title = await requireTitle(interaction.guildId, r.title_id);
        const inputs = [{ id: 'champion', label: title.is_tag_title ? 'Team or wrestler in the bot, or any name' : 'A wrestler in the bot, or any name', required: true, max: 60, value: r.holder }];
        if (title.is_tag_title) inputs.push({ id: 'partner', label: 'Partner (only if you typed a wrestler)', max: 60 });
        return interaction.showModal(modal(`ui:ttm:rc:${r.id}`, 'Change the champion', inputs));
    }
    if (a === 'da') {
        return interaction.showModal(modal(`ui:ttm:da:${r.id}`, 'Add a defense', [
            { id: 'opponent', label: 'Who did they beat?', required: true, max: 80 },
            { id: 'date', label: 'Date (YYYY-MM-DD, optional)', max: 10 },
            { id: 'notes', label: 'Notes (optional)', max: 200 }]));
    }
    if (a === 'dx') {
        const res = await attempt(() => capture(interaction, 'title', 'remove-defense', { title: r.title_id, reign: r.id, defense: v }));
        return reignScreen(interaction, r.id, said(res));
    }
    if (a === 'rx') {
        return show(interaction, { content: `Delete **${r.holder || 'this'}**'s reign (${ymd(r.won_date)} → ${r.lost_date ? ymd(r.lost_date) : 'now'}) from the history? This can't be undone.`, embeds: [], files: [],
            components: [row(btn(`ui:tt:rxy:${r.id}`, 'Yes, delete it', D), btn(`ui:tt:r:${r.id}`, 'Keep it'))] });
    }
    if (a === 'rxy') {
        const res = await attempt(() => capture(interaction, 'title', 'reign-remove', { title: r.title_id, reign: r.id }));
        if (res.failed) return reignScreen(interaction, r.id, res.content);
        return titleScreen(interaction, r.title_id, `🗑 ${said(res)}`);
    }
    throw new UserError('That button is from an older version of the bot. Run `/title manage` again.');
}

async function crown(interaction, what, titleId, subject) {
    const r = await attempt(() => capture(interaction, 'title', what, { title: titleId, ...subject }));
    return titleScreen(interaction, titleId, r.failed ? r.content : `✅ ${said(r)}`);
}

async function handleTitleForm(interaction, a, b) {
    requireAdmin(interaction, 'fix title history');
    const { requireTitle } = require('../utils/titleLogic');
    if (a === 'ra') {
        const title = await requireTitle(interaction.guildId, b);
        let holder;
        try { holder = await holderValues(interaction.guildId, title, field(interaction, 'champion')); } catch (e) { if (!(e instanceof UserError)) throw e; return titleScreen(interaction, b, `⚠️ ${e.message}`); }
        const defenses = field(interaction, 'defenses') === '' ? 0 : Number(field(interaction, 'defenses'));
        if (!Number.isInteger(defenses) || defenses < 0 || defenses > 999) return titleScreen(interaction, b, '⚠️ Defenses has to be a whole number. Nothing was added.');
        const r = await attempt(() => capture(interaction, 'title', 'reign-add', { title: title.id, won_date: field(interaction, 'won'), lost_date: field(interaction, 'lost') || null, defenses, notes: field(interaction, 'notes') || null, ...holder }));
        return titleScreen(interaction, b, said(r));
    }
    const reign = await reignRowById(interaction.guildId, b);
    if (a === 're') {
        const defenses = Number(field(interaction, 'defenses'));
        if (!Number.isInteger(defenses) || defenses < 0 || defenses > 999) return reignScreen(interaction, reign.id, '⚠️ Defenses has to be a whole number. Nothing was changed.');
        const yn = field(interaction, 'interim').toLowerCase();
        const r = await attempt(() => capture(interaction, 'title', 'reign-edit', {
            title: reign.title_id, reign: reign.id, won_date: field(interaction, 'won'), lost_date: field(interaction, 'lost') || '-',
            defenses, notes: field(interaction, 'notes') || '-', interim: /^y/.test(yn) }));
        return reignScreen(interaction, reign.id, said(r));
    }
    if (a === 'rc') {
        const title = await requireTitle(interaction.guildId, reign.title_id);
        let holder;
        try { holder = await holderValues(interaction.guildId, title, field(interaction, 'champion'), field(interaction, 'partner')); } catch (e) { if (!(e instanceof UserError)) throw e; return reignScreen(interaction, reign.id, `⚠️ ${e.message}`); }
        const r = await attempt(() => capture(interaction, 'title', 'reign-edit', { title: reign.title_id, reign: reign.id, ...holder }));
        return reignScreen(interaction, reign.id, said(r));
    }
    if (a === 'da') {
        const r = await attempt(() => capture(interaction, 'title', 'add-defense', { title: reign.title_id, reign: reign.id, opponent: field(interaction, 'opponent'), date: field(interaction, 'date') || null, notes: field(interaction, 'notes') || null }));
        return reignScreen(interaction, reign.id, said(r));
    }
    throw new UserError('That form is from an older version of the bot. Run `/title manage` again.');
}

/** From the wrestler picker (hub.js): interim / unify for a singles belt. */
function crownFromPicker(interaction, purpose, titleId, charId) {
    return crown(interaction, purpose === 'tin' ? 'interim' : 'unify', titleId, { character: charId });
}

// ================================================================== routing

async function handle(interaction, parts) {
    const [, kind, a, b, c] = parts;
    if (kind === 'sv') return handleVersus(interaction, a);
    if (kind === 'lz') return handleLegacy(interaction, a, b);
    if (kind === 'lzm') return handleLegacyForm(interaction, a, b);
    if (kind === 'nm' && a === 'o') {
        // a staff-only vote: say so before showing the wrestler list
        requireAdmin(interaction, 'add nominees to this vote');
        return open(interaction, () => hub().pickerPayload(interaction, 'nom', b));
    }
    if (kind === 'nm') return nominate(interaction, b, c);
    if (kind === 'dr') return handleRoster(interaction, a);
    if (kind === 'kb') return handleBonuses(interaction);
    if (kind === 'kbm') return handleBonusesForm(interaction);
    if (kind === 'pl') return handlePle(interaction, a);
    if (kind === 'plm') return handlePleForm(interaction);
    if (kind === 'tt') return handleTitle(interaction, a, b, c);
    if (kind === 'ttm') return handleTitleForm(interaction, a, b);
    throw new UserError('That button is from an older version of the bot. Run the command again.');
}

module.exports = {
    KINDS, handle, statsScreen, standingsScreen, legacyScreen, legacyWrestler, directoryScreen, feudScreen, contractScreen,
    teamScreen, tournamentScreen, titleHome, titleScreen, resultsStaffRow, nominatePick, nominate, crownFromPicker
};
