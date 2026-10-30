// New championship tools: a simple title-match form, belt pictures, and hand-entered defenses.
// This file only defines the pieces; they are exposed through /title and /reign.
const { SlashCommandBuilder } = require('discord.js');
const { pool, withTransaction } = require('../db/pool');
const { autocompleteCharacters, requireCharacter } = require('../utils/characterUtils');
const { autocompleteTeams, requireTeam, getTeamMembers } = require('../utils/teamUtils');
const { autocompleteTitles, requireTitle, getCurrentReign, reignHolderName } = require('../utils/titleLogic');
const { stipulationChoices, addDetailOptions } = require('../utils/matchOptions');
const { processUpload } = require('../utils/imageUrl');
const { requireAdmin, respond, NO_MENTIONS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { logAudit } = require('../utils/audit');
const { FINISHES } = require('../utils/constants');
const champ = require('./championship');

const RESULT_CHOICES = [
    { name: 'Decisive (has a winner)', value: 'decisive' },
    { name: 'Draw (champion keeps the title)', value: 'draw' },
    { name: 'No Contest (champion keeps the title)', value: 'no_contest' }
];
const titleOpt = (o, desc = 'Title') => o.setName('title').setDescription(desc).setRequired(true).setAutocomplete(true);

const data = new SlashCommandBuilder()
    .setName('title-extras')
    .setDescription('Title tools')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('match').setDescription('[Admin] Log a title match: pick the title, the challenger and who won')
        .addStringOption((o) => titleOpt(o, 'Title on the line'))
        .addStringOption((o) => o.setName('challenger').setDescription('The challenger (a wrestler, or a team for tag titles)').setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('winner').setDescription('Who won').setRequired(true).addChoices({ name: 'The champion (first listed if the title is vacant)', value: 1 }, { name: 'The challenger (second listed if the title is vacant)', value: 2 }))
        .addStringOption((o) => o.setName('opponent').setDescription('Only if the title is vacant: the other wrestler or team').setRequired(false).setAutocomplete(true))
        .addStringOption((o) => o.setName('result_type').setDescription('Default: decisive').setRequired(false).addChoices(...RESULT_CHOICES))
        .addStringOption((o) => o.setName('stipulation').setDescription('Match type or stipulation (Ladder, Hell in a Cell...)').setRequired(false).setMaxLength(40).setAutocomplete(true))
        .addStringOption((o) => o.setName('finish').setDescription('How it ended').setRequired(false).addChoices(...FINISHES))
        .addStringOption((o) => o.setName('score').setDescription('Falls or score, like 3-2').setRequired(false).setMaxLength(20))
        .addStringOption((o) => o.setName('notes').setDescription('Extra notes').setRequired(false).setMaxLength(300)))
    .addSubcommand((s) => s.setName('belt-image').setDescription('[Admin] Upload the belt picture for a title (shown on its belt card)')
        .addStringOption((o) => titleOpt(o))
        .addAttachmentOption((o) => o.setName('picture').setDescription('The belt picture (PNG, JPG, WEBP or GIF)').setRequired(false))
        .addBooleanOption((o) => o.setName('remove').setDescription('Remove the belt picture instead').setRequired(false)))
    .addSubcommand((s) => s.setName('add-defense').setDescription('[Admin] Record a title defense for a reign (for defenses from before the bot)')
        .addStringOption((o) => titleOpt(o))
        .addIntegerOption((o) => o.setName('reign').setDescription('Which reign').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('opponent').setDescription('Who they beat (a name)').setRequired(true).setMaxLength(60))
        .addStringOption((o) => o.setName('date').setDescription('Date of the match, YYYY-MM-DD (optional)').setRequired(false))
        .addStringOption((o) => o.setName('notes').setDescription('Optional note, e.g. the show').setRequired(false).setMaxLength(100)))
    .addSubcommand((s) => s.setName('remove-defense').setDescription('[Admin] Delete a defense you entered by hand')
        .addStringOption((o) => titleOpt(o))
        .addIntegerOption((o) => o.setName('reign').setDescription('Which reign').setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('defense').setDescription('Which defense').setRequired(true).setAutocomplete(true)));

/** Members of the champion side of a tag title (the reign's own members, else the team's members). */
async function reignTeamMembers(reign) {
    const { rows } = await pool.query(`SELECT c.id FROM title_reign_members trm JOIN characters c ON c.id = trm.character_id WHERE trm.reign_id = $1 ORDER BY trm.id`, [reign.id]);
    if (rows.length) return rows.map((r) => String(r.id));
    return (await getTeamMembers(reign.team_id)).map((m) => String(m.id));
}

async function teamPair(guildId, value, label) {
    const team = await requireTeam(guildId, value);
    const m = (await getTeamMembers(team.id)).map((x) => String(x.id));
    if (m.length !== 2) throw new UserError(`**${team.name}** has ${m.length} members. Title matches here are 2v2, so both teams need exactly 2 wrestlers.`);
    void label;
    return { team, ids: m };
}

async function logTitleMatch(interaction) {
    const guildId = interaction.guildId;
    const title = await requireTitle(guildId, interaction.options.getString('title'));
    const challenger = interaction.options.getString('challenger');
    const opponent = interaction.options.getString('opponent');
    const winner = interaction.options.getInteger('winner');
    const reign = await getCurrentReign(title.id);
    if (title.is_tag_title) {
        let first, second;
        if (reign?.team_id) {
            const ids = await reignTeamMembers(reign);
            if (ids.length !== 2) throw new UserError(`The champions of the **${title.name}** don't have exactly 2 members on record. Fix them with \`/reign edit\`.`);
            first = ids;
            second = (await teamPair(guildId, challenger)).ids;
        } else if (reign) {
            throw new UserError(`The **${title.name}** champions aren't a registered team. Fix the reign with \`/reign edit\` first.`);
        } else {
            if (!opponent) throw new UserError(`The **${title.name}** is vacant, so fill in \`opponent\` too (the second team).`);
            first = (await teamPair(guildId, challenger)).ids;
            second = (await teamPair(guildId, opponent)).ids;
        }
        return champ.runTitleMatch(interaction, 'tag2v2', [...first, ...second], null, winner);
    }
    let p1, p2;
    if (reign) {
        if (!reign.character_id) throw new UserError(`The champion of the **${title.name}** (${reignHolderName(reign)}) isn't a wrestler in the bot. Fix the reign with \`/reign edit\` first.`);
        p1 = String(reign.character_id); p2 = challenger;
    } else {
        if (!opponent) throw new UserError(`The **${title.name}** is vacant, so fill in \`opponent\` too (the second wrestler).`);
        p1 = challenger; p2 = opponent;
    }
    return champ.runTitleMatch(interaction, 'singles', [p1, p2], winner - 1, null);
}

async function reignRow(guildId, titleId, reignId) {
    const { rows } = await pool.query(`SELECT * FROM title_reigns WHERE id = $1 AND title_id = $2 AND guild_id = $3`, [reignId, titleId, guildId]);
    if (!rows[0]) throw new UserError('I couldn\'t find that reign. Choose it from the dropdown after picking the title.');
    return rows[0];
}

module.exports = {
    data, logTitleMatch,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        if (focused.name === 'title') return interaction.respond(await autocompleteTitles(interaction, focused.value));
        if (focused.name === 'stipulation') return interaction.respond(stipulationChoices(focused.value));
        if (focused.name === 'reign') return interaction.respond(await champ.reignAutocomplete(interaction, focused.value));
        if (focused.name === 'defense') {
            const reignId = interaction.options.getInteger('reign');
            if (!reignId) return interaction.respond([]);
            const { rows } = await pool.query(`SELECT d.* FROM reign_defenses d JOIN title_reigns tr ON tr.id = d.reign_id WHERE d.reign_id = $1 AND tr.guild_id = $2 ORDER BY d.defended_on NULLS LAST, d.id LIMIT 25`, [reignId, interaction.guildId]);
            return interaction.respond(rows.map((d) => ({ name: `vs ${d.opponent}${d.defended_on ? ` (${champ.fmtDate(d.defended_on)})` : ''}`.slice(0, 100), value: Number(d.id) })));
        }
        if (focused.name === 'challenger' || focused.name === 'opponent') {
            const tv = interaction.options.getString('title');
            let title = null;
            if (tv && /^\d+$/.test(tv)) title = (await pool.query(`SELECT * FROM titles WHERE id = $1 AND guild_id = $2`, [tv, interaction.guildId])).rows[0] || null;
            if (title?.is_tag_title) {
                const list = await autocompleteTeams(interaction, focused.value);
                return interaction.respond(list);
            }
            return interaction.respond(await autocompleteCharacters(interaction, focused.value, { division: title?.division || null }));
        }
        return interaction.respond([]);
    },

    async execute(interaction) {
        requireAdmin(interaction, 'change championships');
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'match') return logTitleMatch(interaction);

        const title = await requireTitle(guildId, interaction.options.getString('title'));

        if (sub === 'belt-image') {
            if (interaction.options.getBoolean('remove')) {
                const { rowCount } = await pool.query(`DELETE FROM title_images WHERE title_id = $1`, [title.id]);
                if (!rowCount) throw new UserError(`The **${title.name}** has no belt picture to remove.`);
                return respond(interaction, { content: `Removed the belt picture for the **${title.name}**. Its belt card goes back to the drawn belt.` });
            }
            const att = interaction.options.getAttachment('picture');
            if (!att) throw new UserError('Attach the belt picture in the `picture` box (or set `remove` to true).');
            await interaction.deferReply();
            let buffer;
            try { buffer = await processUpload(att); } catch (err) { throw new UserError(`Picture problem: ${err.message}`); }
            await pool.query(
                `INSERT INTO title_images (title_id, data, content_type) VALUES ($1, $2, 'image/jpeg')
                 ON CONFLICT (title_id) DO UPDATE SET data = EXCLUDED.data, content_type = 'image/jpeg', updated_at = now()`, [title.id, buffer]);
            await logAudit(guildId, interaction.user.id, 'title_image_set', { title: title.name });
            return respond(interaction, { content: `Saved the belt picture for the **${title.name}**. See it with \`/championship belt\` or \`/championship panel\`.` });
        }

        const reign = await reignRow(guildId, title.id, interaction.options.getInteger('reign'));

        if (sub === 'add-defense') {
            const raw = interaction.options.getString('date');
            const date = raw ? champ.parseDate(raw, 'The date') : null;
            const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
            if (date) {
                if (date < ymd(reign.won_date)) throw new UserError('That date is before the reign started.');
                if (reign.lost_date && date > ymd(reign.lost_date)) throw new UserError('That date is after the reign ended.');
                if (date > new Date().toISOString().slice(0, 10)) throw new UserError('That date is in the future.');
            }
            await withTransaction(async (client) => {
                await client.query(`INSERT INTO reign_defenses (reign_id, opponent, defended_on, notes, created_by) VALUES ($1,$2,$3,$4,$5)`,
                    [reign.id, interaction.options.getString('opponent').trim(), date, interaction.options.getString('notes'), interaction.user.id]);
                await client.query(`UPDATE title_reigns SET defenses = defenses + 1 WHERE id = $1`, [reign.id]);
            });
            await logAudit(guildId, interaction.user.id, 'defense_added', { title: title.name, reign: reign.id });
            return respond(interaction, { content: `Added the defense to ${reignHolderName(reign)}'s reign. It now shows in \`/championship defenses\`.`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'remove-defense') {
            const { rowCount } = await withTransaction(async (client) => {
                const r = await client.query(`DELETE FROM reign_defenses WHERE id = $1 AND reign_id = $2`, [interaction.options.getInteger('defense'), reign.id]);
                if (r.rowCount) await client.query(`UPDATE title_reigns SET defenses = GREATEST(0, defenses - 1) WHERE id = $1`, [reign.id]);
                return r;
            });
            if (!rowCount) throw new UserError('I couldn\'t find that defense. Pick it from the dropdown after choosing the reign.');
            return respond(interaction, { content: 'Removed that defense.' });
        }
    }
};
void addDetailOptions; void requireCharacter;
