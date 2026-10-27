const { EmbedBuilder } = require('discord.js');
const { pool, withTransaction } = require('../db/pool');
const { buildLeaderboardEmbed, buildRankingsEmbed } = require('../utils/leaderboardQueries');
const { leaderboardComponents } = require('../modules/leaderboard');
const { rankingsComponents } = require('../modules/rankings');
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
                content: `<@${request.requested_by}> your ${request.request_type === 'match_request' ? 'match request' : 'contender challenge'} was **${approve ? 'approved' : 'denied'}**.${approve && request.request_type === 'match_request' ? ' An admin can put it on a card with `/card request`.' : ''}`,
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

    // ---- contracts: the wrestler's owner answers an offer; admins answer a request ----
    if (interaction.isButton() && id.startsWith('contract:')) {
        const [, action, contractId] = id.split(':');
        const cu = require('../utils/contractUtils');
        const { cardFor } = require('../commands/contract');
        const k = await cu.getContract(contractId, interaction.guildId);
        if (!k) return respond(interaction, { content: 'That contract no longer exists.', flags: EPHEMERAL });
        const ownerAction = ['accept', 'decline'].includes(action);
        const allowed = ownerAction ? (interaction.user.id === k.owner_discord_id || isAdmin(interaction)) : isAdmin(interaction);
        if (!allowed) return respond(interaction, { content: ownerAction ? `Only ${k.char_name}'s owner (or an admin) can answer this offer.` : 'Only admins/mods (Manage Server) can answer a contract request.', flags: EPHEMERAL });
        if (!['offered', 'requested'].includes(k.status)) return respond(interaction, { content: 'That one was already answered.', flags: EPHEMERAL });
        await interaction.deferUpdate();
        try {
            if (action === 'accept' || action === 'approve') {
                const signed = await cu.activate(contractId, interaction.guildId);
                const full = await cu.getContract(signed.id, interaction.guildId);
                return await interaction.editReply({
                    content: `✍️ **${k.char_name}** signed a ${k.months}-month deal worth ${cu.money(k.salary)}/month!`,
                    embeds: [], components: [], files: [await cardFor(interaction.guild, full)], allowedMentions: NO_MENTIONS
                });
            }
            await cu.closePending(contractId, interaction.guildId, action === 'decline' ? 'declined' : 'rejected');
            return await interaction.editReply({ content: action === 'decline' ? `❌ ${k.char_name}'s owner declined the offer.` : `❌ The request for ${k.char_name} was rejected.`, embeds: [], components: [], allowedMentions: NO_MENTIONS });
        } catch (err) {
            const known = err instanceof UserError;
            if (!known) console.error('Contract button failed:', err);
            return interaction.followUp({ content: known ? `⚠️ ${err.message}` : '⚠️ Something went wrong on my side. Please try again.', flags: EPHEMERAL }).catch(() => {});
        }
    }

    // ---- show signups: anyone can use ----
    if (id.startsWith('signup:')) {
        const [, action, signupId] = id.split(':');
        const su = require('../utils/signupUtils');
        const signup = await su.getSignup(signupId, interaction.guildId);
        if (!signup) return respond(interaction, { content: 'That signup no longer exists.', flags: EPHEMERAL });
        if (signup.status !== 'open') return respond(interaction, { content: '🔒 That signup is closed.', flags: EPHEMERAL });
        if (interaction.isButton() && action === 'join') {
            return respond(interaction, { ...(await su.buildPicker(signup, interaction.guildId, interaction.user.id)), flags: EPHEMERAL });
        }
        if (interaction.isButton() && action === 'leave') {
            await su.setEntries(signup, interaction.guildId, interaction.user.id, []);
            await su.refreshSignupPost(interaction.client, signup);
            return respond(interaction, { content: `You're withdrawn from **${signup.title}**.`, flags: EPHEMERAL });
        }
        if (interaction.isStringSelectMenu() && action === 'pick') {
            const chosen = await su.setEntries(signup, interaction.guildId, interaction.user.id, interaction.values);
            await su.refreshSignupPost(interaction.client, signup);
            const msg = chosen.length
                ? `✅ You're signed up for **${signup.title}**: ${chosen.map((c) => `**${c.name}**`).join(', ')}. Press the button again to change it.`
                : `You're withdrawn from **${signup.title}**.`;
            return interaction.update({ content: msg, components: [] });
        }
        return;
    }

    // ---- Match of the Night voting: anyone can vote ----
    if (interaction.isButton() && id.startsWith('motn:')) {
        const [, pollId, matchId] = id.split(':');
        const motn = require('../utils/motn');
        const poll = await motn.castVote(pollId, interaction.guildId, interaction.user.id, matchId);
        const names = await motn.matchNames([matchId]);
        const idx = poll.match_ids.map(String).indexOf(String(matchId)) + 1;
        const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM motn_votes WHERE poll_id = $1`, [poll.id])).rows[0].n;
        const msg = await motn.buildPollMessage(poll);
        await interaction.update({ embeds: msg.embeds, components: msg.components }).catch(() => {});
        return interaction.followUp({ content: `✅ Your vote: **${idx}. ${motn.shortNames(names.get(String(matchId)))}**. (${total} vote${total === 1 ? '' : 's'} so far)`, flags: EPHEMERAL });
    }

    // ---- profile "Story" page: private to whoever clicked ----
    if (interaction.isButton() && id.startsWith('prof:story:')) {
        const { rows } = await pool.query(`SELECT * FROM characters WHERE id = $1 AND guild_id = $2`, [id.split(':')[2], interaction.guildId]);
        const c = rows[0];
        if (!c) return respond(interaction, { content: 'That character no longer exists.', flags: EPHEMERAL });
        const embed = new EmbedBuilder().setTitle(`${c.name} — Story`).setColor(0xE8BF4A);
        if (c.catchphrase) embed.addFields({ name: 'Catchphrase', value: `“${c.catchphrase}”` });
        if (c.finisher) embed.addFields({ name: 'Finisher', value: c.finisher, inline: true });
        if (c.signatures) embed.addFields({ name: 'Signature moves', value: c.signatures.split(',').map((x) => x.trim()).filter(Boolean).map((x) => `• ${x}`).join('\n').slice(0, 1000), inline: true });
        embed.setDescription((c.lore || '_No story written yet. Owners can add one with `/character story`._').slice(0, 4000));
        return respond(interaction, { embeds: [embed], flags: EPHEMERAL });
    }

    // ---- roster pager: only the person who opened it can flip through ----
    if (interaction.isButton() && id.startsWith('roster:')) {
        const [, division, index, retired, ownerId] = id.split(':');
        if (interaction.user.id !== ownerId) {
            return respond(interaction, { content: 'This roster belongs to someone else. Use `/directory roster` to open your own.', flags: EPHEMERAL });
        }
        await interaction.deferUpdate();
        try {
            const { buildRosterPage } = require('../modules/roster');
            const page = await buildRosterPage(interaction.guild, { division, index: parseInt(index, 10), includeRetired: retired === '1', userId: ownerId });
            return await interaction.editReply(page);
        } catch (err) {
            // never delete the roster message on a failure: tell the user privately instead
            const known = err instanceof UserError;
            if (!known) console.error('Roster page failed:', err);
            return interaction.followUp({ content: known ? `⚠️ ${err.message}` : '⚠️ Something went wrong on my side. Please try again.', flags: EPHEMERAL }).catch(() => {});
        }
    }

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
            await interaction.deferUpdate();
            const { rankingsPayload } = require('../modules/rankings');
            return interaction.editReply(await rankingsPayload(interaction.guild, division));
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
