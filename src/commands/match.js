const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { UserError } = require('../utils/errors');
const { logAudit } = require('../utils/audit');
const { MATCH_CONFIG, matchLabel } = require('../utils/constants');
const { autocompleteCharacters } = require('../utils/characterUtils');
const { autocompleteTitles } = require('../utils/titleLogic');
const { logMatch, undoMatch, editMatch } = require('../utils/matchService');
const { presentMatch, mirrorToMatchesChannel } = require('../utils/matchPresenter');
const { requireAdmin, respond, NO_MENTIONS } = require('../utils/discordHelpers');
const { recentMatches } = require('../utils/statsQueries');

const RESULT_CHOICES = [
    { name: 'Decisive (has a winner)', value: 'decisive' },
    { name: 'Draw', value: 'draw' },
    { name: 'No Contest', value: 'no_contest' }
];

function buildLogSubcommand(sub, key, config) {
    sub.setName(`log-${key.replace(/_/g, '-')}`).setDescription(`Log a ${config.label} result`);
    for (const slot of config.slots) {
        sub.addStringOption((o) => o.setName(slot.name).setDescription(slot.label).setRequired(true).setAutocomplete(true));
    }
    if (config.winnerMode === 'single') {
        sub.addIntegerOption((o) => o.setName('winner').setDescription(`Who won: 1-${config.slots.length} (the order you picked above)`)
            .setRequired(true).setMinValue(1).setMaxValue(config.slots.length));
    } else {
        sub.addIntegerOption((o) => o.setName('winning_team').setDescription('Which team won')
            .setRequired(true).addChoices({ name: 'Team 1', value: 1 }, { name: 'Team 2', value: 2 }));
    }
    sub.addStringOption((o) => o.setName('title').setDescription('Make it a championship match for this title').setRequired(false).setAutocomplete(true));
    sub.addStringOption((o) => o.setName('contender_for').setDescription('Make it a #1 contender match for this title (winner becomes #1 contender)').setRequired(false).setAutocomplete(true));
    sub.addStringOption((o) => o.setName('result_type').setDescription('Default: decisive').setRequired(false).addChoices(...RESULT_CHOICES));
    sub.addStringOption((o) => o.setName('notes').setDescription('Stipulation or notes (shown on the card)').setRequired(false).setMaxLength(300));
    if (key === 'singles') {
        sub.addBooleanOption((o) => o.setName('override_cooldown').setDescription('Book it even though the repeat-matchup cooldown is active').setRequired(false));
    }
    return sub;
}

const data = new SlashCommandBuilder()
    .setName('match')
    .setDescription('Log match results (admins)')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

for (const [key, config] of Object.entries(MATCH_CONFIG)) {
    data.addSubcommand((sub) => buildLogSubcommand(sub, key, config));
}
data.addSubcommand((sub) => sub.setName('rate').setDescription('Give a logged match 1 to 5 stars (used for Wrestler of the Month "best match")')
    .addIntegerOption((o) => o.setName('match_id').setDescription('Match to rate').setRequired(true).setAutocomplete(true))
    .addIntegerOption((o) => o.setName('stars').setDescription('1 to 5 stars').setRequired(true).setMinValue(1).setMaxValue(5)));
data.addSubcommand((sub) => sub.setName('undo').setDescription('Delete a logged match and reverse its title/contender changes')
    .addIntegerOption((o) => o.setName('match_id').setDescription('Match to undo').setRequired(true).setAutocomplete(true)));
data.addSubcommand((sub) => sub.setName('edit').setDescription('Fix the notes, winner or result of a plain match')
    .addIntegerOption((o) => o.setName('match_id').setDescription('Match to edit').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('notes').setDescription('New notes (type a single - to clear)').setRequired(false).setMaxLength(300))
    .addIntegerOption((o) => o.setName('winner').setDescription('New winner by slot number (non-team matches)').setRequired(false).setMinValue(1).setMaxValue(8))
    .addIntegerOption((o) => o.setName('winning_team').setDescription('New winning team (team matches)').setRequired(false).addChoices({ name: 'Team 1', value: 1 }, { name: 'Team 2', value: 2 }))
    .addStringOption((o) => o.setName('result_type').setDescription('Change the result type').setRequired(false).addChoices(...RESULT_CHOICES)));
data.addSubcommand((sub) => sub.setName('recent').setDescription('Show the latest matches with their IDs')
    .addIntegerOption((o) => o.setName('count').setDescription('How many (default 10, max 25)').setRequired(false).setMinValue(1).setMaxValue(25)));

async function matchIdAutocomplete(interaction, focused) {
    const num = String(focused).replace(/\D/g, '');
    const { rows } = await pool.query(
        `SELECT m.id, m.match_type, m.is_title_match, m.created_at,
                (SELECT string_agg(c.name, ' vs ' ORDER BY mp.id) FROM match_participants mp JOIN characters c ON c.id = mp.character_id WHERE mp.match_id = m.id) AS names
         FROM matches m
         WHERE m.guild_id = $1 AND ($2 = '' OR m.id::text LIKE $2 || '%')
         ORDER BY m.id DESC LIMIT 25`,
        [interaction.guildId, num]
    );
    return rows.map((r) => ({
        name: `#${r.id} ${matchLabel(r.match_type)}${r.is_title_match ? ' 🏆' : ''}: ${r.names}`.slice(0, 100),
        value: Number(r.id)
    }));
}

module.exports = {
    data,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        if (focused.name === 'match_id') return interaction.respond(await matchIdAutocomplete(interaction, focused.value));
        if (focused.name === 'title' || focused.name === 'contender_for') return interaction.respond(await autocompleteTitles(interaction, focused.value));
        return interaction.respond(await autocompleteCharacters(interaction, focused.value));
    },

    async execute(interaction) {
        requireAdmin(interaction, 'log or change matches');
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub.startsWith('log-')) {
            const key = sub.replace(/^log-/, '').replace(/-/g, '_');
            const config = MATCH_CONFIG[key];
            if (!config) return respond(interaction, { content: 'Unknown match type.', flags: 64 });

            const result = await logMatch({
                guildId,
                matchType: key,
                slotCharacterIds: config.slots.map((s) => interaction.options.getString(s.name)),
                winnerIndex: config.winnerMode === 'single' ? interaction.options.getInteger('winner') - 1 : null,
                winningTeam: config.winnerMode === 'team' ? interaction.options.getInteger('winning_team') : null,
                resultType: interaction.options.getString('result_type') || 'decisive',
                notes: interaction.options.getString('notes'),
                titleValue: interaction.options.getString('title'),
                contenderTitleValue: interaction.options.getString('contender_for'),
                overrideCooldown: interaction.options.getBoolean('override_cooldown') || false,
                actor: interaction.user.id
            });

            await interaction.deferReply();
            const { payload } = await presentMatch(interaction, result);
            await interaction.editReply(payload);
            await mirrorToMatchesChannel(interaction, payload);
            return;
        }

        if (sub === 'rate') {
            const matchId = interaction.options.getInteger('match_id');
            const stars = interaction.options.getInteger('stars');
            const { rowCount } = await pool.query(`UPDATE matches SET stars = $1, rated_by = $2 WHERE id = $3 AND guild_id = $4`, [stars, interaction.user.id, matchId, guildId]);
            if (!rowCount) throw new UserError('I could not find that match on this server.');
            await logAudit(guildId, interaction.user.id, 'match_rated', { matchId, stars });
            return respond(interaction, { content: `Match **#${matchId}** rated ${'⭐'.repeat(stars)} (${stars}/5).` });
        }

        if (sub === 'undo') {
            const matchId = interaction.options.getInteger('match_id');
            const { match, parts } = await undoMatch(guildId, matchId, interaction.user.id);
            const lines = [`↩️ Match **#${matchId}** (${matchLabel(match.match_type)}: ${parts.map((p) => p.name).join(' vs ')}) was undone by <@${interaction.user.id}>.`];
            if (match.title_effect?.type && match.title_effect.type !== 'none') lines.push('The title change from that match was reversed.');
            if (match.title_effect?.kind === 'contender') lines.push('The #1 contender change from that match was reversed.');
            return respond(interaction, { content: lines.join('\n'), allowedMentions: NO_MENTIONS });
        }

        if (sub === 'edit') {
            const matchId = interaction.options.getInteger('match_id');
            const rawNotes = interaction.options.getString('notes');
            const { changes } = await editMatch(guildId, matchId, interaction.user.id, {
                notes: rawNotes === null ? null : rawNotes.trim() === '-' ? '' : rawNotes,
                winnerIndex: interaction.options.getInteger('winner') !== null ? interaction.options.getInteger('winner') - 1 : null,
                winningTeam: interaction.options.getInteger('winning_team'),
                resultType: interaction.options.getString('result_type')
            });
            const bits = [];
            if (changes.result) bits.push(`result is now **${changes.result.replace('_', ' ')}**`);
            if (changes.winners !== undefined && changes.winners > 0) bits.push('winner updated');
            if (changes.notes !== undefined) bits.push(changes.notes ? 'notes updated' : 'notes cleared');
            return respond(interaction, { content: `✏️ Match **#${matchId}** edited: ${bits.join(', ')}.`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'recent') {
            const rows = await recentMatches(guildId, { limit: interaction.options.getInteger('count') || 10 });
            if (!rows.length) return respond(interaction, { content: 'No matches logged yet.', flags: 64 });
            const lines = rows.map((r) => {
                const when = `<t:${Math.floor(new Date(r.created_at).getTime() / 1000)}:R>`;
                const tag = r.title_name ? ` 🏆 ${r.title_name}` : r.contender_title_name ? ` 🎯 ${r.contender_title_name}` : '';
                const res = r.result_type === 'decisive' ? `**${r.winners}** def. ${r.others}` : `${[r.winners, r.others].filter(Boolean).join(', ')} (${r.result_type === 'draw' ? 'draw' : 'no contest'})`;
                return `\`#${r.id}\` ${matchLabel(r.match_type)}${tag} — ${res} ${when}`;
            });
            const embed = new EmbedBuilder().setTitle('Recent Matches').setColor(0x3498DB).setDescription(lines.join('\n').slice(0, 4000));
            return respond(interaction, { embeds: [embed], flags: 64, allowedMentions: NO_MENTIONS });
        }
    }
};
