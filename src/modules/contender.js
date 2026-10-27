const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { pool, withTransaction } = require('../db/pool');
const { autocompleteCharacters, requireCharacter } = require('../utils/characterUtils');
const { autocompleteTeams, requireTeam, getTeamMembers } = require('../utils/teamUtils');
const { autocompleteTitles, requireTitle } = require('../utils/titleLogic');
const { setContender } = require('../utils/contenderLogic');
const { postPendingCard } = require('../handlers/pendingQueue');
const { requireAdmin, isAdmin, respond, NO_MENTIONS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { logAudit } = require('../utils/audit');

const titleOpt = (o) => o.setName('title').setDescription('Title').setRequired(true).setAutocomplete(true);

const data = new SlashCommandBuilder()
    .setName('contender')
    .setDescription('#1 contenders for titles')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('challenge')
        .setDescription('Ask to become #1 contender (an admin approves it)')
        .addStringOption(titleOpt)
        .addStringOption((o) => o.setName('character').setDescription('Your character (for singles titles)').setRequired(false).setAutocomplete(true))
        .addStringOption((o) => o.setName('team').setDescription('Your team (for tag titles)').setRequired(false).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('award')
        .setDescription('[Admin] Name a #1 contender directly (character for singles titles, team for tag titles)')
        .addStringOption(titleOpt)
        .addStringOption((o) => o.setName('character').setDescription('Wrestler (singles titles)').setRequired(false).setAutocomplete(true))
        .addStringOption((o) => o.setName('team').setDescription('Team (tag titles)').setRequired(false).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('revoke').setDescription('[Admin] Remove the current #1 contender of a title').addStringOption(titleOpt))
    .addSubcommand((s) => s.setName('list').setDescription('See current #1 contenders')
        .addStringOption((o) => o.setName('title').setDescription('Only this title').setRequired(false).setAutocomplete(true)));

/** Reads the character/team option pair and checks it matches the kind of title. */
async function resolveSubject(interaction, title) {
    const guildId = interaction.guildId;
    const charVal = interaction.options.getString('character');
    const teamVal = interaction.options.getString('team');
    if (charVal && teamVal) throw new UserError('Pick either a `character` or a `team`, not both.');
    if (title.is_tag_title) {
        if (!teamVal) throw new UserError(`The **${title.name}** is a tag title. Choose a \`team\` (register one with \`/team create\`).`);
        const team = await requireTeam(guildId, teamVal);
        return { subject: { type: 'team', id: String(team.id) }, division: team.division, name: team.name, record: team };
    }
    if (!charVal) throw new UserError(`The **${title.name}** is a singles title. Choose a \`character\`.`);
    const c = await requireCharacter(guildId, charVal, { statuses: ['approved'] });
    return { subject: { type: 'character', id: String(c.id) }, division: c.division, name: c.name, record: c };
}

module.exports = {
    data,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        if (focused.name === 'title') return interaction.respond(await autocompleteTitles(interaction, focused.value));
        if (focused.name === 'team') return interaction.respond(await autocompleteTeams(interaction, focused.value));
        return interaction.respond(await autocompleteCharacters(interaction, focused.value));
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'challenge') {
            const title = await requireTitle(guildId, interaction.options.getString('title'));
            const r = await resolveSubject(interaction, title);
            if (r.division !== title.division) throw new UserError(`The **${title.name}** is in a different division than **${r.name}**.`);

            if (!isAdmin(interaction)) {
                // players may only challenge with their own wrestlers / a team they're part of
                let owns;
                if (r.subject.type === 'character') owns = r.record.owner_discord_id === interaction.user.id;
                else owns = (await getTeamMembers(r.subject.id)).some((m) => m.owner_discord_id === interaction.user.id);
                if (!owns) throw new UserError('You can only challenge with your own character (or a team one of your characters is on).');
            }
            const { rows: champ } = await pool.query(
                `SELECT 1 FROM title_reigns WHERE title_id = $1 AND lost_date IS NULL AND ((team_id IS NULL AND character_id = $2 AND $3 = 'character') OR (team_id = $2 AND $3 = 'team'))`,
                [title.id, r.subject.id, r.subject.type]);
            if (champ.length) throw new UserError(`**${r.name}** already holds the **${title.name}**.`);
            const { rows: dup } = await pool.query(
                `SELECT 1 FROM pending_requests WHERE guild_id = $1 AND request_type = 'contender_challenge' AND status = 'pending' AND title_id = $2
                   AND ((challenger_character_id = $3 AND $4 = 'character') OR (team_id = $3 AND $4 = 'team'))`,
                [guildId, title.id, r.subject.id, r.subject.type]);
            if (dup.length) throw new UserError('That challenge is already waiting for an admin.');

            await postPendingCard(interaction.guild, {
                type: 'contender_challenge', titleId: title.id, requestedBy: interaction.user.id,
                challengerCharacterId: r.subject.type === 'character' ? r.subject.id : null,
                teamId: r.subject.type === 'team' ? r.subject.id : null
            });
            return respond(interaction, { content: `Challenge sent: **${r.name}** for #1 contender of the **${title.name}**. An admin will review it.`, flags: 64 });
        }

        if (sub === 'list') {
            const titleVal = interaction.options.getString('title');
            const params = [guildId];
            let where = `t.guild_id = $1 AND co.status = 'active'`;
            if (titleVal) { const t = await requireTitle(guildId, titleVal); params.push(t.id); where += ` AND t.id = $2`; }
            const { rows } = await pool.query(
                `SELECT t.name AS title_name, COALESCE(tm.name, c.name) AS name, u.discord_id, co.earned_via, co.created_at
                 FROM contenders co JOIN titles t ON t.id = co.title_id
                 LEFT JOIN characters c ON c.id = co.character_id LEFT JOIN users u ON u.id = c.owner_id
                 LEFT JOIN teams tm ON tm.id = co.team_id
                 WHERE ${where} ORDER BY t.division, t.name`, params);
            if (!rows.length) return respond(interaction, { content: 'No active #1 contenders right now.', flags: 64 });
            const how = { win_streak: 'win streak', challenge_approved: 'approved challenge', admin_award: 'named by admin', contender_match: 'won a #1 contender match' };
            const embed = new EmbedBuilder().setTitle('🎯 #1 Contenders').setColor(0xE67E22)
                .setDescription(rows.map((r) => `**${r.title_name}**\n${r.name}${r.discord_id ? ` (<@${r.discord_id}>)` : ''} — _${how[r.earned_via] || r.earned_via}_, <t:${Math.floor(new Date(r.created_at).getTime() / 1000)}:R>`).join('\n\n'));
            return respond(interaction, { embeds: [embed], allowedMentions: NO_MENTIONS });
        }

        requireAdmin(interaction, 'change #1 contenders');
        const title = await requireTitle(guildId, interaction.options.getString('title'));

        if (sub === 'award') {
            const r = await resolveSubject(interaction, title);
            const res = await withTransaction((client) => setContender(client, {
                guildId, title, subject: r.subject, subjectDivision: r.division, earnedVia: 'admin_award', awardedBy: interaction.user.id
            }));
            await logAudit(guildId, interaction.user.id, 'contender_awarded', { title: title.name, who: r.name, replaced: res.revokedIds.length });
            return respond(interaction, { content: `🎯 **${r.name}** is now the #1 contender for the **${title.name}**.`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'revoke') {
            const { rowCount } = await pool.query(`UPDATE contenders SET status = 'revoked', resolved_at = now() WHERE title_id = $1 AND status = 'active'`, [title.id]);
            if (!rowCount) throw new UserError(`The **${title.name}** has no #1 contender right now.`);
            await logAudit(guildId, interaction.user.id, 'contender_revoked', { title: title.name });
            return respond(interaction, { content: `Removed the #1 contender for the **${title.name}**.` });
        }
    }
};
