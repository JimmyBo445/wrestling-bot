const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { pool, withTransaction } = require('../db/pool');
const { autocompleteCharacters, requireCharacter } = require('../utils/characterUtils');
const { autocompleteTitles, requireTitle } = require('../utils/titleLogic');
const { requireAdmin, respond, NO_MENTIONS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { logAudit } = require('../utils/audit');
const { DIVISION_THEME } = require('../utils/constants');
const { renderBracketCard } = require('../cards/bracketCard');
const T = require('../utils/tournamentUtils');

const tourOpt = (o, desc = 'Tournament') => o.setName('tournament').setDescription(desc).setRequired(true).setAutocomplete(true);
const DIVS = Object.entries(DIVISION_THEME).map(([value, t]) => ({ name: t.label, value }));

const data = new SlashCommandBuilder()
    .setName('tournament')
    .setDescription('Single-elimination tournaments with a bracket picture')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('create').setDescription('[Admin] Create a tournament (4 to 16 singles wrestlers)')
        .addStringOption((o) => o.setName('name').setDescription('e.g. King of the Ring').setRequired(true).setMaxLength(50))
        .addStringOption((o) => o.setName('division').setDescription('Division').setRequired(true).addChoices(...DIVS))
        .addStringOption((o) => o.setName('title').setDescription('Optional: the winner is crowned champion of this singles title').setRequired(false).setAutocomplete(true)))
    .addSubcommand((s) => {
        s.setName('add').setDescription('[Admin] Add wrestlers to a tournament that has not started').addStringOption((o) => tourOpt(o));
        s.addStringOption((o) => o.setName('wrestler1').setDescription('Wrestler').setRequired(true).setAutocomplete(true));
        for (let i = 2; i <= 8; i++) s.addStringOption((o) => o.setName(`wrestler${i}`).setDescription('Another wrestler').setRequired(false).setAutocomplete(true));
        return s;
    })
    .addSubcommand((s) => s.setName('remove').setDescription('[Admin] Take a wrestler out before the tournament starts')
        .addStringOption((o) => tourOpt(o)).addStringOption((o) => o.setName('wrestler').setDescription('Wrestler').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('start').setDescription('[Admin] Draw the bracket and begin (random draw, byes if needed)').addStringOption((o) => tourOpt(o)))
    .addSubcommand((s) => s.setName('bracket').setDescription('Show the bracket as a picture').addStringOption((o) => tourOpt(o)))
    .addSubcommand((s) => s.setName('list').setDescription('All tournaments'))
    .addSubcommand((s) => s.setName('advance').setDescription('[Admin] Decide a bracket match without logging a match (forfeit, walkover)')
        .addStringOption((o) => tourOpt(o))
        .addIntegerOption((o) => o.setName('bracket_match').setDescription('Which bracket match').setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('winner').setDescription('Top or bottom wrestler advances').setRequired(true).addChoices({ name: 'Top wrestler', value: 1 }, { name: 'Bottom wrestler', value: 2 })))
    .addSubcommand((s) => s.setName('cancel').setDescription('[Admin] Cancel a tournament').addStringOption((o) => tourOpt(o)));

async function sendBracket(interaction, tour, extra = {}) {
    const buffer = await renderBracketCard(await T.bracketData(interaction.guild, tour));
    return { files: [new AttachmentBuilder(buffer, { name: 'bracket.png' })], allowedMentions: NO_MENTIONS, ...extra };
}

module.exports = {
    data,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        const sub = interaction.options.getSubcommand(false);
        if (focused.name === 'tournament') {
            const statuses = { add: ['signup'], remove: ['signup'], start: ['signup'], advance: ['active'], cancel: ['signup', 'active'] }[sub] || null;
            return interaction.respond(await T.autocompleteTournaments(interaction, focused.value, statuses));
        }
        if (focused.name === 'title') return interaction.respond(await autocompleteTitles(interaction, focused.value, { tagOnly: false }));
        if (focused.name === 'bracket_match') {
            const tid = interaction.options.getString('tournament');
            if (!tid || !/^\d+$/.test(tid)) return interaction.respond([]);
            const { rows } = await pool.query(
                `SELECT tm.id, tm.round, tm.slot, a.name AS a, b.name AS b FROM tournament_matches tm
                 JOIN tournaments t ON t.id = tm.tournament_id
                 JOIN characters a ON a.id = tm.a_id JOIN characters b ON b.id = tm.b_id
                 WHERE t.id = $1 AND t.guild_id = $2 AND tm.winner_id IS NULL ORDER BY tm.round, tm.slot LIMIT 25`, [tid, interaction.guildId]);
            return interaction.respond(rows.map((r) => ({ name: `Round ${r.round}, match ${r.slot}: ${r.a} vs ${r.b}`.slice(0, 100), value: Number(r.id) })));
        }
        if (focused.name === 'wrestler' && interaction.options.getSubcommand(false) === 'remove') {
            const tid = interaction.options.getString('tournament');
            if (!tid || !/^\d+$/.test(tid)) return interaction.respond([]);
            const { rows } = await pool.query(
                `SELECT c.id, c.name FROM tournament_entrants te JOIN characters c ON c.id = te.character_id
                 WHERE te.tournament_id = $1 AND c.name ILIKE $2 ORDER BY c.name LIMIT 25`, [tid, `%${String(focused.value).replace(/[%_]/g, '')}%`]);
            return interaction.respond(rows.map((r) => ({ name: r.name.slice(0, 100), value: String(r.id) })));
        }
        const t = interaction.options.getString('tournament');
        let division = null;
        if (t && /^\d+$/.test(t)) division = (await pool.query(`SELECT division FROM tournaments WHERE id = $1 AND guild_id = $2`, [t, interaction.guildId])).rows[0]?.division || null;
        return interaction.respond(await autocompleteCharacters(interaction, focused.value, { division }));
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'create') {
            requireAdmin(interaction, 'create tournaments');
            const division = interaction.options.getString('division');
            const titleVal = interaction.options.getString('title');
            let title = null;
            if (titleVal) {
                title = await requireTitle(guildId, titleVal);
                if (title.is_tag_title) throw new UserError('Tournaments are for singles wrestlers, so pick a singles title.');
                if (title.division !== division) throw new UserError(`The **${title.name}** belongs to a different division.`);
            }
            const { rows } = await pool.query(
                `INSERT INTO tournaments (guild_id, name, division, title_id, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
                [guildId, interaction.options.getString('name').trim(), division, title?.id || null, interaction.user.id]);
            await logAudit(guildId, interaction.user.id, 'tournament_created', { id: rows[0].id });
            return respond(interaction, { content: `🏟️ Tournament **${interaction.options.getString('name').trim()}** created${title ? ` (the winner becomes ${title.name} champion)` : ''}. Add ${T.MIN_ENTRANTS} to ${T.MAX_ENTRANTS} wrestlers with \`/tournament add\`, then \`/tournament start\`.` });
        }

        if (sub === 'add' || sub === 'remove') {
            requireAdmin(interaction, 'change tournament entrants');
            const tour = await T.requireTournament(guildId, interaction.options.getString('tournament'), { statuses: ['signup'] });
            if (sub === 'remove') {
                const { rowCount } = await pool.query(`DELETE FROM tournament_entrants WHERE tournament_id = $1 AND character_id = $2`, [tour.id, interaction.options.getString('wrestler')]);
                if (!rowCount) throw new UserError('That wrestler isn\'t in the tournament.');
                return respond(interaction, { content: 'Removed.' });
            }
            const added = []; const skipped = [];
            for (let i = 1; i <= 8; i++) {
                const v = interaction.options.getString(`wrestler${i}`);
                if (v === null) continue;
                const c = await requireCharacter(guildId, v, { statuses: ['approved'], claimed: true });
                if (c.division !== tour.division) throw new UserError(`**${c.name}** is in a different division than this tournament.`);
                const { rows: n } = await pool.query(`SELECT COUNT(*)::int AS n FROM tournament_entrants WHERE tournament_id = $1`, [tour.id]);
                if (n[0].n >= T.MAX_ENTRANTS) throw new UserError(`A tournament holds at most ${T.MAX_ENTRANTS} wrestlers.`);
                const { rowCount } = await pool.query(`INSERT INTO tournament_entrants (tournament_id, character_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [tour.id, c.id]);
                (rowCount ? added : skipped).push(c.name);
            }
            const { rows: all } = await pool.query(`SELECT c.name FROM tournament_entrants te JOIN characters c ON c.id = te.character_id WHERE te.tournament_id = $1 ORDER BY c.name`, [tour.id]);
            return respond(interaction, { content: `Added ${added.length ? added.map((n) => `**${n}**`).join(', ') : 'nobody new'}${skipped.length ? ` (already in: ${skipped.join(', ')})` : ''}.\n**${all.length}** entered: ${all.map((r) => r.name).join(', ')}`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'start') {
            requireAdmin(interaction, 'start tournaments');
            const tour = await T.requireTournament(guildId, interaction.options.getString('tournament'), { statuses: ['signup'] });
            await interaction.deferReply();
            const res = await T.startTournament(guildId, tour.id);
            await logAudit(guildId, interaction.user.id, 'tournament_started', { id: tour.id, entrants: res.entrants });
            const fresh = (await pool.query(`SELECT * FROM tournaments WHERE id = $1`, [tour.id])).rows[0];
            return interaction.editReply(await sendBracket(interaction, fresh, {
                content: `🏟️ **${tour.name}** is on! ${res.entrants} wrestlers, ${res.rounds} round${res.rounds === 1 ? '' : 's'}${res.byes ? `, ${res.byes} bye${res.byes === 1 ? '' : 's'}` : ''}. Log each match with \`/match log-singles\` and the bracket advances by itself.`
            }));
        }

        if (sub === 'bracket') {
            const tour = await T.requireTournament(guildId, interaction.options.getString('tournament'));
            if (tour.status === 'signup') {
                const { rows } = await pool.query(`SELECT c.name FROM tournament_entrants te JOIN characters c ON c.id = te.character_id WHERE te.tournament_id = $1 ORDER BY c.name`, [tour.id]);
                return respond(interaction, { content: `**${tour.name}** hasn't started. Entered so far (${rows.length}): ${rows.map((r) => r.name).join(', ') || 'nobody yet'}.` });
            }
            await interaction.deferReply();
            return interaction.editReply(await sendBracket(interaction, tour));
        }

        if (sub === 'list') {
            const { rows } = await pool.query(`SELECT * FROM tournaments WHERE guild_id = $1 ORDER BY id DESC LIMIT 15`, [guildId]);
            if (!rows.length) return respond(interaction, { content: 'No tournaments yet. An admin can create one with `/tournament create`.', flags: 64 });
            const lines = rows.map((t) => `**${t.name}** — ${DIVISION_THEME[t.division].label} · ${t.status}${t.winner_name ? ` · 🏆 ${t.winner_name}` : ''}`);
            return respond(interaction, { embeds: [new EmbedBuilder().setTitle('Tournaments').setColor(0xE8BF4A).setDescription(lines.join('\n'))] });
        }

        if (sub === 'advance') {
            requireAdmin(interaction, 'decide bracket matches');
            const tour = await T.requireTournament(guildId, interaction.options.getString('tournament'), { statuses: ['active'] });
            const tmId = interaction.options.getInteger('bracket_match');
            const res = await withTransaction(async (client) => {
                const { rows } = await client.query(`SELECT * FROM tournament_matches WHERE id = $1 AND tournament_id = $2 FOR UPDATE`, [tmId, tour.id]);
                const tm = rows[0];
                if (!tm || tm.winner_id || !tm.a_id || !tm.b_id) throw new UserError('Pick an undecided bracket match from the list.');
                return T.placeWinner(client, tm, interaction.options.getInteger('winner') === 1 ? tm.a_id : tm.b_id);
            });
            await logAudit(guildId, interaction.user.id, 'tournament_advanced', { id: tour.id, match: tmId });
            const fresh = (await pool.query(`SELECT * FROM tournaments WHERE id = $1`, [tour.id])).rows[0];
            await interaction.deferReply();
            return interaction.editReply(await sendBracket(interaction, fresh, {
                content: res.finished ? `🏆 **${res.winnerName}** wins **${tour.name}**!${res.crowned ? ` They are the new **${res.crowned}** champion.` : ''}` : `Advanced to the ${res.nextRound}.`
            }));
        }

        if (sub === 'cancel') {
            requireAdmin(interaction, 'cancel tournaments');
            const tour = await T.requireTournament(guildId, interaction.options.getString('tournament'), { statuses: ['signup', 'active'] });
            await pool.query(`UPDATE tournaments SET status = 'cancelled' WHERE id = $1`, [tour.id]);
            await logAudit(guildId, interaction.user.id, 'tournament_cancelled', { id: tour.id });
            return respond(interaction, { content: `Cancelled **${tour.name}**.` });
        }
    }
};
