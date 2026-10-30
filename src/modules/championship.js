const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { pool, withTransaction } = require('../db/pool');
const { autocompleteCharacters, requireCharacter } = require('../utils/characterUtils');
const { autocompleteTeams, requireTeam, getTeamMembers } = require('../utils/teamUtils');
const { autocompleteTitles, requireTitle, setVacancy, vacateTitle, reignHolderName, getCurrentReign, startReign } = require('../utils/titleLogic');
const { logMatch } = require('../utils/matchService');
const { presentMatch, mirrorToMatchesChannel } = require('../utils/matchPresenter');
const { maybeAutoRecap } = require('../utils/showRecap');
const { renderBeltCard, renderLineageCard } = require('../utils/cardRenderer');
const { buildBeltData, buildLineageData } = require('../utils/cardData');
const { requireAdmin, respond, DIVISION_LABELS, NO_MENTIONS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { logAudit } = require('../utils/audit');
const { DIVISION_THEME, FINISHES } = require('../utils/constants');
const { readDetails, stipulationChoices } = require('../utils/matchOptions');
const { titleStatus } = require('../utils/titleWatch');
const { grandSlamProgress } = require('../utils/badges');

const RESULT_CHOICES = [
    { name: 'Decisive (has a winner)', value: 'decisive' },
    { name: 'Draw (champion keeps the title)', value: 'draw' },
    { name: 'No Contest (champion keeps the title)', value: 'no_contest' }
];
const titleOpt = (o, desc = 'Title') => o.setName('title').setDescription(desc).setRequired(true).setAutocomplete(true);

const data = new SlashCommandBuilder()
    .setName('championship')
    .setDescription('Championship titles, reigns and history')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('list').setDescription('All titles and who holds them'))
    .addSubcommand((s) => s.setName('belt').setDescription('Show a title as a belt card').addStringOption((o) => titleOpt(o)))
    .addSubcommand((s) => s.setName('lineage').setDescription('Graphic timeline of every champion of a title').addStringOption((o) => titleOpt(o)))
    .addSubcommand((s) => s.setName('defenses').setDescription("A champion's title defense log (who they beat and when)")
        .addStringOption((o) => titleOpt(o))
        .addIntegerOption((o) => o.setName('reign').setDescription('Reign number from /championship history (default: current or latest)').setRequired(false).setMinValue(1)))
    .addSubcommand((s) => s.setName('history').setDescription('Reign history for a title').addStringOption((o) => titleOpt(o)))
    .addSubcommand((s) => s.setName('log-singles-title-match').setDescription('[Admin] Log a singles championship match')
        .addStringOption((o) => titleOpt(o, 'Title on the line'))
        .addStringOption((o) => o.setName('champion_or_p1').setDescription('Defending champion (or wrestler 1 if vacant)').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('challenger_or_p2').setDescription('Challenger (or wrestler 2 if vacant)').setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('winner').setDescription('Who won').setRequired(true).addChoices({ name: 'Wrestler 1 (champion / first listed)', value: 1 }, { name: 'Wrestler 2 (challenger / second listed)', value: 2 }))
        .addStringOption((o) => o.setName('result_type').setDescription('Default: decisive').setRequired(false).addChoices(...RESULT_CHOICES))
        .addStringOption((o) => o.setName('notes').setDescription('Extra notes').setRequired(false).setMaxLength(300))
        .addStringOption((o) => o.setName('stipulation').setDescription('Match type or stipulation (Ladder, Hell in a Cell...)').setRequired(false).setMaxLength(40).setAutocomplete(true))
        .addStringOption((o) => o.setName('finish').setDescription('How it ended').setRequired(false).addChoices(...FINISHES))
        .addStringOption((o) => o.setName('score').setDescription('Falls or score, like 3-2').setRequired(false).setMaxLength(20)))
    .addSubcommand((s) => s.setName('log-tag-title-match').setDescription('[Admin] Log a 2v2 tag championship match (both sides must be registered teams)')
        .addStringOption((o) => titleOpt(o, 'Tag title on the line'))
        .addStringOption((o) => o.setName('team1_p1').setDescription('Team 1 - Wrestler 1').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('team1_p2').setDescription('Team 1 - Wrestler 2').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('team2_p1').setDescription('Team 2 - Wrestler 1').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('team2_p2').setDescription('Team 2 - Wrestler 2').setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('winning_team').setDescription('Which team won').setRequired(true).addChoices({ name: 'Team 1', value: 1 }, { name: 'Team 2', value: 2 }))
        .addStringOption((o) => o.setName('result_type').setDescription('Default: decisive').setRequired(false).addChoices(...RESULT_CHOICES))
        .addStringOption((o) => o.setName('notes').setDescription('Extra notes').setRequired(false).setMaxLength(300))
        .addStringOption((o) => o.setName('stipulation').setDescription('Match type or stipulation (Ladder, Hell in a Cell...)').setRequired(false).setMaxLength(40).setAutocomplete(true))
        .addStringOption((o) => o.setName('finish').setDescription('How it ended').setRequired(false).addChoices(...FINISHES))
        .addStringOption((o) => o.setName('score').setDescription('Falls or score, like 3-2').setRequired(false).setMaxLength(20)))
    .addSubcommand((s) => s.setName('vacate').setDescription('[Admin] Vacate a title (the reign is ended)')
        .addStringOption((o) => titleOpt(o)))
    .addSubcommand((s) => s.setName('backfill-reign').setDescription('[Admin] Add a reign from before the bot (pick a character, a team, or type a name)')
        .addStringOption((o) => titleOpt(o))
        .addStringOption((o) => o.setName('won_date').setDescription('Date won, YYYY-MM-DD').setRequired(true))
        .addStringOption((o) => o.setName('lost_date').setDescription('Date lost, YYYY-MM-DD (leave empty if still champion)').setRequired(false))
        .addStringOption((o) => o.setName('character').setDescription('Champion, if they are a character in the bot').setRequired(false).setAutocomplete(true))
        .addStringOption((o) => o.setName('team').setDescription('Champion team, for tag titles').setRequired(false).setAutocomplete(true))
        .addStringOption((o) => o.setName('champion_name').setDescription('Champion name as text (when not in the bot)').setRequired(false).setMaxLength(60))
        .addIntegerOption((o) => o.setName('defenses').setDescription('Successful defenses').setRequired(false).setMinValue(0).setMaxValue(999))
        .addStringOption((o) => o.setName('notes').setDescription('Optional note').setRequired(false).setMaxLength(200)))
    .addSubcommand((s) => s.setName('edit-reign').setDescription('[Admin] Fix any reign: dates, defenses or notes (also reigns the bot logged)')
        .addStringOption((o) => titleOpt(o))
        .addIntegerOption((o) => o.setName('reign').setDescription('Reign to edit').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('won_date').setDescription('New won date, YYYY-MM-DD').setRequired(false))
        .addStringOption((o) => o.setName('lost_date').setDescription('New lost date, YYYY-MM-DD (or - for still champion)').setRequired(false))
        .addIntegerOption((o) => o.setName('defenses').setDescription('Defenses').setRequired(false).setMinValue(0).setMaxValue(999))
        .addStringOption((o) => o.setName('notes').setDescription('Note (or - to clear)').setRequired(false).setMaxLength(200))
        .addStringOption((o) => o.setName('character').setDescription('Change the champion to this wrestler').setRequired(false).setAutocomplete(true))
        .addStringOption((o) => o.setName('team').setDescription('Change the champion to this team (tag titles)').setRequired(false).setAutocomplete(true))
        .addStringOption((o) => o.setName('champion_name').setDescription('Change the champion to a plain-text name').setRequired(false).setMaxLength(60))
        .addBooleanOption((o) => o.setName('interim').setDescription('Mark or unmark this as an interim reign').setRequired(false)))
    .addSubcommand((s) => s.setName('watch').setDescription('[Admin] Days since each title was defended and since each champion last wrestled'))
    .addSubcommand((s) => s.setName('grand-slam').setDescription('Who has held every title in a division (and who is close)')
        .addStringOption((o) => o.setName('division').setDescription('Division').setRequired(true).addChoices(...Object.entries(DIVISION_THEME).map(([value, t]) => ({ name: t.label, value })))))
    .addSubcommand((s) => s.setName('rematches').setDescription('Champions who lost a belt and are owed a rematch'))
    .addSubcommand((s) => s.setName('waive-rematch').setDescription('[Admin] Cancel a rematch that is owed')
        .addIntegerOption((o) => o.setName('rematch').setDescription('Rematch to cancel').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('interim').setDescription('[Admin] Crown an interim champion (the current reign is ended and noted)')
        .addStringOption((o) => titleOpt(o))
        .addStringOption((o) => o.setName('character').setDescription('Interim champion (singles titles)').setRequired(false).setAutocomplete(true))
        .addStringOption((o) => o.setName('team').setDescription('Interim champions (tag titles)').setRequired(false).setAutocomplete(true))
        .addStringOption((o) => o.setName('reason').setDescription('Why (injury, absence...)').setRequired(false).setMaxLength(100)))
    .addSubcommand((s) => s.setName('unify').setDescription('[Admin] Unify: the real or interim champion becomes the undisputed champion')
        .addStringOption((o) => titleOpt(o))
        .addStringOption((o) => o.setName('character').setDescription('Undisputed champion (singles titles)').setRequired(false).setAutocomplete(true))
        .addStringOption((o) => o.setName('team').setDescription('Undisputed champions (tag titles)').setRequired(false).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('remove-reign').setDescription('[Admin] Delete a reign entered by mistake (backfilled or bot-logged)')
        .addStringOption((o) => titleOpt(o))
        .addIntegerOption((o) => o.setName('reign').setDescription('Reign to delete').setRequired(true).setAutocomplete(true)));

function parseDate(str, label) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) throw new UserError(`${label} must look like 2025-03-21 (year-month-day).`);
    const d = new Date(`${str}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== str) throw new UserError(`${label} isn't a real date.`);
    return str;
}
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'Present');
const daysBetween = (a, b) => Math.max(0, Math.round(((b ? new Date(b) : new Date()) - new Date(a)) / 864e5));

async function reignAutocomplete(interaction, focused) {
    const titleId = interaction.options.getString('title');
    if (!titleId || !/^\d+$/.test(titleId)) return [];
    const { rows } = await pool.query(
        `SELECT tr.id, tr.won_date, tr.lost_date, tr.is_backfilled, c.name AS character_name, tm.name AS team_name, tr.reign_char_name,
                ROW_NUMBER() OVER (ORDER BY tr.won_date, tr.id) AS n
         FROM title_reigns tr LEFT JOIN characters c ON c.id = tr.character_id LEFT JOIN teams tm ON tm.id = tr.team_id
         WHERE tr.title_id = $1 AND tr.guild_id = $2 ORDER BY tr.won_date DESC, tr.id DESC LIMIT 25`,
        [titleId, interaction.guildId]
    );
    const q = String(focused || '').toLowerCase();
    return rows
        .map((r) => ({ name: `#${r.n} ${reignHolderName(r)} (${fmtDate(r.won_date)} → ${fmtDate(r.lost_date)})${r.is_backfilled ? '' : ' [bot-logged]'}`.slice(0, 100), value: Number(r.id) }))
        .filter((o) => o.name.toLowerCase().includes(q));
}

async function assertNoOverlap(client, titleId, won, lost, exceptId = null) {
    const { rows } = await client.query(
        `SELECT tr.id, tr.won_date, tr.lost_date, c.name AS character_name, tm.name AS team_name, tr.reign_char_name
         FROM title_reigns tr LEFT JOIN characters c ON c.id = tr.character_id LEFT JOIN teams tm ON tm.id = tr.team_id
         WHERE tr.title_id = $1 AND ($4::bigint IS NULL OR tr.id <> $4)
           AND tr.won_date < COALESCE($3::date, 'infinity'::date) AND COALESCE(tr.lost_date, 'infinity'::date) > $2::date
         LIMIT 1`,
        [titleId, won, lost, exceptId]
    );
    if (rows.length) {
        const r = rows[0];
        throw new UserError(`That overlaps the reign of **${reignHolderName(r)}** (${fmtDate(r.won_date)} → ${fmtDate(r.lost_date)}). Two people can't hold a title at the same time. Adjust the dates, or fix the other reign first.`);
    }
}


/** The defense log for one reign (default: current or latest). Throws UserError when there is nothing to show. */
async function defensesEmbed(title, want = null) {
    const { rows: reigns } = await pool.query(
        `SELECT * FROM (
            SELECT tr.*, c.name AS character_name, tm.name AS team_name, ROW_NUMBER() OVER (ORDER BY tr.won_date, tr.id)::int AS n
            FROM title_reigns tr LEFT JOIN characters c ON c.id = tr.character_id LEFT JOIN teams tm ON tm.id = tr.team_id
            WHERE tr.title_id = $1) x ORDER BY n`, [title.id]);
    if (!reigns.length) throw new UserError(`The **${title.name}** has no reign history yet.`);
    const reign = want ? reigns.find((r) => r.n === want) : reigns[reigns.length - 1];
    if (!reign) throw new UserError(`The **${title.name}** only has ${reigns.length} reign${reigns.length === 1 ? '' : 's'}.`);
    const { rows: defs } = await pool.query(
        `SELECT m.id, m.created_at,
                (SELECT string_agg(c.name, ' & ' ORDER BY mp.id) FROM match_participants mp JOIN characters c ON c.id = mp.character_id
                  WHERE mp.match_id = m.id AND NOT mp.is_winner) AS opponents
         FROM matches m WHERE m.title_id = $1 AND m.title_effect->>'type' = 'defense' AND m.title_effect->>'reign_id' = $2
         ORDER BY m.created_at, m.id`, [title.id, String(reign.id)]);
    const { rows: manual } = await pool.query(`SELECT * FROM reign_defenses WHERE reign_id = $1 ORDER BY defended_on NULLS LAST, id`, [reign.id]);
    const holder = reignHolderName(reign);
    const lines = [
        ...manual.map((d) => ({ at: d.defended_on ? new Date(d.defended_on).getTime() : 0, text: `vs ${d.opponent}${d.defended_on ? ` · ${fmtDate(d.defended_on)}` : ''}${d.notes ? ` · _${d.notes}_` : ''}` })),
        ...defs.map((d) => ({ at: new Date(d.created_at).getTime(), text: `vs ${d.opponents || 'unknown'} · <t:${Math.floor(new Date(d.created_at).getTime() / 1000)}:D> · match #${d.id}` }))
    ].sort((a, b) => a.at - b.at).map((x, i) => `**${i + 1}.** ${x.text}`);
    const older = reign.defenses - defs.length - manual.length;
    if (older > 0) lines.push(`_+ ${older} defense${older === 1 ? '' : 's'} counted without details (add them with \`/reign add-defense\`)_`);
    return new EmbedBuilder().setTitle(`${holder}: ${title.name}`).setColor(0xE8BF4A)
        .setDescription(`Reign #${reign.n} · ${fmtDate(reign.won_date)} → ${fmtDate(reign.lost_date)} · ${daysBetween(reign.won_date, reign.lost_date)} days · **${reign.defenses}** defense${reign.defenses === 1 ? '' : 's'}\n\n${lines.length ? lines.join('\n') : 'No title defenses yet.'}`.slice(0, 4000));
}

/** The reign history embed for a title, or null when it has none. */
async function historyEmbed(title) {
    const { rows } = await pool.query(
        `SELECT * FROM (
            SELECT tr.*, c.name AS character_name, tm.name AS team_name, ROW_NUMBER() OVER (ORDER BY tr.won_date, tr.id) AS n
            FROM title_reigns tr LEFT JOIN characters c ON c.id = tr.character_id LEFT JOIN teams tm ON tm.id = tr.team_id
            WHERE tr.title_id = $1) x ORDER BY won_date DESC, id DESC LIMIT 20`, [title.id]);
    if (!rows.length) return null;
    const { rows: own } = await pool.query(`SELECT ro.reign_id, u.discord_id FROM reign_owners ro JOIN users u ON u.id = ro.user_id WHERE ro.reign_id = ANY($1::bigint[])`, [rows.map((r) => r.id)]);
    const played = (id) => { const m = own.filter((o) => String(o.reign_id) === String(id)).map((o) => `<@${o.discord_id}>`); return m.length ? ` · played by ${m.join(' & ')}` : ''; };
    const lines = rows.map((r) => `**#${r.n} ${reignHolderName(r)}**${played(r.id)}${r.is_backfilled ? ' _(historical)_' : ''}\n${fmtDate(r.won_date)} → ${fmtDate(r.lost_date)} · ${daysBetween(r.won_date, r.lost_date)} days · ${r.defenses} defense${r.defenses === 1 ? '' : 's'}${r.notes ? `\n_${r.notes}_` : ''}`);
    return new EmbedBuilder().setTitle(`${title.name} — Reign History`).setColor(0xE8BF4A).setDescription(lines.join('\n\n').slice(0, 4000)).setFooter({ text: rows.length === 20 ? 'Showing the 20 most recent reigns' : `${rows.length} reign(s)` });
}

/** Works out who held a reign from the character / team / champion_name options (exactly one). */
async function resolveHolder(guildId, title, interaction) {
    const charVal = interaction.options.getString('character');
    const teamVal = interaction.options.getString('team');
    const nameVal = interaction.options.getString('champion_name');
    if ([charVal, teamVal, nameVal].filter(Boolean).length !== 1) {
        throw new UserError('Fill in exactly ONE of: `character` (a wrestler in the bot), `team` (a registered team) or `champion_name` (plain text).');
    }
    let character = null, team = null, members = [];
    if (charVal) {
        if (title.is_tag_title) throw new UserError('That is a tag title. Pick a `team` or type a `champion_name`.');
        character = await requireCharacter(guildId, charVal, { statuses: ['approved', 'retired'] });
        if (character.division !== title.division) throw new UserError(`**${character.name}** is in a different division than the **${title.name}**.`);
    } else if (teamVal) {
        if (!title.is_tag_title) throw new UserError('That is a singles title. Pick a `character` or type a `champion_name`.');
        team = await requireTeam(guildId, teamVal, { active: false });
        if (team.division !== title.division) throw new UserError(`**${team.name}** is in a different division than the **${title.name}**.`);
        members = await getTeamMembers(team.id);
        if (!members.length) {
            const { rows } = await pool.query(`SELECT c.* FROM team_members tm JOIN characters c ON c.id = tm.character_id WHERE tm.team_id = $1`, [team.id]);
            members = rows;
        }
    }
    return { character, team, members, nameVal };
}

async function runTitleMatch(interaction, matchType, slotIds, winnerIndex, winningTeam) {
    const result = await logMatch({
        guildId: interaction.guildId, matchType, slotCharacterIds: slotIds, winnerIndex, winningTeam,
        resultType: interaction.options.getString('result_type') || 'decisive',
        notes: interaction.options.getString('notes'),
        titleValue: interaction.options.getString('title'),
        ...readDetails(interaction),
        actor: interaction.user.id
    });
    await interaction.deferReply();
    const { payload } = await presentMatch(interaction, result);
    await interaction.editReply(payload);
    await mirrorToMatchesChannel(interaction, payload);
    await maybeAutoRecap(interaction, result);
}

module.exports = {
    data, runTitleMatch, defensesEmbed, historyEmbed, daysBetween, fmtDate, reignAutocomplete, parseDate,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        if (focused.name === 'stipulation') return interaction.respond(stipulationChoices(focused.value));
        if (focused.name === 'title') return interaction.respond(await autocompleteTitles(interaction, focused.value));
        if (focused.name === 'rematch') {
            const { rows } = await pool.query(
                `SELECT rr.id, rr.holder_name, t.name AS title_name FROM rematch_rights rr JOIN titles t ON t.id = rr.title_id
                 WHERE rr.guild_id = $1 AND rr.status = 'active' ORDER BY rr.expires_on LIMIT 25`, [interaction.guildId]);
            return interaction.respond(rows.map((r) => ({ name: `${r.holder_name} — ${r.title_name}`.slice(0, 100), value: Number(r.id) })));
        }
        if (focused.name === 'reign') return interaction.respond(await reignAutocomplete(interaction, focused.value));
        if (focused.name === 'team') return interaction.respond(await autocompleteTeams(interaction, focused.value));
        return interaction.respond(await autocompleteCharacters(interaction, focused.value));
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'list') {
            const { rows } = await pool.query(
                `SELECT t.id, t.name, t.division, t.is_tag_title,
                        tr.id AS reign_id, tr.is_interim, tr.defenses, tr.won_date, tr.character_id, tr.team_id,
                        c.name AS champ_name, u.discord_id, tm.name AS team_name, tr.reign_char_name,
                        (SELECT COALESCE(t2.name, c2.name) FROM contenders co LEFT JOIN teams t2 ON t2.id = co.team_id LEFT JOIN characters c2 ON c2.id = co.character_id
                          WHERE co.title_id = t.id AND co.status = 'active') AS contender
                 FROM titles t
                 LEFT JOIN title_reigns tr ON tr.title_id = t.id AND tr.lost_date IS NULL
                 LEFT JOIN characters c ON c.id = tr.character_id
                 LEFT JOIN users u ON u.id = c.owner_id
                 LEFT JOIN teams tm ON tm.id = tr.team_id
                 WHERE t.guild_id = $1 ORDER BY t.division, t.is_tag_title, t.name`, [guildId]);
            const members = new Map();
            for (const r of rows.filter((x) => x.team_id)) {
                const { rows: m } = await pool.query(`SELECT c.name FROM title_reign_members trm JOIN characters c ON c.id = trm.character_id WHERE trm.reign_id = $1 ORDER BY trm.id`, [r.reign_id]);
                members.set(r.reign_id, m.map((x) => x.name));
            }
            const fmt = (r) => {
                let holder;
                if (!r.reign_id) holder = '_Vacant_';
                else if (r.team_id) holder = `**${r.team_name}** (${(members.get(r.reign_id) || []).join(' & ')})`;
                else if (r.character_id) holder = `**${r.champ_name}** (<@${r.discord_id}>)`;
                else holder = `**${r.reign_char_name}**`;
                const extra = r.reign_id ? `${r.is_interim ? ' · _interim_' : ''} · ${r.defenses} def. · ${daysBetween(r.won_date)}d` : '';
                return `**${r.name}**\n${holder}${extra}${r.contender ? `\n🎯 #1 contender: ${r.contender}` : ''}`;
            };
            const embed = new EmbedBuilder().setTitle('🏆 Championship Titles').setColor(0xE8BF4A);
            for (const div of ['mens', 'womens', 'custom', 'custom_womens']) {
                const list = rows.filter((r) => r.division === div);
                if (list.length) embed.addFields({ name: `${DIVISION_THEME[div].label} Division`, value: list.map(fmt).join('\n\n').slice(0, 1024) });
            }
            return respond(interaction, { embeds: [embed], allowedMentions: NO_MENTIONS });
        }

        if (sub === 'belt') {
            const title = await requireTitle(guildId, interaction.options.getString('title'));
            await interaction.deferReply();
            const buffer = await renderBeltCard(await buildBeltData(interaction.guild, title));
            return interaction.editReply({ files: [new AttachmentBuilder(buffer, { name: 'belt.png' })] });
        }

        if (sub === 'lineage') {
            const title = await requireTitle(guildId, interaction.options.getString('title'));
            await interaction.deferReply();
            const buffer = await renderLineageCard(await buildLineageData(interaction.guild, title));
            return interaction.editReply({ files: [new AttachmentBuilder(buffer, { name: 'lineage.png' })] });
        }

        if (sub === 'defenses') {
            const title = await requireTitle(guildId, interaction.options.getString('title'));
            return respond(interaction, { embeds: [await defensesEmbed(title, interaction.options.getInteger('reign'))], allowedMentions: NO_MENTIONS });
        }

        if (sub === 'history') {
            const title = await requireTitle(guildId, interaction.options.getString('title'));
            const embed = await historyEmbed(title);
            if (!embed) return respond(interaction, { content: `No reign history for the **${title.name}** yet.`, flags: 64 });
            return respond(interaction, { embeds: [embed] });
        }

        requireAdmin(interaction, 'change championships');

        if (sub === 'log-singles-title-match') {
            return runTitleMatch(interaction, 'singles',
                [interaction.options.getString('champion_or_p1'), interaction.options.getString('challenger_or_p2')],
                interaction.options.getInteger('winner') - 1, null);
        }
        if (sub === 'log-tag-title-match') {
            return runTitleMatch(interaction, 'tag2v2',
                ['team1_p1', 'team1_p2', 'team2_p1', 'team2_p2'].map((n) => interaction.options.getString(n)),
                null, interaction.options.getInteger('winning_team'));
        }

        if (sub === 'vacate') {
            const title = await requireTitle(guildId, interaction.options.getString('title'));
            const ended = await withTransaction((client) => vacateTitle(client, title.id));
            if (!ended) throw new UserError(`The **${title.name}** is already vacant.`);
            await logAudit(guildId, interaction.user.id, 'title_vacated', { title: title.name, holder: reignHolderName(ended) });
            return respond(interaction, { content: `The **${title.name}** is now vacant. **${reignHolderName(ended)}**'s reign ended after ${daysBetween(ended.won_date)} days.`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'backfill-reign') {
            const title = await requireTitle(guildId, interaction.options.getString('title'));
            const won = parseDate(interaction.options.getString('won_date'), 'Won date');
            const lostRaw = interaction.options.getString('lost_date');
            const lost = lostRaw ? parseDate(lostRaw, 'Lost date') : null;
            if (won > today()) throw new UserError('The won date can\'t be in the future.');
            if (lost && lost < won) throw new UserError('The lost date can\'t be before the won date.');
            if (lost && lost > today()) throw new UserError('The lost date can\'t be in the future.');

            const { character, team, members, nameVal } = await resolveHolder(guildId, title, interaction);
            const defenses = interaction.options.getInteger('defenses') || 0;
            const notes = interaction.options.getString('notes');

            await withTransaction(async (client) => {
                await assertNoOverlap(client, title.id, won, lost);
                const { rows } = await client.query(
                    `INSERT INTO title_reigns (guild_id, title_id, character_id, team_id, reign_char_name, won_date, lost_date, defenses, is_backfilled, entered_by, notes)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10) RETURNING id`,
                    [guildId, title.id, character?.id || null, team?.id || null, nameVal || null, won, lost, defenses, interaction.user.id, notes]);
                for (const m of members) await client.query(`INSERT INTO title_reign_members (reign_id, character_id) VALUES ($1,$2)`, [rows[0].id, m.id]);
                await setVacancy(client, title.id);
            });
            const who = character?.name || team?.name || nameVal;
            await logAudit(guildId, interaction.user.id, 'reign_backfilled', { title: title.name, who, won, lost });
            return respond(interaction, { content: `Added **${who}**'s reign of the **${title.name}** (${won} → ${lost || 'present'}${defenses ? `, ${defenses} defenses` : ''}).`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'watch') {
            requireAdmin(interaction, 'see the title watch');
            const status = await titleStatus(guildId);
            if (!status.length) return respond(interaction, { content: 'No title currently has a champion that I can track.', flags: 64 });
            const settings = await require('../utils/ensureGuild').getGuildSettings(guildId);
            const lines = status.map((s) => {
                const warnD = settings.defense_days && s.daysSinceDefense >= settings.defense_days ? ' ⚠️' : '';
                const warnA = settings.vacate_days && s.daysSinceActive >= settings.vacate_days - 7 ? ' ⏳' : '';
                return `**${s.title_name}**${s.is_interim ? ' _(interim)_' : ''}: ${s.holder}${s.injured ? ' 🤕' : ''}\nlast defense **${s.daysSinceDefense}d** ago${warnD} · champion last wrestled **${s.daysSinceActive}d** ago${warnA}`;
            });
            const embed = new EmbedBuilder().setTitle('Title Watch').setColor(0xE8BF4A).setDescription(lines.join('\n\n').slice(0, 4000))
                .setFooter({ text: `Warn after ${settings.defense_days || '—'}d without a defense · auto-vacate after ${settings.vacate_days || '—'}d inactive (/admin deadlines)` });
            return respond(interaction, { embeds: [embed], flags: 64, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'grand-slam') {
            const division = interaction.options.getString('division');
            const gs = await grandSlamProgress(guildId, division);
            if (!gs.total) return respond(interaction, { content: 'That division has no titles.', flags: 64 });
            const done = gs.rows.filter((r) => r.complete);
            const close = gs.rows.filter((r) => !r.complete && r.n >= Math.max(1, gs.total - 2)).slice(0, 10);
            const embed = new EmbedBuilder().setTitle(`Grand Slam — ${DIVISION_THEME[division].label}`).setColor(DIVISION_THEME[division].embed)
                .setDescription(`A grand slam means holding **every** title in the division (${gs.total} titles).`)
                .addFields(
                    { name: '🏅 Grand Slam Champions', value: done.length ? done.map((r) => `**${r.name}**`).join('\n') : '_Nobody yet_' },
                    { name: 'Closest', value: close.length ? close.map((r) => `${r.name}: ${r.n}/${gs.total}`).join('\n') : '—' });
            return respond(interaction, { embeds: [embed], allowedMentions: NO_MENTIONS });
        }

        if (sub === 'rematches') {
            const { rows } = await pool.query(
                `SELECT rr.id, rr.holder_name, rr.expires_on, t.name AS title_name FROM rematch_rights rr JOIN titles t ON t.id = rr.title_id
                 WHERE rr.guild_id = $1 AND rr.status = 'active' ORDER BY rr.expires_on`, [guildId]);
            if (!rows.length) return respond(interaction, { content: 'Nobody is owed a rematch right now.', flags: 64 });
            const lines = rows.map((r) => `🔁 **${r.holder_name}** — ${r.title_name} (until ${fmtDate(r.expires_on)})`);
            return respond(interaction, { embeds: [new EmbedBuilder().setTitle('Rematches Owed').setColor(0xE8BF4A).setDescription(lines.join('\n'))], allowedMentions: NO_MENTIONS });
        }

        if (sub === 'waive-rematch') {
            requireAdmin(interaction, 'cancel rematches');
            const { rowCount } = await pool.query(`UPDATE rematch_rights SET status = 'waived' WHERE id = $1 AND guild_id = $2 AND status = 'active'`, [interaction.options.getInteger('rematch'), guildId]);
            if (!rowCount) throw new UserError('I couldn\'t find that rematch. Pick one from the list.');
            await logAudit(guildId, interaction.user.id, 'rematch_waived', {});
            return respond(interaction, { content: 'Rematch cancelled.' });
        }

        if (sub === 'interim' || sub === 'unify') {
            const title = await requireTitle(guildId, interaction.options.getString('title'));
            const charVal = interaction.options.getString('character');
            const teamVal = interaction.options.getString('team');
            if ([charVal, teamVal].filter(Boolean).length !== 1) throw new UserError('Fill in exactly ONE of `character` (singles title) or `team` (tag title).');
            let subject, members = [], name;
            if (charVal) {
                if (title.is_tag_title) throw new UserError('That is a tag title. Pick a `team`.');
                const c = await requireCharacter(guildId, charVal, { statuses: ['approved'] });
                if (c.division !== title.division) throw new UserError(`**${c.name}** is in a different division than the **${title.name}**.`);
                subject = { type: 'character', id: c.id }; name = c.name;
            } else {
                if (!title.is_tag_title) throw new UserError('That is a singles title. Pick a `character`.');
                const t = await requireTeam(guildId, teamVal, { active: true });
                if (t.division !== title.division) throw new UserError(`**${t.name}** is in a different division than the **${title.name}**.`);
                members = await getTeamMembers(t.id);
                subject = { type: 'team', id: t.id }; name = t.name;
            }
            const reason = sub === 'interim' ? interaction.options.getString('reason') : null;
            const text = await withTransaction(async (client) => {
                const cur = await getCurrentReign(title.id, client, true);
                if (sub === 'interim') {
                    if (cur?.is_interim) throw new UserError('There is already an interim champion. Use `/championship unify` or `/championship vacate` first.');
                    if (cur) {
                        await client.query(`UPDATE title_reigns SET lost_date = CURRENT_DATE, notes = COALESCE(notes || ' · ', '') || $2 WHERE id = $1`,
                            [cur.id, `Interim champion crowned${reason ? ` (${reason})` : ''}`]);
                    }
                    await startReign(client, { guildId, title, subject, memberIds: members.map((m) => m.id), matchId: null, actor: interaction.user.id,
                        notes: reason ? `Interim: ${reason}` : 'Interim champion', interim: true });
                    await setVacancy(client, title.id);
                    return `**${name}** is the interim champion of the **${title.name}**${cur ? ` (${reignHolderName(cur)}'s reign was ended)` : ''}.`;
                }
                // unify: close any current reign and start a normal one
                if (cur) await client.query(`UPDATE title_reigns SET lost_date = CURRENT_DATE WHERE id = $1`, [cur.id]);
                const same = cur && ((subject.type === 'team' && String(cur.team_id) === String(subject.id)) || (subject.type === 'character' && !cur.team_id && String(cur.character_id) === String(subject.id)));
                if (same && cur.is_interim) {
                    // the interim champion simply becomes the real one: keep their reign running as a normal reign
                    await client.query(`UPDATE title_reigns SET lost_date = NULL, is_interim = false, notes = COALESCE(notes || ' · ', '') || 'Unified' WHERE id = $1`, [cur.id]);
                } else {
                    await startReign(client, { guildId, title, subject, memberIds: members.map((m) => m.id), matchId: null, actor: interaction.user.id, notes: 'Unified champion' });
                }
                await setVacancy(client, title.id);
                return `**${name}** is the undisputed champion of the **${title.name}**.`;
            });
            await logAudit(guildId, interaction.user.id, sub === 'interim' ? 'interim_crowned' : 'title_unified', { title: title.name, who: name });
            return respond(interaction, { content: text, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'edit-reign' || sub === 'remove-reign') {
            const title = await requireTitle(guildId, interaction.options.getString('title'));
            const reignId = interaction.options.getInteger('reign');
            const { rows } = await pool.query(`SELECT * FROM title_reigns WHERE id = $1 AND title_id = $2 AND guild_id = $3`, [reignId, title.id, guildId]);
            const reign = rows[0];
            if (!reign) throw new UserError('I couldn\'t find that reign. Choose it from the dropdown after picking the title.');
            if (sub === 'remove-reign') {
                await withTransaction(async (client) => {
                    await client.query(`DELETE FROM title_reigns WHERE id = $1`, [reign.id]);
                    await setVacancy(client, title.id);
                });
                await logAudit(guildId, interaction.user.id, 'reign_removed', { title: title.name, reignId, botLogged: !reign.is_backfilled });
                return respond(interaction, { content: `Deleted that reign from the **${title.name}** history.${reign.is_backfilled ? '' : ' It came from a logged match, so that match can no longer be undone with `/match undo` (the match result itself stays in the records).'}` });
            }

            const wonRaw = interaction.options.getString('won_date');
            const lostRaw = interaction.options.getString('lost_date');
            const won = wonRaw ? parseDate(wonRaw, 'Won date') : new Date(reign.won_date).toISOString().slice(0, 10);
            const lost = lostRaw === '-' ? null : lostRaw ? parseDate(lostRaw, 'Lost date') : reign.lost_date ? new Date(reign.lost_date).toISOString().slice(0, 10) : null;
            if (lost && lost < won) throw new UserError('The lost date can\'t be before the won date.');
            const defenses = interaction.options.getInteger('defenses');
            const notesRaw = interaction.options.getString('notes');
            const interim = interaction.options.getBoolean('interim');
            const changeHolder = ['character', 'team', 'champion_name'].some((k) => interaction.options.getString(k));
            const holder = changeHolder ? await resolveHolder(guildId, title, interaction) : null;
            await withTransaction(async (client) => {
                await assertNoOverlap(client, title.id, won, lost, reign.id);
                await client.query(
                    `UPDATE title_reigns SET won_date = $2, lost_date = $3, defenses = COALESCE($4, defenses), notes = $5,
                            is_interim = COALESCE($6, is_interim) WHERE id = $1`,
                    [reign.id, won, lost, defenses, notesRaw === null ? reign.notes : notesRaw === '-' ? null : notesRaw, interim]);
                if (holder) {
                    await client.query(`UPDATE title_reigns SET character_id = $2, team_id = $3, reign_char_name = $4 WHERE id = $1`,
                        [reign.id, holder.character?.id || null, holder.team?.id || null, holder.nameVal || null]);
                    await client.query(`DELETE FROM title_reign_members WHERE reign_id = $1`, [reign.id]);
                    for (const m of holder.members) await client.query(`INSERT INTO title_reign_members (reign_id, character_id) VALUES ($1,$2)`, [reign.id, m.id]);
                }
                await setVacancy(client, title.id);
            });
            await logAudit(guildId, interaction.user.id, 'reign_edited', { title: title.name, reignId });
            return respond(interaction, { content: `Updated that reign: ${won} → ${lost || 'present'}${holder ? `, champion is now **${holder.character?.name || holder.team?.name || holder.nameVal}**` : ''}.`, allowedMentions: NO_MENTIONS });
        }
    }
};
