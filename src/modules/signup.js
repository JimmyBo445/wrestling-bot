const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { pool } = require('../db/pool');
const { respond, requireAdmin, NO_MENTIONS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { autocompleteCharacters, requireCharacter } = require('../utils/characterUtils');
const { parseDate } = require('../utils/dates');
const { logAudit } = require('../utils/audit');
const su = require('../utils/signupUtils');

const signupOpt = (o) => o.setName('signup').setDescription('Which signup (default: the newest)').setRequired(false).setAutocomplete(true);

const data = new SlashCommandBuilder()
    .setName('signup')
    .setDescription('[Admin] Show signups: players click to say which wrestlers are available')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('open').setDescription('Post a signup with a button for players to pick their wrestlers')
        .addStringOption((o) => o.setName('title').setDescription('e.g. "RAW - Nov 3"').setRequired(true).setMaxLength(80))
        .addStringOption((o) => o.setName('deadline').setDescription('Closes after this date, YYYY-MM-DD (default: stays open until you close it)').setRequired(false).setMaxLength(10))
        .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: here)').setRequired(false)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('list').setDescription('Who signed up, by division, with records, for booking (only you see it)')
        .addStringOption((o) => o.setName('division').setDescription('Only one division').setRequired(false)
            .addChoices({ name: "Men's", value: 'mens' }, { name: "Women's", value: 'womens' }, { name: 'Customs', value: 'custom' }, { name: "Custom Women's", value: 'custom_womens' }))
        .addStringOption(signupOpt))
    .addSubcommand((s) => s.setName('close').setDescription('Close a signup and send the final list to the staff channel')
        .addStringOption(signupOpt))
    .addSubcommand((s) => s.setName('done').setDescription('Finish a signup: booking and matchmaking go back to using everyone')
        .addStringOption(signupOpt))
    .addSubcommand((s) => s.setName('add').setDescription('Sign a wrestler up yourself (for a player who asked you)')
        .addStringOption((o) => o.setName('character').setDescription('Wrestler').setRequired(true).setAutocomplete(true))
        .addStringOption(signupOpt))
    .addSubcommand((s) => s.setName('remove').setDescription('Take a wrestler off a signup')
        .addStringOption((o) => o.setName('character').setDescription('Wrestler').setRequired(true).setAutocomplete(true))
        .addStringOption(signupOpt));

module.exports = {
    data,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        if (focused.name === 'signup') {
            const { rows } = await pool.query(
                `SELECT id, title, status FROM signups WHERE guild_id = $1 AND title ILIKE $2 ORDER BY created_at DESC LIMIT 25`,
                [interaction.guildId, `%${String(focused.value).replace(/[%_]/g, '')}%`]);
            return interaction.respond(rows.map((r) => ({ name: `${r.title}${r.status === 'open' ? ' (open)' : r.status === 'done' ? ' (done)' : ' (closed)'}`.slice(0, 100), value: String(r.id) })));
        }
        return interaction.respond(await autocompleteCharacters(interaction, focused.value));
    },

    async execute(interaction) {
        requireAdmin(interaction, 'run signups');
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'open') {
            const title = interaction.options.getString('title').trim();
            const dl = interaction.options.getString('deadline');
            const deadline = dl ? parseDate(dl.trim(), 'Deadline') : null;
            const chId = interaction.options.getChannel('channel')?.id;
            const channel = chId ? await interaction.guild.channels.fetch(chId).catch(() => null) : interaction.channel;
            if (!channel?.isTextBased()) throw new UserError('I can\'t post in that channel.');
            await interaction.deferReply({ flags: 64 });
            const { rows: older } = await pool.query(`UPDATE signups SET status = 'done', closed_at = COALESCE(closed_at, now()) WHERE guild_id = $1 AND status IN ('open','closed') RETURNING *`, [guildId]);
            for (const o of older) await su.refreshSignupPost(interaction.client, { ...o, status: 'done' });
            const { rows } = await pool.query(
                `INSERT INTO signups (guild_id, title, channel_id, deadline, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
                [guildId, title, channel.id, deadline, interaction.user.id]);
            const signup = rows[0];
            let msg;
            try { msg = await channel.send(await su.buildSignupMessage(signup)); }
            catch (err) {
                await pool.query(`DELETE FROM signups WHERE id = $1`, [signup.id]);
                throw new UserError('I couldn\'t post in that channel. Check that I can send messages and embeds there.');
            }
            await pool.query(`UPDATE signups SET message_id = $1 WHERE id = $2`, [msg?.id || null, signup.id]);
            await logAudit(guildId, interaction.user.id, 'signup_open', { title });
            return respond(interaction, { content: `✅ Signup **${title}** is open in <#${channel.id}>. See who joined with \`/booking signup-list\`.${deadline ? ` It closes automatically after ${deadline}.` : ' Close it with `/signup close`.'}` });
        }

        const signup = await su.resolveSignup(guildId, interaction.options.getString('signup'));

        if (sub === 'list') {
            await interaction.deferReply({ flags: 64 });
            const embed = await su.buildBookingList(signup, interaction.options.getString('division'));
            return respond(interaction, { embeds: [embed], allowedMentions: NO_MENTIONS });
        }

        if (sub === 'done') {
            if (signup.status === 'done') throw new UserError('That signup is already finished. Booking already uses everyone.');
            await su.markDone(signup.id, guildId);
            if (signup.status === 'open') await su.refreshSignupPost(interaction.client, { ...signup, status: 'done' });
            return respond(interaction, { content: `✅ **${signup.title}** is finished. \`/card auto\` and \`/booking suggest\` go back to using everyone until you open another signup.`, flags: 64 });
        }

        if (sub === 'close') {
            if (signup.status !== 'open') throw new UserError('That signup is already closed.');
            await interaction.deferReply({ flags: 64 });
            await su.closeSignup(interaction.client, signup);
            await logAudit(guildId, interaction.user.id, 'signup_close', { title: signup.title });
            const n = (await su.getEntries(signup.id)).length;
            return respond(interaction, { content: `🔒 Closed **${signup.title}** with ${n} wrestler${n === 1 ? '' : 's'} signed up. \`/card auto\` and \`/booking suggest\` will favor them for the next week.` });
        }

        const c = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved'] });
        if (sub === 'add') {
            if (signup.status !== 'open') throw new UserError('That signup is closed. Pick an open one with the `signup` option.');
            await su.addEntry(signup, c);
            await su.refreshSignupPost(interaction.client, signup);
            return respond(interaction, { content: `✅ Signed **${c.name}** up for **${signup.title}**.`, flags: 64 });
        }
        if (sub === 'remove') {
            const removed = await su.removeEntry(signup, c.id);
            if (!removed) throw new UserError(`${c.name} isn't on **${signup.title}**.`);
            if (signup.status === 'open') await su.refreshSignupPost(interaction.client, signup);
            return respond(interaction, { content: `Removed **${c.name}** from **${signup.title}**.`, flags: 64 });
        }
    }
};
