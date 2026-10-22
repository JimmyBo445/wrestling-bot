const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { autocompleteCharacters, requireCharacter } = require('../utils/characterUtils');
const { feudMatches, feudHeat, requireFeud, autocompleteFeuds } = require('../utils/feudUtils');
const { requireAdmin, respond, NO_MENTIONS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { logAudit } = require('../utils/audit');
const { fmtYmd } = require('../utils/dates');

const feudOpt = (o) => o.setName('feud').setDescription('Feud').setRequired(true).setAutocomplete(true);

const data = new SlashCommandBuilder()
    .setName('feud')
    .setDescription('Rivalries and storylines: a timeline and a heat meter for each feud')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('start').setDescription('[Admin] Start a feud between two wrestlers')
        .addStringOption((o) => o.setName('wrestler1').setDescription('First wrestler').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('wrestler2').setDescription('Second wrestler').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('name').setDescription('Feud name, e.g. "Blood Feud" (default: their names)').setRequired(false).setMaxLength(60))
        .addStringOption((o) => o.setName('story').setDescription('What started it').setRequired(false).setMaxLength(300)))
    .addSubcommand((s) => s.setName('log').setDescription('[Admin] Add a storyline moment to a feud (promo, attack, challenge...)')
        .addStringOption(feudOpt)
        .addStringOption((o) => o.setName('text').setDescription('What happened').setRequired(true).setMaxLength(300)))
    .addSubcommand((s) => s.setName('view').setDescription('The timeline, record and heat of a feud').addStringOption(feudOpt))
    .addSubcommand((s) => s.setName('list').setDescription('Active feuds, hottest first'))
    .addSubcommand((s) => s.setName('heat').setDescription('[Admin] Nudge a feud hotter or colder by hand')
        .addStringOption(feudOpt)
        .addIntegerOption((o) => o.setName('boost').setDescription('Extra heat from -40 (colder) to +40 (hotter), replaces the old boost').setRequired(true).setMinValue(-40).setMaxValue(40)))
    .addSubcommand((s) => s.setName('end').setDescription('[Admin] End a feud (keeps the timeline)')
        .addStringOption(feudOpt)
        .addStringOption((o) => o.setName('text').setDescription('How it ended').setRequired(false).setMaxLength(300)));

module.exports = {
    data,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        if (focused.name === 'feud') return interaction.respond(await autocompleteFeuds(interaction, focused.value, { activeOnly: ['log', 'heat', 'end'].includes(interaction.options.getSubcommand(false)) }));
        return interaction.respond(await autocompleteCharacters(interaction, focused.value));
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'start') {
            requireAdmin(interaction, 'start feuds');
            const a = await requireCharacter(guildId, interaction.options.getString('wrestler1'), { statuses: ['approved'] });
            const b = await requireCharacter(guildId, interaction.options.getString('wrestler2'), { statuses: ['approved'] });
            if (a.id === b.id) throw new UserError('Pick two different wrestlers.');
            const { rows: dupe } = await pool.query(
                `SELECT id FROM feuds WHERE guild_id = $1 AND status = 'active' AND ((char_a = $2 AND char_b = $3) OR (char_a = $3 AND char_b = $2))`, [guildId, a.id, b.id]);
            if (dupe.length) throw new UserError('Those two already have an active feud. Add to it with `/feud log`.');
            const name = interaction.options.getString('name')?.trim() || `${a.name} vs ${b.name}`;
            const { rows } = await pool.query(
                `INSERT INTO feuds (guild_id, name, char_a, char_b, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [guildId, name, a.id, b.id, interaction.user.id]);
            const story = interaction.options.getString('story')?.trim();
            if (story) await pool.query(`INSERT INTO feud_entries (feud_id, body, created_by) VALUES ($1,$2,$3)`, [rows[0].id, story, interaction.user.id]);
            await logAudit(guildId, interaction.user.id, 'feud_started', { name });
            return respond(interaction, { content: `🔥 Feud started: **${name}**. Add moments with \`/feud log\`; every match between them heats it up.`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'log') {
            requireAdmin(interaction, 'log storyline moments');
            const feud = await requireFeud(guildId, interaction.options.getString('feud'));
            if (feud.status !== 'active') throw new UserError('That feud has ended.');
            await pool.query(`INSERT INTO feud_entries (feud_id, body, created_by) VALUES ($1,$2,$3)`, [feud.id, interaction.options.getString('text').trim(), interaction.user.id]);
            const heat = await feudHeat(feud);
            return respond(interaction, { content: `📖 Added to **${feud.name}**. Heat: ${heat.bar} **${heat.score}** (${heat.label})`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'heat') {
            requireAdmin(interaction, 'change feud heat');
            const feud = await requireFeud(guildId, interaction.options.getString('feud'));
            await pool.query(`UPDATE feuds SET boost = $2 WHERE id = $1`, [feud.id, interaction.options.getInteger('boost')]);
            const heat = await feudHeat({ ...feud, boost: interaction.options.getInteger('boost') });
            return respond(interaction, { content: `**${feud.name}** heat: ${heat.bar} **${heat.score}** (${heat.label})`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'end') {
            requireAdmin(interaction, 'end feuds');
            const feud = await requireFeud(guildId, interaction.options.getString('feud'));
            if (feud.status !== 'active') throw new UserError('That feud has already ended.');
            const text = interaction.options.getString('text')?.trim();
            if (text) await pool.query(`INSERT INTO feud_entries (feud_id, body, created_by) VALUES ($1,$2,$3)`, [feud.id, `Ended: ${text}`, interaction.user.id]);
            await pool.query(`UPDATE feuds SET status = 'ended', ended_at = now() WHERE id = $1`, [feud.id]);
            await logAudit(guildId, interaction.user.id, 'feud_ended', { name: feud.name });
            return respond(interaction, { content: `🏁 **${feud.name}** is over. \`/feud view\` still shows the full timeline.`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'list') {
            const { rows } = await pool.query(
                `SELECT f.*, a.name AS a_name, b.name AS b_name FROM feuds f JOIN characters a ON a.id = f.char_a JOIN characters b ON b.id = f.char_b
                 WHERE f.guild_id = $1 AND f.status = 'active'`, [guildId]);
            if (!rows.length) return respond(interaction, { content: 'No active feuds. An admin can start one with `/feud start`.', flags: 64 });
            const withHeat = await Promise.all(rows.map(async (f) => ({ f, heat: await feudHeat(f) })));
            withHeat.sort((x, y) => y.heat.score - x.heat.score);
            const lines = withHeat.map(({ f, heat }) => `${heat.bar} **${heat.score}** · **${f.name}** (${f.a_name} vs ${f.b_name}) · ${heat.label}`);
            return respond(interaction, { embeds: [new EmbedBuilder().setTitle('🔥 Active Feuds').setColor(0xC0392B).setDescription(lines.join('\n').slice(0, 4000))], allowedMentions: NO_MENTIONS });
        }

        if (sub === 'view') {
            const feud = await requireFeud(guildId, interaction.options.getString('feud'));
            const matches = await feudMatches(feud);
            const { rows: entries } = await pool.query(`SELECT body, created_at FROM feud_entries WHERE feud_id = $1 ORDER BY created_at, id`, [feud.id]);
            const heat = await feudHeat(feud);
            let aw = 0, bw = 0, other = 0;
            for (const m of matches) { if (m.result_type !== 'decisive') other++; else if (m.a_won) aw++; else if (m.b_won) bw++; else other++; }
            const events = [
                ...matches.map((m) => ({ at: new Date(m.created_at), text: `🥊 ${m.result_type !== 'decisive' ? `${m.result_type === 'draw' ? 'Draw' : 'No contest'}` : `**${m.a_won ? feud.a_name : feud.b_name}** won`}${m.title_name ? ` · 🏆 ${m.title_name}` : ''}${m.stipulation ? ` · ${m.stipulation}` : ''}${m.stars ? ` · ${'⭐'.repeat(m.stars)}` : ''} _(match #${m.id})_` })),
                ...entries.map((e) => ({ at: new Date(e.created_at), text: `📖 ${e.body}` }))
            ].sort((x, y) => x.at - y.at);
            const shown = events.slice(-14);
            const embed = new EmbedBuilder().setColor(0xC0392B).setTitle(`🔥 ${feud.name}${feud.status === 'ended' ? ' (ended)' : ''}`)
                .setDescription(`**${feud.a_name}** vs **${feud.b_name}**\nRecord: **${aw}–${bw}**${other ? ` (${other} no decision)` : ''}\nHeat: ${heat.bar} **${heat.score}**/100 · ${heat.label}`)
                .addFields({ name: events.length > shown.length ? `Timeline (latest ${shown.length} of ${events.length})` : 'Timeline',
                    value: (shown.length ? shown.map((e) => `\`${fmtYmd(e.at)}\` ${e.text}`).join('\n') : '_Nothing yet._').slice(0, 1024) });
            return respond(interaction, { embeds: [embed], allowedMentions: NO_MENTIONS });
        }
    }
};
