const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { autocompleteCharacters, getCharacterById } = require('../utils/characterUtils');
const { postPendingCard } = require('../handlers/pendingQueue');

async function autocompleteTitles(interaction, focusedValue) {
    const { rows } = await pool.query(
        `SELECT id, name FROM titles WHERE guild_id = $1 AND name ILIKE $2 ORDER BY name LIMIT 25`,
        [interaction.guildId, `%${focusedValue}%`]
    );
    return rows.map((r) => ({ name: r.name, value: String(r.id) }));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('contender')
        .setDescription('Manage #1 contender status')
        .addSubcommand((sub) =>
            sub.setName('challenge')
                .setDescription('Request a #1 contender shot at a title (requires admin approval)')
                .addStringOption((o) => o.setName('character').setDescription('Your character').setRequired(true).setAutocomplete(true))
                .addStringOption((o) => o.setName('title').setDescription('Title').setRequired(true).setAutocomplete(true))
        )
        .addSubcommand((sub) =>
            sub.setName('award')
                .setDescription('[Admin] Directly name a #1 contender for a title')
                .addStringOption((o) => o.setName('character').setDescription('Character').setRequired(true).setAutocomplete(true))
                .addStringOption((o) => o.setName('title').setDescription('Title').setRequired(true).setAutocomplete(true))
        )
        .addSubcommand((sub) =>
            sub.setName('list')
                .setDescription('View current #1 contenders')
                .addStringOption((o) => o.setName('title').setDescription('Filter to one title').setRequired(false).setAutocomplete(true))
        ),

    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        if (focusedOption.name === 'title') {
            return interaction.respond(await autocompleteTitles(interaction, focusedOption.value));
        }
        return interaction.respond(await autocompleteCharacters(interaction, focusedOption.value));
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'challenge') {
            const characterId = interaction.options.getString('character');
            const titleId = interaction.options.getString('title');
            const character = await getCharacterById(characterId);
            const { rows: titleRows } = await pool.query(`SELECT name FROM titles WHERE id = $1`, [titleId]);

            await interaction.reply({ content: `Challenge submitted for **${character.name}** to become #1 contender for the **${titleRows[0].name}**. Awaiting admin approval.`, ephemeral: true });

            await postPendingCard(interaction.guild, {
                type: 'contender_challenge',
                titleId,
                challengerCharacterId: characterId,
                requestedBy: interaction.user.id,
                summary: `**${character.name}** (<@${interaction.user.id}>) wants the #1 contender spot for the **${titleRows[0].name}**`
            });
            return;
        }

        if (sub === 'award') {
            if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
                return interaction.reply({ content: 'Only admins/mods can award contender status directly.', ephemeral: true });
            }
            const characterId = interaction.options.getString('character');
            const titleId = interaction.options.getString('title');
            const character = await getCharacterById(characterId);
            const { rows: titleRows } = await pool.query(`SELECT name FROM titles WHERE id = $1`, [titleId]);

            await pool.query(`UPDATE contenders SET status = 'revoked', resolved_at = now() WHERE title_id = $1 AND status = 'active'`, [titleId]);
            await pool.query(
                `INSERT INTO contenders (guild_id, title_id, character_id, earned_via, awarded_by)
                 VALUES ($1, $2, $3, 'admin_award', $4)`,
                [guildId, titleId, characterId, interaction.user.id]
            );

            return interaction.reply(`**${character.name}** is now the #1 contender for the **${titleRows[0].name}**.`);
        }

        if (sub === 'list') {
            const titleId = interaction.options.getString('title');
            const params = [guildId];
            let where = `t.guild_id = $1 AND co.status = 'active'`;
            if (titleId) { params.push(titleId); where += ` AND t.id = $2`; }

            const { rows } = await pool.query(
                `SELECT t.name AS title_name, c.name AS character_name, u.discord_id, co.earned_via, co.created_at
                 FROM contenders co
                 JOIN titles t ON t.id = co.title_id
                 JOIN characters c ON c.id = co.character_id
                 JOIN users u ON u.id = c.owner_id
                 WHERE ${where}
                 ORDER BY t.name`,
                params
            );

            if (!rows.length) return interaction.reply({ content: 'No active #1 contenders right now.', ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle('#1 Contenders')
                .setColor(0xE67E22)
                .setDescription(rows.map((r) => `**${r.title_name}**\n${r.character_name} (<@${r.discord_id}>) — _${r.earned_via.replace('_', ' ')}_`).join('\n\n'));

            return interaction.reply({ embeds: [embed] });
        }
    }
};
