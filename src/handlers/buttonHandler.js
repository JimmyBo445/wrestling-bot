const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { pool, withTransaction } = require('../db/pool');
const { buildLeaderboardEmbed } = require('../utils/leaderboardQueries');

async function handleButtonInteraction(interaction) {
    if (interaction.isStringSelectMenu() && interaction.customId === 'leaderboard_select') {
        const category = interaction.values[0];
        const embed = await buildLeaderboardEmbed(interaction.guildId, category);
        return interaction.update({ embeds: [embed] });
    }

    if (!interaction.customId.startsWith('pending_')) return;

    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'Only admins/mods can resolve pending requests.', ephemeral: true });
    }

    const [, action, requestIdStr] = interaction.customId.split('_');
    const requestId = parseInt(requestIdStr, 10);

    const { rows } = await pool.query(`SELECT * FROM pending_requests WHERE id = $1`, [requestId]);
    const request = rows[0];
    if (!request) return interaction.reply({ content: 'That request no longer exists.', ephemeral: true });
    if (request.status !== 'pending') {
        return interaction.reply({ content: `That request was already ${request.status}.`, ephemeral: true });
    }

    const approve = action === 'approve';

    await withTransaction(async (client) => {
        await client.query(
            `UPDATE pending_requests SET status = $1, resolved_by = $2, resolved_at = now() WHERE id = $3`,
            [approve ? 'approved' : 'denied', interaction.user.id, requestId]
        );

        if (request.request_type === 'character_submission') {
            await client.query(
                `UPDATE characters SET status = $1, approved_by = $2, approved_at = now() WHERE id = $3`,
                [approve ? 'approved' : 'denied', interaction.user.id, request.character_id]
            );
        } else if (request.request_type === 'contender_challenge' && approve) {
            await client.query(
                `UPDATE contenders SET status = 'revoked', resolved_at = now() WHERE title_id = $1 AND status = 'active'`,
                [request.title_id]
            );
            await client.query(
                `INSERT INTO contenders (guild_id, title_id, character_id, earned_via, awarded_by)
                 VALUES ($1, $2, $3, 'challenge_approved', $4)`,
                [interaction.guildId, request.title_id, request.challenger_character_id, interaction.user.id]
            );
        }
    });

    const resultLine = approve ? `Approved by <@${interaction.user.id}>` : `Denied by <@${interaction.user.id}>`;

    if (interaction.message?.embeds?.length) {
        const original = interaction.message.embeds[0];
        const updated = EmbedBuilder.from(original)
            .setColor(approve ? 0x2ECC71 : 0xE74C3C)
            .addFields({ name: 'Result', value: resultLine });
        await interaction.update({ embeds: [updated], components: [] });
    } else {
        await interaction.reply({ content: resultLine, ephemeral: true });
    }
}

module.exports = { handleButtonInteraction };
