const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { ensureUser } = require('../utils/ensureGuild');
const { canAddCharacter, autocompleteCharacters, getCharacterById } = require('../utils/characterUtils');
const { postPendingCard } = require('../handlers/pendingQueue');
const { renderProfileCard } = require('../utils/cardRenderer');

const DIVISION_CHOICES = [
    { name: "Men's", value: 'mens' },
    { name: "Women's", value: 'womens' },
    { name: 'Custom', value: 'custom' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('character')
        .setDescription('Manage wrestler characters')
        .addSubcommand((sub) =>
            sub.setName('submit')
                .setDescription('Submit a character for admin approval (max 3 per user)')
                .addStringOption((o) => o.setName('name').setDescription('Character name').setRequired(true))
                .addStringOption((o) => o.setName('division').setDescription('Division').setRequired(true).addChoices(...DIVISION_CHOICES))
                .addStringOption((o) => o.setName('image_url').setDescription('Optional image URL for their card').setRequired(false))
        )
        .addSubcommand((sub) =>
            sub.setName('assign')
                .setDescription('[Admin] Create and auto-approve a character for a user')
                .addUserOption((o) => o.setName('user').setDescription('Owner').setRequired(true))
                .addStringOption((o) => o.setName('name').setDescription('Character name').setRequired(true))
                .addStringOption((o) => o.setName('division').setDescription('Division').setRequired(true).addChoices(...DIVISION_CHOICES))
                .addStringOption((o) => o.setName('image_url').setDescription('Optional image URL').setRequired(false))
        )
        .addSubcommand((sub) =>
            sub.setName('list')
                .setDescription('List a user\'s characters')
                .addUserOption((o) => o.setName('user').setDescription('Defaults to you').setRequired(false))
        )
        .addSubcommand((sub) =>
            sub.setName('profile')
                .setDescription('Show a character\'s stat card')
                .addStringOption((o) => o.setName('character').setDescription('Character').setRequired(true).setAutocomplete(true))
        )
        .addSubcommand((sub) =>
            sub.setName('retire')
                .setDescription('[Admin] Retire a character')
                .addStringOption((o) => o.setName('character').setDescription('Character').setRequired(true).setAutocomplete(true))
        ),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused();
        const choices = await autocompleteCharacters(interaction, focused);
        await interaction.respond(choices);
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'submit') {
            const name = interaction.options.getString('name');
            const division = interaction.options.getString('division');
            const imageUrl = interaction.options.getString('image_url');

            const ownerId = await ensureUser(guildId, interaction.user.id);
            const allowed = await canAddCharacter(guildId, ownerId);
            if (!allowed) {
                return interaction.reply({ content: 'You already have 3 characters (approved or pending). Retire one first.', ephemeral: true });
            }

            const { rows } = await pool.query(
                `INSERT INTO characters (guild_id, owner_id, name, division, image_url, status, submitted_by)
                 VALUES ($1, $2, $3, $4, $5, 'pending', $6) RETURNING id`,
                [guildId, ownerId, name, division, imageUrl, interaction.user.id]
            );

            await interaction.reply({ content: `**${name}** submitted for approval! An admin will review it via \`/admin pending\`.`, ephemeral: true });

            await postPendingCard(interaction.guild, {
                type: 'character_submission',
                characterId: rows[0].id,
                requestedBy: interaction.user.id,
                summary: `**${name}** (${division}) submitted by <@${interaction.user.id}>`
            });
            return;
        }

        if (sub === 'assign') {
            if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
                return interaction.reply({ content: 'Only admins/mods can assign characters directly.', ephemeral: true });
            }
            const targetUser = interaction.options.getUser('user');
            const name = interaction.options.getString('name');
            const division = interaction.options.getString('division');
            const imageUrl = interaction.options.getString('image_url');

            const ownerId = await ensureUser(guildId, targetUser.id);
            const allowed = await canAddCharacter(guildId, ownerId);
            if (!allowed) {
                return interaction.reply({ content: `<@${targetUser.id}> already has 3 characters.`, ephemeral: true });
            }

            await pool.query(
                `INSERT INTO characters (guild_id, owner_id, name, division, image_url, status, submitted_by, approved_by, approved_at)
                 VALUES ($1, $2, $3, $4, $5, 'approved', $6, $6, now())`,
                [guildId, ownerId, name, division, imageUrl, interaction.user.id]
            );

            return interaction.reply(`Assigned **${name}** (${division}) to <@${targetUser.id}>.`);
        }

        if (sub === 'list') {
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const ownerId = await ensureUser(guildId, targetUser.id);
            const { rows } = await pool.query(
                `SELECT name, division, status FROM characters
                 WHERE guild_id = $1 AND owner_id = $2 AND status != 'denied'
                 ORDER BY status, name`,
                [guildId, ownerId]
            );

            if (!rows.length) {
                return interaction.reply({ content: `<@${targetUser.id}> has no characters yet.`, ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle(`${targetUser.username}'s Characters`)
                .setColor(0xC0392B)
                .setDescription(rows.map((r) => `**${r.name}** — ${r.division}${r.status !== 'approved' ? ` _(${r.status})_` : ''}`).join('\n'));

            return interaction.reply({ embeds: [embed] });
        }

        if (sub === 'profile') {
            const characterId = interaction.options.getString('character');
            const character = await getCharacterById(characterId);
            if (!character) return interaction.reply({ content: 'Character not found.', ephemeral: true });

            await interaction.deferReply();
            const buffer = await renderProfileCard(character);
            return interaction.editReply({ files: [{ attachment: buffer, name: 'profile.png' }] });
        }

        if (sub === 'retire') {
            if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
                return interaction.reply({ content: 'Only admins/mods can retire characters.', ephemeral: true });
            }
            const characterId = interaction.options.getString('character');
            await pool.query(`UPDATE characters SET status = 'retired' WHERE id = $1 AND guild_id = $2`, [characterId, guildId]);
            return interaction.reply('Character retired.');
        }
    }
};
