const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { autocompleteCharacters, requireCharacter } = require('../utils/characterUtils');
const { requireAdmin, respond, getDisplayNames, DIVISION_LABELS, NO_MENTIONS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { logAudit } = require('../utils/audit');
const cu = require('../utils/contractUtils');
const { renderContractCard } = require('../cards/contractCard');

const charOpt = (o, desc = 'Wrestler') => o.setName('character').setDescription(desc).setRequired(true).setAutocomplete(true);
const termOpts = (s) => s
    .addIntegerOption((o) => o.setName('months').setDescription('Length in months (1-36)').setRequired(true).setMinValue(1).setMaxValue(36))
    .addIntegerOption((o) => o.setName('salary').setDescription('Pay per month, in dollars').setRequired(true).setMinValue(0).setMaxValue(1000000000));
const clauseOpt = (o) => o.setName('clauses').setDescription('Special terms, e.g. "Main event guarantee"').setRequired(false).setMaxLength(150);
const DIVS = [["Men's", 'mens'], ["Women's", 'womens'], ['Customs', 'custom'], ["Custom Women's", 'custom_womens']].map(([name, value]) => ({ name, value }));

const data = new SlashCommandBuilder()
    .setName('contract')
    .setDescription('Contracts and earnings (just for fun, they never affect booking)')
    .setDMPermission(false)
    .addSubcommand((s) => termOpts(s.setName('offer').setDescription('[Admin] Offer a wrestler a contract; their owner accepts with a button')
        .addStringOption((o) => charOpt(o)))
        .addStringOption(clauseOpt))
    .addSubcommand((s) => s.setName('view').setDescription('Show a wrestler\'s contract and career earnings').addStringOption((o) => charOpt(o)))
    .addSubcommand((s) => termOpts(s.setName('request').setDescription('Ask for a new deal or a raise for your wrestler (an admin approves)')
        .addStringOption((o) => charOpt(o, 'Your wrestler')))
        .addStringOption(clauseOpt))
    .addSubcommand((s) => s.setName('release').setDescription('[Admin] End a wrestler\'s contract now').addStringOption((o) => charOpt(o)))
    .addSubcommand((s) => s.setName('list').setDescription('Wrestlers under contract')
        .addBooleanOption((o) => o.setName('ending_soon').setDescription('Only contracts ending in the next 30 days').setRequired(false))
        .addStringOption((o) => o.setName('division').setDescription('Only one division').setRequired(false).addChoices(...DIVS)))
    .addSubcommand((s) => s.setName('free-agents').setDescription('Approved wrestlers with no contract')
        .addStringOption((o) => o.setName('division').setDescription('Only one division').setRequired(false).addChoices(...DIVS)))
    .addSubcommand((s) => s.setName('earnings').setDescription('Career earnings leaderboard')
        .addStringOption((o) => o.setName('division').setDescription('Only one division').setRequired(false).addChoices(...DIVS)))
    .addSubcommand((s) => s.setName('bonuses').setDescription('[Admin] See or change the bonus paid per win and per title-match win')
        .addIntegerOption((o) => o.setName('win').setDescription('Dollars per match win').setRequired(false).setMinValue(0).setMaxValue(100000000))
        .addIntegerOption((o) => o.setName('title_win').setDescription('Extra dollars for winning a title match').setRequired(false).setMinValue(0).setMaxValue(100000000)));

const offerButtons = (id, kind) => [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`contract:${kind === 'offered' ? 'accept' : 'approve'}:${id}`).setLabel(kind === 'offered' ? 'Accept & sign' : 'Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`contract:${kind === 'offered' ? 'decline' : 'reject'}:${id}`).setLabel(kind === 'offered' ? 'Decline' : 'Reject').setStyle(ButtonStyle.Danger))];

async function cardFor(guild, k, { withEarnings = false } = {}) {
    const names = await getDisplayNames(guild, [k.owner_discord_id], 2500);
    let earnings = null;
    if (withEarnings) {
        const e = (await cu.earningsMap(k.guild_id, { characterId: k.character_id })).get(String(k.character_id));
        earnings = e ? cu.money(e.total) : cu.money(0);
    }
    return new AttachmentBuilder(await renderContractCard({
        serverName: guild?.name || null,
        character: { name: k.char_name, division: k.division, imageUrl: k.image_url },
        ownerName: names.get(k.owner_discord_id) || 'unknown',
        months: k.months, salary: `${cu.money(k.salary)}/mo`,
        start: k.start_date ? cu.prettyDate(k.start_date) : 'on signing', end: k.end_date ? cu.prettyDate(k.end_date) : '—',
        clauses: k.clauses, status: k.status === 'offered' || k.status === 'requested' ? 'pending' : k.status, earnings
    }), { name: 'contract.png' });
}

const termText = (k) => `**${k.months} month${k.months === 1 ? '' : 's'}** at **${cu.money(k.salary)}/month**${k.clauses ? `\n_Clauses: ${k.clauses}_` : ''}`;

module.exports = {
    data, cardFor, offerButtons,

    async autocomplete(interaction) {
        return interaction.respond(await autocompleteCharacters(interaction, interaction.options.getFocused()));
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'offer' || sub === 'request') {
            const offer = sub === 'offer';
            if (offer) requireAdmin(interaction, 'offer contracts');
            const c = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved'] });
            if (!offer && c.owner_discord_id !== interaction.user.id) throw new UserError('You can only ask for a contract for your own wrestlers.');
            const months = interaction.options.getInteger('months'), salary = interaction.options.getInteger('salary');
            const clauses = interaction.options.getString('clauses')?.trim() || null;
            // a newer offer/request replaces anything still waiting for this wrestler
            await pool.query(`UPDATE contracts SET status = 'withdrawn' WHERE character_id = $1 AND status IN ('offered','requested')`, [c.id]);
            const { rows } = await pool.query(
                `INSERT INTO contracts (guild_id, character_id, months, salary, clauses, status, offered_by, requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
                [guildId, c.id, months, salary, clauses, offer ? 'offered' : 'requested', offer ? interaction.user.id : null, offer ? null : interaction.user.id]);
            const k = await cu.getContract(rows[0].id, guildId);
            await interaction.deferReply();
            const existing = await cu.getActive(c.id);
            const embed = new EmbedBuilder().setColor(0xE8BF4A)
                .setTitle(offer ? `📝 Contract offer for ${c.name}` : `🙋 ${c.name} is asking for a new deal`)
                .setDescription(`${termText(k)}\n\n${offer ? `<@${c.owner_discord_id}>, press **Accept & sign** to take the deal, or **Decline**.` : 'An admin can **Approve** it, or answer with a different `/contract offer`.'}${existing ? `\n_This would replace their current deal (${cu.money(existing.salary)}/month, ends ${cu.prettyDate(existing.end_date)})._` : ''}`);
            await logAudit(guildId, interaction.user.id, offer ? 'contract_offer' : 'contract_request', { character: c.name, months, salary });
            return respond(interaction, {
                content: offer ? `<@${c.owner_discord_id}>` : undefined, embeds: [embed], components: offerButtons(k.id, offer ? 'offered' : 'requested'),
                allowedMentions: offer ? { users: [c.owner_discord_id] } : NO_MENTIONS
            });
        }

        if (sub === 'view') {
            const c = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved', 'retired'] });
            await interaction.deferReply();
            const { rows } = await pool.query(`SELECT id FROM contracts WHERE character_id = $1 AND status IN ('active','expired') ORDER BY (status = 'active') DESC, id DESC LIMIT 1`, [c.id]);
            const earn = (await cu.earningsMap(guildId, { characterId: c.id })).get(String(c.id));
            if (!rows.length) {
                return respond(interaction, { content: `**${c.name}** has no contract${earn ? '' : ' and has never had one'}. Contracts are just for fun, so that's perfectly fine. An admin can offer one with \`/contract offer\`.${earn ? `\nCareer earnings: **${cu.money(earn.total)}**` : ''}` });
            }
            const k = await cu.getContract(rows[0].id, guildId);
            const embed = new EmbedBuilder().setColor(0xE8BF4A).setTitle(`📝 ${c.name}'s contract${k.status === 'expired' ? ' (expired)' : ''}`)
                .setDescription(termText(k)).setImage('attachment://contract.png');
            if (earn) embed.addFields({ name: 'Career earnings', value: `**${cu.money(earn.total)}**\nSalary ${cu.money(earn.salary)} · ${earn.wins} win${earn.wins === 1 ? '' : 's'} × ${cu.money(earn.winBonus)} · ${earn.titleWins} title win${earn.titleWins === 1 ? '' : 's'} × ${cu.money(earn.titleBonus)} extra` });
            return respond(interaction, { embeds: [embed], files: [await cardFor(interaction.guild, k, { withEarnings: true })] });
        }

        if (sub === 'release') {
            requireAdmin(interaction, 'release contracts');
            const c = await requireCharacter(guildId, interaction.options.getString('character'), { statuses: ['approved', 'retired'] });
            const today = await cu.todayFor(guildId);
            const { rowCount } = await pool.query(`UPDATE contracts SET status = 'released', end_date = $2::date WHERE character_id = $1 AND status = 'active'`, [c.id, today]);
            if (!rowCount) throw new UserError(`${c.name} has no active contract.`);
            await logAudit(guildId, interaction.user.id, 'contract_release', { character: c.name });
            return respond(interaction, { content: `**${c.name}** has been released from their contract and is now a free agent. Earnings so far are kept.` });
        }

        if (sub === 'bonuses') {
            const win = interaction.options.getInteger('win'), tw = interaction.options.getInteger('title_win');
            if (win !== null || tw !== null) {
                requireAdmin(interaction, 'change bonuses');
                await pool.query(`UPDATE guilds SET contract_win_bonus = COALESCE($2, contract_win_bonus), contract_title_bonus = COALESCE($3, contract_title_bonus) WHERE guild_id = $1`, [guildId, win, tw]);
            }
            const { rows } = await pool.query(`SELECT contract_win_bonus AS w, contract_title_bonus AS t FROM guilds WHERE guild_id = $1`, [guildId]);
            return respond(interaction, { content: `${win !== null || tw !== null ? '✅ Updated. ' : ''}Wrestlers under contract earn **${cu.money(rows[0].w)}** per match win and **${cu.money(rows[0].t)}** extra for winning a title match, on top of their monthly salary.`, flags: 64 });
        }

        if (sub === 'list' || sub === 'free-agents' || sub === 'earnings') {
            const division = interaction.options.getString('division');
            await interaction.deferReply();
            if (sub === 'list') {
                const soon = interaction.options.getBoolean('ending_soon');
                const today = await cu.todayFor(guildId);
                const { rows } = await pool.query(
                    `SELECT k.salary, k.end_date, k.character_id, c.name, c.division, u.discord_id
                     FROM contracts k JOIN characters c ON c.id = k.character_id JOIN users u ON u.id = c.owner_id
                     WHERE k.guild_id = $1 AND k.status = 'active' AND ($2::text IS NULL OR c.division = $2)
                       AND (NOT $3::boolean OR k.end_date <= $4::date + 30)
                     ORDER BY k.salary DESC, c.name LIMIT 40`, [guildId, division, Boolean(soon), today]);
                if (!rows.length) return respond(interaction, { content: soon ? 'No contracts end in the next 30 days.' : 'Nobody is under contract yet. Admins can start with `/contract offer`.' });
                const lines = rows.map((r) => `**${r.name}** (<@${r.discord_id}>) · ${cu.money(r.salary)}/mo · ends ${cu.prettyDate(r.end_date)}`);
                return respond(interaction, { embeds: [new EmbedBuilder().setColor(0xE8BF4A).setTitle(soon ? '📝 Contracts ending soon' : '📝 Under contract').setDescription(lines.join('\n').slice(0, 4000))], allowedMentions: NO_MENTIONS });
            }
            if (sub === 'free-agents') {
                const { rows } = await pool.query(
                    `SELECT c.name, c.division, u.discord_id FROM characters c JOIN users u ON u.id = c.owner_id
                     WHERE c.guild_id = $1 AND c.status = 'approved' AND ($2::text IS NULL OR c.division = $2)
                       AND NOT EXISTS (SELECT 1 FROM contracts k WHERE k.character_id = c.id AND k.status = 'active')
                     ORDER BY c.division, c.name LIMIT 60`, [guildId, division]);
                if (!rows.length) return respond(interaction, { content: 'Everyone is under contract.' });
                const lines = rows.map((r) => `**${r.name}** (<@${r.discord_id}>)${division ? '' : ` · ${DIVISION_LABELS[r.division]}`}`);
                return respond(interaction, { embeds: [new EmbedBuilder().setColor(0x95A5A6).setTitle('🆓 Free agents').setDescription(lines.join('\n').slice(0, 4000)).setFooter({ text: 'Contracts are optional: free agents wrestle like anyone else' })], allowedMentions: NO_MENTIONS });
            }
            const map = await cu.earningsMap(guildId);
            const ids = [...map.keys()];
            if (!ids.length) return respond(interaction, { content: 'Nobody has earned anything yet. Sign someone with `/contract offer`.' });
            const { rows } = await pool.query(`SELECT c.id, c.name, c.division, u.discord_id FROM characters c JOIN users u ON u.id = c.owner_id WHERE c.id = ANY($1::bigint[]) AND ($2::text IS NULL OR c.division = $2)`, [ids, division]);
            const ranked = rows.map((r) => ({ ...r, total: map.get(String(r.id)).total })).sort((a, b) => b.total - a.total).slice(0, 15);
            if (!ranked.length) return respond(interaction, { content: 'Nobody in that division has earned anything yet.' });
            const medals = ['🥇', '🥈', '🥉'];
            const lines = ranked.map((r, i) => `${medals[i] || `**${i + 1}.**`} **${r.name}** (<@${r.discord_id}>) — ${cu.money(r.total)}`);
            return respond(interaction, { embeds: [new EmbedBuilder().setColor(0x2ECC71).setTitle('💰 Career earnings').setDescription(lines.join('\n')).setFooter({ text: 'Salary while under contract + bonuses for wins and title-match wins' })], allowedMentions: NO_MENTIONS });
        }
    }
};
