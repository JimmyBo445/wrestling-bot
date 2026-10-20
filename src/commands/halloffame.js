const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { autocompleteCharacters, requireCharacter } = require('../utils/characterUtils');
const { renderHofCard } = require('../utils/cardRenderer');
const { characterSummary } = require('../utils/statsQueries');
const { requireAdmin, respond, getDisplayNames, DIVISION_LABELS, NO_MENTIONS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { logAudit } = require('../utils/audit');

const data = new SlashCommandBuilder()
    .setName('halloffame')
    .setDescription('The Hall of Fame: retired legends')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('induct').setDescription('[Admin] Induct a wrestler into the Hall of Fame')
        .addStringOption((o) => o.setName('character').setDescription('Wrestler (retired or active)').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('blurb').setDescription('A line about their legacy (shown on the graphic)').setRequired(false).setMaxLength(180)))
    .addSubcommand((s) => s.setName('remove').setDescription('[Admin] Take someone out of the Hall of Fame')
        .addStringOption((o) => o.setName('character').setDescription('Wrestler').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('list').setDescription('Everyone in the Hall of Fame'))
    .addSubcommand((s) => s.setName('view').setDescription('Hall of Fame graphic for one legend')
        .addStringOption((o) => o.setName('character').setDescription('Wrestler').setRequired(true).setAutocomplete(true)));

async function buildHofData(guild, character, entry) {
    const names = await getDisplayNames(guild, [character.owner_discord_id], 2500);
    const s = await characterSummary(character.id);
    const { rows: reigns } = await pool.query(
        `SELECT COUNT(DISTINCT tr.id)::int AS reigns, COALESCE(SUM(tr.defenses), 0)::int AS defenses
         FROM title_reigns tr WHERE (tr.team_id IS NULL AND tr.character_id = $1)
            OR EXISTS (SELECT 1 FROM title_reign_members m WHERE m.reign_id = tr.id AND m.character_id = $1)`, [character.id]);
    const { rows: titles } = await pool.query(
        `SELECT DISTINCT t.name FROM title_reigns tr JOIN titles t ON t.id = tr.title_id
         WHERE (tr.team_id IS NULL AND tr.character_id = $1)
            OR EXISTS (SELECT 1 FROM title_reign_members m WHERE m.reign_id = tr.id AND m.character_id = $1) ORDER BY t.name`, [character.id]);
    return {
        serverName: guild.name || null, name: character.name, division: character.division, imageUrl: character.image_url,
        owner: names.get(character.owner_discord_id) || 'unknown', year: new Date(entry.inducted_at).getFullYear(), blurb: entry.blurb,
        record: { wins: s.wins, losses: s.losses, draws: s.draws }, reigns: reigns[0].reigns, defenses: reigns[0].defenses,
        bestStreak: s.streaks.longestWin, titles: titles.map((t) => t.name)
    };
}

module.exports = {
    data,
    async autocomplete(interaction) {
        return interaction.respond(await autocompleteCharacters(interaction, interaction.options.getFocused(), { statuses: ['approved', 'retired'] }));
    },
    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'induct') {
            requireAdmin(interaction, 'induct legends');
            const c = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved', 'retired'] });
            const blurb = interaction.options.getString('blurb')?.trim() || null;
            const { rows: dup } = await pool.query(`SELECT 1 FROM hall_of_fame WHERE guild_id = $1 AND character_id = $2`, [guildId, c.id]);
            if (dup.length) throw new UserError(`**${c.name}** is already in the Hall of Fame.`);
            await interaction.deferReply();
            const { rows } = await pool.query(
                `INSERT INTO hall_of_fame (guild_id, character_id, inducted_by, blurb) VALUES ($1,$2,$3,$4) RETURNING *`, [guildId, c.id, interaction.user.id, blurb]);
            await logAudit(guildId, interaction.user.id, 'hof_inducted', { name: c.name });
            const buffer = await renderHofCard(await buildHofData(interaction.guild, c, rows[0]));
            return interaction.editReply({ content: `🏛️ **${c.name}** has been inducted into the Hall of Fame!`, files: [new AttachmentBuilder(buffer, { name: 'hall-of-fame.png' })], allowedMentions: NO_MENTIONS });
        }

        if (sub === 'remove') {
            requireAdmin(interaction, 'change the Hall of Fame');
            const c = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved', 'retired'] });
            const { rowCount } = await pool.query(`DELETE FROM hall_of_fame WHERE guild_id = $1 AND character_id = $2`, [guildId, c.id]);
            if (!rowCount) throw new UserError(`**${c.name}** isn't in the Hall of Fame.`);
            await logAudit(guildId, interaction.user.id, 'hof_removed', { name: c.name });
            return respond(interaction, { content: `**${c.name}** was removed from the Hall of Fame.` });
        }

        if (sub === 'list') {
            const { rows } = await pool.query(
                `SELECT c.name, c.division, h.inducted_at, u.discord_id FROM hall_of_fame h JOIN characters c ON c.id = h.character_id JOIN users u ON u.id = c.owner_id
                 WHERE h.guild_id = $1 ORDER BY h.inducted_at DESC, c.name LIMIT 40`, [guildId]);
            if (!rows.length) return respond(interaction, { content: 'The Hall of Fame is empty. An admin can induct a legend with `/halloffame induct`.' });
            const lines = rows.map((r) => `🏛️ **${r.name}** (<@${r.discord_id}>) · ${DIVISION_LABELS[r.division]} · class of ${new Date(r.inducted_at).getFullYear()}`);
            return respond(interaction, { embeds: [new EmbedBuilder().setTitle('Hall of Fame').setColor(0xE8BF4A).setDescription(lines.join('\n'))], allowedMentions: NO_MENTIONS });
        }

        if (sub === 'view') {
            const c = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved', 'retired'] });
            const { rows } = await pool.query(`SELECT * FROM hall_of_fame WHERE guild_id = $1 AND character_id = $2`, [guildId, c.id]);
            if (!rows[0]) throw new UserError(`**${c.name}** isn't in the Hall of Fame.`);
            await interaction.deferReply();
            const buffer = await renderHofCard(await buildHofData(interaction.guild, c, rows[0]));
            return interaction.editReply({ files: [new AttachmentBuilder(buffer, { name: 'hall-of-fame.png' })] });
        }
    }
};
