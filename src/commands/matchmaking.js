const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { autocompleteCharacters, getCharacterById } = require('../utils/characterUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('matchmaking')
        .setDescription('Matchmaking suggestions')
        .addSubcommand((sub) =>
            sub.setName('suggest')
                .setDescription('Suggest opponents who haven\'t faced this character/user much')
                .addStringOption((o) => o.setName('character').setDescription('Character to find opponents for').setRequired(true).setAutocomplete(true))
                .addIntegerOption((o) => o.setName('count').setDescription('How many suggestions (default 5)').setRequired(false))
        ),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused();
        await interaction.respond(await autocompleteCharacters(interaction, focused));
    },

    async execute(interaction) {
        const characterId = interaction.options.getString('character');
        const count = interaction.options.getInteger('count') || 5;
        const character = await getCharacterById(characterId);
        if (!character) return interaction.reply({ content: 'Character not found.', ephemeral: true });

        // Count prior singles/multi-man matchups against every other approved character,
        // in the same division (keeps suggestions sensible), then rank ascending —
        // characters with zero or fewest matchups float to the top.
        const { rows } = await pool.query(
            `WITH opponents AS (
                SELECT c.id, c.name, u.discord_id
                FROM characters c JOIN users u ON u.id = c.owner_id
                WHERE c.guild_id = $1 AND c.status = 'approved' AND c.id != $2
             ),
             matchup_counts AS (
                SELECT o.id, o.name, o.discord_id, COUNT(mp2.id) AS matches_together
                FROM opponents o
                LEFT JOIN match_participants mp1 ON mp1.character_id = $2
                LEFT JOIN match_participants mp2 ON mp2.match_id = mp1.match_id AND mp2.character_id = o.id
                GROUP BY o.id, o.name, o.discord_id
             )
             SELECT * FROM matchup_counts ORDER BY matches_together ASC, random() LIMIT $3`,
            [interaction.guildId, characterId, count]
        );

        if (!rows.length) {
            return interaction.reply({ content: 'No other approved characters found to suggest.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle(`Fresh Matchup Suggestions for ${character.name}`)
            .setColor(0x3498DB)
            .setDescription(rows.map((r, i) => `**${i + 1}.** ${r.name} (<@${r.discord_id}>) — ${r.matches_together} prior match(es) vs this character`).join('\n'));

        return interaction.reply({ embeds: [embed] });
    }
};
