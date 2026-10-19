const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { autocompleteCharacters, requireCharacter } = require('../utils/characterUtils');
const { getGuildSettings } = require('../utils/ensureGuild');
const { singlesCooldownHoursLeft } = require('../utils/matchService');
const { postPendingCard } = require('../handlers/pendingQueue');
const { respond, DIVISION_LABELS, NO_MENTIONS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');

const data = new SlashCommandBuilder()
    .setName('matchmaking')
    .setDescription('Matchmaking help and match requests')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('suggest')
        .setDescription('Find fresh opponents: people this wrestler (and player) has faced the least')
        .addStringOption((o) => o.setName('character').setDescription('Wrestler to find opponents for').setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('count').setDescription('How many suggestions (default 5, max 15)').setRequired(false).setMinValue(1).setMaxValue(15))
        .addBooleanOption((o) => o.setName('any_division').setDescription('Include other divisions (default: same division only)').setRequired(false)))
    .addSubcommand((s) => s.setName('request')
        .setDescription('Ask admins to book a singles match between two wrestlers')
        .addStringOption((o) => o.setName('character').setDescription('Your wrestler').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('opponent').setDescription('Who you want to face').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('note').setDescription('Why / any stipulation').setRequired(false).setMaxLength(200)));

module.exports = {
    data,

    async autocomplete(interaction) {
        return interaction.respond(await autocompleteCharacters(interaction, interaction.options.getFocused()));
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'suggest') {
            const me = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved'] });
            const count = interaction.options.getInteger('count') || 5;
            const anyDivision = interaction.options.getBoolean('any_division') || false;
            const settings = await getGuildSettings(guildId);

            const { rows } = await pool.query(
                `SELECT o.id, o.name, o.division, o.owner_id, u.discord_id,
                    (SELECT COUNT(*)::int FROM match_participants a JOIN match_participants b ON b.match_id = a.match_id AND b.character_id = o.id
                       AND (a.team_number IS NULL OR b.team_number IS DISTINCT FROM a.team_number)
                     WHERE a.character_id = $2) AS char_meetings,
                    (SELECT COUNT(DISTINCT a.match_id)::int FROM match_participants a
                       JOIN match_participants b ON b.match_id = a.match_id AND (a.team_number IS NULL OR b.team_number IS DISTINCT FROM a.team_number)
                       JOIN characters ca ON ca.id = a.character_id JOIN characters cb ON cb.id = b.character_id
                     WHERE ca.owner_id = $3 AND cb.owner_id = o.owner_id) AS user_meetings,
                    (SELECT MAX(m.created_at) FROM match_participants a JOIN match_participants b ON b.match_id = a.match_id AND b.character_id = o.id
                       JOIN matches m ON m.id = a.match_id WHERE a.character_id = $2) AS last_met,
                    EXISTS (SELECT 1 FROM title_reigns tr WHERE tr.lost_date IS NULL AND tr.team_id IS NULL AND tr.character_id = o.id) AS champ,
                    EXISTS (SELECT 1 FROM contenders co WHERE co.status = 'active' AND co.character_id = o.id) AS contender
                 FROM characters o JOIN users u ON u.id = o.owner_id
                 WHERE o.guild_id = $1 AND o.status = 'approved' AND o.id <> $2 AND o.owner_id <> $3
                   AND ($4 OR o.division = $5)`,
                [guildId, me.id, me.owner_id, anyDivision, me.division]
            );
            if (!rows.length) throw new UserError('No other players\' wrestlers to suggest yet.');

            for (const r of rows) {
                r.cooldown = await singlesCooldownHoursLeft(guildId, me, { id: r.id, owner_id: r.owner_id }, settings);
            }
            rows.sort((a, b) =>
                (a.cooldown > 0) - (b.cooldown > 0) ||
                a.char_meetings - b.char_meetings ||
                a.user_meetings - b.user_meetings ||
                (a.last_met ? new Date(a.last_met).getTime() : 0) - (b.last_met ? new Date(b.last_met).getTime() : 0) ||
                Math.random() - 0.5);

            const lines = rows.slice(0, count).map((r, i) => {
                const flags = `${r.champ ? ' 👑' : ''}${r.contender ? ' 🎯' : ''}${r.cooldown ? ` ⏳${r.cooldown}h` : ''}`;
                const last = r.last_met ? `last faced <t:${Math.floor(new Date(r.last_met).getTime() / 1000)}:R>` : 'never faced';
                return `**${i + 1}. ${r.name}** (<@${r.discord_id}>)${anyDivision ? ` · ${DIVISION_LABELS[r.division]}` : ''}${flags}\n${r.char_meetings} match${r.char_meetings === 1 ? '' : 'es'} vs ${me.name} · ${r.user_meetings} between the players · ${last}`;
            });
            const embed = new EmbedBuilder().setTitle(`Fresh matchups for ${me.name}`).setColor(0x3498DB)
                .setDescription(lines.join('\n\n')).setFooter({ text: '👑 champion  🎯 #1 contender  ⏳ singles cooldown still active' });
            return respond(interaction, { embeds: [embed], allowedMentions: NO_MENTIONS });
        }

        if (sub === 'request') {
            const me = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved'] });
            const opp = await requireCharacter(guildId, interaction.options.getString('opponent'), { statuses: ['approved'] });
            if (String(me.id) === String(opp.id)) throw new UserError('A wrestler can\'t face themselves.');
            if (me.owner_discord_id !== interaction.user.id) throw new UserError('You can only request matches for your own wrestlers.');
            const settings = await getGuildSettings(guildId);
            const left = await singlesCooldownHoursLeft(guildId, me, opp, settings);
            const note = interaction.options.getString('note');
            await postPendingCard(interaction.guild, {
                type: 'match_request', requestedBy: interaction.user.id, characterId: me.id, challengerCharacterId: opp.id,
                payload: { match_type: 'singles', names: [me.name, opp.name], note: note || null }
            });
            return respond(interaction, {
                content: `Request sent: **${me.name}** vs **${opp.name}**. An admin will review it.${left ? `\n⏳ Heads up: these two players had a regular singles match recently, so booking may need to wait about ${left}h.` : ''}`,
                flags: 64
            });
        }
    }
};
