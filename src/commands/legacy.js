// /legacy: career accolades. Everyone can look (list, view); admins and staff award and remove them.
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { respond, requireAdmin, EPHEMERAL, NO_MENTIONS, DIVISION_LABELS } = require('../utils/discordHelpers');
const { autocompleteCharacters, requireCharacter } = require('../utils/characterUtils');
const { ensureUser } = require('../utils/ensureGuild');
const { UserError } = require('../utils/errors');
const { logAudit } = require('../utils/audit');
const L = require('../utils/legacy');

const KIND_CHOICES = Object.entries(L.KINDS).map(([value, k]) => ({ name: k.label, value }));
const DIV_CHOICES = Object.entries(DIVISION_LABELS).map(([value, name]) => ({ name, value }));
const GOLD = 0xE8BF4A;
const thisYear = () => new Date().getFullYear();

const data = new SlashCommandBuilder()
    .setName('legacy')
    .setDescription('Career accolades: Money in the Bank, Royal Rumble, Face of FNLW MVP and year-end awards')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('list').setDescription('The honor roll: every winner of an accolade')
        .addStringOption((o) => o.setName('accolade').setDescription('Which one (default: all)').setRequired(false).addChoices(...KIND_CHOICES))
        .addIntegerOption((o) => o.setName('year').setDescription('Just one year').setRequired(false).setMinValue(2000).setMaxValue(2100)))
    .addSubcommand((s) => s.setName('view').setDescription('Every accolade a wrestler (or a player) has won')
        .addStringOption((o) => o.setName('character').setDescription('A wrestler').setRequired(false).setAutocomplete(true))
        .addUserOption((o) => o.setName('player').setDescription('Or a player').setRequired(false)))
    .addSubcommand((s) => s.setName('award').setDescription('[Admin] Give a wrestler an accolade (posts an announcement if a Legacy channel is set)')
        .addStringOption((o) => o.setName('accolade').setDescription('Which accolade').setRequired(true).addChoices(...KIND_CHOICES))
        .addStringOption((o) => o.setName('character').setDescription('The winner').setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('year').setDescription('Year (default: this year)').setRequired(false).setMinValue(2000).setMaxValue(2100))
        .addStringOption((o) => o.setName('award_name').setDescription('Year-end awards: which award').setRequired(false).setAutocomplete(true))
        .addStringOption((o) => o.setName('division').setDescription('MITB / Rumble: which division (default: the wrestler\'s)').setRequired(false).addChoices(...DIV_CHOICES))
        .addUserOption((o) => o.setName('player').setDescription('Who played them then, if not the current owner (for old wins)').setRequired(false))
        .addStringOption((o) => o.setName('notes').setDescription('Optional note, e.g. the show').setRequired(false).setMaxLength(150))
        .addBooleanOption((o) => o.setName('announce').setDescription('Post it in the Legacy channel (default: yes)').setRequired(false)))
    .addSubcommand((s) => s.setName('remove').setDescription('[Admin] Take back an accolade given by mistake')
        .addIntegerOption((o) => o.setName('accolade').setDescription('Start typing a name or year').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('award-names').setDescription('[Admin] The list of year-end award names: see, add, rename or remove')
        .addStringOption((o) => o.setName('action').setDescription('What to do').setRequired(false)
            .addChoices({ name: 'Show the list', value: 'list' }, { name: 'Add a name', value: 'add' }, { name: 'Remove a name', value: 'remove' }, { name: 'Rename', value: 'rename' }))
        .addStringOption((o) => o.setName('name').setDescription('The award name').setRequired(false).setMaxLength(50).setAutocomplete(true))
        .addStringOption((o) => o.setName('new_name').setDescription('Rename: the new name').setRequired(false).setMaxLength(50)))
    .addSubcommand((s) => s.setName('vote-open').setDescription('[Admin] Open a community vote for Face of FNLW MVP or a year-end award')
        .addStringOption((o) => o.setName('accolade').setDescription('What is being voted on').setRequired(true)
            .addChoices({ name: 'Face of FNLW MVP', value: 'mvp' }, { name: 'Year-end award', value: 'award' }))
        .addStringOption((o) => o.setName('award_name').setDescription('Year-end awards: which award').setRequired(false).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('year').setDescription('Year (default: this year)').setRequired(false).setMinValue(2000).setMaxValue(2100))
        .addStringOption((o) => o.setName('nominees_by').setDescription('Who can add nominees (default: admins and staff)').setRequired(false).addChoices(...[{ name: 'Admins and staff', value: 'admins' }, { name: 'Everyone', value: 'everyone' }]))
        .addStringOption((o) => o.setName('voters').setDescription('Who can vote (default: everyone)').setRequired(false).addChoices(...[{ name: 'Admins and staff', value: 'admins' }, { name: 'Everyone', value: 'everyone' }]))
        .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: the Legacy channel, or here)').setRequired(false)))
    .addSubcommand((s) => s.setName('nominate').setDescription('Add a nominee to a vote (for a rivalry or match, add a second wrestler)')
        .addIntegerOption((o) => o.setName('vote').setDescription('Which vote').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('character').setDescription('The nominee').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('character2').setDescription('Rivalry / match: the other wrestler').setRequired(false).setAutocomplete(true))
        .addStringOption((o) => o.setName('label').setDescription('How it shows, e.g. "Ace vs Bolt, Survivor Series"').setRequired(false).setMaxLength(100)))
    .addSubcommand((s) => s.setName('vote-start').setDescription('[Admin] Close nominations and open the voting')
        .addIntegerOption((o) => o.setName('vote').setDescription('Which vote').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('vote-close').setDescription('[Admin] End a vote: the winner gets the accolade (only the winner is announced)')
        .addIntegerOption((o) => o.setName('vote').setDescription('Which vote').setRequired(true).setAutocomplete(true))
        .addBooleanOption((o) => o.setName('cancel').setDescription('Cancel it instead (nobody wins)').setRequired(false)));

function honorRollEmbed(rows, { kind, year }) {
    const title = `🎖 Legacy${kind ? `: ${L.KINDS[kind].label}` : ''}${year ? ` · ${year}` : ''}`;
    const embed = new EmbedBuilder().setColor(GOLD).setTitle(title);
    if (!rows.length) return embed.setDescription('No accolades yet. Admins add them with `/legacy` → 🎖 Give accolade.');
    // group by accolade name (without year), newest first inside each
    const groups = new Map();
    for (const a of rows) {
        const k = L.accoladeName(a, { withYear: false });
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(a);
    }
    for (const [name, list] of [...groups.entries()].slice(0, 25)) {
        const lines = list.map((a) => `**${a.year}**: ${a.holder_name}${a.discord_id ? ` (<@${a.discord_id}>)` : ''}${a.notes ? ` _${a.notes}_` : ''}`);
        let value = lines.join('\n');
        if (value.length > 1024) value = `${lines.slice(0, 12).join('\n')}\n…and ${lines.length - 12} more`;
        embed.addFields({ name, value: value.slice(0, 1024) });
    }
    return embed;
}

function filterMenu(kind) {
    return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ui:lg').setPlaceholder('Show one accolade')
        .addOptions([{ label: 'All accolades', value: 'all', default: !kind }, ...KIND_CHOICES.map((k) => ({ label: k.name, value: k.value, default: k.value === kind }))]));
}

async function honorRoll(guildId, { kind = null, year = null } = {}) {
    const { rows } = await pool.query(
        `SELECT l.*, u.discord_id FROM legacy l LEFT JOIN users u ON u.id = l.user_id
         WHERE l.guild_id = $1 AND ($2::text IS NULL OR l.kind = $2) AND ($3::int IS NULL OR l.year = $3)
         ORDER BY CASE l.kind WHEN 'mvp' THEN 0 WHEN 'mitb' THEN 1 WHEN 'rumble' THEN 2 ELSE 3 END, l.award_name, l.division, l.year DESC, l.id DESC`,
        [guildId, kind, year]);
    return { embeds: [honorRollEmbed(rows, { kind, year })], components: [filterMenu(kind)], allowedMentions: NO_MENTIONS };
}

module.exports = {
    data,
    honorRoll,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        const guildId = interaction.guildId;
        if (focused.name === 'character' || focused.name === 'character2') return interaction.respond(await autocompleteCharacters(interaction, focused.value, { statuses: ['approved', 'retired'] }));
        if (focused.name === 'vote') {
            const sub = interaction.options.getSubcommand();
            const statuses = sub === 'nominate' ? ['nominating'] : sub === 'vote-start' ? ['nominating'] : ['nominating', 'voting'];
            return interaction.respond(await require('../utils/awardVotes').pollChoices(guildId, focused.value, statuses));
        }
        if (focused.name === 'award_name' || focused.name === 'name') {
            const names = await L.awardNames(guildId);
            const typed = String(focused.value || '').toLowerCase();
            return interaction.respond(names.filter((n) => n.toLowerCase().includes(typed)).slice(0, 25).map((n) => ({ name: n, value: n })));
        }
        if (focused.name === 'accolade') {
            const typed = `%${String(focused.value || '').replace(/[%_]/g, '')}%`;
            const { rows } = await pool.query(
                `SELECT * FROM legacy WHERE guild_id = $1 AND (holder_name ILIKE $2 OR year::text ILIKE $2 OR COALESCE(award_name,'') ILIKE $2 OR kind ILIKE $2)
                 ORDER BY year DESC, id DESC LIMIT 25`, [guildId, typed]);
            return interaction.respond(rows.map((a) => ({ name: `${a.holder_name}: ${L.accoladeName(a)}`.slice(0, 100), value: Number(a.id) })));
        }
        return interaction.respond([]);
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'list') {
            return respond(interaction, await honorRoll(guildId, { kind: interaction.options.getString('accolade'), year: interaction.options.getInteger('year') }));
        }

        if (sub === 'view') {
            const charVal = interaction.options.getString('character');
            const player = interaction.options.getUser('player');
            if (!charVal && !player) throw new UserError('Pick a `character` or a `player`.');
            let rows, title;
            if (charVal) {
                const c = await requireCharacter(guildId, charVal, { statuses: ['approved', 'retired'] });
                rows = await L.characterLegacy(c.id);
                title = `🎖 ${c.name}'s Legacy`;
            } else {
                const uid = await ensureUser(guildId, player.id);
                rows = await L.playerLegacy(uid);
                title = `🎖 ${player.displayName || player.username}'s Legacy`;
            }
            const embed = new EmbedBuilder().setColor(GOLD).setTitle(title)
                .setDescription(rows.length ? rows.map((a) => `**${L.accoladeName(a)}**${player ? ` · ${a.holder_name}` : ''}${a.notes ? ` _${a.notes}_` : ''}`).join('\n').slice(0, 4000) : 'No accolades yet.');
            return respond(interaction, { embeds: [embed], allowedMentions: NO_MENTIONS });
        }

        const AV = require('../utils/awardVotes');
        if (sub === 'nominate') {
            const p = await AV.getPoll(guildId, interaction.options.getInteger('vote'));
            if (p.nominate_who !== 'everyone') requireAdmin(interaction, 'add nominees to this vote');
            const c = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved', 'retired'] });
            const c2v = interaction.options.getString('character2');
            const c2 = c2v ? await requireCharacter(guildId, c2v, { statuses: ['approved', 'retired'] }) : null;
            if (c2 && String(c2.id) === String(c.id)) throw new UserError('Pick two different wrestlers.');
            const n = await AV.addNominee(p, { character: c, character2: c2, label: interaction.options.getString('label'), actor: interaction.user.id });
            await AV.postOrUpdate(interaction.client, p, await AV.nominationsPayload(p));
            return respond(interaction, { content: `✅ **${n.label}** is nominated for **${AV.pollName(p)}**.`, flags: EPHEMERAL, allowedMentions: NO_MENTIONS });
        }

        requireAdmin(interaction, 'manage Legacy accolades');

        if (sub === 'vote-open') {
            const kind = interaction.options.getString('accolade');
            let awardName = null;
            if (kind === 'award') {
                const raw = interaction.options.getString('award_name')?.trim();
                if (!raw) throw new UserError('Pick which year-end award in `award_name`.');
                awardName = (await L.awardNames(guildId)).find((n) => n.toLowerCase() === raw.toLowerCase());
                if (!awardName) throw new UserError(`**${raw}** isn't on your award list. Add it first with \`/legacy\` → 🏷 Award names.`);
            }
            const s = await require('../utils/ensureGuild').getGuildSettings(guildId);
            const channelId = interaction.options.getChannel('channel')?.id || s.legacy_channel_id || interaction.channelId;
            const p = await AV.openPoll(guildId, {
                kind, awardName, year: interaction.options.getInteger('year') || thisYear(),
                nominateWho: interaction.options.getString('nominees_by') || 'admins', voteWho: interaction.options.getString('voters') || 'everyone',
                channelId, actor: interaction.user.id });
            const posted = await AV.postOrUpdate(interaction.client, p, await AV.nominationsPayload(p));
            await logAudit(guildId, interaction.user.id, 'award_vote_opened', { vote: AV.pollName(p) });
            return respond(interaction, { content: `🗳 Opened **${AV.pollName(p)}**${posted ? ` in <#${channelId}>` : ''}. Add nominees with 🙋 Nominate someone on the vote post${p.nominate_who === 'everyone' ? ' (anyone can)' : ''}, then ▶️ Start voting on the vote post to open voting.`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'vote-start') {
            const p = await AV.getPoll(guildId, interaction.options.getInteger('vote'));
            if (p.status !== 'nominating') throw new UserError('Voting has already started (or the vote is closed).');
            const list = await AV.nominees(p.id);
            if (list.length < 2) throw new UserError('A vote needs at least 2 nominees. Add them with 🙋 Nominate someone on the vote post.');
            await pool.query(`UPDATE award_polls SET status = 'voting' WHERE id = $1`, [p.id]);
            const live = { ...p, status: 'voting' };
            const posted = await AV.postOrUpdate(interaction.client, live, await AV.votingPayload(live));
            await logAudit(guildId, interaction.user.id, 'award_vote_started', { vote: AV.pollName(p) });
            return respond(interaction, { content: `🗳 Voting is open for **${AV.pollName(p)}**${posted ? ` in <#${p.channel_id}>` : ''}. Close it with 🔒 Close vote on the vote post.`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'vote-close') {
            const p = await AV.getPoll(guildId, interaction.options.getInteger('vote'));
            const cancel = interaction.options.getBoolean('cancel') === true;
            const r = await AV.closePoll(interaction.client, guildId, p, { cancel, actor: interaction.user.id });
            await logAudit(guildId, interaction.user.id, cancel ? 'award_vote_cancelled' : 'award_vote_closed', { vote: AV.pollName(p) });
            if (r.cancelled) return respond(interaction, { content: `Cancelled **${AV.pollName(p)}**. Nobody wins.`, flags: EPHEMERAL });
            // staff see the totals privately; the public post only names the winner
            const totals = r.totals.map((x) => `${x.votes} · ${x.nominee.label}`).join('\n') || '_No votes._';
            const result = r.winners.length === 1 ? `🏆 **${r.winners[0].label}** won${r.given.length ? ` and got **${AV.pollName(p)}** on their Legacy` : ''}.`
                : r.winners.length > 1 ? '🤝 It\'s a tie. Settle it with `/legacy` → 🎖 Give accolade.' : 'Nobody voted.';
            return respond(interaction, { content: `${result}\n\n**Totals (only you can see these):**\n${totals}`.slice(0, 1900), flags: EPHEMERAL, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'award') {
            const kind = interaction.options.getString('accolade');
            const c = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved', 'retired'] });
            const year = interaction.options.getInteger('year') || thisYear();
            let awardName = null, division = null;
            if (kind === 'award') {
                const raw = interaction.options.getString('award_name')?.trim();
                if (!raw) throw new UserError('Pick which year-end award in `award_name`.');
                const names = await L.awardNames(guildId);
                awardName = names.find((n) => n.toLowerCase() === raw.toLowerCase());
                if (!awardName) throw new UserError(`**${raw}** isn't on your award list. Pick one from the list, or add it first with \`/legacy\` → 🏷 Award names.`);
            }
            if (L.KINDS[kind].perDivision) division = interaction.options.getString('division') || c.division;
            const playerOpt = interaction.options.getUser('player');
            const row = await L.giveAccolade(guildId, { kind, awardName, division, year, character: c, playerDiscord: playerOpt ? playerOpt.id : undefined,
                notes: interaction.options.getString('notes'), actor: interaction.user.id });
            if (!row) throw new UserError(`**${c.name}** already has **${L.accoladeName({ kind, award_name: awardName, division, year })}**.`);
            const playerDiscord = row.user_discord;
            await logAudit(guildId, interaction.user.id, 'legacy_awarded', { accolade: L.accoladeName(row), character: c.name });
            const posted = interaction.options.getBoolean('announce') === false ? null : await L.announceAccolade(interaction.client, guildId, row, c);
            const tail = posted ? ` Announced in <#${posted}>.` : posted === false ? ' ⚠️ I couldn\'t post in the Legacy channel. Check I can send messages there.' : '';
            return respond(interaction, { content: `🎖 **${c.name}** now has **${L.accoladeName(row)}**${playerDiscord ? ` (credit: <@${playerDiscord}>)` : ''}.${tail}`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'remove') {
            const id = interaction.options.getInteger('accolade');
            const { rows } = await pool.query(`DELETE FROM legacy WHERE id = $1 AND guild_id = $2 RETURNING *`, [id, guildId]);
            if (!rows.length) throw new UserError('I couldn\'t find that accolade. Pick it from the list that appears as you type.');
            await logAudit(guildId, interaction.user.id, 'legacy_removed', { accolade: L.accoladeName(rows[0]), character: rows[0].holder_name });
            return respond(interaction, { content: `Removed **${L.accoladeName(rows[0])}** from ${rows[0].holder_name}.`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'award-names') {
            const action = interaction.options.getString('action') || 'list';
            const name = interaction.options.getString('name')?.trim();
            const names = await L.awardNames(guildId);
            const find = (n) => names.find((x) => x.toLowerCase() === String(n).toLowerCase());
            if (action !== 'list') {
                if (!name) throw new UserError('Fill in `name`.');
                if (action === 'add') {
                    if (find(name)) throw new UserError(`**${find(name)}** is already on the list.`);
                    await pool.query(`INSERT INTO legacy_award_names (guild_id, name, sort) VALUES ($1,$2,100)`, [guildId, name]);
                } else {
                    const hit = find(name);
                    if (!hit) throw new UserError(`**${name}** isn't on the list.`);
                    if (action === 'remove') {
                        await pool.query(`DELETE FROM legacy_award_names WHERE guild_id = $1 AND lower(name) = lower($2)`, [guildId, hit]);
                    } else {
                        const nn = interaction.options.getString('new_name')?.trim();
                        if (!nn) throw new UserError('Fill in `new_name`.');
                        if (find(nn) && find(nn).toLowerCase() !== hit.toLowerCase()) throw new UserError(`**${find(nn)}** is already on the list.`);
                        await pool.query(`UPDATE legacy_award_names SET name = $3 WHERE guild_id = $1 AND lower(name) = lower($2)`, [guildId, hit, nn]);
                        // past winners keep their award, under its new name
                        await pool.query(`UPDATE legacy SET award_name = $3 WHERE guild_id = $1 AND kind = 'award' AND lower(award_name) = lower($2)`, [guildId, hit, nn]);
                    }
                }
                await pool.query(`UPDATE guilds SET legacy_names_set = true WHERE guild_id = $1`, [guildId]);
                await logAudit(guildId, interaction.user.id, 'legacy_award_names', { action, name });
            }
            const now = await L.awardNames(guildId);
            const head = action === 'list' ? '**Year-end awards**' : '✅ Saved. **Year-end awards** now:';
            return respond(interaction, { content: `${head}\n${now.length ? now.map((n) => `• ${n}`).join('\n') : '_None. Add one with `action:Add a name`._'}${action === 'remove' ? '\n_Past winners of a removed award keep it._' : ''}`, flags: EPHEMERAL });
        }
    }
};

// 3.9: one command. /legacy is the honor roll; /legacy wrestler: shows one wrestler's accolades.
// Staff give and take back accolades, rename award names and run votes with buttons there.
require('../utils/slim').asScreen(module.exports, {
    description: 'Money in the Bank, Royal Rumble, Face of FNLW MVP and year-end awards: the honor roll and votes',
    options: [
        { type: 3, name: 'wrestler', description: 'One wrestler\'s accolades (leave empty for the honor roll)', required: false, autocomplete: true },
        { type: 6, name: 'player', description: 'Or one player\'s accolades', required: false }
    ],
    screen: (i) => require('../modules/screens').legacyScreen(i),
    autocomplete: async (i) => i.respond(await require('../utils/characterUtils').autocompleteCharacters(i, i.options.getFocused(), { statuses: ['approved', 'retired'] }))
});
