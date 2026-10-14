const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { pool } = require('../db/pool');

/**
 * Creates a pending_requests row and, if a pending channel is configured,
 * posts an embed with Approve/Deny buttons. If no channel is configured,
 * the request still queues silently and admins can see it via /admin pending.
 */
async function postPendingCard(guild, { type, characterId = null, titleId = null, challengerCharacterId = null, requestedBy, summary }) {
    const { rows: reqRows } = await pool.query(
        `INSERT INTO pending_requests (guild_id, request_type, requested_by, character_id, title_id, challenger_character_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [guild.id, type, requestedBy, characterId, titleId, challengerCharacterId]
    );
    const requestId = reqRows[0].id;

    const { rows: guildRows } = await pool.query(`SELECT pending_channel_id FROM guilds WHERE guild_id = $1`, [guild.id]);
    const channelId = guildRows[0]?.pending_channel_id;
    if (!channelId) return requestId; // no channel set, request just sits in the queue

    let channel;
    try {
        channel = await guild.channels.fetch(channelId);
    } catch (_) {
        return requestId;
    }
    if (!channel) return requestId;

    const embed = new EmbedBuilder()
        .setTitle(type === 'character_submission' ? 'New Character Submission' : 'Title Contender Challenge')
        .setDescription(summary)
        .setColor(0xF1C40F)
        .setFooter({ text: `Request #${requestId}` });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`pending_approve_${requestId}`).setLabel('Approve').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`pending_deny_${requestId}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
    );

    const message = await channel.send({ embeds: [embed], components: [row] });
    await pool.query(`UPDATE pending_requests SET message_id = $1 WHERE id = $2`, [message.id, requestId]);
    return requestId;
}

module.exports = { postPendingCard };
