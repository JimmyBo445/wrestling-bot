// /directory list: the whole roster as plain text (no pictures), A to Z or grouped by player.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { respond, NO_MENTIONS, DIVISION_LABELS } = require('../utils/discordHelpers');
const { rosterRows, currentTitles, activeTeams } = require('../utils/rosterInfo');
const { UserError } = require('../utils/errors');

const DIVISION_CHOICES = Object.entries(DIVISION_LABELS).map(([value, name]) => ({ name, value }));
const DIV_ORDER = Object.keys(DIVISION_LABELS);
const COLORS = { mens: 0x2E86C1, womens: 0xC2185B, custom: 0xE67E22, custom_womens: 0x8E44AD };
const MAX_DESC = 3900, MAX_MSG = 5800;

const data = new SlashCommandBuilder()
    .setName('list')
    .setDescription('The whole roster as a text list (no pictures): who plays who')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('division').setDescription('Just one division (default: all)').setRequired(false).addChoices(...DIVISION_CHOICES))
    .addStringOption((o) => o.setName('sort').setDescription('How to list it (default: wrestlers A to Z)').setRequired(false)
        .addChoices({ name: 'Wrestlers A to Z', value: 'wrestler' }, { name: 'Grouped by player', value: 'player' }))
    .addBooleanOption((o) => o.setName('include_retired').setDescription('Also list retired wrestlers (default: no)').setRequired(false));

/** Splits lines into embed-sized pieces. */
function chunk(lines, max = MAX_DESC) {
    const out = [];
    let cur = '';
    for (const l of lines) {
        if (cur && cur.length + l.length + 1 > max) { out.push(cur); cur = ''; }
        cur = cur ? `${cur}\n${l}` : l;
    }
    if (cur) out.push(cur);
    return out;
}

/** Builds the embeds for the list. Exported for tests. */
async function buildRosterList(guildId, { division = null, sort = 'wrestler', includeRetired = false } = {}) {
    const rows = await rosterRows(guildId, { statuses: includeRetired ? ['approved', 'retired'] : ['approved'], division });
    if (!rows.length) throw new UserError(division ? `There are no ${includeRetired ? '' : 'active '}wrestlers in the ${DIVISION_LABELS[division]} division yet.` : 'There are no wrestlers yet.');
    const [titles, teams] = await Promise.all([currentTitles(guildId), activeTeams(guildId)]);
    const mark = (c) => `${titles.has(String(c.id)) ? ' 🏆' : ''}${c.status === 'retired' ? ' _(retired)_' : ''}`;
    const who = (c) => (c.unclaimed ? '_unclaimed_' : `<@${c.discord_id}>`);
    const embeds = [];

    if (sort === 'player') {
        // one line per player: their wrestlers, A to Z
        const byPlayer = new Map();
        for (const c of rows) {
            const key = c.unclaimed ? 'unclaimed' : c.discord_id;
            if (!byPlayer.has(key)) byPlayer.set(key, []);
            byPlayer.get(key).push(c);
        }
        const players = [...byPlayer.entries()].sort(([a, ca], [b, cb]) => (a === 'unclaimed') - (b === 'unclaimed') || ca[0].name.localeCompare(cb[0].name));
        const lines = players.map(([key, cs]) => `${key === 'unclaimed' ? '**Unclaimed**' : `<@${key}>`} (${cs.length}): ${cs.map((c) => `${c.name}${division ? '' : ` _${DIVISION_LABELS[c.division]}_`}${mark(c)}`).join(', ')}`);
        const pages = chunk(lines);
        pages.forEach((p, i) => embeds.push(new EmbedBuilder().setColor(division ? COLORS[division] : 0xC0392B)
            .setTitle(`${division ? `${DIVISION_LABELS[division]} roster` : 'Roster'} by player${pages.length > 1 ? ` (${i + 1}/${pages.length})` : ''}`)
            .setDescription(p)));
    } else {
        // one section per division: wrestler — player
        for (const div of DIV_ORDER) {
            const cs = rows.filter((c) => c.division === div);
            if (!cs.length) continue;
            const lines = cs.map((c) => {
                const team = teams.get(String(c.id));
                return `**${c.name}** · ${who(c)}${mark(c)}${team ? ` · _${team.join(', ')}_` : ''}`;
            });
            const pages = chunk(lines);
            pages.forEach((p, i) => embeds.push(new EmbedBuilder().setColor(COLORS[div])
                .setTitle(`${DIVISION_LABELS[div]} (${cs.length})${pages.length > 1 ? ` ${i + 1}/${pages.length}` : ''}`)
                .setDescription(p)));
        }
    }
    const players = new Set(rows.filter((c) => !c.unclaimed).map((c) => c.discord_id)).size;
    embeds[embeds.length - 1].setFooter({ text: `${rows.length} wrestler${rows.length === 1 ? '' : 's'} · ${players} player${players === 1 ? '' : 's'} · 🏆 = current champion · /whois for one wrestler · /directory roster for pictures` });
    return embeds;
}

/** Groups embeds into messages that fit Discord's limits (10 embeds, about 6000 characters each). */
function toMessages(embeds) {
    const msgs = [];
    let cur = [], size = 0;
    for (const e of embeds) {
        const n = (e.data.title || '').length + (e.data.description || '').length + (e.data.footer?.text || '').length;
        if (cur.length && (cur.length >= 10 || size + n > MAX_MSG)) { msgs.push(cur); cur = []; size = 0; }
        cur.push(e); size += n;
    }
    if (cur.length) msgs.push(cur);
    return msgs;
}

module.exports = {
    data,
    buildRosterList,
    toMessages,

    async execute(interaction) {
        const embeds = await buildRosterList(interaction.guildId, {
            division: interaction.options.getString('division'),
            sort: interaction.options.getString('sort') || 'wrestler',
            includeRetired: interaction.options.getBoolean('include_retired') || false
        });
        const [first, ...rest] = toMessages(embeds);
        await respond(interaction, { embeds: first, allowedMentions: NO_MENTIONS });
        for (const m of rest) await interaction.followUp({ embeds: m, allowedMentions: NO_MENTIONS });
    }
};
