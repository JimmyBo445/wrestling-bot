const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const { pool } = require('../db/pool');
const { getGuildSettings } = require('../utils/ensureGuild');
const { buildPendingMessage } = require('../handlers/pendingQueue');
const { respond, EPHEMERAL, NO_MENTIONS } = require('../utils/discordHelpers');
const { logAudit } = require('../utils/audit');
const { UserError } = require('../utils/errors');
const { buildMonthlyEmbed, prevMonthKey } = require('../utils/monthly');
const { sendBackup } = require('../utils/backup');
const importer = require('../utils/importer');
const titleImport = require('../utils/titleImport');
const history = require('../utils/historyChannel');
const { AttachmentBuilder } = require('discord.js');

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
    .addSubcommand((s) => s.setName('set-admin-channel').setDescription('Staff channel for reminders: tonight\'s card, rematches, title warnings (empty = off)')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(false).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('set-newsletter-channel').setDescription('Where the weekly newsletter is posted (leave empty to turn off)')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(false).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('deadlines').setDescription('Warn when a champion has not defended, and optionally vacate belts of inactive champions')
        .addIntegerOption((o) => o.setName('defense_days').setDescription('Warn staff if a title has not been defended in this many days (0 = off)').setRequired(false).setMinValue(0).setMaxValue(365))
        .addIntegerOption((o) => o.setName('vacate_days').setDescription('Auto-vacate if the champion has not wrestled at all in this many days (0 = off)').setRequired(false).setMinValue(0).setMaxValue(730)))
    .addSubcommand((s) => s.setName('rematches').setDescription('Rematch clause: a champion who loses the belt is owed a rematch')
        .addStringOption((o) => o.setName('action').setDescription('On or off').setRequired(true).addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' }))
        .addIntegerOption((o) => o.setName('days').setDescription('How many days the rematch is good for (default 30)').setRequired(false).setMinValue(1).setMaxValue(365)))
    .addSubcommand((s) => s.setName('set-timezone').setDescription('Your time zone, so show dates and reminders line up (e.g. America/New_York)')
        .addStringOption((o) => o.setName('zone').setDescription('Time zone name like America/New_York, Europe/London, or UTC').setRequired(true).setMaxLength(40)))
    .addSubcommand((s) => s.setName('import').setDescription('Bring in characters or past results from a spreadsheet file (CSV). Shows a preview first.')
        .addStringOption((o) => o.setName('what').setDescription('What the file contains').setRequired(true).addChoices({ name: 'Characters', value: 'characters' }, { name: 'Past results (singles matches)', value: 'results' }, { name: 'Title history (old reigns)', value: 'titles' }))
        .addAttachmentOption((o) => o.setName('file').setDescription('A .csv file (save your spreadsheet as CSV)').setRequired(true))
        .addBooleanOption((o) => o.setName('apply').setDescription('Leave empty to only preview. Set to true to really import.').setRequired(false)))
    .addSubcommand((s) => s.setName('history').setDescription('Championship history channel the bot keeps up to date. Run with nothing to update it now.')
        .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (the bot posts its own messages there)').setRequired(false).addChannelTypes(ChannelType.GuildText))
        .addStringOption((o) => o.setName('auto').setDescription('Update it by itself after every title change').setRequired(false)
            .addChoices({ name: 'On', value: 'on' }, { name: 'Off (only when I run /admin history)', value: 'off' })))
    .addSubcommand((s) => s.setName('import-template').setDescription('Get example CSV files showing the columns to use for /admin import'))
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
        if (sub === 'set-admin-channel' || sub === 'set-newsletter-channel') {
            const channel = interaction.options.getChannel('channel');
            const col = sub === 'set-admin-channel' ? 'admin_channel_id' : 'newsletter_channel_id';
            await pool.query(`UPDATE guilds SET ${col} = $1 WHERE guild_id = $2`, [channel?.id || null, guildId]);
            await logAudit(guildId, interaction.user.id, `setting_${col}`, { channel: channel?.id || null });
            if (sub === 'set-admin-channel') return respond(interaction, { content: channel ? `Staff reminders (tonight's card, rematches owed, title warnings) will post in <#${channel.id}>. Make sure only staff can see that channel.` : 'Staff reminders are **off**.' });
            return respond(interaction, { content: channel ? `The weekly newsletter will post in <#${channel.id}> (use \`/admin newsletter add\` to add your own lines or post it now).` : 'The weekly newsletter is **off**.' });
        }
        if (sub === 'deadlines') {
            const d = interaction.options.getInteger('defense_days');
            const v = interaction.options.getInteger('vacate_days');
            if (d === null && v === null) throw new UserError('Fill in `defense_days`, `vacate_days`, or both.');
            await pool.query(`UPDATE guilds SET defense_days = COALESCE($1, defense_days), vacate_days = COALESCE($2, vacate_days) WHERE guild_id = $3`, [d, v, guildId]);
            await logAudit(guildId, interaction.user.id, 'setting_deadlines', { defense_days: d, vacate_days: v });
            const s = await getGuildSettings(guildId);
            const bits = [s.defense_days ? `warn staff when a title has gone **${s.defense_days} days** without a defense` : 'no defense warnings',
                s.vacate_days ? `auto-vacate a belt when the champion has not wrestled in **${s.vacate_days} days**` : 'no auto-vacate'];
            return respond(interaction, { content: `Title deadlines: ${bits.join('; ')}.${(s.defense_days || s.vacate_days) && !s.admin_channel_id ? '\nTip: set a staff channel with `/admin set-admin-channel` so the warnings have somewhere to go.' : ''}` });
        }
        if (sub === 'rematches') {
            const on = interaction.options.getString('action') === 'on';
            const days = interaction.options.getInteger('days');
            await pool.query(`UPDATE guilds SET rematch_enabled = $1, rematch_days = COALESCE($2, rematch_days) WHERE guild_id = $3`, [on, days, guildId]);
            await logAudit(guildId, interaction.user.id, 'setting_rematches', { on, days });
            const s = await getGuildSettings(guildId);
            return respond(interaction, { content: on ? `Rematch clauses are **on**: a champion who loses the belt is owed a rematch for **${s.rematch_days} days**.` : 'Rematch clauses are **off**.' });
        }
        if (sub === 'set-timezone') {
            const zone = interaction.options.getString('zone').trim();
            try { new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date()); }
            catch (_) { throw new UserError('I don\'t know that time zone. Use a name like `America/New_York`, `America/Los_Angeles`, `Europe/London` or `UTC`.'); }
            await pool.query(`UPDATE guilds SET tz = $1 WHERE guild_id = $2`, [zone, guildId]);
            await logAudit(guildId, interaction.user.id, 'setting_timezone', { zone });
            return respond(interaction, { content: `Time zone set to **${zone}**. Show dates and reminders now follow it.` });
        }
        if (sub === 'history') {
            const channel = interaction.options.getChannel('channel');
            const auto = interaction.options.getString('auto');
            const before = await getGuildSettings(guildId);
            if (channel) {
                if (channel.id !== before.history_channel_id) await history.forgetPosts(guildId);
                await pool.query(`UPDATE guilds SET history_channel_id = $1 WHERE guild_id = $2`, [channel.id, guildId]);
            }
            if (auto) await pool.query(`UPDATE guilds SET history_auto = $1 WHERE guild_id = $2`, [auto === 'on', guildId]);
            const s = await getGuildSettings(guildId);
            if (channel || auto) await logAudit(guildId, interaction.user.id, 'setting_history_channel', { channel: s.history_channel_id, auto: s.history_auto });
            if (!s.history_channel_id) {
                return respond(interaction, { content: 'No history channel yet. Pick one: `/admin history channel:#your-channel`. The bot posts every title\'s history there and keeps it up to date.', flags: EPHEMERAL });
            }
            const how = s.history_auto === false
                ? 'Automatic updates are **off**: run `/admin history` whenever you want it updated.'
                : 'It updates by itself a few seconds after any title change. Run `/admin history` to update it right away.';
            if (auto && !channel) return respond(interaction, { content: `Championship history channel: <#${s.history_channel_id}>. ${how}` });
            await interaction.deferReply({ flags: EPHEMERAL });
            try {
                const r = await history.refreshHistory(interaction.client, guildId);
                const bits = [r.posted && `${r.posted} posted`, r.edited && `${r.edited} updated`, r.removed && `${r.removed} removed`].filter(Boolean).join(', ');
                const extra = channel ? '\nTip: you can delete the old hand-written history posts there. If you delete one of the bot\'s own messages, it reposts the history.' : '';
                return respond(interaction, { content: `✅ Championship history in <#${s.history_channel_id}> is up to date${bits ? ` (${bits})` : ''}. ${how}${extra}` });
            } catch (err) {
                throw new UserError(`${err.message} Make sure I can see that channel and send messages in it.`);
            }
        }
        if (sub === 'import-template') {
            const files = Object.entries({ ...importer.TEMPLATES, titles: titleImport.TEMPLATE }).map(([k, v]) => new AttachmentBuilder(Buffer.from(v), { name: `import-${k}.csv` }));
            return respond(interaction, { content: '📄 Three example files. Open them in Excel or Google Sheets, replace the rows with yours, save as **CSV**, then attach to `/admin import`.\n**Characters:** `name, division, owner` (Discord ID or exact username) + optional `alignment, bio, finisher`.\n**Results:** `winner, loser` (character names) + optional `date` (YYYY-MM-DD), `stipulation, notes`, `result` (win or draw). **Titles:** `title, holder, won, lost` + optional `members` (Discord IDs that get credit), `defenses, notes`. Dates like 4/1/23 or 2023-04-01; leave `lost` empty for the current champion.', files, flags: 64 });
        }
        if (sub === 'import') {
            const what = interaction.options.getString('what');
            const att = interaction.options.getAttachment('file');
            const apply = interaction.options.getBoolean('apply') === true;
            if (!att) throw new UserError('Attach a .csv file.');
            if (!/\.(csv|txt|tsv)$/i.test(att.name || '') && !/text|csv/i.test(att.contentType || '')) throw new UserError('That doesn\'t look like a CSV file. In Excel or Google Sheets choose File → Save as / Download → CSV.');
            await interaction.deferReply({ flags: 64 });
            const rows = importer.parseCsv(await importer.downloadCsv(att));
            const res = what === 'characters'
                ? await importer.importCharacters(interaction.guild, rows, { apply, actor: interaction.user.id })
                : what === 'titles'
                    ? await titleImport.importTitles(guildId, rows, { apply, actor: interaction.user.id })
                    : await importer.importResults(guildId, rows, { apply, actor: interaction.user.id });
            const noun = what === 'characters' ? 'character' : what === 'titles' ? 'reign' : 'result';
            const onlyLinks = what === 'titles' && !res.ok.length && res.filled?.length;
            const head = onlyLinks
                ? (apply ? '✅ No new reigns to add.' : '👀 Preview: no new reigns to add. Nothing was saved yet. Run the same command with `apply: true` to link the characters.')
                : apply
                ? `✅ Imported **${res.ok.length}** ${noun}${res.ok.length === 1 ? '' : 's'}.`
                : `👀 Preview: **${res.ok.length}** ${noun}${res.ok.length === 1 ? '' : 's'} are ready to import${res.problems.length ? ` and **${res.problems.length}** line(s) have problems` : ''}. Nothing was saved yet. Run the same command with \`apply: true\` to import.`;
            const sample = res.ok.slice(0, 5).map((r) => (what === 'characters' ? `• ${r.name} (${r.division}) → <@${r.discordId}>`
                : what === 'titles' ? `• ${r.title.name}: ${r.holder}${r.members.length ? ` (${r.members.map((id) => `<@${id}>`).join(' & ')})` : ''}, ${r.won} → ${r.lost || 'now'}, ${r.defenses} def.`
                    : `• ${r.a.name} def. ${r.b.name}${r.draw ? ' (draw)' : ''} on ${r.date}`)).join('\n');
            const skip = res.skipped?.length ? `\nℹ️ ${res.skipped.length} reign(s) were already in the bot and were left alone.` : '';
            const filled = res.filled?.length
                ? `\n🔗 ${apply ? 'Linked' : 'Will link'} the character on **${res.filled.length}** reign(s) already in the bot: ${res.filled.slice(0, 5).map((x) => `${x.characters.map((c) => c.name).join(' & ')} (${x.title.name}, ${x.won})`).join(', ')}${res.filled.length > 5 ? ', …' : ''}.`
                : '';
            const probs = res.problems.slice(0, 12).map((p) => `⚠️ ${p}`).join('\n');
            const after = what === 'titles' && apply && res.ok.length ? '\nCheck it with `/championship history`. If you set a history channel (`/admin history`), it updates in a few seconds.' : '';
            return respond(interaction, { content: [head + after, sample && `\n${sample}${res.ok.length > 5 ? `\n…and ${res.ok.length - 5} more` : ''}`, filled, skip, probs && `\n${probs}${res.problems.length > 12 ? `\n…and ${res.problems.length - 12} more problems` : ''}`].filter(Boolean).join('\n').slice(0, 1900), allowedMentions: NO_MENTIONS });
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
                { name: 'Staff reminders channel', value: s.admin_channel_id ? `<#${s.admin_channel_id}>` : 'Off (use `/admin set-admin-channel`)' },
                { name: 'Weekly newsletter', value: s.newsletter_channel_id ? `<#${s.newsletter_channel_id}>` : 'Off (use `/admin set-newsletter-channel`)' },
                { name: 'Title deadlines', value: `${s.defense_days ? `Warn after ${s.defense_days}d without a defense` : 'No defense warnings'} · ${s.vacate_days ? `auto-vacate after ${s.vacate_days}d of champion inactivity` : 'no auto-vacate'}` },
                { name: 'Rematch clause', value: s.rematch_enabled ? `On (${s.rematch_days} days)` : 'Off' },
                { name: 'Time zone', value: s.tz || 'UTC' },
                { name: 'Weekly backup DM', value: s.backup_user_id ? `On, to <@${s.backup_user_id}>` : 'Off (use `/admin backup`)' },
                { name: 'Championship history channel', value: s.history_channel_id ? `<#${s.history_channel_id}> (${s.history_auto === false ? 'manual updates' : 'updates by itself'})` : 'Off (use `/admin history`)' }
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
                    msg.embeds[0].setDescription(`${msg.embeds[0].data.description}${jump || '\nUse `/championship contender-award` to pick a title, or ignore it.'}`);
                }
                await interaction.followUp({ ...msg, flags: EPHEMERAL });
            }
        }
    }
};

// Newsletter and the staff report also live here: /admin newsletter <add|list|remove|preview|post> and /admin report
{
    const { partsOf, extend } = require('../utils/umbrella');
    extend(module.exports, {
        extras: partsOf(require('../modules/report'), { prefix: '' }).map((p) => ({ ...p, json: { ...p.json, name: 'report', description: '[Admin] Staff report: idle wrestlers, thin divisions, stale titles, contracts' } })),
        groups: [{ name: 'newsletter', description: '[Admin] Weekly newsletter: add lines, preview, post', parts: partsOf(require('../modules/newsletter')) }]
    });
}
