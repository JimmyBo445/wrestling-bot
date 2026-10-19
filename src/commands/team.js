const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { pool, withTransaction } = require('../db/pool');
const { autocompleteCharacters, requireCharacter } = require('../utils/characterUtils');
const {
    autocompleteTeams, requireTeam, getTeamMembers, findTeamForCharacters, getTitlesHeldByTeam
} = require('../utils/teamUtils');
const { vacateTitle } = require('../utils/titleLogic');
const { renderTeamCard } = require('../utils/cardRenderer');
const { buildTeamData } = require('../utils/cardData');
const { validateImageUrl } = require('../utils/imageUrl');
const { requireAdmin, respond, DIVISION_LABELS, NO_MENTIONS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { logAudit } = require('../utils/audit');
const { teamSummary } = require('../utils/statsQueries');

const MAX_MEMBERS = 4;
const memberOpt = (o, n, required) => o.setName(`member${n}`).setDescription(`Team member ${n}`).setRequired(required).setAutocomplete(true);
const teamOpt = (o) => o.setName('team').setDescription('Team').setRequired(true).setAutocomplete(true);

const data = new SlashCommandBuilder()
    .setName('team')
    .setDescription('Registered tag teams (they can hold tag titles and have their own record)')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('create').setDescription('[Admin] Register a new tag team')
        .addStringOption((o) => o.setName('name').setDescription('Team name').setRequired(true).setMaxLength(40))
        .addStringOption((o) => memberOpt(o, 1, true))
        .addStringOption((o) => memberOpt(o, 2, true))
        .addStringOption((o) => memberOpt(o, 3, false))
        .addStringOption((o) => memberOpt(o, 4, false))
        .addStringOption((o) => o.setName('image_url').setDescription('Optional team art link (https)').setRequired(false)))
    .addSubcommand((s) => s.setName('list').setDescription('List all active teams'))
    .addSubcommand((s) => s.setName('profile').setDescription("Show a team's card").addStringOption(teamOpt))
    .addSubcommand((s) => s.setName('add-member').setDescription('[Admin] Add a wrestler to a team')
        .addStringOption(teamOpt)
        .addStringOption((o) => o.setName('character').setDescription('Wrestler to add').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('remove-member').setDescription('[Admin] Remove a wrestler (a team that holds a tag title loses it)')
        .addStringOption(teamOpt)
        .addStringOption((o) => o.setName('character').setDescription('Wrestler to remove').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('rename').setDescription('[Admin] Rename a team')
        .addStringOption(teamOpt)
        .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(40)))
    .addSubcommand((s) => s.setName('disband').setDescription('[Admin] Disband a team (record is kept; held tag titles are vacated)')
        .addStringOption(teamOpt));

async function assertNoDuplicateRoster(guildId, characterIds, exceptTeamId = null) {
    const dup = await findTeamForCharacters(guildId, characterIds);
    if (dup && String(dup.id) !== String(exceptTeamId)) throw new UserError(`An active team with exactly those wrestlers already exists: **${dup.name}**.`);
}

async function disbandInTx(client, team, guildId) {
    const vacated = [];
    const { rows: held } = await client.query(
        `SELECT t.id, t.name FROM title_reigns tr JOIN titles t ON t.id = tr.title_id WHERE tr.team_id = $1 AND tr.lost_date IS NULL`, [team.id]);
    for (const t of held) { await vacateTitle(client, t.id); vacated.push(t.name); }
    await client.query(`UPDATE team_members SET left_at = now() WHERE team_id = $1 AND left_at IS NULL`, [team.id]);
    await client.query(`UPDATE teams SET status = 'disbanded', disbanded_at = now() WHERE id = $1`, [team.id]);
    await client.query(`UPDATE contenders SET status = 'revoked', resolved_at = now() WHERE team_id = $1 AND status = 'active'`, [team.id]);
    await client.query(`UPDATE pending_requests SET status = 'dismissed', resolved_at = now() WHERE team_id = $1 AND status = 'pending'`, [team.id]);
    void guildId;
    return vacated;
}

module.exports = {
    data,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        if (focused.name === 'team') return interaction.respond(await autocompleteTeams(interaction, focused.value));
        if (focused.name === 'character' && interaction.options.getSubcommand(false) === 'remove-member') {
            const teamId = interaction.options.getString('team');
            if (teamId && /^\d+$/.test(teamId)) {
                const members = await getTeamMembers(teamId);
                const q = focused.value.toLowerCase();
                return interaction.respond(members.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 25).map((m) => ({ name: m.name.slice(0, 100), value: String(m.id) })));
            }
        }
        return interaction.respond(await autocompleteCharacters(interaction, focused.value));
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'create') {
            requireAdmin(interaction, 'register teams');
            const name = interaction.options.getString('name').trim();
            const ids = [1, 2, 3, 4].map((n) => interaction.options.getString(`member${n}`)).filter(Boolean);
            if (new Set(ids).size !== ids.length) throw new UserError('The same wrestler can\'t be on a team twice.');
            const members = [];
            for (const id of ids) members.push(await requireCharacter(guildId, id, { statuses: ['approved'] }));
            const division = members[0].division;
            const odd = members.find((m) => m.division !== division);
            if (odd) throw new UserError(`All team members must be in the same division. **${odd.name}** is ${DIVISION_LABELS[odd.division]} but **${members[0].name}** is ${DIVISION_LABELS[division]}.`);
            await assertNoDuplicateRoster(guildId, ids);
            await interaction.deferReply();
            const imgUrl = interaction.options.getString('image_url');
            if (imgUrl) { const v = await validateImageUrl(imgUrl); if (!v.ok) throw new UserError(`Image problem: ${v.error}`); }

            let teamId;
            try {
                teamId = await withTransaction(async (client) => {
                    const { rows } = await client.query(
                        `INSERT INTO teams (guild_id, name, division, image_url, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
                        [guildId, name, division, imgUrl, interaction.user.id]);
                    for (const m of members) await client.query(`INSERT INTO team_members (team_id, character_id) VALUES ($1,$2)`, [rows[0].id, m.id]);
                    return rows[0].id;
                });
            } catch (err) {
                if (err.code === '23505') throw new UserError(`There is already an active team called **${name}**.`);
                throw err;
            }
            await logAudit(guildId, interaction.user.id, 'team_created', { teamId, name, members: members.map((m) => m.name) });
            const team = await requireTeam(guildId, teamId);
            const buffer = await renderTeamCard(await buildTeamData(interaction.guild, team));
            return interaction.editReply({ content: `Registered team **${name}** (${DIVISION_LABELS[division]}) with ${members.map((m) => `**${m.name}**`).join(', ')}. When these exact wrestlers are booked on one side of a tag match, the match counts for the team.`, files: [new AttachmentBuilder(buffer, { name: 'team.png' })] });
        }

        if (sub === 'list') {
            const { rows } = await pool.query(`SELECT * FROM teams WHERE guild_id = $1 AND status = 'active' ORDER BY division, name`, [guildId]);
            if (!rows.length) return respond(interaction, { content: 'No teams registered yet. Admins can use `/team create`.', flags: 64 });
            const lines = [];
            for (const t of rows) {
                const members = await getTeamMembers(t.id);
                const s = await teamSummary(t.id);
                const held = await getTitlesHeldByTeam(t.id);
                lines.push(`**${t.name}** (${DIVISION_LABELS[t.division]}) — ${members.map((m) => m.name).join(' & ')}\n${s.wins}-${s.losses}${held.length ? `  ·  🏆 ${held.map((h) => h.name).join(', ')}` : ''}`);
            }
            return respond(interaction, { embeds: [new EmbedBuilder().setTitle('Tag Teams').setColor(0x7C3AED).setDescription(lines.join('\n\n').slice(0, 4000))] });
        }

        if (sub === 'profile') {
            const team = await requireTeam(guildId, interaction.options.getString('team'), { active: false });
            await interaction.deferReply();
            const buffer = await renderTeamCard(await buildTeamData(interaction.guild, team));
            return interaction.editReply({ files: [new AttachmentBuilder(buffer, { name: 'team.png' })] });
        }

        requireAdmin(interaction, 'change teams');

        if (sub === 'add-member') {
            const team = await requireTeam(guildId, interaction.options.getString('team'));
            const character = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved'] });
            const members = await getTeamMembers(team.id);
            if (members.some((m) => String(m.id) === String(character.id))) throw new UserError(`**${character.name}** is already on **${team.name}**.`);
            if (members.length >= MAX_MEMBERS) throw new UserError(`Teams can have at most ${MAX_MEMBERS} members.`);
            if (character.division !== team.division) throw new UserError(`**${character.name}** is ${DIVISION_LABELS[character.division]} but **${team.name}** is a ${DIVISION_LABELS[team.division]} team.`);
            const held = await getTitlesHeldByTeam(team.id);
            if (held.length) throw new UserError(`**${team.name}** holds the ${held.map((h) => `**${h.name}**`).join(', ')}. Changing the roster would change who the champions are. Vacate the title first (\`/championship vacate\`) or create a new team.`);
            await assertNoDuplicateRoster(guildId, [...members.map((m) => m.id), character.id], team.id);
            await pool.query(`INSERT INTO team_members (team_id, character_id) VALUES ($1,$2)`, [team.id, character.id]);
            await logAudit(guildId, interaction.user.id, 'team_member_added', { team: team.name, character: character.name });
            return respond(interaction, { content: `Added **${character.name}** to **${team.name}**.` });
        }

        if (sub === 'remove-member') {
            const team = await requireTeam(guildId, interaction.options.getString('team'));
            const character = await requireCharacter(guildId, interaction.options.getString('character'));
            const members = await getTeamMembers(team.id);
            if (!members.some((m) => String(m.id) === String(character.id))) throw new UserError(`**${character.name}** isn't on **${team.name}**.`);
            const result = await withTransaction(async (client) => {
                const vacated = [];
                const { rows: held } = await client.query(
                    `SELECT t.id, t.name FROM title_reigns tr JOIN titles t ON t.id = tr.title_id WHERE tr.team_id = $1 AND tr.lost_date IS NULL`, [team.id]);
                for (const t of held) { await vacateTitle(client, t.id); vacated.push(t.name); }
                await client.query(`UPDATE team_members SET left_at = now() WHERE team_id = $1 AND character_id = $2 AND left_at IS NULL`, [team.id, character.id]);
                let disbanded = false;
                if (members.length - 1 < 2) { await disbandInTx(client, team, guildId); disbanded = true; }
                return { vacated, disbanded };
            });
            await logAudit(guildId, interaction.user.id, 'team_member_removed', { team: team.name, character: character.name, ...result });
            let msg = `Removed **${character.name}** from **${team.name}**.`;
            if (result.vacated.length) msg += `\n💔 The team split, so the ${result.vacated.map((v) => `**${v}**`).join(', ')} ${result.vacated.length > 1 ? 'are' : 'is'} now vacant.`;
            if (result.disbanded) msg += `\n**${team.name}** dropped below 2 members and was disbanded (its record is kept).`;
            return respond(interaction, { content: msg });
        }

        if (sub === 'rename') {
            const team = await requireTeam(guildId, interaction.options.getString('team'));
            const name = interaction.options.getString('name').trim();
            try { await pool.query(`UPDATE teams SET name = $1 WHERE id = $2`, [name, team.id]); }
            catch (err) { if (err.code === '23505') throw new UserError(`There is already an active team called **${name}**.`); throw err; }
            await logAudit(guildId, interaction.user.id, 'team_renamed', { from: team.name, to: name });
            return respond(interaction, { content: `Renamed **${team.name}** to **${name}**.` });
        }

        if (sub === 'disband') {
            const team = await requireTeam(guildId, interaction.options.getString('team'));
            const vacated = await withTransaction((client) => disbandInTx(client, team, guildId));
            await logAudit(guildId, interaction.user.id, 'team_disbanded', { team: team.name, vacated });
            return respond(interaction, { content: `**${team.name}** was disbanded. Its record stays in the history books.${vacated.length ? `\n💔 Vacated: ${vacated.map((v) => `**${v}**`).join(', ')}.` : ''}`, allowedMentions: NO_MENTIONS });
        }
    }
};
