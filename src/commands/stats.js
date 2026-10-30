const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { autocompleteCharacters, requireCharacter } = require('../utils/characterUtils');
const { ensureUser } = require('../utils/ensureGuild');
const {
    PERIODS, PERIOD_LABELS, stipulationBreakdown, characterSummary, opponentBreakdown, headToHead, recentMatches, userSummary
} = require('../utils/statsQueries');
const { respond, NO_MENTIONS, DIVISION_LABELS } = require('../utils/discordHelpers');
const { matchLabel, DIVISION_THEME, FINISH_LABEL } = require('../utils/constants');
const { UserError } = require('../utils/errors');
const { buildTapeData, buildPlayerData, buildCareerData } = require('../utils/cardData');
const { characterBadges } = require('../utils/badges');
const { renderTapeCard, renderPlayerCard, renderCareerCard } = require('../utils/cardRenderer');

const PERIOD_CHOICES = Object.entries(PERIOD_LABELS).map(([value, name]) => ({ name, value }));
const charOpt = (o, name = 'character', desc = 'Character') => o.setName(name).setDescription(desc).setRequired(true).setAutocomplete(true);
const periodOpt = (o) => o.setName('period').setDescription('Time window (default: all time)').setRequired(false).addChoices(...PERIOD_CHOICES);

const data = new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Win/loss stats, streaks, head-to-head and history')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('character').setDescription('Detailed stats for one wrestler').addStringOption((o) => charOpt(o)).addStringOption(periodOpt))
    .addSubcommand((s) => s.setName('user').setDescription("A player's stats across all their wrestlers")
        .addUserOption((o) => o.setName('user').setDescription('Defaults to you').setRequired(false))
        .addBooleanOption((o) => o.setName('text').setDescription('Show plain text instead of the player card picture').setRequired(false)))
    .addSubcommand((s) => s.setName('head-to-head').setDescription('Record between two wrestlers')
        .addStringOption((o) => charOpt(o, 'character1', 'First wrestler')).addStringOption((o) => charOpt(o, 'character2', 'Second wrestler')).addStringOption(periodOpt))
    .addSubcommand((s) => s.setName('champions').setDescription('Players ranked by title reigns (credit stays with whoever owned the wrestler)'))
    .addSubcommand((s) => s.setName('versus').setDescription('Record between two players (all of their wrestlers)')
        .addUserOption((o) => o.setName('player1').setDescription('First player').setRequired(true))
        .addUserOption((o) => o.setName('player2').setDescription('Second player').setRequired(true)).addStringOption(periodOpt))
    .addSubcommand((s) => s.setName('rivalries').setDescription('The hottest rivalries: pairs who have met the most')
        .addStringOption((o) => o.setName('period').setDescription('Default: all time').setRequired(false)
            .addChoices(...Object.entries(PERIOD_LABELS).map(([value, name]) => ({ name, value })))))
    .addSubcommand((s) => s.setName('tape').setDescription('Tale of the tape graphic for two wrestlers')
        .addStringOption((o) => charOpt(o, 'character1', 'First wrestler')).addStringOption((o) => charOpt(o, 'character2', 'Second wrestler')))
    .addSubcommand((s) => s.setName('timeline').setDescription('Career timeline graphic: debut, title reigns, milestones and more')
        .addStringOption((o) => charOpt(o)))
    .addSubcommand((s) => s.setName('badges').setDescription('Achievement badges a wrestler has earned')
        .addStringOption((o) => charOpt(o)))
    .addSubcommand((s) => s.setName('opponents').setDescription('A wrestler\'s record against everyone they have faced')
        .addStringOption((o) => charOpt(o)).addStringOption(periodOpt))
    .addSubcommand((s) => s.setName('history').setDescription("A wrestler's most recent matches")
        .addStringOption((o) => charOpt(o)).addIntegerOption((o) => o.setName('count').setDescription('How many (default 10, max 25)').setRequired(false).setMinValue(1).setMaxValue(25)));

const EMOJI = { W: '🟩', L: '🟥', D: '⬜', NC: '⬛' };
const form = (arr) => (arr.length ? arr.map((r) => EMOJI[r]).join(' ') : '—');
const streakStr = (s) => (s.current ? `${s.current} ${s.direction === 'win' ? 'win' : 'loss'}${s.current > 1 ? (s.direction === 'win' ? 's' : 'es') : ''}` : '—');
const rec = (s) => `${s.wins}-${s.losses}${s.draws ? `-${s.draws}` : ''}${s.ncs ? ` (${s.ncs} NC)` : ''}`;
const pct = (s) => (s.wins + s.losses ? `${s.winPct.toFixed(1)}%` : '—');

module.exports = {
    data,

    async autocomplete(interaction) {
        return interaction.respond(await autocompleteCharacters(interaction, interaction.options.getFocused(), { statuses: ['approved', 'retired'] }));
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        const periodKey = interaction.options.getString('period') || 'all';
        const days = PERIODS[periodKey];
        const periodNote = periodKey === 'all' ? null : PERIOD_LABELS[periodKey];

        if (sub === 'character') {
            const c = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved', 'retired'] });
            const s = await characterSummary(c.id, days, c.owner_id);
            const allOwners = await characterSummary(c.id, days);
            const opps = await opponentBreakdown(c.id, { days, limit: 1 });
            const embed = new EmbedBuilder()
                .setTitle(`${c.name} — Stats`).setColor(DIVISION_THEME[c.division].embed)
                .setDescription(`${DIVISION_LABELS[c.division]} · owned by <@${c.owner_discord_id}>${c.status === 'retired' ? ' · _retired_' : ''}`)
                .addFields(
                    { name: 'Record', value: rec(s), inline: true },
                    { name: 'Win %', value: pct(s), inline: true },
                    { name: 'Matches', value: String(s.total), inline: true },
                    { name: 'Current Streak', value: streakStr(s.streaks), inline: true },
                    { name: 'Best Win Streak', value: String(s.streaks.longestWin), inline: true },
                    { name: 'Worst Loss Streak', value: String(s.streaks.longestLoss), inline: true },
                    { name: 'Last 5', value: form(s.form), inline: true },
                    { name: 'Title Matches', value: `${s.titleMatches.w}-${s.titleMatches.l}`, inline: true },
                    { name: 'Most Faced', value: opps[0] ? `${opps[0].name} (${opps[0].w}-${opps[0].l}${opps[0].d ? `-${opps[0].d}` : ''})` : '—', inline: true }
                );
            if (allOwners.total !== s.total) embed.addFields({ name: 'All owners (before transfer)', value: rec(allOwners), inline: true });
            const types = Object.entries(s.byType);
            if (types.length) embed.addFields({ name: 'By Match Type', value: types.map(([k, v]) => `${matchLabel(k)}: **${v.w}-${v.l}**${v.d ? `-${v.d}` : ''}`).join('\n') });
            const sb = await stipulationBreakdown(c.id, c.owner_id, days);
            const sips = Object.entries(sb.bySip);
            if (sips.length) embed.addFields({ name: 'By Stipulation', value: sips.sort((a, b) => (b[1].w + b[1].l) - (a[1].w + a[1].l)).slice(0, 8).map(([k, v]) => `${k}: **${v.w}-${v.l}**`).join('\n') });
            const fins = Object.entries(sb.winFinishes);
            if (fins.length) embed.addFields({ name: 'Wins By', value: fins.sort((a, b) => b[1] - a[1]).map(([k, n]) => `${FINISH_LABEL[k] || k}: **${n}**`).join(' · ') });
            if (periodNote) embed.setFooter({ text: periodNote });
            return respond(interaction, { embeds: [embed], allowedMentions: NO_MENTIONS });
        }

        if (sub === 'champions') {
            const top = await require('../utils/playerTitles').topChampions(guildId);
            if (!top.length) return respond(interaction, { content: 'No title reigns on record yet.', flags: 64 });
            const lines = top.map((r, i) => `**${i + 1}.** <@${r.discord_id}> — **${r.reigns}** reign${r.reigns === 1 ? '' : 's'} · ${r.days} days · ${r.defenses} defense${r.defenses === 1 ? '' : 's'}${r.current ? ` · 👑 holds ${r.current}` : ''}`);
            return respond(interaction, { embeds: [new EmbedBuilder().setTitle('Most Decorated Players').setColor(0xE8BF4A).setDescription(lines.join('\n').slice(0, 4000)).setFooter({ text: 'Credit goes to whoever owned the wrestler at the time' })], allowedMentions: NO_MENTIONS });
        }

        if (sub === 'timeline') {
            const c = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved', 'retired'] });
            await interaction.deferReply();
            const buffer = await renderCareerCard(await buildCareerData(interaction.guild, c));
            return interaction.editReply({ files: [new AttachmentBuilder(buffer, { name: 'career.png' })] });
        }

        if (sub === 'badges') {
            const c = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved', 'retired'] });
            const s = await characterSummary(c.id, null, c.owner_id);
            const { rows: st } = await pool.query(
                `SELECT COUNT(DISTINCT tr.id)::int AS reigns, COALESCE(SUM(tr.defenses), 0)::int AS defenses FROM title_reigns tr
                 WHERE (tr.team_id IS NULL AND tr.character_id = $1) OR EXISTS (SELECT 1 FROM title_reign_members m WHERE m.reign_id = tr.id AND m.character_id = $1)`, [c.id]);
            const badges = await characterBadges(c, s, st[0]);
            const embed = new EmbedBuilder().setTitle(`${c.name} — Badges`).setColor(DIVISION_THEME[c.division].embed)
                .setDescription(badges.length ? badges.map((b) => `🏅 **${b.label}**`).join('\n') : '_No badges yet. Wins, title reigns, streaks and classics earn them._');
            return respond(interaction, { embeds: [embed], allowedMentions: NO_MENTIONS });
        }

        if (sub === 'user') {
            const target = interaction.options.getUser('user') || interaction.user;
            const ownerId = await ensureUser(guildId, target.id);
            const u = await userSummary(guildId, ownerId);
            const tstat = await require('../utils/playerTitles').playerTitleStats(guildId, ownerId);
            if (!u.chars.length && !tstat.reigns) throw new UserError(`<@${target.id}> has no approved characters yet.`);
            if (!interaction.options.getBoolean('text')) {
                await interaction.deferReply();
                const buffer = await renderPlayerCard(await buildPlayerData(interaction.guild, target, ownerId));
                return interaction.editReply({ files: [new AttachmentBuilder(buffer, { name: 'player.png' })] });
            }
            const divLines = Object.entries(u.byDivision).map(([d, v]) => `${DIVISION_LABELS[d] || d}: **${rec(v)}**${v.winPct && v.wins + v.losses ? ` (${v.winPct.toFixed(0)}%)` : ''}`);
            const embed = new EmbedBuilder().setTitle(`${target.displayName || target.username} — Overall`).setColor(0xC0392B)
                .addFields(
                    { name: 'Record', value: rec(u), inline: true },
                    { name: 'Win %', value: pct(u), inline: true },
                    { name: 'Streak', value: streakStr(u.streaks), inline: true },
                    { name: 'Best Win Streak', value: String(u.streaks.longestWin), inline: true },
                    { name: 'Last 5', value: form(u.form), inline: true },
                    ...(tstat.reigns ? [{ name: 'Championships', value: `**${tstat.reigns}** reign${tstat.reigns === 1 ? '' : 's'} · ${tstat.days} days · ${tstat.defenses} defense${tstat.defenses === 1 ? '' : 's'}${tstat.current.length ? `\nCurrent: ${tstat.current.map((c) => `${c.title} (${c.holder})`).join(', ')}` : ''}`.slice(0, 1000) }] : []),
                    { name: 'By division', value: (divLines.join('\n') || '—').slice(0, 1000) },
                    { name: 'Wrestlers', value: u.chars.map((c) => `**${c.name}**${c.status === 'retired' ? ' _(retired)_' : ''}${c.current ? '' : ' _(former)_'}: ${c.wins}-${c.losses}${c.streaks.current ? ` (${c.streaks.direction === 'win' ? 'W' : 'L'}${c.streaks.current})` : ''}`).join('\n') }
                );
            return respond(interaction, { embeds: [embed], allowedMentions: NO_MENTIONS });
        }

        if (sub === 'head-to-head') {
            const a = await requireCharacter(guildId, interaction.options.getString('character1'), { statuses: ['approved', 'retired'] });
            const b = await requireCharacter(guildId, interaction.options.getString('character2'), { statuses: ['approved', 'retired'] });
            if (String(a.id) === String(b.id)) throw new UserError('Pick two different wrestlers.');
            const h = await headToHead([a.id], [b.id], days);
            return respond(interaction, { embeds: [h2hEmbed(`${a.name} vs ${b.name}`, a.name, b.name, h, periodNote)], allowedMentions: NO_MENTIONS });
        }

        if (sub === 'rivalries') {
            const { rivalries } = require('../utils/monthly');
            const period = interaction.options.getString('period') || 'all';
            const d = PERIODS[period];
            const rows = await rivalries(guildId, { start: d ? new Date(Date.now() - d * 864e5) : null, limit: 8 });
            if (!rows.length) throw new UserError('No rivalries yet. A rivalry starts when two wrestlers have met at least twice.');
            const lines = rows.map((r, i) => `**${i + 1}.** 🔥 ${r.a_name} vs ${r.b_name}: **${r.meetings}** meetings (${r.a_wins}-${r.b_wins})`);
            return respond(interaction, { embeds: [new EmbedBuilder().setTitle('Hottest Rivalries').setColor(0xE67E22).setDescription(lines.join('\n')).setFooter({ text: PERIOD_LABELS[period] })] });
        }

        if (sub === 'tape') {
            const a = await requireCharacter(guildId, interaction.options.getString('character1'), { statuses: ['approved', 'retired'] });
            const b = await requireCharacter(guildId, interaction.options.getString('character2'), { statuses: ['approved', 'retired'] });
            if (String(a.id) === String(b.id)) throw new UserError('Pick two different wrestlers.');
            await interaction.deferReply();
            const tape = await buildTapeData(interaction.guild, {
                left: { type: 'character', character: a }, right: { type: 'character', character: b }, label: 'Singles', division: a.division
            });
            return interaction.editReply({ files: [new AttachmentBuilder(await renderTapeCard(tape), { name: 'tale-of-the-tape.png' })] });
        }

        if (sub === 'versus') {
            const p1 = interaction.options.getUser('player1'); const p2 = interaction.options.getUser('player2');
            if (p1.id === p2.id) throw new UserError('Pick two different players.');
            const ids = async (u) => (await pool.query(
                `SELECT c.id FROM characters c JOIN users x ON x.id = c.owner_id WHERE c.guild_id = $1 AND x.discord_id = $2 AND c.status IN ('approved','retired')`, [guildId, u.id])).rows.map((r) => r.id);
            const [A, B] = [await ids(p1), await ids(p2)];
            const h = await headToHead(A, B, days);
            return respond(interaction, { embeds: [h2hEmbed(`${p1.displayName || p1.username} vs ${p2.displayName || p2.username}`, p1.displayName || p1.username, p2.displayName || p2.username, h, periodNote)], allowedMentions: NO_MENTIONS });
        }

        if (sub === 'opponents') {
            const c = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved', 'retired'] });
            const rows = await opponentBreakdown(c.id, { days, limit: 20 });
            if (!rows.length) throw new UserError(`${c.name} hasn't faced anyone${periodNote ? ' in that period' : ''} yet.`);
            const lines = rows.map((r) => `**${r.name}** (<@${r.discord_id}>) — ${r.w}-${r.l}${r.d ? `-${r.d}` : ''} in ${r.meetings} meeting${r.meetings === 1 ? '' : 's'}, last <t:${Math.floor(new Date(r.last_met).getTime() / 1000)}:R>`);
            const embed = new EmbedBuilder().setTitle(`${c.name} — Record vs Opponents`).setColor(DIVISION_THEME[c.division].embed)
                .setDescription(lines.join('\n').slice(0, 4000)).setFooter({ text: `Most-faced first${periodNote ? ` · ${periodNote}` : ''}. In multi-person matches a win counts against everyone, a loss only against the winner.` });
            return respond(interaction, { embeds: [embed], allowedMentions: NO_MENTIONS });
        }

        if (sub === 'history') {
            const c = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved', 'retired'] });
            const rows = await recentMatches(guildId, { characterId: c.id, limit: interaction.options.getInteger('count') || 10 });
            if (!rows.length) throw new UserError(`${c.name} hasn't wrestled yet.`);
            const lines = rows.map((r) => {
                const tag = r.title_name ? ` 🏆 ${r.title_name}` : r.contender_title_name ? ` 🎯 ${r.contender_title_name}` : '';
                const res = r.result_type === 'decisive' ? `**${r.winners}** def. ${r.others}` : `${[r.winners, r.others].filter(Boolean).join(', ')} — ${r.result_type === 'draw' ? 'draw' : 'no contest'}`;
                return `\`#${r.id}\` ${matchLabel(r.match_type)}${tag}: ${res} <t:${Math.floor(new Date(r.created_at).getTime() / 1000)}:R>`;
            });
            return respond(interaction, { embeds: [new EmbedBuilder().setTitle(`${c.name} — Recent Matches`).setColor(DIVISION_THEME[c.division].embed).setDescription(lines.join('\n').slice(0, 4000))] });
        }
    }
};

function h2hEmbed(title, nameA, nameB, h, periodNote) {
    const embed = new EmbedBuilder().setTitle(title).setColor(0x3498DB);
    if (!h.total) return embed.setDescription('They have never faced each other.');
    const last = h.matches.slice(0, 5).map((m) => {
        const res = m.result_type === 'draw' ? 'Draw' : m.result_type === 'no_contest' ? 'No contest' : m.a_won && !m.b_won ? `${nameA} won` : m.b_won && !m.a_won ? `${nameB} won` : 'Other';
        return `\`#${m.id}\` ${matchLabel(m.match_type)}${m.is_title_match ? ' 🏆' : ''}: ${res}`;
    });
    embed.addFields(
        { name: nameA, value: `${h.a} win${h.a === 1 ? '' : 's'}`, inline: true },
        { name: nameB, value: `${h.b} win${h.b === 1 ? '' : 's'}`, inline: true },
        { name: 'Other', value: `${h.d} draw${h.d === 1 ? '' : 's'}${h.other ? `, ${h.other} other` : ''}`, inline: true },
        { name: `Last ${last.length} meeting${last.length === 1 ? '' : 's'}`, value: last.join('\n') }
    );
    embed.setFooter({ text: `${h.total} meeting${h.total === 1 ? '' : 's'}${periodNote ? ` · ${periodNote}` : ''}` });
    return embed;
}
