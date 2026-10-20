const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { pool, withTransaction } = require('../db/pool');
const { ensureUser } = require('../utils/ensureGuild');
const { canAddCharacter, autocompleteCharacters, requireCharacter } = require('../utils/characterUtils');
const { postPendingCard } = require('../handlers/pendingQueue');
const { renderProfileCard } = require('../utils/cardRenderer');
const { buildProfileData } = require('../utils/cardData');
const { validateImageUrl } = require('../utils/imageUrl');
const { getTitlesHeldByCharacter } = require('../utils/teamUtils');
const { requireAdmin, isAdmin, respond, reply, DIVISION_LABELS, NO_MENTIONS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { logAudit } = require('../utils/audit');
const { characterSummary } = require('../utils/statsQueries');
const { DIVISION_THEME, MAX_CHARACTERS_PER_USER } = require('../utils/constants');

const DIVISION_CHOICES = [
    { name: "Men's", value: 'mens' },
    { name: "Women's", value: 'womens' },
    { name: 'Custom', value: 'custom' },
    { name: "Custom Women's", value: 'custom_womens' }
];
const ALIGNMENT_CHOICES = [
    { name: 'Face (good guy)', value: 'face' },
    { name: 'Heel (bad guy)', value: 'heel' },
    { name: 'Neutral', value: 'neutral' }
];

const charOpt = (o, desc = 'Character') => o.setName('character').setDescription(desc).setRequired(true).setAutocomplete(true);

const data = new SlashCommandBuilder()
    .setName('character')
    .setDescription('Manage wrestler characters')
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('submit')
        .setDescription(`Submit a character for admin approval (max ${MAX_CHARACTERS_PER_USER} per player)`)
        .addStringOption((o) => o.setName('name').setDescription('Character name').setRequired(true).setMaxLength(40))
        .addStringOption((o) => o.setName('division').setDescription('Division').setRequired(true).addChoices(...DIVISION_CHOICES))
        .addStringOption((o) => o.setName('image_url').setDescription('Link (https) to character art for their card').setRequired(false))
        .addStringOption((o) => o.setName('alignment').setDescription('Face, heel or neutral').setRequired(false).addChoices(...ALIGNMENT_CHOICES))
        .addStringOption((o) => o.setName('bio').setDescription('One-line description shown on their profile').setRequired(false).setMaxLength(120))
        .addStringOption((o) => o.setName('finisher').setDescription('Finishing move, shown on their profile').setRequired(false).setMaxLength(40))
        .addStringOption((o) => o.setName('entrance_theme').setDescription('Entrance theme (song name), shown on their profile').setRequired(false).setMaxLength(60)))
    .addSubcommand((sub) => sub.setName('assign')
        .setDescription('[Admin] Create and auto-approve a character for a player')
        .addUserOption((o) => o.setName('user').setDescription('Owner').setRequired(true))
        .addStringOption((o) => o.setName('name').setDescription('Character name').setRequired(true).setMaxLength(40))
        .addStringOption((o) => o.setName('division').setDescription('Division').setRequired(true).addChoices(...DIVISION_CHOICES))
        .addStringOption((o) => o.setName('image_url').setDescription('Link (https) to character art').setRequired(false))
        .addStringOption((o) => o.setName('alignment').setDescription('Face, heel or neutral').setRequired(false).addChoices(...ALIGNMENT_CHOICES))
        .addStringOption((o) => o.setName('bio').setDescription('One-line description').setRequired(false).setMaxLength(120))
        .addStringOption((o) => o.setName('finisher').setDescription('Finishing move, shown on their profile').setRequired(false).setMaxLength(40))
        .addStringOption((o) => o.setName('entrance_theme').setDescription('Entrance theme (song name), shown on their profile').setRequired(false).setMaxLength(60)))
    .addSubcommand((sub) => sub.setName('list')
        .setDescription("List a player's characters")
        .addUserOption((o) => o.setName('user').setDescription('Defaults to you').setRequired(false)))
    .addSubcommand((sub) => sub.setName('profile').setDescription("Show a character's profile card").addStringOption((o) => charOpt(o)))
    .addSubcommand((sub) => sub.setName('edit')
        .setDescription("Change a character's name, art, alignment, bio, finisher or theme (owner or admin)")
        .addStringOption((o) => charOpt(o))
        .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(false).setMaxLength(40))
        .addStringOption((o) => o.setName('image_url').setDescription('New art link (https), or - to remove').setRequired(false))
        .addStringOption((o) => o.setName('alignment').setDescription('Face, heel or neutral').setRequired(false).addChoices(...ALIGNMENT_CHOICES))
        .addStringOption((o) => o.setName('bio').setDescription('New description, or - to clear').setRequired(false).setMaxLength(120))
        .addStringOption((o) => o.setName('finisher').setDescription('New finisher, or - to clear').setRequired(false).setMaxLength(40))
        .addStringOption((o) => o.setName('entrance_theme').setDescription('New entrance theme, or - to clear').setRequired(false).setMaxLength(60)))
    .addSubcommand((sub) => sub.setName('retire')
        .setDescription('[Admin] Retire a character (hides it, keeps all stats, frees a slot)')
        .addStringOption((o) => charOpt(o)))
    .addSubcommand((sub) => sub.setName('restore')
        .setDescription('[Admin] Bring a retired character back')
        .addStringOption((o) => charOpt(o, 'Retired character')))
    .addSubcommand((sub) => sub.setName('remove')
        .setDescription('[Admin] Permanently delete a character that has no match/title history')
        .addStringOption((o) => charOpt(o)))
    .addSubcommand((sub) => sub.setName('transfer')
        .setDescription('[Admin] Give a character to a different player (keeps all stats and history)')
        .addStringOption((o) => charOpt(o))
        .addUserOption((o) => o.setName('new_owner').setDescription('Who should own it').setRequired(true)));

// Which statuses to offer in the dropdown for each subcommand
const STATUS_BY_SUB = {
    profile: ['approved', 'retired'], edit: ['approved', 'retired', 'pending'], retire: ['approved'],
    restore: ['retired'], remove: ['approved', 'pending', 'retired', 'denied'], transfer: ['approved', 'pending', 'retired']
};

/** Trims; empty text becomes null. */
function cleanText(v) {
    if (v === null || v === undefined) return null;
    const t = String(v).trim();
    return t ? t : null;
}

async function checkImage(url) {
    if (!url || url === '-') return null;
    const v = await validateImageUrl(url);
    if (!v.ok) throw new UserError(`Image problem: ${v.error}`);
    return url;
}

module.exports = {
    data,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused();
        const sub = interaction.options.getSubcommand(false);
        return interaction.respond(await autocompleteCharacters(interaction, focused, { statuses: STATUS_BY_SUB[sub] || ['approved'] }));
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'submit') {
            const name = interaction.options.getString('name').trim();
            const division = interaction.options.getString('division');
            if (!name) throw new UserError('Please give the character a name.');
            await interaction.deferReply({ flags: 64 });
            const imageUrl = await checkImage(interaction.options.getString('image_url'));

            const ownerId = await ensureUser(guildId, interaction.user.id);
            if (!(await canAddCharacter(guildId, ownerId))) {
                throw new UserError(`You already have ${MAX_CHARACTERS_PER_USER} characters (approved or pending). Ask an admin to retire one first.`);
            }
            const { rows } = await pool.query(
                `INSERT INTO characters (guild_id, owner_id, name, division, image_url, alignment, bio, finisher, entrance_theme, status, submitted_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10) RETURNING id`,
                [guildId, ownerId, name, division, imageUrl, interaction.options.getString('alignment'), interaction.options.getString('bio'),
                    cleanText(interaction.options.getString('finisher')), cleanText(interaction.options.getString('entrance_theme')), interaction.user.id]
            );
            await interaction.editReply({ content: `**${name}** was submitted for approval. An admin will review it.` });
            await postPendingCard(interaction.guild, { type: 'character_submission', characterId: rows[0].id, requestedBy: interaction.user.id });
            return;
        }

        if (sub === 'assign') {
            requireAdmin(interaction, 'assign characters directly');
            const targetUser = interaction.options.getUser('user');
            if (targetUser.bot) throw new UserError('Bots can\'t own characters.');
            const name = interaction.options.getString('name').trim();
            await interaction.deferReply();
            const imageUrl = await checkImage(interaction.options.getString('image_url'));
            const ownerId = await ensureUser(guildId, targetUser.id);
            if (!(await canAddCharacter(guildId, ownerId))) throw new UserError(`<@${targetUser.id}> already has ${MAX_CHARACTERS_PER_USER} characters.`);
            const division = interaction.options.getString('division');
            await pool.query(
                `INSERT INTO characters (guild_id, owner_id, name, division, image_url, alignment, bio, finisher, entrance_theme, status, submitted_by, approved_by, approved_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved', $10, $10, now())`,
                [guildId, ownerId, name, division, imageUrl, interaction.options.getString('alignment'), interaction.options.getString('bio'),
                    cleanText(interaction.options.getString('finisher')), cleanText(interaction.options.getString('entrance_theme')), interaction.user.id]
            );
            await logAudit(guildId, interaction.user.id, 'character_assigned', { name, owner: targetUser.id, division });
            return interaction.editReply({ content: `Assigned **${name}** (${DIVISION_LABELS[division]}) to <@${targetUser.id}>.`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'list') {
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const ownerId = await ensureUser(guildId, targetUser.id);
            const { rows } = await pool.query(
                `SELECT id, name, division, status, alignment FROM characters
                 WHERE guild_id = $1 AND owner_id = $2 AND status <> 'denied' ORDER BY status, name`, [guildId, ownerId]);
            if (!rows.length) return respond(interaction, { content: `<@${targetUser.id}> has no characters yet.`, flags: 64, allowedMentions: NO_MENTIONS });
            const lines = [];
            for (const r of rows) {
                const s = await characterSummary(r.id);
                const held = await getTitlesHeldByCharacter(r.id);
                lines.push(`**${r.name}** — ${DIVISION_LABELS[r.division]}${r.alignment ? ` · ${r.alignment}` : ''}${r.status !== 'approved' ? ` _(${r.status})_` : ''}\n` +
                    `${s.wins}-${s.losses}${s.draws ? `-${s.draws}` : ''}${held.length ? `  ·  🏆 ${held.map((h) => h.name).join(', ')}` : ''}`);
            }
            const embed = new EmbedBuilder().setTitle(`${targetUser.displayName || targetUser.username}'s Characters`)
                .setColor(0xC0392B).setDescription(lines.join('\n\n')).setFooter({ text: `${rows.filter((r) => ['approved', 'pending'].includes(r.status)).length}/${MAX_CHARACTERS_PER_USER} slots used` });
            return respond(interaction, { embeds: [embed] });
        }

        if (sub === 'profile') {
            const character = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved', 'retired'] });
            await interaction.deferReply();
            const buffer = await renderProfileCard(await buildProfileData(interaction.guild, character));
            return interaction.editReply({ files: [new AttachmentBuilder(buffer, { name: 'profile.png' })] });
        }

        if (sub === 'edit') {
            const character = await requireCharacter(guildId, interaction.options.getString('character'));
            const mine = character.owner_discord_id === interaction.user.id;
            if (!mine && !isAdmin(interaction)) throw new UserError('You can only edit your own characters (admins can edit anyone\'s).');
            await interaction.deferReply({ flags: 64 });

            const updates = []; const params = []; const changed = [];
            const set = (col, val, label) => { params.push(val); updates.push(`${col} = $${params.length}`); changed.push(label); };
            const name = interaction.options.getString('name');
            if (name !== null) { if (!name.trim()) throw new UserError('Name can\'t be empty.'); set('name', name.trim(), 'name'); }
            const img = interaction.options.getString('image_url');
            if (img !== null) set('image_url', await checkImage(img), img === '-' ? 'art removed' : 'art');
            const align = interaction.options.getString('alignment');
            if (align !== null) set('alignment', align, 'alignment');
            const bio = interaction.options.getString('bio');
            if (bio !== null) set('bio', bio === '-' ? null : bio, 'bio');
            const finisher = interaction.options.getString('finisher');
            if (finisher !== null) set('finisher', finisher === '-' ? null : cleanText(finisher), 'finisher');
            const theme = interaction.options.getString('entrance_theme');
            if (theme !== null) set('entrance_theme', theme === '-' ? null : cleanText(theme), 'entrance theme');
            if (!updates.length) throw new UserError('Nothing to change: fill in at least one option (name, image_url, alignment, bio, finisher or entrance_theme).');
            params.push(character.id);
            await pool.query(`UPDATE characters SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
            if (!mine) await logAudit(guildId, interaction.user.id, 'character_edited', { id: character.id, changed });
            return interaction.editReply({ content: `Updated **${name?.trim() || character.name}**: ${changed.join(', ')}.` });
        }

        if (sub === 'retire') {
            requireAdmin(interaction, 'retire characters');
            const character = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved'] });
            const held = await pool.query(
                `SELECT t.name FROM title_reigns tr JOIN titles t ON t.id = tr.title_id
                 WHERE tr.lost_date IS NULL AND ((tr.team_id IS NULL AND tr.character_id = $1)
                   OR EXISTS (SELECT 1 FROM title_reign_members m WHERE m.reign_id = tr.id AND m.character_id = $1))`, [character.id]);
            if (held.rows.length) {
                throw new UserError(`**${character.name}** currently holds the ${held.rows.map((r) => `**${r.name}**`).join(', ')}. Vacate it first with \`/championship vacate\`.`);
            }
            const teams = await withTransaction(async (client) => {
                await client.query(`UPDATE characters SET status = 'retired', retired_at = now() WHERE id = $1`, [character.id]);
                await client.query(`UPDATE contenders SET status = 'revoked', resolved_at = now() WHERE character_id = $1 AND status = 'active'`, [character.id]);
                const { rows: mem } = await client.query(
                    `UPDATE team_members SET left_at = now() WHERE character_id = $1 AND left_at IS NULL RETURNING team_id`, [character.id]);
                const disbanded = [];
                for (const { team_id } of mem) {
                    const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM team_members WHERE team_id = $1 AND left_at IS NULL`, [team_id]);
                    if (rows[0].n < 2) {
                        await client.query(`UPDATE team_members SET left_at = now() WHERE team_id = $1 AND left_at IS NULL`, [team_id]);
                        const { rows: t } = await client.query(`UPDATE teams SET status = 'disbanded', disbanded_at = now() WHERE id = $1 RETURNING name`, [team_id]);
                        await client.query(`UPDATE contenders SET status = 'revoked', resolved_at = now() WHERE team_id = $1 AND status = 'active'`, [team_id]);
                        disbanded.push(t[0].name);
                    }
                }
                return { left: mem.length, disbanded };
            });
            await logAudit(guildId, interaction.user.id, 'character_retired', { id: character.id, name: character.name });
            let msg = `Retired **${character.name}**. Their stats and history are kept, and the owner has a free slot.`;
            if (teams.left) msg += `\nThey were removed from ${teams.left} team(s).`;
            if (teams.disbanded.length) msg += ` Disbanded because it dropped below 2 members: ${teams.disbanded.map((n) => `**${n}**`).join(', ')}.`;
            return respond(interaction, { content: msg, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'restore') {
            requireAdmin(interaction, 'restore characters');
            const character = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['retired'] });
            if (!(await canAddCharacter(guildId, character.owner_id))) {
                throw new UserError(`<@${character.owner_discord_id}> already has ${MAX_CHARACTERS_PER_USER} characters. Retire or transfer one first.`);
            }
            await pool.query(`UPDATE characters SET status = 'approved', retired_at = NULL WHERE id = $1`, [character.id]);
            await logAudit(guildId, interaction.user.id, 'character_restored', { id: character.id, name: character.name });
            return respond(interaction, { content: `**${character.name}** is back (owner: <@${character.owner_discord_id}>).`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'remove') {
            requireAdmin(interaction, 'delete characters');
            const character = await requireCharacter(guildId, interaction.options.getString('character'));
            const { rows } = await pool.query(
                `SELECT (SELECT COUNT(*) FROM match_participants WHERE character_id = $1)::int AS matches,
                        (SELECT COUNT(*) FROM title_reigns WHERE character_id = $1)::int
                          + (SELECT COUNT(*) FROM title_reign_members WHERE character_id = $1)::int AS reigns,
                        (SELECT COUNT(*) FROM contenders WHERE character_id = $1)::int AS contenders,
                        (SELECT COUNT(*) FROM team_members WHERE character_id = $1)::int AS teams`, [character.id]);
            const { matches, reigns, contenders, teams } = rows[0];
            if (matches || reigns || contenders || teams) {
                const bits = [];
                if (matches) bits.push(`${matches} match${matches > 1 ? 'es' : ''}`);
                if (reigns) bits.push(`${reigns} title reign record${reigns > 1 ? 's' : ''}`);
                if (contenders) bits.push(`${contenders} #1 contender record${contenders > 1 ? 's' : ''}`);
                if (teams) bits.push(`${teams} team membership${teams > 1 ? 's' : ''}`);
                throw new UserError(`**${character.name}** has history (${bits.join(', ')}), so deleting would break stats. Use \`/character retire\` to hide them, or \`/character transfer\` to give them to the right owner.`);
            }
            await withTransaction(async (client) => {
                await client.query(`DELETE FROM pending_requests WHERE character_id = $1 OR challenger_character_id = $1`, [character.id]);
                await client.query(`DELETE FROM characters WHERE id = $1 AND guild_id = $2`, [character.id, guildId]);
            });
            await logAudit(guildId, interaction.user.id, 'character_removed', { name: character.name, owner: character.owner_discord_id });
            return respond(interaction, { content: `Deleted **${character.name}** (was owned by <@${character.owner_discord_id}>).`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'transfer') {
            requireAdmin(interaction, 'transfer characters');
            const newOwnerUser = interaction.options.getUser('new_owner');
            if (newOwnerUser.bot) throw new UserError('Bots can\'t own characters.');
            const character = await requireCharacter(guildId, interaction.options.getString('character'));
            const newOwnerId = await ensureUser(guildId, newOwnerUser.id);
            if (String(character.owner_id) === String(newOwnerId)) throw new UserError(`<@${newOwnerUser.id}> already owns **${character.name}**.`);
            if (['approved', 'pending'].includes(character.status) && !(await canAddCharacter(guildId, newOwnerId))) {
                throw new UserError(`<@${newOwnerUser.id}> already has ${MAX_CHARACTERS_PER_USER} characters. Retire or move one of theirs first.`);
            }
            await pool.query(`UPDATE characters SET owner_id = $1 WHERE id = $2 AND guild_id = $3`, [newOwnerId, character.id, guildId]);
            await logAudit(guildId, interaction.user.id, 'character_transferred', { name: character.name, from: character.owner_discord_id, to: newOwnerUser.id });
            return respond(interaction, { content: `Moved **${character.name}** from <@${character.owner_discord_id}> to <@${newOwnerUser.id}>. All stats and history came with it.`, allowedMentions: NO_MENTIONS });
        }
    }
};
void reply; void DIVISION_THEME;
