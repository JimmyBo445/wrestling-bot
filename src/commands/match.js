const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { UserError } = require('../utils/errors');
const { logAudit } = require('../utils/audit');
const { MATCH_CONFIG, matchLabel, FINISHES } = require('../utils/constants');
const { autocompleteCharacters } = require('../utils/characterUtils');
const { autocompleteTitles } = require('../utils/titleLogic');
const { logMatch, undoMatch, editMatch } = require('../utils/matchService');
const { presentMatch, mirrorToMatchesChannel } = require('../utils/matchPresenter');
const { maybeAutoRecap } = require('../utils/showRecap');
const { requireAdmin, respond, NO_MENTIONS } = require('../utils/discordHelpers');
const { recentMatches } = require('../utils/statsQueries');
const { addDetailOptions, readDetails, stipulationChoices, finishChoices } = require('../utils/matchOptions');
const L = require('../utils/legacy');

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
    sub.addStringOption((o) => o.setName('notes').setDescription('Extra notes (shown on the card)').setRequired(false).setMaxLength(300));
    addDetailOptions(sub, { finishSearch: true });
    if (key === 'singles') {
        sub.addBooleanOption((o) => o.setName('override_cooldown').setDescription('Book it even though the repeat-matchup cooldown is active').setRequired(false));
    }
    return sub;
}

const data = new SlashCommandBuilder()
    .setName('match')
    .setDescription('Match results: players report theirs, staff log, edit and undo')
    .setDMPermission(false);
// 3.7: /match is visible to everyone so players can use /match report. Every other subcommand is
// [Admin] and still checks for admin / staff role before doing anything.
void PermissionFlagsBits;

// 3.0: one command for every match type (the old log-... commands were retired in 3.5).
data.addSubcommand((sub) => {
    sub.setName('log').setDescription('[Admin] Log any match: pick the type, the wrestlers in order, then who won')
        .addStringOption((o) => o.setName('type').setDescription('Match type').setRequired(true)
            .addChoices(...Object.entries(MATCH_CONFIG).map(([value, c]) => ({ name: c.label, value }))))
        .addStringOption((o) => o.setName('wrestler1').setDescription('Wrestler 1 (tag: Team 1 first, then Team 2)').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('wrestler2').setDescription('Wrestler 2').setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('winner').setDescription('Who won: their wrestler number, or 1 / 2 for the winning team').setRequired(true).setMinValue(1).setMaxValue(8));
    for (let n = 3; n <= 8; n++) sub.addStringOption((o) => o.setName(`wrestler${n}`).setDescription(`Wrestler ${n}`).setRequired(false).setAutocomplete(true));
    sub.addStringOption((o) => o.setName('title').setDescription('Title on the line').setRequired(false).setAutocomplete(true))
        .addStringOption((o) => o.setName('contender_for').setDescription('#1 contender match for this title').setRequired(false).setAutocomplete(true))
        .addStringOption((o) => o.setName('result_type').setDescription('Default: decisive').setRequired(false).addChoices(...RESULT_CHOICES))
        .addStringOption((o) => o.setName('ple').setDescription('Premium live event, e.g. WrestleMania (optional)').setRequired(false).setMaxLength(40).setAutocomplete(true))
        .addStringOption((o) => o.setName('notes').setDescription('Extra notes').setRequired(false).setMaxLength(300));
    addDetailOptions(sub, { finishSearch: true });
    return sub.addBooleanOption((o) => o.setName('override_cooldown').setDescription('Singles: book it even if the cooldown is active').setRequired(false));
});
// 3.5: the old /match log-singles, log-tag2v2, … were retired (use /match log). They're no longer
// registered with Discord; the code below still understands them, so nothing half-finished breaks.
void buildLogSubcommand;
data.addSubcommand((sub) => sub.setName('ple').setDescription('[Admin] Mark matches as part of a PLE (by date or one match), or see PLE history')
    .addStringOption((o) => o.setName('event').setDescription('PLE name, e.g. WrestleMania (the year is added for you)').setRequired(false).setMaxLength(40).setAutocomplete(true))
    .addStringOption((o) => o.setName('date').setDescription('Tag every match logged that day, YYYY-MM-DD (default: today)').setRequired(false))
    .addIntegerOption((o) => o.setName('match_id').setDescription('Or tag just this match').setRequired(false).setAutocomplete(true))
    .addBooleanOption((o) => o.setName('clear').setDescription('Remove the PLE tag instead').setRequired(false)));
data.addSubcommand((sub) => sub.setName('rate').setDescription('[Admin] Give a logged match 1 to 5 stars (used for Wrestler of the Month "best match")')
    .addIntegerOption((o) => o.setName('match_id').setDescription('Match to rate').setRequired(true).setAutocomplete(true))
    .addIntegerOption((o) => o.setName('stars').setDescription('1 to 5 stars').setRequired(true).setMinValue(1).setMaxValue(5)));
data.addSubcommand((sub) => sub.setName('undo').setDescription('[Admin] Delete a logged match and reverse its title/contender changes')
    .addIntegerOption((o) => o.setName('match_id').setDescription('Match to undo').setRequired(true).setAutocomplete(true)));
data.addSubcommand((sub) => sub.setName('edit').setDescription('[Admin] Fix the notes, winner or result of a plain match')
    .addIntegerOption((o) => o.setName('match_id').setDescription('Match to edit').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('notes').setDescription('New notes (type a single - to clear)').setRequired(false).setMaxLength(300))
    .addIntegerOption((o) => o.setName('winner').setDescription('New winner by slot number (non-team matches)').setRequired(false).setMinValue(1).setMaxValue(8))
    .addIntegerOption((o) => o.setName('winning_team').setDescription('New winning team (team matches)').setRequired(false).addChoices({ name: 'Team 1', value: 1 }, { name: 'Team 2', value: 2 }))
    .addStringOption((o) => o.setName('result_type').setDescription('Change the result type').setRequired(false).addChoices(...RESULT_CHOICES))
    .addStringOption((o) => o.setName('stipulation').setDescription('New stipulation (type a single - to clear)').setRequired(false).setMaxLength(40).setAutocomplete(true))
    .addStringOption((o) => o.setName('finish').setDescription('How it ended').setRequired(false).addChoices(...FINISHES))
    .addStringOption((o) => o.setName('score').setDescription('Falls or score (type a single - to clear)').setRequired(false).setMaxLength(20)));
data.addSubcommand((sub) => sub.setName('recent').setDescription('[Admin] Show the latest matches with their IDs')
    .addIntegerOption((o) => o.setName('count').setDescription('How many (default 10, max 25)').setRequired(false).setMinValue(1).setMaxValue(25)));
data.addSubcommand((sub) => sub.setName('report').setDescription('Report the result of your card match. Staff approve it before it counts.')
    .addStringOption((o) => o.setName('match').setDescription('Your match on the card').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('winner').setDescription('How it ended (pick the match first)').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('finish').setDescription('How it ended (optional)').setRequired(false).addChoices(...FINISHES))
    .addStringOption((o) => o.setName('score').setDescription('Score, e.g. 2-1 (optional)').setRequired(false).setMaxLength(20))
    .addStringOption((o) => o.setName('notes').setDescription('Anything staff should know (optional)').setRequired(false).setMaxLength(300))
    .addAttachmentOption((o) => o.setName('screenshot').setDescription('A picture of the result (optional)').setRequired(false)));

// ---- 3.7: players report their own card match result (see src/modules/reports.js)
async function reportAutocomplete(interaction) {
    const R = require('../modules/reports');
    const focused = interaction.options.getFocused(true);
    const mine = await R.reportable(interaction.guildId, interaction.user.id);
    if (focused.name === 'match') {
        const q = String(focused.value || '').toLowerCase();
        return interaction.respond(mine.filter((m) => `${R.vsText(m)} ${R.where(m)}`.toLowerCase().includes(q)).slice(0, 25)
            .map((m) => ({ name: `${R.where(m)}: ${R.vsText(m)}`.slice(0, 100), value: `${m.draft_id}:${m.position}` })));
    }
    if (focused.name === 'winner') {
        const picked = mine.find((m) => `${m.draft_id}:${m.position}` === interaction.options.getString('match'));
        if (!picked) return interaction.respond([{ name: 'Pick your match first', value: 'x' }]);
        return interaction.respond(R.outcomes(picked).map((o) => ({ name: o.label.slice(0, 100), value: o.code })));
    }
    return interaction.respond([]);
}

async function reportExecute(interaction) {
    const R = require('../modules/reports');
    const [draftId, pos] = String(interaction.options.getString('match') || '').split(':');
    if (!draftId || !pos) throw new UserError('Pick your match from the list that appears as you type.');
    const code = interaction.options.getString('winner');
    if (!code || code === 'x') throw new UserError('Pick who won from the list (pick the match first).');
    const att = interaction.options.getAttachment('screenshot');
    if (att && !/^image\//.test(att.contentType || '') && !/\.(png|jpe?g|gif|webp)$/i.test(att.name || '')) throw new UserError('The screenshot has to be a picture (PNG, JPG, GIF or WEBP).');
    await interaction.deferReply({ flags: 64 });
    const msg = await R.submitReport(interaction, {
        draftId, position: Number(pos), code, finish: interaction.options.getString('finish'),
        score: interaction.options.getString('score')?.trim() || null, notes: interaction.options.getString('notes')?.trim() || null,
        proof: att ? { url: att.url, name: att.name } : null
    });
    return interaction.editReply({ content: msg });
}

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
        if (interaction.options.getSubcommand(false) === 'report') return reportAutocomplete(interaction);
        const focused = interaction.options.getFocused(true);
        if (focused.name === 'match_id') return interaction.respond(await matchIdAutocomplete(interaction, focused.value));
        if (focused.name === 'stipulation') return interaction.respond(stipulationChoices(focused.value));
        if (focused.name === 'finish') return interaction.respond(finishChoices(focused.value));
        if (focused.name === 'ple' || focused.name === 'event') {
            const names = await require('../utils/ple').pleNames(interaction.guildId, focused.value);
            const typed = String(focused.value || '').trim();
            const list = names.map((n) => ({ name: n, value: n }));
            if (typed && !names.some((n) => n.toLowerCase() === typed.toLowerCase())) list.unshift({ name: typed.slice(0, 40), value: typed.slice(0, 40) });
            return interaction.respond(list.slice(0, 25));
        }
        if (focused.name === 'title' || focused.name === 'contender_for') return interaction.respond(await autocompleteTitles(interaction, focused.value));
        return interaction.respond(await autocompleteCharacters(interaction, focused.value));
    },

    async execute(interaction) {
        if (interaction.options.getSubcommand() === 'report') return reportExecute(interaction);
        requireAdmin(interaction, 'log or change matches');
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'log' || sub.startsWith('log-')) {
            let key, config, slotIds, winnerIndex = null, winningTeam = null;
            if (sub === 'log') {
                key = interaction.options.getString('type');
                config = MATCH_CONFIG[key];
                if (!config) throw new UserError('Unknown match type.');
                const given = Array.from({ length: 8 }, (_, i) => interaction.options.getString(`wrestler${i + 1}`));
                const filled = given.filter(Boolean).length;
                const need = config.slots.length;
                if (filled !== need || given.slice(0, need).some((v) => !v)) {
                    throw new UserError(`A ${config.label} has **${need}** wrestlers: fill in wrestler1 to wrestler${need}${config.winnerMode === 'team' ? ` (Team 1 is wrestler1-${need / 2}, Team 2 is wrestler${need / 2 + 1}-${need})` : ''}, and nothing after that.`);
                }
                slotIds = given.slice(0, need);
                const w = interaction.options.getInteger('winner');
                if (config.winnerMode === 'team') {
                    if (w !== 1 && w !== 2) throw new UserError('For a tag match, `winner` is the winning team: 1 or 2.');
                    winningTeam = w;
                } else {
                    if (w < 1 || w > need) throw new UserError(`\`winner\` must be a wrestler number from 1 to ${need}.`);
                    winnerIndex = w - 1;
                }
            } else {
                key = sub.replace(/^log-/, '').replace(/-/g, '_');
                config = MATCH_CONFIG[key];
                if (!config) return respond(interaction, { content: 'Unknown match type.', flags: 64 });
                slotIds = config.slots.map((s) => interaction.options.getString(s.name));
                winnerIndex = config.winnerMode === 'single' ? interaction.options.getInteger('winner') - 1 : null;
                winningTeam = config.winnerMode === 'team' ? interaction.options.getInteger('winning_team') : null;
            }
            const pleName = sub === 'log' && interaction.options.getString('ple') ? require('../utils/ple').cleanName(interaction.options.getString('ple')) : null;

            const result = await logMatch({
                guildId,
                matchType: key,
                slotCharacterIds: slotIds,
                winnerIndex,
                winningTeam,
                resultType: interaction.options.getString('result_type') || 'decisive',
                notes: interaction.options.getString('notes'),
                titleValue: interaction.options.getString('title'),
                contenderTitleValue: interaction.options.getString('contender_for'),
                overrideCooldown: interaction.options.getBoolean('override_cooldown') || false,
                ...readDetails(interaction),
                actor: interaction.user.id
            });

            await interaction.deferReply();
            let pleNote = null;
            if (pleName) {
                const t = await require('../utils/ple').tagMatches(interaction.client, guildId, [result.matchId], pleName, interaction.user.id);
                pleNote = `🎆 Part of **${pleName} ${new Date().getUTCFullYear()}**${t.awards.length ? `. 🎖 ${t.awards.map((a) => `${a.ch.name} earned **${L.accoladeName(a.row)}**`).join(', ')}` : ''}.`;
            }
            const { payload } = await presentMatch(interaction, result);
            if (pleNote) payload.content = [payload.content, pleNote].filter(Boolean).join('\n');
            await interaction.editReply(payload);
            await mirrorToMatchesChannel(interaction, payload);
            await maybeAutoRecap(interaction, result);
            return;
        }

        if (sub === 'ple') {
            const P = require('../utils/ple');
            const clear = interaction.options.getBoolean('clear') === true;
            const eventRaw = interaction.options.getString('event');
            const matchId = interaction.options.getInteger('match_id');
            const dateRaw = interaction.options.getString('date');
            if (!eventRaw && !clear && !matchId && !dateRaw) {
                // no options: show PLE history
                const [list, leaders] = await Promise.all([P.pleList(guildId), P.pleLeaders(guildId, 10)]);
                const embed = new EmbedBuilder().setTitle('🎆 Premium Live Events').setColor(0x9B59B6)
                    .setDescription(list.length ? list.map((r) => `**${r.ple} ${r.year}** · ${r.matches} match${r.matches === 1 ? '' : 'es'}`).join('\n').slice(0, 2000) : 'No PLEs tagged yet. After a show: `/fnlw` → Results → 🎟 PLE tags every match logged today.');
                if (leaders.length) embed.addFields({ name: 'Most PLE wins', value: leaders.map((r, i) => `${i + 1}. **${r.name}**${r.discord_id ? ` (<@${r.discord_id}>)` : ''}: ${r.w}-${r.l}`).join('\n').slice(0, 1024) });
                return respond(interaction, { embeds: [embed], allowedMentions: NO_MENTIONS });
            }
            if (!clear && !eventRaw) throw new UserError('Fill in `event` (the PLE name), or set `clear:true` to remove a tag.');
            const event = clear ? null : P.cleanName(eventRaw);
            let ids;
            if (matchId) {
                const { rows } = await pool.query(`SELECT id FROM matches WHERE id = $1 AND guild_id = $2`, [matchId, guildId]);
                if (!rows.length) throw new UserError('I could not find that match on this server.');
                ids = [matchId];
            } else {
                const s = await require('../utils/ensureGuild').getGuildSettings(guildId);
                const { localNow } = require('../utils/titleWatch');
                const date = dateRaw ? require('../utils/dates').parseDate(dateRaw.trim(), 'The date') : localNow(s.tz).date;
                ids = await P.matchIdsOnDate(guildId, date, s.tz);
                if (!ids.length) throw new UserError(`No matches were logged on ${date}. Pick another \`date\`, or tag one match with \`match_id\`.`);
            }
            const r = await P.tagMatches(interaction.client, guildId, ids, event, interaction.user.id);
            await logAudit(guildId, interaction.user.id, clear ? 'ple_cleared' : 'ple_tagged', { event, matches: r.tagged });
            const awards = r.awards.length ? `\n🎖 ${r.awards.map((a) => `**${a.ch.name}** earned **${L.accoladeName(a.row)}**`).join('\n🎖 ')}` : '';
            return respond(interaction, { content: clear ? `Removed the PLE tag from ${r.tagged} match${r.tagged === 1 ? '' : 'es'}.` : `🎆 Tagged ${r.tagged} match${r.tagged === 1 ? '' : 'es'} as **${event}**.${awards}`, allowedMentions: NO_MENTIONS });
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
                resultType: interaction.options.getString('result_type'),
                stipulation: interaction.options.getString('stipulation'),
                finish: interaction.options.getString('finish'),
                score: interaction.options.getString('score')
            });
            const bits = [];
            if (changes.result) bits.push(`result is now **${changes.result.replace('_', ' ')}**`);
            if (changes.winners !== undefined && changes.winners > 0) bits.push('winner updated');
            if (changes.notes !== undefined) bits.push(changes.notes ? 'notes updated' : 'notes cleared');
            if (changes.stipulation !== undefined) bits.push(changes.stipulation ? 'stipulation updated' : 'stipulation cleared');
            if (changes.finish !== undefined) bits.push('finish updated');
            if (changes.score !== undefined) bits.push(changes.score ? 'score updated' : 'score cleared');
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

// 3.9: Discord lists log and report. Undo, edit and rate are buttons under every result; recent and PLEs
// are on /fnlw → Results. The old subcommands still work inside the bot.
require('../utils/slim').keepSubs(module.exports, { show: ['log', 'report'] });
