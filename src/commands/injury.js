const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { autocompleteCharacters, requireCharacter } = require('../utils/characterUtils');
const { ACTIVE, fmt } = require('../utils/injuryUtils');
const { requireAdmin, respond, NO_MENTIONS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { logAudit } = require('../utils/audit');

const data = new SlashCommandBuilder()
    .setName('injury')
    .setDescription('Injuries: wrestlers who are out until a return date')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('add').setDescription('[Admin] Mark a wrestler injured (auto cards skip them)')
        .addStringOption((o) => o.setName('character').setDescription('Wrestler').setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('days').setDescription('How many days they are out').setRequired(true).setMinValue(1).setMaxValue(365))
        .addStringOption((o) => o.setName('reason').setDescription('e.g. Torn ACL, kayfabe injury').setRequired(false).setMaxLength(60)))
    .addSubcommand((s) => s.setName('clear').setDescription('[Admin] Mark a wrestler healthy again')
        .addStringOption((o) => o.setName('character').setDescription('Injured wrestler').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('list').setDescription('Who is injured right now'));

module.exports = {
    data,

    async autocomplete(interaction) {
        const focused = String(interaction.options.getFocused() || '');
        if (interaction.options.getSubcommand(false) === 'clear') {
            const { rows } = await pool.query(
                `SELECT c.id, c.name FROM injuries i JOIN characters c ON c.id = i.character_id
                 WHERE c.guild_id = $1 AND ${ACTIVE} AND c.name ILIKE $2 ORDER BY c.name LIMIT 25`, [interaction.guildId, `%${focused.replace(/[%_]/g, '')}%`]);
            return interaction.respond(rows.map((r) => ({ name: r.name.slice(0, 100), value: String(r.id) })));
        }
        return interaction.respond(await autocompleteCharacters(interaction, focused));
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'add') {
            requireAdmin(interaction, 'mark injuries');
            const c = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved'] });
            const days = interaction.options.getInteger('days');
            const reason = interaction.options.getString('reason')?.trim() || null;
            await pool.query(`UPDATE injuries SET cleared_at = now() WHERE character_id = $1 AND cleared_at IS NULL`, [c.id]); // replaces an older one
            const { rows } = await pool.query(
                `INSERT INTO injuries (guild_id, character_id, reason, returns_at, created_by) VALUES ($1,$2,$3, CURRENT_DATE + $4::int, $5)
                 RETURNING to_char(returns_at, 'YYYY-MM-DD') AS returns_at`, [guildId, c.id, reason, days, interaction.user.id]);
            await logAudit(guildId, interaction.user.id, 'injury_added', { name: c.name, days });
            return respond(interaction, { content: `🤕 **${c.name}** (<@${c.owner_discord_id}>) is injured until **${fmt(rows[0].returns_at)}**${reason ? ` (${reason})` : ''}. Auto cards will skip them.`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'clear') {
            requireAdmin(interaction, 'clear injuries');
            const c = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved', 'retired'] });
            const { rowCount } = await pool.query(`UPDATE injuries SET cleared_at = now(), announced = true WHERE character_id = $1 AND cleared_at IS NULL`, [c.id]);
            if (!rowCount) throw new UserError(`**${c.name}** isn't injured.`);
            await logAudit(guildId, interaction.user.id, 'injury_cleared', { name: c.name });
            return respond(interaction, { content: `💪 **${c.name}** is cleared and ready to wrestle.` });
        }

        if (sub === 'list') {
            const { rows } = await pool.query(
                `SELECT c.name, u.discord_id, i.reason, to_char(i.returns_at, 'YYYY-MM-DD') AS returns_at
                 FROM injuries i JOIN characters c ON c.id = i.character_id JOIN users u ON u.id = c.owner_id
                 WHERE c.guild_id = $1 AND ${ACTIVE} ORDER BY i.returns_at, c.name`, [guildId]);
            if (!rows.length) return respond(interaction, { content: 'Nobody is injured right now. 💪' });
            const lines = rows.map((r) => `🤕 **${r.name}** (<@${r.discord_id}>) · back **${fmt(r.returns_at)}**${r.reason ? ` · ${r.reason}` : ''}`);
            return respond(interaction, { embeds: [new EmbedBuilder().setTitle('Injury Report').setColor(0xC0392B).setDescription(lines.join('\n').slice(0, 4000))], allowedMentions: NO_MENTIONS });
        }
    }
};
