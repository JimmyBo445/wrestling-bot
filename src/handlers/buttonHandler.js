const { EmbedBuilder } = require('discord.js');
const { pool, withTransaction } = require('../db/pool');
const { buildLeaderboardEmbed, buildRankingsEmbed } = require('../utils/leaderboardQueries');
const { leaderboardComponents } = require('../commands/leaderboard');
const { rankingsComponents } = require('../commands/rankings');
const { setContender } = require('../utils/contenderLogic');
const { requireTitle } = require('../utils/titleLogic');
const { isAdmin, respond, EPHEMERAL, NO_MENTIONS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { logAudit } = require('../utils/audit');
const { PERIODS } = require('../utils/statsQueries');

function resolvedEmbed(interaction, approve, line) {
    const original = interaction.message?.embeds?.[0];
    const base = original ? EmbedBuilder.from(original) : new EmbedBuilder();
    return base.setColor(approve ? 0x2ECC71 : 0xE74C3C).addFields({ name: 'Result', value: line });
}

/** Atomically takes a pending request so two admins can't both resolve it. Returns the row or null. */
async function claimRequest(client, id, guildId, status, actor) {
    const { rows } = await client.query(
        `UPDATE pending_requests SET status = $1, resolved_by = $2, resolved_at = now()
         WHERE id = $3 AND guild_id = $4 AND status = 'pending' RETURNING *`,
        [status, actor, id, guildId]
    );
    return rows[0] || null;
}

async function handlePending(interaction) {
    const [, action, idStr] = interaction.customId.split('_');
    const id = parseInt(idStr, 10);
    const approve = action === 'approve';
    let line = '';

    const request = await withTransaction(async (client) => {
        const r = await claimRequest(client, id, interaction.guildId, approve ? 'approved' : 'denied', interaction.user.id);
        if (!r) return null;

        if (r.request_type === 'character_submission') {
            await client.query(
                `UPDATE characters SET status = $1, approved_by = $2, approved_at = now() WHERE id = $3`,
                [approve ? 'approved' : 'denied', interaction.user.id, r.character_id]);
        } else if (r.request_type === 'contender_challenge' && approve) {
            const { rows: tRows } = await client.query(`SELECT * FROM titles WHERE id = $1`, [r.title_id]);
            const title = tRows[0];
            const subject = r.team_id ? { type: 'team', id: String(r.team_id) } : { type: 'character', id: String(r.challenger_character_id) };
            const { rows: sRows } = await client.query(
                `SELECT division, name, status FROM ${subject.type === 'team' ? 'teams' : 'characters'} WHERE id = $1`, [subject.id]);
            if (!sRows[0] || !['approved', 'active'].includes(sRows[0].status)) throw new UserError('That wrestler/team is no longer active, so the challenge can\'t be approved. Deny it instead.');
            await setContender(client, { guildId: interaction.guildId, title, subject, subjectDivision: sRows[0].division, earnedVia: 'challenge_approved', awardedBy: interaction.user.id });
            line = `${sRows[0].name} is now #1 contender`;
        }
        return r;
    });

    if (!request) {
        const { rows } = await pool.query(`SELECT status FROM pending_requests WHERE id = $1 AND guild_id = $2`, [id, interaction.guildId]);
        if (interaction.message?.components?.length && rows[0]) await interaction.update({ components: [] }).catch(() => {});
        return respond(interaction, { content: rows[0] ? `That request was already ${rows[0].status}.` : 'That request no longer exists.', flags: EPHEMERAL });
    }

    await logAudit(interaction.guildId, interaction.user.id, `request_${approve ? 'approved' : 'denied'}`, { id, type: request.request_type });
    const who = approve ? `Approved by <@${interaction.user.id}>` : `Denied by <@${interaction.user.id}>`;
    const result = [who, line].filter(Boolean).join(' · ');
    await interaction.update({ embeds: [resolvedEmbed(interaction, approve, result)], components: [], allowedMentions: NO_MENTIONS });

    // let the requester know about decisions that otherwise they'd never see
    if (['match_request', 'contender_challenge'].includes(request.request_type)) {
        try {
            await interaction.channel.send({
                content: `<@${request.requested_by}> your ${request.request_type === 'match_request' ? 'match request' : 'contender challenge'} was **${approve ? 'approved' : 'denied'}**.${approve && request.request_type === 'match_request' ? ' An admin will book it.' : ''}`,
                allowedMentions: { users: [request.requested_by] }
            });
        } catch (_) { /* no permission to post: fine */ }
    }
}

async function handleStreak(interaction) {
    const parts = interaction.customId.split('_'); // streak_pick_12 | streak_dismiss_12
    const action = parts[1];
    const id = parseInt(parts[2], 10);

    if (action === 'dismiss') {
        const done = await withTransaction((c) => claimRequest(c, id, interaction.guildId, 'dismissed', interaction.user.id));
        if (!done) return respond(interaction, { content: 'That prompt was already handled.', flags: EPHEMERAL });
        return interaction.update({ embeds: [resolvedEmbed(interaction, false, `Dismissed by <@${interaction.user.id}>`).setColor(0x95A5A6)], components: [], allowedMentions: NO_MENTIONS });
    }

    const titleId = interaction.values[0];
    let title; let name;
    const req = await withTransaction(async (client) => {
        const r = await claimRequest(client, id, interaction.guildId, 'approved', interaction.user.id);
        if (!r) return null;
        title = await requireTitle(interaction.guildId, titleId, client);
        const subject = r.team_id ? { type: 'team', id: String(r.team_id) } : { type: 'character', id: String(r.character_id) };
        const { rows } = await client.query(`SELECT division, name FROM ${subject.type === 'team' ? 'teams' : 'characters'} WHERE id = $1`, [subject.id]);
        name = rows[0].name;
        await setContender(client, { guildId: interaction.guildId, title, subject, subjectDivision: rows[0].division, earnedVia: 'win_streak', awardedBy: interaction.user.id });
        return r;
    });
    if (!req) return respond(interaction, { content: 'That prompt was already handled.', flags: EPHEMERAL });
    await logAudit(interaction.guildId, interaction.user.id, 'streak_contender_set', { name, title: title.name });
    return interaction.update({
        embeds: [resolvedEmbed(interaction, true, `🎯 ${name} is now #1 contender for the ${title.name} (picked by <@${interaction.user.id}>)`)],
        components: [], allowedMentions: NO_MENTIONS
    });
}

async function handleButtonInteraction(interaction) {
    const id = interaction.customId || '';

    // ---- public browsing menus: anyone can use ----
    if (interaction.isStringSelectMenu()) {
        if (id.startsWith('lb_cat_') || id.startsWith('lb_period_')) {
            let category; let period;
            if (id.startsWith('lb_cat_')) { category = interaction.values[0]; period = id.slice('lb_cat_'.length); }
            else { period = interaction.values[0]; category = id.slice('lb_period_'.length); }
            if (!(period in PERIODS)) period = 'all';
            const embed = await buildLeaderboardEmbed(interaction.guildId, category, period);
            return interaction.update({ embeds: [embed], components: leaderboardComponents(category, period) });
        }
        if (id === 'rank_div') {
            const division = interaction.values[0];
            return interaction.update({ embeds: [await buildRankingsEmbed(interaction.guildId, division)], components: rankingsComponents(division) });
        }
    }

    // ---- admin-only actions ----
    if (id.startsWith('pending_') || id.startsWith('streak_')) {
        if (!isAdmin(interaction)) {
            return respond(interaction, { content: 'Only admins/mods (Manage Server) can do that.', flags: EPHEMERAL });
        }
        if (id.startsWith('pending_')) return handlePending(interaction);
        return handleStreak(interaction);
    }
}

module.exports = { handleButtonInteraction };
