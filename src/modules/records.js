// /championship records: the record book for a title. Longest and shortest reign, most defenses in one reign,
// and who has held it the most times. Credits the player, with the character when the reign is linked to one.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { respond, NO_MENTIONS } = require('../utils/discordHelpers');
const { autocompleteTitles, requireTitle } = require('../utils/titleLogic');

const data = new SlashCommandBuilder()
    .setName('records')
    .setDescription('Record book for a title: longest and shortest reign, most defenses, most reigns')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('title').setDescription('Title').setRequired(true).setAutocomplete(true));

const DAYS = `(COALESCE(tr.lost_date, CURRENT_DATE) - tr.won_date)::int`;

/** All reigns of a title with who held them (holder label, character(s), players). */
async function reignsOf(titleId) {
    const { rows } = await pool.query(
        `SELECT tr.id, tr.won_date, tr.lost_date, tr.defenses, ${DAYS} AS days,
                COALESCE(tm.name, c.name, tr.reign_char_name, 'Unknown') AS holder, c.name AS character_name,
                (SELECT string_agg(mc.name, ' & ' ORDER BY m.id) FROM title_reign_members m JOIN characters mc ON mc.id = m.character_id WHERE m.reign_id = tr.id) AS member_chars,
                (SELECT array_agg(u.discord_id ORDER BY u.id) FROM reign_owners ro JOIN users u ON u.id = ro.user_id WHERE ro.reign_id = tr.id AND NOT u.is_placeholder) AS players
         FROM title_reigns tr LEFT JOIN characters c ON c.id = tr.character_id LEFT JOIN teams tm ON tm.id = tr.team_id
         WHERE tr.title_id = $1 ORDER BY tr.won_date, tr.id`, [titleId]);
    return rows;
}

/**
 * Singles: "Ace Blackout (@Jimmy)" when the reign is linked to a character, otherwise just "@Jimmy".
 * Tag: "Black Air Force Energy: Bron & Jey (@a & @b)".
 */
function who(r, isTag) {
    const players = (r.players || []).map((p) => `<@${p}>`).join(' & ');
    if (!isTag) {
        if (r.character_name) return `**${r.character_name}**${players ? ` (${players})` : ''}`;
        return players || `**${r.holder}**`;
    }
    const chars = r.member_chars && r.member_chars !== r.holder ? `: ${r.member_chars}` : '';
    return `**${r.holder}**${chars}${players ? ` (${players})` : ''}`;
}
const { shortDate } = require('../utils/historyChannel');
const span = (r) => `${shortDate(r.won_date)} → ${r.lost_date ? shortDate(r.lost_date) : 'now'}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Top `n` rows by a score, keeping ties at the cut. */
function top(rows, score, n = 3) {
    const sorted = [...rows].sort((a, b) => score(b) - score(a));
    if (sorted.length <= n) return sorted;
    const cut = score(sorted[n - 1]);
    return sorted.filter((r, i) => i < n || score(r) === cut).slice(0, n + 2);
}

async function recordsEmbed(title) {
    const rows = await reignsOf(title.id);
    const embed = new EmbedBuilder().setColor(0xE8BF4A).setTitle(`📚 ${title.name}: Record Book`);
    if (!rows.length) return embed.setDescription('No reigns yet, so no records.');

    const longest = top(rows, (r) => r.days);
    embed.addFields({ name: '⏳ Longest reign', value: longest.map((r) => `${who(r, title.is_tag_title)}: **${plural(r.days, 'day')}**${r.lost_date ? '' : ' _(still going)_'}\n${span(r)}`).join('\n') });

    const done = rows.filter((r) => r.lost_date);
    if (done.length) {
        const shortest = top(done, (r) => -r.days);
        embed.addFields({ name: '⚡ Shortest reign', value: shortest.map((r) => `${who(r, title.is_tag_title)}: **${r.days === 0 ? 'less than a day' : plural(r.days, 'day')}**\n${span(r)}`).join('\n') });
    }

    const def = top(rows.filter((r) => r.defenses > 0), (r) => r.defenses);
    embed.addFields({ name: '🛡 Most defenses in one reign', value: def.length ? def.map((r) => `${who(r, title.is_tag_title)}: **${plural(r.defenses, 'defense')}**\n${span(r)}`).join('\n') : '_No defenses yet._' });

    // most reigns: by team name for tag titles, by player otherwise (with the characters they used)
    const groups = new Map();
    for (const r of rows) {
        const key = title.is_tag_title ? `t:${r.holder.toLowerCase()}` : (r.players || []).length ? `p:${[...r.players].sort().join(',')}` : `n:${r.holder.toLowerCase()}`;
        if (!groups.has(key)) groups.set(key, { label: title.is_tag_title || !(r.players || []).length ? `**${r.holder}**` : r.players.map((p) => `<@${p}>`).join(' & '), n: 0, chars: new Set() });
        const g = groups.get(key);
        g.n += 1;
        if (r.character_name && !title.is_tag_title) g.chars.add(r.character_name);
        if (title.is_tag_title && r.players) for (const p of r.players) g.chars.add(`<@${p}>`);
    }
    const most = top([...groups.values()], (g) => g.n);
    embed.addFields({ name: '👑 Most reigns', value: most.map((g) => `${g.label}: **${g.n}x**${g.chars.size ? ` · ${[...g.chars].slice(0, 4).join(', ')}` : ''}`).join('\n') });

    const total = rows.length;
    const daysAll = rows.reduce((a, r) => a + r.days, 0);
    embed.setFooter({ text: `${plural(total, 'reign')} · ${plural(groups.size, title.is_tag_title ? 'team' : 'champion')} · ${daysAll} days of history` });
    return embed;
}

module.exports = {
    data,
    recordsEmbed,
    async autocomplete(interaction) {
        return interaction.respond(await autocompleteTitles(interaction, interaction.options.getFocused()));
    },
    async execute(interaction) {
        const title = await requireTitle(interaction.guildId, interaction.options.getString('title'));
        return respond(interaction, { embeds: [await recordsEmbed(title)], allowedMentions: NO_MENTIONS });
    }
};
