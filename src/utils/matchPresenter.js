const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { renderMatchCard } = require('./cardRenderer');
const { buildMatchCardData, outcomeText } = require('./cardData');
const { getGuildSettings } = require('./ensureGuild');
const { maybePromptStreak } = require('./contenderLogic');
const { NO_MENTIONS } = require('./discordHelpers');
const { isTeamMatch } = require('./constants');

/** Plain-text alt/summary of a match, used if the image can't be drawn. */
function textSummary(result) {
    const win = result.characters.filter((_, i) => result.winnerIdx.includes(i)).map((c) => c.name).join(' & ');
    const rest = result.characters.filter((_, i) => !result.winnerIdx.includes(i)).map((c) => c.name).join(' & ');
    if (result.resultType === 'decisive') return `**${win}** defeated ${rest}`;
    return `${result.characters.map((c) => c.name).join(' vs ')} — ${result.resultType === 'draw' ? 'draw' : 'no contest'}`;
}

/**
 * Builds the public message for a freshly logged match (card + notices),
 * and fires the win-streak prompt for the winner(s) if one is due.
 * Returns { payload, notices }.
 */
async function presentMatch(interaction, result) {
    const notices = [];
    if (result.cooldownOverridden) notices.push('⏱️ Cooldown was overridden for this booking.');

    let file = null;
    try {
        const data = await buildMatchCardData(interaction.guild, result);
        const buffer = await renderMatchCard(data);
        file = new AttachmentBuilder(buffer, { name: 'match.png' });
    } catch (err) {
        console.error('Match card failed, falling back to text:', err);
    }

    const embed = new EmbedBuilder()
        .setColor(result.title ? 0xE8BF4A : result.contenderTitle ? 0xF08C32 : result.resultType === 'decisive' ? 0x27AE60 : 0x95A5A6)
        .setFooter({ text: `Logged by ${interaction.user.username} · Match #${result.matchId} · /match undo ${result.matchId} to reverse` });
    if (file) embed.setImage('attachment://match.png');
    else embed.setTitle(`${result.label} Result`).setDescription([textSummary(result), outcomeText(result)].filter(Boolean).join('\n'));

    // Win-streak prompts (admin picks the title). Characters for non-team matches, registered teams for tag matches.
    if (result.resultType === 'decisive') {
        if (isTeamMatch(result.matchType)) {
            if (result.winnerSubject?.type === 'team') {
                const n = await maybePromptStreak(interaction.guild, { subject: result.winnerSubject, fallbackChannel: interaction.channel });
                if (n) notices.push(n.trim());
            }
        } else {
            const winner = result.characters[result.winnerIdx[0]];
            const n = await maybePromptStreak(interaction.guild, { subject: { type: 'character', id: String(winner.id) }, fallbackChannel: interaction.channel });
            if (n) notices.push(n.trim());
        }
    }

    const payload = {
        content: notices.join('\n') || undefined,
        embeds: [embed],
        files: file ? [file] : [],
        allowedMentions: NO_MENTIONS
    };
    return { payload, notices };
}

/** Sends a copy of the result to the configured #matches channel (if different from where it was run). */
async function mirrorToMatchesChannel(interaction, payload) {
    try {
        const settings = await getGuildSettings(interaction.guildId);
        if (!settings.matches_channel_id || settings.matches_channel_id === interaction.channelId) return;
        const channel = await interaction.guild.channels.fetch(settings.matches_channel_id).catch(() => null);
        if (!channel?.isTextBased()) return;
        // files are single-use streams in some cases, so rebuild attachments from buffers
        const files = (payload.files || []).map((f) => new AttachmentBuilder(f.attachment, { name: f.name }));
        await channel.send({ ...payload, files });
    } catch (err) {
        console.error('Could not mirror match to matches channel:', err.message);
    }
}

module.exports = { presentMatch, mirrorToMatchesChannel, textSummary };
