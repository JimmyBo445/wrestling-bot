// /championship panel: a title's belt card with buttons. Everyone gets History / Defenses / Lineage;
// admins also get Log match, Set contender, Clear contender and Vacate.
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, AttachmentBuilder } = require('discord.js');
const { pool, withTransaction } = require('../db/pool');
const { autocompleteTitles, requireTitle, getCurrentReign, reignHolderName, vacateTitle } = require('../utils/titleLogic');
const { setContender } = require('../utils/contenderLogic');
const { requireTeam, getTeamMembers } = require('../utils/teamUtils');
const { renderBeltCard, renderLineageCard } = require('../utils/cardRenderer');
const { buildBeltData, buildLineageData } = require('../utils/cardData');
const { isAdmin, respond, EPHEMERAL, NO_MENTIONS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { logAudit } = require('../utils/audit');
const champ = require('./championship');
const extras = require('./titleExtras');

const PAGE = 25;
const btn = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);

const data = new SlashCommandBuilder()
    .setName('title-panel')
    .setDescription("A title's belt with buttons for history, defenses and (admins) quick actions")
    .setDMPermission(false)
    .addStringOption((o) => o.setName('title').setDescription('Title').setRequired(true).setAutocomplete(true));

async function buildPanel(guild, title, admin) {
    const buffer = await renderBeltCard(await buildBeltData(guild, title));
    const rows = [new ActionRowBuilder().addComponents(
        btn(`chmp:hist:${title.id}`, '📜 History'), btn(`chmp:def:${title.id}`, '🛡 Defenses'), btn(`chmp:lin:${title.id}`, '🕰 Lineage'))];
    if (admin) {
        rows.push(new ActionRowBuilder().addComponents(
            btn(`chmp:log:${title.id}`, '🎬 Log match', ButtonStyle.Primary),
            btn(`chmp:sc:${title.id}`, '🎯 Set contender', ButtonStyle.Secondary),
            btn(`chmp:cc:${title.id}`, '✖ Clear contender', ButtonStyle.Secondary),
            btn(`chmp:vac:${title.id}`, '🚫 Vacate', ButtonStyle.Danger)));
    }
    return { content: `**${title.name}**`, files: [new AttachmentBuilder(buffer, { name: 'belt.png' })], components: rows, embeds: [], allowedMentions: NO_MENTIONS };
}

/** Who can be picked: challengers (everyone but the champion) for singles, 2-member teams for tag titles. */
async function candidates(title, page, { excludeChampion = true } = {}) {
    const reign = await getCurrentReign(title.id);
    let list;
    if (title.is_tag_title) {
        const { rows } = await pool.query(
            `SELECT t.id, t.name FROM teams t WHERE t.guild_id = $1 AND t.division = $2 AND t.status = 'active'
               AND (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id AND tm.left_at IS NULL) = 2
             ORDER BY t.name`, [title.guild_id, title.division]);
        list = rows.filter((r) => !(excludeChampion && reign?.team_id && String(reign.team_id) === String(r.id)));
    } else {
        const { rows } = await pool.query(
            `SELECT c.id, c.name FROM characters c JOIN users u ON u.id = c.owner_id
             WHERE c.guild_id = $1 AND c.division = $2 AND c.status = 'approved' AND NOT u.is_placeholder ORDER BY c.name`, [title.guild_id, title.division]);
        list = rows.filter((r) => !(excludeChampion && reign?.character_id && String(reign.character_id) === String(r.id)));
    }
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    const pg = Math.min(Math.max(0, page), pages - 1);
    return { items: list.slice(pg * PAGE, (pg + 1) * PAGE), page: pg, pages, total: list.length };
}

async function picker(title, kind, page, intro) {
    const c = await candidates(title, page);
    if (!c.total) return { content: `${intro}\n\nThere is nobody eligible to pick (${title.is_tag_title ? 'no registered 2-member teams in this division' : 'no other wrestlers in this division'}).`, components: [], files: [], embeds: [] };
    const sel = new StringSelectMenuBuilder().setCustomId(`chmp:${kind === 'log' ? 'lc' : 'sp'}:${title.id}`).setPlaceholder(`${title.is_tag_title ? 'Pick a team' : 'Pick a wrestler'} (page ${c.page + 1}/${c.pages})`)
        .addOptions(c.items.map((x) => ({ label: x.name.slice(0, 100), value: String(x.id) })));
    const rows = [new ActionRowBuilder().addComponents(sel)];
    if (c.pages > 1) rows.push(new ActionRowBuilder().addComponents(
        btn(`chmp:pg:${kind}:${title.id}:${c.page - 1}`, '◀ Previous', ButtonStyle.Secondary, c.page === 0),
        btn(`chmp:pg:${kind}:${title.id}:${c.page + 1}`, 'Next ▶', ButtonStyle.Secondary, c.page >= c.pages - 1)));
    return { content: intro, components: rows, files: [], embeds: [] };
}

/** Pretends to be a slash command so the normal title-match logging can run from a button. */
function asCommand(interaction, values) {
    const options = { getString: (n) => (values[n] !== undefined ? String(values[n]) : null), getInteger: (n) => (values[n] !== undefined ? Number(values[n]) : null), getBoolean: () => null, getAttachment: () => null };
    return new Proxy(interaction, { get(t, p) { if (p === 'options') return options; const v = Reflect.get(t, p, t); return typeof v === 'function' ? v.bind(t) : v; } });
}

async function nameOf(title, value) {
    if (title.is_tag_title) return (await requireTeam(title.guild_id, value)).name;
    const { rows } = await pool.query(`SELECT name FROM characters WHERE id = $1`, [value]);
    return rows[0]?.name || 'them';
}

/** Handles every chmp: button and dropdown. */
async function handleComponent(interaction) {
    const [, act, tid, a, b] = interaction.customId.split(':');
    const guildId = interaction.guildId;
    try {
        if (!['hist', 'def', 'lin'].includes(act) && !isAdmin(interaction)) {
            return await respond(interaction, { content: 'Only admins/mods (Manage Server) can use that button.', flags: EPHEMERAL });
        }
        if (act === 'x') { await interaction.deferUpdate(); return await interaction.editReply({ content: 'Cancelled.', components: [] }); }
        const title = await requireTitle(guildId, act === 'pg' ? a : tid);
        if (act === 'hist' || act === 'def' || act === 'lin') {
            await interaction.deferReply({ flags: EPHEMERAL });
            if (act === 'lin') {
                const buf = await renderLineageCard(await buildLineageData(interaction.guild, title));
                return await interaction.editReply({ files: [new AttachmentBuilder(buf, { name: 'lineage.png' })] });
            }
            const embed = act === 'def' ? await champ.defensesEmbed(title) : await champ.historyEmbed(title);
            return await interaction.editReply(embed ? { embeds: [embed], allowedMentions: NO_MENTIONS } : { content: `No reign history for the **${title.name}** yet.` });
        }
        if (act === 'log' || act === 'sc') {
            await interaction.deferReply({ flags: EPHEMERAL });
            if (act === 'log') {
                const reign = await getCurrentReign(title.id);
                if (!reign) return await interaction.editReply({ content: `The **${title.name}** is vacant. Use \`/title match\` and fill in the \`opponent\` too.` });
                return await interaction.editReply(await picker(title, 'log', 0, `Who is challenging **${reignHolderName(reign)}** for the **${title.name}**?`));
            }
            return await interaction.editReply(await picker(title, 'sc', 0, `Who is the new #1 contender for the **${title.name}**?`));
        }
        if (act === 'pg') {
            await interaction.deferUpdate();
            const kind = tid;
            const reign = await getCurrentReign(title.id);
            const intro = kind === 'log' ? `Who is challenging **${reign ? reignHolderName(reign) : 'the champion'}** for the **${title.name}**?` : `Who is the new #1 contender for the **${title.name}**?`;
            return await interaction.editReply(await picker(title, kind, Number(b), intro));
        }
        if (act === 'lc') {
            await interaction.deferUpdate();
            const chId = interaction.values[0];
            const reign = await getCurrentReign(title.id);
            const name = await nameOf(title, chId);
            return await interaction.editReply({
                content: `**${name}** challenges for the **${title.name}**. Who won?`,
                components: [new ActionRowBuilder().addComponents(
                    btn(`chmp:lw:${title.id}:${chId}:1`, `🏆 ${reign ? reignHolderName(reign).slice(0, 60) : 'Champion'} retains`, ButtonStyle.Success),
                    btn(`chmp:lw:${title.id}:${chId}:2`, `🥇 ${name.slice(0, 60)} wins`, ButtonStyle.Primary),
                    btn('chmp:x:0', 'Cancel'))]
            });
        }
        if (act === 'lw') {
            // the result is posted publicly, like /title match
            const fake = asCommand(interaction, { title: title.id, challenger: a, winner: b });
            return await extras.logTitleMatch(fake);
        }
        if (act === 'sp') {
            await interaction.deferUpdate();
            const id = interaction.values[0];
            const subject = title.is_tag_title ? { type: 'team', id } : { type: 'character', id };
            const division = title.is_tag_title ? (await requireTeam(guildId, id)).division : (await pool.query(`SELECT division FROM characters WHERE id = $1`, [id])).rows[0]?.division;
            const name = await nameOf(title, id);
            await withTransaction((client) => setContender(client, { guildId, title, subject, subjectDivision: division, earnedVia: 'admin_award', awardedBy: interaction.user.id }));
            await logAudit(guildId, interaction.user.id, 'contender_awarded', { title: title.name, who: name });
            return await interaction.editReply({ content: `🎯 **${name}** is now the #1 contender for the **${title.name}**.`, components: [] });
        }
        if (act === 'cc') {
            await interaction.deferReply({ flags: EPHEMERAL });
            const { rowCount } = await pool.query(`UPDATE contenders SET status = 'revoked', resolved_at = now() WHERE title_id = $1 AND status = 'active'`, [title.id]);
            if (!rowCount) throw new UserError(`The **${title.name}** has no #1 contender right now.`);
            await logAudit(guildId, interaction.user.id, 'contender_revoked', { title: title.name });
            return await interaction.editReply({ content: `Removed the #1 contender for the **${title.name}**.` });
        }
        if (act === 'vac') {
            await interaction.deferReply({ flags: EPHEMERAL });
            const reign = await getCurrentReign(title.id);
            if (!reign) return await interaction.editReply({ content: `The **${title.name}** is already vacant.` });
            return await interaction.editReply({
                content: `Vacate the **${title.name}**? **${reignHolderName(reign)}**'s reign will end today.`,
                components: [new ActionRowBuilder().addComponents(btn(`chmp:vacy:${title.id}`, 'Yes, vacate it', ButtonStyle.Danger), btn('chmp:x:0', 'Cancel'))]
            });
        }
        if (act === 'vacy') {
            await interaction.deferUpdate();
            const ended = await withTransaction((client) => vacateTitle(client, title.id));
            if (!ended) return await interaction.editReply({ content: `The **${title.name}** is already vacant.`, components: [] });
            await logAudit(guildId, interaction.user.id, 'title_vacated', { title: title.name, holder: reignHolderName(ended) });
            return await interaction.editReply({ content: `The **${title.name}** is now vacant. **${reignHolderName(ended)}**'s reign ended after ${champ.daysBetween(ended.won_date)} days.`, components: [] });
        }
    } catch (err) {
        const known = err instanceof UserError;
        if (!known) console.error('Title panel button failed:', err);
        const msg = { content: known ? `⚠️ ${err.message}` : '⚠️ Something went wrong on my side. Please try again.', flags: EPHEMERAL };
        return (interaction.deferred || interaction.replied ? interaction.followUp(msg) : respond(interaction, msg)).catch(() => {});
    }
}

module.exports = {
    data, buildPanel, handleComponent,

    async autocomplete(interaction) {
        return interaction.respond(await autocompleteTitles(interaction, interaction.options.getFocused()));
    },

    async execute(interaction) {
        const title = await requireTitle(interaction.guildId, interaction.options.getString('title'));
        await interaction.deferReply();
        return interaction.editReply(await buildPanel(interaction.guild, title, isAdmin(interaction)));
    }
};
