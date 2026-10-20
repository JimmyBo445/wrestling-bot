const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { pool, withTransaction } = require('../db/pool');
const { autocompleteCharacters, requireCharacter } = require('../utils/characterUtils');
const {
    MIN_FACTION, MAX_FACTION, autocompleteFactions, requireFaction, getFactionMembers, factionOfCharacter, buildFactionData, factionSummary
} = require('../utils/factionUtils');
const { renderFactionCard } = require('../utils/cardRenderer');
const { requireAdmin, respond, DIVISION_LABELS, NO_MENTIONS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { logAudit } = require('../utils/audit');

const DIVISION_CHOICES = Object.entries(DIVISION_LABELS).map(([value, name]) => ({ name, value }));
const memberOpt = (o, n, required) => o.setName(`member${n}`).setDescription(`Faction member ${n}`).setRequired(required).setAutocomplete(true);
const factionOpt = (o) => o.setName('faction').setDescription('Faction').setRequired(true).setAutocomplete(true);

const data = new SlashCommandBuilder()
    .setName('faction')
    .setDescription(`Factions: groups of ${MIN_FACTION}-${MAX_FACTION} wrestlers with a shared record (separate from tag teams)`)
    .setDMPermission(false)
    .addSubcommand((s) => {
        s.setName('create').setDescription('[Admin] Start a faction')
            .addStringOption((o) => o.setName('name').setDescription('Faction name').setRequired(true).setMaxLength(40))
            .addStringOption((o) => o.setName('division').setDescription('Division').setRequired(true).addChoices(...DIVISION_CHOICES));
        for (let i = 1; i <= MAX_FACTION; i++) s.addStringOption((o) => memberOpt(o, i, i <= MIN_FACTION));
        return s;
    })
    .addSubcommand((s) => s.setName('add-member').setDescription('[Admin] Add a wrestler to a faction')
        .addStringOption((o) => factionOpt(o)).addStringOption((o) => o.setName('character').setDescription('Wrestler').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('remove-member').setDescription('[Admin] Take a wrestler out of a faction')
        .addStringOption((o) => factionOpt(o)).addStringOption((o) => o.setName('character').setDescription('Wrestler').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('disband').setDescription('[Admin] End a faction (its record is kept)').addStringOption((o) => factionOpt(o)))
    .addSubcommand((s) => s.setName('list').setDescription('All factions with their records'))
    .addSubcommand((s) => s.setName('profile').setDescription('Faction card with members, record and titles').addStringOption((o) => factionOpt(o)));

async function checkMembers(guildId, faction, chars) {
    for (const c of chars) {
        if (c.division !== faction.division) throw new UserError(`**${c.name}** is in a different division than **${faction.name}** (${DIVISION_LABELS[faction.division]}).`);
        const other = await factionOfCharacter(c.id);
        if (other && String(other.id) !== String(faction.id)) throw new UserError(`**${c.name}** is already in **${other.name}**. Remove them from it first.`);
    }
}

module.exports = {
    data,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        if (focused.name === 'faction') return interaction.respond(await autocompleteFactions(interaction, focused.value));
        return interaction.respond(await autocompleteCharacters(interaction, focused.value, { division: interaction.options.getString('division') || null }));
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'create') {
            requireAdmin(interaction, 'create factions');
            const name = interaction.options.getString('name').trim();
            const division = interaction.options.getString('division');
            const ids = [];
            for (let i = 1; i <= MAX_FACTION; i++) { const v = interaction.options.getString(`member${i}`); if (v) ids.push(v); }
            if (ids.length < MIN_FACTION) throw new UserError(`A faction needs at least ${MIN_FACTION} wrestlers (a tag team is 2).`);
            const chars = [];
            for (const v of ids) chars.push(await requireCharacter(guildId, v, { statuses: ['approved'] }));
            if (new Set(chars.map((c) => String(c.id))).size !== chars.length) throw new UserError('The same wrestler is listed twice.');
            const { rows: dup } = await pool.query(`SELECT 1 FROM factions WHERE guild_id = $1 AND lower(name) = lower($2) AND status = 'active'`, [guildId, name]);
            if (dup.length) throw new UserError(`There is already a faction called **${name}**.`);
            const draft = { id: 0, name, division };
            await checkMembers(guildId, draft, chars);
            await interaction.deferReply();
            const faction = await withTransaction(async (client) => {
                const { rows } = await client.query(`INSERT INTO factions (guild_id, name, division, created_by) VALUES ($1,$2,$3,$4) RETURNING *`, [guildId, name, division, interaction.user.id]);
                for (const c of chars) await client.query(`INSERT INTO faction_members (faction_id, character_id) VALUES ($1,$2)`, [rows[0].id, c.id]);
                return rows[0];
            });
            await logAudit(guildId, interaction.user.id, 'faction_created', { name, members: chars.map((c) => c.name) });
            const buffer = await renderFactionCard(await buildFactionData(interaction.guild, faction));
            return interaction.editReply({ content: `Faction **${name}** is official!`, files: [new AttachmentBuilder(buffer, { name: 'faction.png' })], allowedMentions: NO_MENTIONS });
        }

        if (sub === 'add-member' || sub === 'remove-member') {
            requireAdmin(interaction, 'change factions');
            const faction = await requireFaction(guildId, interaction.options.getString('faction'));
            const c = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved', 'retired'] });
            const members = await getFactionMembers(faction.id);
            const inIt = members.some((m) => String(m.id) === String(c.id));
            if (sub === 'add-member') {
                if (inIt) throw new UserError(`**${c.name}** is already in **${faction.name}**.`);
                if (members.length >= MAX_FACTION) throw new UserError(`A faction can have at most ${MAX_FACTION} members.`);
                await checkMembers(guildId, faction, [c]);
                await pool.query(`INSERT INTO faction_members (faction_id, character_id) VALUES ($1,$2)
                                  ON CONFLICT (faction_id, character_id) DO UPDATE SET left_at = NULL, joined_at = now()`, [faction.id, c.id]);
                await logAudit(guildId, interaction.user.id, 'faction_member_added', { faction: faction.name, name: c.name });
                return respond(interaction, { content: `**${c.name}** joined **${faction.name}**.` });
            }
            if (!inIt) throw new UserError(`**${c.name}** isn't in **${faction.name}**.`);
            if (members.length <= MIN_FACTION) throw new UserError(`A faction needs at least ${MIN_FACTION} members. Add someone else first, or use \`/faction disband\`.`);
            await pool.query(`UPDATE faction_members SET left_at = now() WHERE faction_id = $1 AND character_id = $2`, [faction.id, c.id]);
            await logAudit(guildId, interaction.user.id, 'faction_member_removed', { faction: faction.name, name: c.name });
            return respond(interaction, { content: `**${c.name}** left **${faction.name}**.` });
        }

        if (sub === 'disband') {
            requireAdmin(interaction, 'disband factions');
            const faction = await requireFaction(guildId, interaction.options.getString('faction'));
            await pool.query(`UPDATE factions SET status = 'disbanded' WHERE id = $1`, [faction.id]);
            await pool.query(`UPDATE faction_members SET left_at = now() WHERE faction_id = $1 AND left_at IS NULL`, [faction.id]);
            await logAudit(guildId, interaction.user.id, 'faction_disbanded', { name: faction.name });
            return respond(interaction, { content: `**${faction.name}** has been disbanded. Its record is kept.` });
        }

        if (sub === 'list') {
            const { rows } = await pool.query(`SELECT * FROM factions WHERE guild_id = $1 AND status = 'active' ORDER BY name`, [guildId]);
            if (!rows.length) return respond(interaction, { content: 'No factions yet. An admin can start one with `/faction create`.' });
            const lines = [];
            for (const f of rows.slice(0, 25)) {
                const s = await factionSummary(f.id);
                const m = await getFactionMembers(f.id);
                lines.push(`**${f.name}** (${DIVISION_LABELS[f.division]}) · ${s.wins}-${s.losses}${s.draws ? `-${s.draws}` : ''} · ${m.map((x) => x.name).join(', ')}`);
            }
            return respond(interaction, { embeds: [new EmbedBuilder().setTitle('Factions').setColor(0x8E44AD).setDescription(lines.join('\n\n').slice(0, 4000))] });
        }

        if (sub === 'profile') {
            const faction = await requireFaction(guildId, interaction.options.getString('faction'), { active: false });
            await interaction.deferReply();
            const buffer = await renderFactionCard(await buildFactionData(interaction.guild, faction));
            return interaction.editReply({ files: [new AttachmentBuilder(buffer, { name: 'faction.png' })] });
        }
    }
};
