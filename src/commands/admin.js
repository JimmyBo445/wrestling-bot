const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { pool } = require('../db/pool');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Admin tools')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((sub) => sub.setName('pending').setDescription('Review pending character submissions and title challenges'))
        .addSubcommand((sub) =>
            sub.setName('set-pending-channel')
                .setDescription('Set the channel where new approval requests are posted')
                .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(ChannelType.GuildText))
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'set-pending-channel') {
            const channel = interaction.options.getChannel('channel');
            await pool.query(`UPDATE guilds SET pending_channel_id = $1 WHERE guild_id = $2`, [channel.id, guildId]);
            return interaction.reply(`Approval requests will now post in <#${channel.id}>.`);
        }

        if (sub === 'pending') {
            const { rows } = await pool.query(
                `SELECT pr.*, c.name AS character_name, c.division, t.name AS title_name
                 FROM pending_requests pr
                 LEFT JOIN characters c ON c.id = pr.character_id
                 LEFT JOIN characters cc ON cc.id = pr.challenger_character_id
                 LEFT JOIN titles t ON t.id = pr.title_id
                 WHERE pr.guild_id = $1 AND pr.status = 'pending'
                 ORDER BY pr.created_at ASC LIMIT 10`,
                [guildId]
            );

            if (!rows.length) {
                return interaction.reply({ content: 'No pending requests. All caught up.', ephemeral: true });
            }

            await interaction.reply({ content: `${rows.length} pending request(s):`, ephemeral: true });

            for (const r of rows) {
                const summary = r.request_type === 'character_submission'
                    ? `**${r.character_name}** (${r.division}) submitted by <@${r.requested_by}>`
                    : `<@${r.requested_by}> wants a #1 contender shot at the **${r.title_name}**`;

                const embed = new EmbedBuilder()
                    .setTitle(r.request_type === 'character_submission' ? 'Character Submission' : 'Contender Challenge')
                    .setDescription(summary)
                    .setColor(0xF1C40F)
                    .setFooter({ text: `Request #${r.id}` });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`pending_approve_${r.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`pending_deny_${r.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
                );

                await interaction.followUp({ embeds: [embed], components: [row], ephemeral: true });
            }
        }
    }
};
