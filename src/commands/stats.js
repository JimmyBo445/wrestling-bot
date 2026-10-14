const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { autocompleteCharacters, getCharacterById } = require('../utils/characterUtils');
const { getStreaks } = require('../utils/contenderLogic');
const { ensureUser } = require('../utils/ensureGuild');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View win/loss stats')
        .addSubcommand((sub) =>
            sub.setName('character')
                .setDescription('Stats for one character')
                .addStringOption((o) => o.setName('character').setDescription('Character').setRequired(true).setAutocomplete(true))
        )
        .addSubcommand((sub) =>
            sub.setName('user')
                .setDescription('Aggregate stats across all of a user\'s characters')
                .addUserOption((o) => o.setName('user').setDescription('Defaults to you').setRequired(false))
        ),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused();
        await interaction.respond(await autocompleteCharacters(interaction, focused));
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'character') {
            const characterId = interaction.options.getString('character');
            const character = await getCharacterById(characterId);
            if (!character) return interaction.reply({ content: 'Character not found.', ephemeral: true });

            const { rows } = await pool.query(
                `SELECT
                    COUNT(*) FILTER (WHERE mp.is_winner AND m.result_type = 'decisive') AS wins,
                    COUNT(*) FILTER (WHERE NOT mp.is_winner AND m.result_type = 'decisive') AS losses,
                    COUNT(*) FILTER (WHERE m.result_type = 'draw') AS draws,
                    COUNT(*) FILTER (WHERE m.result_type = 'no_contest') AS ncs,
                    json_agg(DISTINCT m.match_type) FILTER (WHERE m.result_type = 'decisive') AS types
                 FROM match_participants mp JOIN matches m ON m.id = mp.match_id
                 WHERE mp.character_id = $1`,
                [characterId]
            );
            const row = rows[0];
            const streaks = await getStreaks(characterId);

            const byTypeRows = await pool.query(
                `SELECT m.match_type,
                        COUNT(*) FILTER (WHERE mp.is_winner) AS w,
                        COUNT(*) FILTER (WHERE NOT mp.is_winner) AS l
                 FROM match_participants mp JOIN matches m ON m.id = mp.match_id
                 WHERE mp.character_id = $1 AND m.result_type = 'decisive'
                 GROUP BY m.match_type ORDER BY m.match_type`,
                [characterId]
            );

            const embed = new EmbedBuilder()
                .setTitle(`${character.name} — Stats`)
                .setColor(0xC0392B)
                .addFields(
                    { name: 'Record', value: `${row.wins}-${row.losses} (Draws: ${row.draws}, NC: ${row.ncs})`, inline: true },
                    { name: 'Current Streak', value: streaks.current > 0 ? `${streaks.current} ${streaks.direction}${streaks.current > 1 ? 's' : ''}` : '—', inline: true },
                    { name: 'Best Win Streak', value: String(streaks.longestWin), inline: true },
                    { name: 'Worst Loss Streak', value: String(streaks.longestLoss), inline: true }
                );

            if (byTypeRows.rows.length) {
                embed.addFields({ name: 'By Match Type', value: byTypeRows.rows.map((r) => `${r.match_type}: ${r.w}-${r.l}`).join('\n') });
            }

            return interaction.reply({ embeds: [embed] });
        }

        if (sub === 'user') {
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const ownerId = await ensureUser(guildId, targetUser.id);

            const { rows } = await pool.query(
                `SELECT c.id, c.name,
                        COUNT(*) FILTER (WHERE mp.is_winner AND m.result_type = 'decisive') AS wins,
                        COUNT(*) FILTER (WHERE NOT mp.is_winner AND m.result_type = 'decisive') AS losses
                 FROM characters c
                 LEFT JOIN match_participants mp ON mp.character_id = c.id
                 LEFT JOIN matches m ON m.id = mp.match_id
                 WHERE c.guild_id = $1 AND c.owner_id = $2 AND c.status = 'approved'
                 GROUP BY c.id, c.name ORDER BY c.name`,
                [guildId, ownerId]
            );

            if (!rows.length) return interaction.reply({ content: `<@${targetUser.id}> has no approved characters yet.`, ephemeral: true });

            const totalWins = rows.reduce((s, r) => s + parseInt(r.wins, 10), 0);
            const totalLosses = rows.reduce((s, r) => s + parseInt(r.losses, 10), 0);

            const embed = new EmbedBuilder()
                .setTitle(`${targetUser.username} — Overall Record: ${totalWins}-${totalLosses}`)
                .setColor(0xC0392B)
                .setDescription(rows.map((r) => `**${r.name}**: ${r.wins}-${r.losses}`).join('\n'));

            return interaction.reply({ embeds: [embed] });
        }
    }
};
