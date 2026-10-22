const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { pool } = require('../db/pool');
const { respond, NO_MENTIONS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { logAudit } = require('../utils/audit');
const { buildNewsletter, weekKey } = require('../utils/newsletter');

const data = new SlashCommandBuilder()
    .setName('newsletter')
    .setDescription('[Admin] The weekly newsletter: add your own lines, preview it, post it')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('add').setDescription('Add a line to the next newsletter (news, announcements, storyline teasers)')
        .addStringOption((o) => o.setName('text').setDescription('What to say').setRequired(true).setMaxLength(300)))
    .addSubcommand((s) => s.setName('list').setDescription('Lines waiting for the next newsletter'))
    .addSubcommand((s) => s.setName('remove').setDescription('Delete a waiting line')
        .addIntegerOption((o) => o.setName('id').setDescription('Line to delete').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('preview').setDescription('See this week\'s newsletter (only you)'))
    .addSubcommand((s) => s.setName('post').setDescription('Post this week\'s newsletter now (default: the newsletter channel, else here)')
        .addChannelOption((o) => o.setName('channel').setDescription('Where to post it').setRequired(false)));

module.exports = {
    data,

    async autocomplete(interaction) {
        const { rows } = await pool.query(`SELECT id, body FROM newsletter_entries WHERE guild_id = $1 AND posted_in IS NULL ORDER BY id DESC LIMIT 25`, [interaction.guildId]);
        return interaction.respond(rows.map((r) => ({ name: `#${r.id} ${r.body}`.slice(0, 100), value: Number(r.id) })));
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'add') {
            const { rows } = await pool.query(`INSERT INTO newsletter_entries (guild_id, body, created_by) VALUES ($1,$2,$3) RETURNING id`, [guildId, interaction.options.getString('text').trim(), interaction.user.id]);
            return respond(interaction, { content: `📝 Added as line **#${rows[0].id}**. It goes out in the next newsletter under "From the office".`, flags: 64 });
        }
        if (sub === 'list') {
            const { rows } = await pool.query(`SELECT id, body FROM newsletter_entries WHERE guild_id = $1 AND posted_in IS NULL ORDER BY id`, [guildId]);
            return respond(interaction, { content: rows.length ? rows.map((r) => `**#${r.id}** ${r.body}`).join('\n') : 'No lines waiting. Add one with `/newsletter add`.', flags: 64 });
        }
        if (sub === 'remove') {
            const { rowCount } = await pool.query(`DELETE FROM newsletter_entries WHERE id = $1 AND guild_id = $2 AND posted_in IS NULL`, [interaction.options.getInteger('id'), guildId]);
            if (!rowCount) throw new UserError('I couldn\'t find that line. Pick one from the list.');
            return respond(interaction, { content: 'Deleted.', flags: 64 });
        }
        const { embed, entryIds } = await buildNewsletter(guildId, interaction.guild?.name);
        if (sub === 'preview') return respond(interaction, { embeds: [embed], flags: 64, allowedMentions: NO_MENTIONS });
        if (sub === 'post') {
            const s = (await pool.query(`SELECT newsletter_channel_id FROM guilds WHERE guild_id = $1`, [guildId])).rows[0];
            const picked = interaction.options.getChannel('channel');
            const channelId = picked?.id || s.newsletter_channel_id;
            if (channelId && channelId !== interaction.channelId) {
                const ch = await interaction.guild.channels.fetch(channelId).catch(() => null);
                if (!ch?.isTextBased()) throw new UserError('I can\'t post in that channel.');
                await ch.send({ embeds: [embed], allowedMentions: NO_MENTIONS }).catch(() => { throw new UserError('I couldn\'t post there. Check that I can view the channel and send messages.'); });
                if (entryIds.length) await pool.query(`UPDATE newsletter_entries SET posted_in = $2 WHERE id = ANY($1::bigint[])`, [entryIds, `manual-${weekKey()}`]);
                await logAudit(guildId, interaction.user.id, 'newsletter_posted', {});
                return respond(interaction, { content: `Posted in <#${channelId}>.`, flags: 64 });
            }
            if (entryIds.length) await pool.query(`UPDATE newsletter_entries SET posted_in = $2 WHERE id = ANY($1::bigint[])`, [entryIds, `manual-${weekKey()}`]);
            await logAudit(guildId, interaction.user.id, 'newsletter_posted', {});
            return respond(interaction, { embeds: [embed], allowedMentions: NO_MENTIONS });
        }
    }
};
