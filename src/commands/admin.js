const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const { pool } = require('../db/pool');
const { getGuildSettings } = require('../utils/ensureGuild');
const { buildPendingMessage } = require('../handlers/pendingQueue');
const { respond, EPHEMERAL, NO_MENTIONS } = require('../utils/discordHelpers');
const { logAudit } = require('../utils/audit');
const { UserError } = require('../utils/errors');
const { buildMonthlyEmbed, prevMonthKey } = require('../utils/monthly');
const { sendBackup } = require('../utils/backup');

const data = new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Admin tools')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('pending').setDescription('Review waiting requests (characters, challenges, match requests, streak prompts)'))
    .addSubcommand((s) => s.setName('set-pending-channel').setDescription('Where new approval requests and win-streak prompts are posted')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('set-matches-channel').setDescription('Also post every match result in this channel (leave empty to turn off)')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(false).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('set-cooldown').setDescription('How long before the same regular singles matchup can be booked again')
        .addIntegerOption((o) => o.setName('hours').setDescription('Hours (0 turns the cooldown off)').setRequired(true).setMinValue(0).setMaxValue(720))
        .addStringOption((o) => o.setName('scope').setDescription('Same two players (default) or the same two characters').setRequired(false)
            .addChoices({ name: 'Same two players', value: 'user' }, { name: 'Same two characters', value: 'character' })))
    .addSubcommand((s) => s.setName('set-streak-threshold').setDescription('How many wins in a row triggers the "pick a title shot" prompt')
        .addIntegerOption((o) => o.setName('wins').setDescription('Win streak length (0 turns prompts off)').setRequired(true).setMinValue(0).setMaxValue(50)))
    .addSubcommand((s) => s.setName('set-monthly-channel').setDescription('Where the monthly "Wrestler of the Month" post goes (leave empty to turn off)')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(false).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('monthly-awards').setDescription('Post Wrestler of the Month now (default: last month)')
        .addStringOption((o) => o.setName('month').setDescription('Month as YYYY-MM, e.g. 2026-09').setRequired(false).setMaxLength(7)))
    .addSubcommand((s) => s.setName('backup').setDescription('Weekly backup spreadsheets sent to you by DM')
        .addStringOption((o) => o.setName('action').setDescription('What to do').setRequired(true)
            .addChoices({ name: 'Turn on (weekly, to me)', value: 'on' }, { name: 'Turn off', value: 'off' }, { name: 'Send one now', value: 'now' })))
    .addSubcommand((s) => s.setName('milestones').setDescription('Auto shout-outs for win streaks, career wins and title reigns')
        .addStringOption((o) => o.setName('action').setDescription('On or off').setRequired(true).addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' })))
    .addSubcommand((s) => s.setName('settings').setDescription('Show this server\'s bot settings'))
    .addSubcommand((s) => s.setName('audit').setDescription('Recent admin actions')
        .addIntegerOption((o) => o.setName('count').setDescription('How many (default 15, max 25)').setRequired(false).setMinValue(1).setMaxValue(25)));

module.exports = {
    data,

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'set-pending-channel') {
            const channel = interaction.options.getChannel('channel');
            await pool.query(`UPDATE guilds SET pending_channel_id = $1 WHERE guild_id = $2`, [channel.id, guildId]);
            await logAudit(guildId, interaction.user.id, 'setting_pending_channel', { channel: channel.id });
            return respond(interaction, { content: `Approval requests and win-streak prompts will post in <#${channel.id}>.` });
        }
        if (sub === 'set-matches-channel') {
            const channel = interaction.options.getChannel('channel');
            await pool.query(`UPDATE guilds SET matches_channel_id = $1 WHERE guild_id = $2`, [channel?.id || null, guildId]);
            await logAudit(guildId, interaction.user.id, 'setting_matches_channel', { channel: channel?.id || null });
            return respond(interaction, { content: channel ? `Match results will also be posted in <#${channel.id}>.` : 'Match results will no longer be copied to another channel.' });
        }
        if (sub === 'set-monthly-channel') {
            const channel = interaction.options.getChannel('channel');
            await pool.query(`UPDATE guilds SET monthly_channel_id = $1 WHERE guild_id = $2`, [channel?.id || null, guildId]);
            await logAudit(guildId, interaction.user.id, 'setting_monthly_channel', { channel: channel?.id || null });
            return respond(interaction, { content: channel ? `Wrestler of the Month will be posted in <#${channel.id}> at the start of each month (it covers the month before).` : 'The automatic monthly post is **off**.' });
        }
        if (sub === 'monthly-awards') {
            const raw = interaction.options.getString('month')?.trim();
            if (raw && !/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) throw new UserError('Write the month like `2026-09`.');
            const { embed } = await buildMonthlyEmbed(guildId, raw || prevMonthKey());
            return respond(interaction, { embeds: [embed], allowedMentions: NO_MENTIONS });
        }
        if (sub === 'backup') {
            const action = interaction.options.getString('action');
            if (action === 'off') {
                await pool.query(`UPDATE guilds SET backup_user_id = NULL WHERE guild_id = $1`, [guildId]);
                await logAudit(guildId, interaction.user.id, 'backup_off', {});
                return respond(interaction, { content: 'Weekly backups are **off**.', flags: 64 });
            }
            await interaction.deferReply({ flags: 64 });
            if (action === 'on') {
                await pool.query(`UPDATE guilds SET backup_user_id = $1, backup_last = NULL WHERE guild_id = $2`, [interaction.user.id, guildId]);
                await logAudit(guildId, interaction.user.id, 'backup_on', {});
            }
            const ok = await sendBackup(interaction.client, guildId, interaction.user.id);
            return respond(interaction, { content: ok
                ? (action === 'on' ? '✅ Weekly backups are **on**. I just sent the first one to your DMs, and I\'ll send a new one every week.' : '✅ Sent to your DMs.')
                : '⚠️ I couldn\'t DM you. Open Discord Settings → Privacy & Safety → allow direct messages from server members, then try again.' });
        }
        if (sub === 'milestones') {
            const on = interaction.options.getString('action') === 'on';
            await pool.query(`UPDATE guilds SET milestones_enabled = $1 WHERE guild_id = $2`, [on, guildId]);
            await logAudit(guildId, interaction.user.id, 'setting_milestones', { on });
            return respond(interaction, { content: `Milestone shout-outs are **${on ? 'on' : 'off'}**.` });
        }
        if (sub === 'set-cooldown') {
            const hours = interaction.options.getInteger('hours');
            const scope = interaction.options.getString('scope');
            await pool.query(`UPDATE guilds SET singles_cooldown_hours = $1, cooldown_scope = COALESCE($2, cooldown_scope) WHERE guild_id = $3`, [hours, scope, guildId]);
            await logAudit(guildId, interaction.user.id, 'setting_cooldown', { hours, scope });
            const s = await getGuildSettings(guildId);
            return respond(interaction, { content: hours === 0 ? 'Singles cooldown is now **off**.' : `Regular singles matchups now have a **${hours}h** cooldown (${s.cooldown_scope === 'character' ? 'same two characters' : 'same two players'}). Title, #1 contender and tag matches are never affected.` });
        }
        if (sub === 'set-streak-threshold') {
            const wins = interaction.options.getInteger('wins');
            await pool.query(`UPDATE guilds SET streak_threshold = $1 WHERE guild_id = $2`, [wins, guildId]);
            await logAudit(guildId, interaction.user.id, 'setting_streak_threshold', { wins });
            return respond(interaction, { content: wins === 0 ? 'Win-streak title-shot prompts are now **off**.' : `A title-shot prompt will appear every time a wrestler or team reaches a multiple of **${wins}** wins in a row.` });
        }

        if (sub === 'settings') {
            const s = await getGuildSettings(guildId);
            const embed = new EmbedBuilder().setTitle('Bot Settings').setColor(0x95A5A6).addFields(
                { name: 'Approval / prompts channel', value: s.pending_channel_id ? `<#${s.pending_channel_id}>` : 'Not set (use `/admin set-pending-channel`)' },
                { name: 'Match results copied to', value: s.matches_channel_id ? `<#${s.matches_channel_id}>` : 'Off (results appear where the command is used)' },
                { name: 'Singles cooldown', value: s.singles_cooldown_hours ? `${s.singles_cooldown_hours}h (${s.cooldown_scope === 'character' ? 'same two characters' : 'same two players'})` : 'Off' },
                { name: 'Win-streak prompt', value: s.streak_threshold ? `Every ${s.streak_threshold} wins in a row` : 'Off' },
                { name: 'Wrestler of the Month post', value: s.monthly_channel_id ? `<#${s.monthly_channel_id}>` : 'Off (use `/admin set-monthly-channel`)' },
                { name: 'Milestone shout-outs', value: s.milestones_enabled === false ? 'Off' : 'On' },
                { name: 'Weekly backup DM', value: s.backup_user_id ? `On, to <@${s.backup_user_id}>` : 'Off (use `/admin backup`)' }
            );
            return respond(interaction, { embeds: [embed], flags: EPHEMERAL });
        }

        if (sub === 'audit') {
            const { rows } = await pool.query(`SELECT * FROM audit_log WHERE guild_id = $1 ORDER BY id DESC LIMIT $2`, [guildId, interaction.options.getInteger('count') || 15]);
            if (!rows.length) return respond(interaction, { content: 'Nothing logged yet.', flags: EPHEMERAL });
            const lines = rows.map((r) => {
                const d = r.details || {};
                const bits = Object.entries(d).filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object').slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(', ');
                return `<t:${Math.floor(new Date(r.created_at).getTime() / 1000)}:R> <@${r.actor_id}> **${r.action.replace(/_/g, ' ')}**${bits ? ` — ${bits}` : ''}`;
            });
            return respond(interaction, { embeds: [new EmbedBuilder().setTitle('Audit Log').setColor(0x95A5A6).setDescription(lines.join('\n').slice(0, 4000))], flags: EPHEMERAL, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'pending') {
            const { rows } = await pool.query(
                `SELECT * FROM pending_requests WHERE guild_id = $1 AND status = 'pending' ORDER BY created_at ASC LIMIT 10`, [guildId]);
            const { rows: total } = await pool.query(`SELECT COUNT(*)::int AS n FROM pending_requests WHERE guild_id = $1 AND status = 'pending'`, [guildId]);
            if (!rows.length) return respond(interaction, { content: 'No pending requests. All caught up.', flags: EPHEMERAL });
            await respond(interaction, { content: `${total[0].n} pending request(s)${total[0].n > rows.length ? ` (showing the oldest ${rows.length})` : ''}:`, flags: EPHEMERAL });
            for (const r of rows) {
                const msg = await buildPendingMessage(r);
                if (r.request_type === 'streak_contender') {
                    const jump = r.message_id && r.channel_id ? `\nUse the prompt posted in <#${r.channel_id}> to pick the title.` : '';
                    msg.embeds[0].setDescription(`${msg.embeds[0].data.description}${jump || '\nUse `/contender award` to pick a title, or ignore it.'}`);
                }
                await interaction.followUp({ ...msg, flags: EPHEMERAL });
            }
        }
    }
};
