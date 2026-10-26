const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { NO_MENTIONS } = require('./discordHelpers');
const { FINISH_LABEL, CARD_BRANDS, DIVISION_THEME } = require('./constants');

const OPENERS = ['Opening the show,', 'Up next,', 'Then,', 'After that,', 'Later on,', 'Moving on,', 'Next,', 'Following that,', 'Back in the ring,', 'Continuing the night,'];
const MAIN = ['In the main event,', 'Closing the show,', 'The main event saw'];
const FINISH_PHRASE = {
    pinfall: 'by pinfall', submission: 'by submission', dq: 'by disqualification', countout: 'by count-out',
    knockout: 'by knockout', interference: 'after outside interference', escape: 'by escaping', forfeit: 'by forfeit'
};
const ord = (n) => { const v = n % 100; return `${n}${(v >= 11 && v <= 13) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`; };
const pick = (list, seed) => list[Math.abs(Number(seed) || 0) % list.length];
const join = (names) => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`);

async function loadMatches(matchIds) {
    if (!matchIds.length) return new Map();
    const { rows } = await pool.query(
        `SELECT m.id, m.match_type, m.result_type, m.stipulation, m.finish, m.score, m.is_title_match, m.title_effect, m.created_at,
                t.name AS title_name, ct.name AS contender_name,
                (SELECT json_agg(json_build_object('id', mp.character_id, 'name', c.name, 'team', mp.team_number, 'win', mp.is_winner) ORDER BY mp.id)
                   FROM match_participants mp JOIN characters c ON c.id = mp.character_id WHERE mp.match_id = m.id) AS parts
         FROM matches m LEFT JOIN titles t ON t.id = m.title_id LEFT JOIN titles ct ON ct.id = m.contender_title_id
         WHERE m.id = ANY($1::bigint[])`, [matchIds]);
    return new Map(rows.map((r) => [String(r.id), r]));
}

/** How many times these two have met up to and including this match, and the series score (singles only). */
async function seriesInfo(m) {
    if (m.match_type !== 'singles' || (m.parts || []).length !== 2) return null;
    const [a, b] = m.parts;
    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE x.is_winner AND m2.result_type = 'decisive')::int AS a_wins,
                COUNT(*) FILTER (WHERE y.is_winner AND m2.result_type = 'decisive')::int AS b_wins
         FROM match_participants x JOIN match_participants y ON y.match_id = x.match_id AND y.character_id = $2
         JOIN matches m2 ON m2.id = x.match_id
         WHERE x.character_id = $1 AND (m2.created_at < $3 OR m2.id = $4)`, [a.id, b.id, m.created_at, m.id]);
    return { n: rows[0].n, a: { name: a.name, wins: rows[0].a_wins }, b: { name: b.name, wins: rows[0].b_wins } };
}

/** One match as a short paragraph. */
async function describeMatch(m, { position, total }) {
    const parts = m.parts || [];
    const names = (list) => list.map((p) => p.name);
    const stip = m.stipulation ? ` in a ${/match$/i.test(m.stipulation) ? m.stipulation : `${m.stipulation} match`}` : '';
    const how = m.finish && FINISH_PHRASE[m.finish] ? ` ${FINISH_PHRASE[m.finish]}` : '';
    const score = m.score ? ` (${m.score})` : '';
    const lead = position === total && total > 1 ? pick(MAIN, m.id) : position === 1 ? OPENERS[0] : pick(OPENERS.slice(1), m.id + position);
    const eff = m.title_effect;
    const title = m.title_name;
    let line;

    if (m.result_type === 'draw' || m.result_type === 'no_contest') {
        const who = join(names(parts));
        const what = m.result_type === 'draw' ? 'ended in a draw' : 'ended in a no contest';
        line = `${lead} ${who}${stip} ${what}${title ? `, so the ${title} stays where it was` : ''}.`;
    } else {
        const winners = parts.filter((p) => p.win);
        const losers = parts.filter((p) => !p.win);
        const teamMode = parts.some((p) => p.team);
        let body;
        if (teamMode) body = `${join(names(winners))} defeated ${join(names(losers))}`;
        else if (parts.length === 2) body = `${winners[0].name} defeated ${losers[0].name}`;
        else body = `${winners[0].name} won the ${m.match_type === 'triple_threat' ? 'triple threat' : m.match_type === 'fatal4way' ? 'fatal 4-way' : m.match_type === 'fiveway' ? '5-way' : 'match'} over ${join(names(losers))}`;
        let tail = '';
        if (title && eff?.type === 'defense') tail = ` to retain the ${title}`;
        else if (title && eff?.type === 'new_reign') tail = ` to win the vacant ${title}`;
        else if (title && eff?.type === 'title_change') tail = ` to capture the ${title}`;
        else if (title && m.is_title_match) tail = ` in a ${title} match`;
        else if (m.contender_name) tail = ` and earned a shot at the ${m.contender_name}`;
        line = `${lead} ${body}${how}${stip}${score}${tail}.`;
        const s = await seriesInfo(m);
        if (s && s.n >= 2) {
            const lead_ = s.a.wins === s.b.wins ? null : (s.a.wins > s.b.wins ? s.a : s.b);
            const other = lead_ === s.a ? s.b : s.a;
            line += ` It was their ${ord(s.n)} meeting${lead_ ? `, and ${lead_.name} now leads the series ${lead_.wins}-${other.wins}` : ', and the series is tied'}.`;
        }
    }
    return line;
}

/**
 * Builds the written recap for a card. Only matches already logged with /match are included.
 * Returns { embed, count, total } or null when none are logged.
 */
async function buildShowRecap(draft) {
    const { rows: slots } = await pool.query(`SELECT * FROM card_draft_matches WHERE draft_id = $1 ORDER BY position`, [draft.id]);
    const logged = slots.filter((s) => s.match_id);
    if (!logged.length) return null;
    const map = await loadMatches(logged.map((s) => s.match_id));
    const lines = [];
    let titleChanges = 0, defenses = 0;
    for (let i = 0; i < logged.length; i++) {
        const m = map.get(String(logged[i].match_id));
        if (!m) continue;
        if (m.title_effect?.type === 'defense') defenses++;
        if (['new_reign', 'title_change'].includes(m.title_effect?.type)) titleChanges++;
        lines.push(`**${i + 1}.** ${await describeMatch(m, { position: i + 1, total: logged.length })}`);
    }
    const brand = CARD_BRANDS[draft.brand]?.name || draft.brand;
    const div = DIVISION_THEME[draft.division]?.label || draft.division;
    const notes = [];
    if (titleChanges) notes.push(`${titleChanges} title change${titleChanges === 1 ? '' : 's'}`);
    if (defenses) notes.push(`${defenses} successful defense${defenses === 1 ? '' : 's'}`);
    const pending = slots.length - logged.length;
    const embed = new EmbedBuilder().setColor(0xE8BF4A)
        .setTitle(`📰 ${draft.name ? `${draft.name} — ` : ''}${brand} ${div} results`)
        .setDescription(lines.join('\n\n').slice(0, 4000))
        .setFooter({ text: `${logged.length} match${logged.length === 1 ? '' : 'es'}${notes.length ? ` · ${notes.join(' · ')}` : ''}${pending ? ` · ${pending} not logged yet` : ''}` });
    return { embed, count: logged.length, total: slots.length };
}

/**
 * Called after any match is logged. When that was the last match of a card, posts the written recap
 * and the results picture once (matches channel, or where the command was used).
 * Never throws.
 */
async function maybeAutoRecap(interaction, result) {
    try {
        const card = result?.card;
        if (!card) return;
        const { rows: g } = await pool.query(`SELECT auto_recap, matches_channel_id FROM guilds WHERE guild_id = $1`, [interaction.guildId]);
        if (!g[0]?.auto_recap) return;
        const { rows: d } = await pool.query(`SELECT * FROM card_drafts WHERE guild_id = $1 AND brand = $2 AND division = $3`, [interaction.guildId, card.brand, card.division]);
        const draft = d[0];
        if (!draft || draft.recap_posted) return;
        const { rows: open } = await pool.query(`SELECT 1 FROM card_draft_matches WHERE draft_id = $1 AND match_id IS NULL LIMIT 1`, [draft.id]);
        if (open.length) return;
        const { rows: any } = await pool.query(`SELECT 1 FROM card_draft_matches WHERE draft_id = $1 LIMIT 1`, [draft.id]);
        if (!any.length) return;
        const { rowCount } = await pool.query(`UPDATE card_drafts SET recap_posted = true WHERE id = $1 AND recap_posted = false`, [draft.id]);
        if (!rowCount) return;
        const recap = await buildShowRecap(draft);
        if (!recap) return;
        const svc = require('./cardService');
        const { renderShowCard } = require('../cards/showCard');
        const files = [];
        try { files.push(new AttachmentBuilder(await renderShowCard(await svc.buildRecapData(interaction.guild, draft)), { name: 'recap.png' })); } catch (err) { console.error('Auto recap picture failed:', err.message); }
        const channelId = g[0].matches_channel_id || interaction.channelId;
        const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased()) return;
        await channel.send({ content: '🎬 **That\'s a wrap!** Every match on the card is in the books.', embeds: [recap.embed], files, allowedMentions: NO_MENTIONS });
    } catch (err) { console.error('Auto recap failed:', err.message); }
}

module.exports = { buildShowRecap, maybeAutoRecap, describeMatch };
