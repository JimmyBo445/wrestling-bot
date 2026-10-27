const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { renderProfileCard } = require('../utils/cardRenderer');
const { buildProfileData } = require('../utils/cardData');
const { respond, DIVISION_LABELS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');

const DIVISION_CHOICES = Object.entries(DIVISION_LABELS).map(([value, name]) => ({ name, value }));

const data = new SlashCommandBuilder()
    .setName('roster')
    .setDescription('Flip through every wrestler in a division, A to Z, with their profile cards')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('division').setDescription('Division').setRequired(true).addChoices(...DIVISION_CHOICES))
    .addBooleanOption((o) => o.setName('include_retired').setDescription('Also show retired wrestlers (default: no)').setRequired(false));

/** Wrestlers in a division, A to Z (case-insensitive). */
async function rosterIds(guildId, division, includeRetired) {
    const { rows } = await pool.query(
        `SELECT c.id FROM characters c WHERE c.guild_id = $1 AND c.division = $2 AND c.status = ANY($3::text[])
         ORDER BY lower(c.name), c.id`,
        [guildId, division, includeRetired ? ['approved', 'retired'] : ['approved']]);
    return rows.map((r) => String(r.id));
}

const customId = (division, index, retired, userId) => `roster:${division}:${index}:${retired ? 1 : 0}:${userId}`;

/** One page: the profile card of wrestler #index plus Prev / counter / Next buttons. */
async function buildRosterPage(guild, { division, index, includeRetired, userId }) {
    const ids = await rosterIds(guild.id, division, includeRetired);
    if (!ids.length) throw new UserError(`There are no ${includeRetired ? '' : 'active '}wrestlers in the ${DIVISION_LABELS[division]} division yet.`);
    const i = ((index % ids.length) + ids.length) % ids.length; // wraps around: after Z comes A
    const { rows } = await pool.query(
        `SELECT c.*, u.discord_id AS owner_discord_id FROM characters c JOIN users u ON u.id = c.owner_id WHERE c.id = $1`, [ids[i]]);
    const buffer = await renderProfileCard(await buildProfileData(guild, rows[0]));
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(customId(division, i - 1, includeRetired, userId)).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(ids.length < 2),
        new ButtonBuilder().setCustomId(`roster_count_${i}`).setLabel(`${i + 1} / ${ids.length}`).setStyle(ButtonStyle.Primary).setDisabled(true),
        new ButtonBuilder().setCustomId(customId(division, i + 1, includeRetired, userId)).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(ids.length < 2)
    );
    return {
        content: `**${DIVISION_LABELS[division]} roster** · A to Z · ${i + 1} of ${ids.length}`,
        files: [new AttachmentBuilder(buffer, { name: 'profile.png' })],
        attachments: [],
        components: [row]
    };
}

module.exports = {
    data,
    buildRosterPage,

    async execute(interaction) {
        await interaction.deferReply();
        const page = await buildRosterPage(interaction.guild, {
            division: interaction.options.getString('division'), index: 0,
            includeRetired: interaction.options.getBoolean('include_retired') || false, userId: interaction.user.id
        });
        return respond(interaction, page);
    }
};
