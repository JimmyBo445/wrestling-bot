const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder
} = require('discord.js');
const { pool } = require('../db/pool');
const { UserError } = require('./errors');
const { getStreaks, getTeamStreaks } = require('./streaks');
const { getCurrentReign, reignMatchesSubject } = require('./titleLogic');
const { DIVISION_LABELS } = require('./discordHelpers');
const { getGuildSettings } = require('./ensureGuild');

/**
 * Makes `subject` the #1 contender for `title` (replacing any current one).
 * Validates division and tag-vs-singles, and that they aren't already champion.
 * Returns { id, revokedIds }.
 */
async function setContender(client, { guildId, title, subject, subjectDivision, earnedVia, awardedBy, sourceMatchId = null }) {
    if (subjectDivision !== title.division) {
        throw new UserError(`The **${title.name}** is a ${DIVISION_LABELS[title.division]} title, so only ${DIVISION_LABELS[title.division]} wrestlers or teams can be its #1 contender.`);
    }
    if (title.is_tag_title && subject.type !== 'team') {
        throw new UserError(`The **${title.name}** is a tag title, so its #1 contender must be a registered team (see \`/team create\`).`);
    }
    if (!title.is_tag_title && subject.type !== 'character') {
        throw new UserError(`The **${title.name}** is a singles title, so its #1 contender must be a single wrestler, not a team.`);
    }
    const current = await getCurrentReign(title.id, client);
    if (reignMatchesSubject(current, subject)) {
        throw new UserError('They already hold that title, so they can\'t also be its #1 contender.');
    }

    const { rows: old } = await client.query(
        `UPDATE contenders SET status = 'revoked', resolved_at = now()
         WHERE title_id = $1 AND status = 'active' RETURNING id`,
        [title.id]
    );
    const { rows } = await client.query(
        `INSERT INTO contenders (guild_id, title_id, character_id, team_id, earned_via, source_match_id, awarded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [guildId, title.id, subject.type === 'character' ? subject.id : null, subject.type === 'team' ? subject.id : null,
            earnedVia, sourceMatchId, awardedBy]
    );
    return { id: String(rows[0].id), revokedIds: old.map((r) => String(r.id)) };
}

/** Titles this subject could still be named #1 contender for (right division, not champion, not already #1). */
async function eligibleTitles(guildId, subject, division, client = pool) {
    const { rows } = await client.query(
        `SELECT t.id, t.name FROM titles t
         WHERE t.guild_id = $1 AND t.division = $2 AND t.is_tag_title = $3
           AND NOT EXISTS (SELECT 1 FROM title_reigns tr WHERE tr.title_id = t.id AND tr.lost_date IS NULL
                           AND ((tr.team_id = $4 AND $5) OR (tr.team_id IS NULL AND tr.character_id = $4 AND NOT $5)))
           AND NOT EXISTS (SELECT 1 FROM contenders c WHERE c.title_id = t.id AND c.status = 'active'
                           AND ((c.team_id = $4 AND $5) OR (c.character_id = $4 AND NOT $5)))
         ORDER BY t.name`,
        [guildId, division, subject.type === 'team', subject.id, subject.type === 'team']
    );
    return rows;
}

/**
 * After a decisive win: if the winner (character or registered team) just reached
 * a multiple of the server's streak threshold, post a "pick a title" prompt for admins.
 * Never throws; returns a short text note for the match reply (or '').
 */
async function maybePromptStreak(guild, { subject, fallbackChannel }) {
    try {
        const settings = await getGuildSettings(guild.id);
        const threshold = settings.streak_threshold;
        if (!threshold || threshold < 1) return '';

        const streak = subject.type === 'team' ? await getTeamStreaks(subject.id) : await getStreaks(subject.id);
        if (streak.direction !== 'win' || streak.current < threshold || streak.current % threshold !== 0) return '';

        const table = subject.type === 'team' ? 'teams' : 'characters';
        const { rows: subjRows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [subject.id]);
        const subj = subjRows[0];
        if (!subj) return '';

        const titles = await eligibleTitles(guild.id, subject, subj.division);
        if (!titles.length) return '';

        const { rows: open } = await pool.query(
            `SELECT 1 FROM pending_requests WHERE guild_id = $1 AND request_type = 'streak_contender' AND status = 'pending'
               AND ((character_id = $2 AND $3 = 'character') OR (team_id = $2 AND $3 = 'team'))`,
            [guild.id, subject.id, subject.type]
        );
        if (open.length) return '';

        const channelId = settings.pending_channel_id || fallbackChannel?.id;
        const { rows: reqRows } = await pool.query(
            `INSERT INTO pending_requests (guild_id, request_type, requested_by, character_id, team_id, payload, channel_id)
             VALUES ($1, 'streak_contender', 'system', $2, $3, $4, $5) RETURNING id`,
            [guild.id, subject.type === 'character' ? subject.id : null, subject.type === 'team' ? subject.id : null,
                JSON.stringify({ streak: streak.current }), channelId || null]
        );
        const requestId = reqRows[0].id;

        let channel = null;
        try { channel = channelId ? await guild.channels.fetch(channelId) : null; } catch (_) { /* gone */ }
        if (!channel) channel = fallbackChannel;
        if (!channel) return `\n🔥 **${subj.name}** has won ${streak.current} in a row — see \`/admin pending\` to pick a title shot.`;

        const embed = new EmbedBuilder()
            .setTitle('🔥 Win Streak — Title Shot?')
            .setColor(0xE67E22)
            .setDescription(`**${subj.name}** has won **${streak.current}** matches in a row.\nAn admin can pick which title they become #1 contender for, or dismiss this.`)
            .setFooter({ text: `Request #${requestId}` });
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`streak_pick_${requestId}`)
            .setPlaceholder('Pick a title to make them #1 contender for')
            .addOptions(titles.slice(0, 25).map((t) => ({ label: t.name.slice(0, 100), value: String(t.id) })));
        const row1 = new ActionRowBuilder().addComponents(menu);
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`streak_dismiss_${requestId}`).setLabel('Not now').setStyle(ButtonStyle.Secondary)
        );
        const msg = await channel.send({ embeds: [embed], components: [row1, row2], allowedMentions: { parse: [] } });
        await pool.query(`UPDATE pending_requests SET message_id = $1, channel_id = $2 WHERE id = $3`, [msg.id, channel.id, requestId]);
        return `\n🔥 **${subj.name}** hit a ${streak.current}-match win streak! A title-shot prompt was posted in <#${channel.id}>.`;
    } catch (err) {
        console.error('Streak prompt failed:', err);
        return '';
    }
}

module.exports = { setContender, eligibleTitles, maybePromptStreak };
