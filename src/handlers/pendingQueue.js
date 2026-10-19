const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { pool } = require('../db/pool');
const { DIVISION_LABELS } = require('../utils/discordHelpers');
const { MATCH_CONFIG } = require('../utils/constants');

const TITLES = {
    character_submission: 'New Character Submission',
    contender_challenge: 'Title Contender Challenge',
    match_request: 'Match Request',
    streak_contender: 'Win Streak: Title Shot?'
};

/** Loads everything needed to describe a request in words. */
async function describeRequest(r) {
    const [ch, chal, team, title] = await Promise.all([
        r.character_id ? pool.query(`SELECT name, division FROM characters WHERE id = $1`, [r.character_id]) : null,
        r.challenger_character_id ? pool.query(`SELECT name, division FROM characters WHERE id = $1`, [r.challenger_character_id]) : null,
        r.team_id ? pool.query(`SELECT name, division FROM teams WHERE id = $1`, [r.team_id]) : null,
        r.title_id ? pool.query(`SELECT name FROM titles WHERE id = $1`, [r.title_id]) : null
    ]);
    const c = ch?.rows[0], challenger = chal?.rows[0], t = team?.rows[0], ti = title?.rows[0];

    if (r.request_type === 'character_submission') {
        return `**${c?.name || 'Unknown'}** (${DIVISION_LABELS[c?.division] || '?'}) submitted by <@${r.requested_by}>`;
    }
    if (r.request_type === 'contender_challenge') {
        const who = t?.name || challenger?.name || 'Unknown';
        return `<@${r.requested_by}> wants **${who}** to be #1 contender for the **${ti?.name || 'title'}**`;
    }
    if (r.request_type === 'match_request') {
        const p = r.payload || {};
        const label = MATCH_CONFIG[p.match_type]?.label || 'Match';
        return `<@${r.requested_by}> requests a **${label}**: **${p.names?.[0] || '?'}** vs **${p.names?.[1] || '?'}**${p.note ? `\n_“${p.note}”_` : ''}`;
    }
    if (r.request_type === 'streak_contender') {
        const who = t?.name || c?.name || 'Unknown';
        return `**${who}** has won **${r.payload?.streak ?? '?'}** in a row. Pick a title to make them #1 contender for.`;
    }
    return 'Request';
}

function buildButtons(r) {
    if (r.request_type === 'streak_contender') {
        // the title picker lives on the original prompt message; from /admin pending you can just dismiss it
        return [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`streak_dismiss_${r.id}`).setLabel('Dismiss').setStyle(ButtonStyle.Secondary)
        )];
    }
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`pending_approve_${r.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`pending_deny_${r.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
    )];
}

async function buildPendingMessage(r) {
    const embed = new EmbedBuilder()
        .setTitle(TITLES[r.request_type] || 'Request')
        .setDescription(await describeRequest(r))
        .setColor(0xF1C40F)
        .setFooter({ text: `Request #${r.id}` });
    return { embeds: [embed], components: buildButtons(r), allowedMentions: { parse: [] } };
}

/**
 * Saves a request and, if a pending channel is set, posts an approval card there.
 * If no channel is set, it still queues, and admins see it via /admin pending.
 */
async function postPendingCard(guild, { type, characterId = null, titleId = null, challengerCharacterId = null, teamId = null, payload = null, requestedBy }) {
    const { rows } = await pool.query(
        `INSERT INTO pending_requests (guild_id, request_type, requested_by, character_id, title_id, challenger_character_id, team_id, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [guild.id, type, requestedBy, characterId, titleId, challengerCharacterId, teamId, payload ? JSON.stringify(payload) : null]
    );
    const request = rows[0];

    const { rows: g } = await pool.query(`SELECT pending_channel_id FROM guilds WHERE guild_id = $1`, [guild.id]);
    const channelId = g[0]?.pending_channel_id;
    if (!channelId) return request.id;

    try {
        const channel = await guild.channels.fetch(channelId);
        if (!channel) return request.id;
        const message = await channel.send(await buildPendingMessage(request));
        await pool.query(`UPDATE pending_requests SET message_id = $1, channel_id = $2 WHERE id = $3`, [message.id, channel.id, request.id]);
    } catch (err) {
        console.error('Could not post pending card:', err.message);
    }
    return request.id;
}

module.exports = { postPendingCard, buildPendingMessage, describeRequest };
