const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { pool, withTransaction } = require('../db/pool');
const { autocompleteCharacters, requireCharacter } = require('../utils/characterUtils');
const { autocompleteTeams, requireTeam, getTeamMembers } = require('../utils/teamUtils');
const { autocompleteTitles, requireTitle, setVacancy, vacateTitle, reignHolderName } = require('../utils/titleLogic');
const { logMatch } = require('../utils/matchService');
const { presentMatch, mirrorToMatchesChannel } = require('../utils/matchPresenter');
const { renderBeltCard } = require('../utils/cardRenderer');
const { buildBeltData } = require('../utils/cardData');
const { requireAdmin, respond, DIVISION_LABELS, NO_MENTIONS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { logAudit } = require('../utils/audit');
const { DIVISION_THEME } = require('../utils/constants');

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
    .addSubcommand((s) => s.setName('history').setDescription('Reign history for a title').addStringOption((o) => titleOpt(o)))
    .addSubcommand((s) => s.setName('log-singles-title-match').setDescription('[Admin] Log a singles championship match')
        .addStringOption((o) => titleOpt(o, 'Title on the line'))
        .addStringOption((o) => o.setName('champion_or_p1').setDescription('Defending champion (or wrestler 1 if vacant)').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('challenger_or_p2').setDescription('Challenger (or wrestler 2 if vacant)').setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('winner').setDescription('Who won').setRequired(true).addChoices({ name: 'Wrestler 1 (champion / first listed)', value: 1 }, { name: 'Wrestler 2 (challenger / second listed)', value: 2 }))
        .addStringOption((o) => o.setName('result_type').setDescription('Default: decisive').setRequired(false).addChoices(...RESULT_CHOICES))
        .addStringOption((o) => o.setName('notes').setDescription('Stipulation or notes').setRequired(false).setMaxLength(300)))
    .addSubcommand((s) => s.setName('log-tag-title-match').setDescription('[Admin] Log a 2v2 tag championship match (both sides must be registered teams)')
        .addStringOption((o) => titleOpt(o, 'Tag title on the line'))
        .addStringOption((o) => o.setName('team1_p1').setDescription('Team 1 - Wrestler 1').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('team1_p2').setDescription('Team 1 - Wrestler 2').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('team2_p1').setDescription('Team 2 - Wrestler 1').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('team2_p2').setDescription('Team 2 - Wrestler 2').setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('winning_team').setDescription('Which team won').setRequired(true).addChoices({ name: 'Team 1', value: 1 }, { name: 'Team 2', value: 2 }))
        .addStringOption((o) => o.setName('result_type').setDescription('Default: decisive').setRequired(false).addChoices(...RESULT_CHOICES))
        .addStringOption((o) => o.setName('notes').setDescription('Stipulation or notes').setRequired(false).setMaxLength(300)))
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
    .addSubcommand((s) => s.setName('edit-reign').setDescription('[Admin] Fix a backfilled reign')
        .addStringOption((o) => titleOpt(o))
        .addIntegerOption((o) => o.setName('reign').setDescription('Reign to edit').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('won_date').setDescription('New won date, YYYY-MM-DD').setRequired(false))
        .addStringOption((o) => o.setName('lost_date').setDescription('New lost date, YYYY-MM-DD (or - for still champion)').setRequired(false))
        .addIntegerOption((o) => o.setName('defenses').setDescription('Defenses').setRequired(false).setMinValue(0).setMaxValue(999))
        .addStringOption((o) => o.setName('notes').setDescription('Note (or - to clear)').setRequired(false).setMaxLength(200)))
    .addSubcommand((s) => s.setName('remove-reign').setDescription('[Admin] Delete a backfilled reign entered by mistake')
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

async function runTitleMatch(interaction, matchType, slotIds, winnerIndex, winningTeam) {
    const result = await logMatch({
        guildId: interaction.guildId, matchType, slotCharacterIds: slotIds, winnerIndex, winningTeam,
        resultType: interaction.options.getString('result_type') || 'decisive',
        notes: interaction.options.getString('notes'),
        titleValue: interaction.options.getString('title'),
        actor: interaction.user.id
    });
    await interaction.deferReply();
    const { payload } = await presentMatch(interaction, result);
    await interaction.editReply(payload);
    await mirrorToMatchesChannel(interaction, payload);
}

module.exports = {
    data,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        if (focused.name === 'title') return interaction.respond(await autocompleteTitles(interaction, focused.value));
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
                        tr.id AS reign_id, tr.defenses, tr.won_date, tr.character_id, tr.team_id,
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
                const extra = r.reign_id ? ` · ${r.defenses} def. · ${daysBetween(r.won_date)}d` : '';
                return `**${r.name}**\n${holder}${extra}${r.contender ? `\n🎯 #1 contender: ${r.contender}` : ''}`;
            };
            const embed = new EmbedBuilder().setTitle('🏆 Championship Titles').setColor(0xE8BF4A);
            for (const div of ['mens', 'womens', 'custom']) {
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

        if (sub === 'history') {
            const title = await requireTitle(guildId, interaction.options.getString('title'));
            const { rows } = await pool.query(
                `SELECT * FROM (
                    SELECT tr.*, c.name AS character_name, tm.name AS team_name, ROW_NUMBER() OVER (ORDER BY tr.won_date, tr.id) AS n
                    FROM title_reigns tr LEFT JOIN characters c ON c.id = tr.character_id LEFT JOIN teams tm ON tm.id = tr.team_id
                    WHERE tr.title_id = $1) x ORDER BY won_date DESC, id DESC LIMIT 20`, [title.id]);
            if (!rows.length) return respond(interaction, { content: `No reign history for the **${title.name}** yet.`, flags: 64 });
            const lines = rows.map((r) => `**#${r.n} ${reignHolderName(r)}**${r.is_backfilled ? ' _(historical)_' : ''}\n${fmtDate(r.won_date)} → ${fmtDate(r.lost_date)} · ${daysBetween(r.won_date, r.lost_date)} days · ${r.defenses} defense${r.defenses === 1 ? '' : 's'}${r.notes ? `\n_${r.notes}_` : ''}`);
            return respond(interaction, { embeds: [new EmbedBuilder().setTitle(`${title.name} — Reign History`).setColor(0xE8BF4A).setDescription(lines.join('\n\n').slice(0, 4000)).setFooter({ text: rows.length === 20 ? 'Showing the 20 most recent reigns' : `${rows.length} reign(s)` })] });
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

        if (sub === 'edit-reign' || sub === 'remove-reign') {
            const title = await requireTitle(guildId, interaction.options.getString('title'));
            const reignId = interaction.options.getInteger('reign');
            const { rows } = await pool.query(`SELECT * FROM title_reigns WHERE id = $1 AND title_id = $2 AND guild_id = $3`, [reignId, title.id, guildId]);
            const reign = rows[0];
            if (!reign) throw new UserError('I couldn\'t find that reign. Choose it from the dropdown after picking the title.');
            if (!reign.is_backfilled) throw new UserError('That reign was created from a logged match. To change it, use `/match undo` on the match instead (editing it here could make records disagree).');

            if (sub === 'remove-reign') {
                await withTransaction(async (client) => {
                    await client.query(`DELETE FROM title_reigns WHERE id = $1`, [reign.id]);
                    await setVacancy(client, title.id);
                });
                await logAudit(guildId, interaction.user.id, 'reign_removed', { title: title.name, reignId });
                return respond(interaction, { content: `Deleted that backfilled reign from the **${title.name}** history.` });
            }

            const wonRaw = interaction.options.getString('won_date');
            const lostRaw = interaction.options.getString('lost_date');
            const won = wonRaw ? parseDate(wonRaw, 'Won date') : new Date(reign.won_date).toISOString().slice(0, 10);
            const lost = lostRaw === '-' ? null : lostRaw ? parseDate(lostRaw, 'Lost date') : reign.lost_date ? new Date(reign.lost_date).toISOString().slice(0, 10) : null;
            if (lost && lost < won) throw new UserError('The lost date can\'t be before the won date.');
            const defenses = interaction.options.getInteger('defenses');
            const notesRaw = interaction.options.getString('notes');
            await withTransaction(async (client) => {
                await assertNoOverlap(client, title.id, won, lost, reign.id);
                await client.query(
                    `UPDATE title_reigns SET won_date = $2, lost_date = $3, defenses = COALESCE($4, defenses), notes = $5 WHERE id = $1`,
                    [reign.id, won, lost, defenses, notesRaw === null ? reign.notes : notesRaw === '-' ? null : notesRaw]);
                await setVacancy(client, title.id);
            });
            await logAudit(guildId, interaction.user.id, 'reign_edited', { title: title.name, reignId });
            return respond(interaction, { content: `Updated that reign: ${won} → ${lost || 'present'}.` });
        }
    }
};
