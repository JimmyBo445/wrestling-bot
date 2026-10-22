const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { pool, withTransaction } = require('../db/pool');
const { UserError } = require('./errors');
const { matchLabel } = require('./constants');

/** "A vs B" style names for a list of match ids, keyed by id. */
async function matchNames(matchIds) {
    const { rows } = await pool.query(
        `SELECT m.id, m.match_type, m.stipulation, m.is_title_match,
                (SELECT string_agg(c.name, ' vs ' ORDER BY mp.id) FROM match_participants mp JOIN characters c ON c.id = mp.character_id WHERE mp.match_id = m.id) AS names
         FROM matches m WHERE m.id = ANY($1::bigint[])`, [matchIds]);
    const map = new Map();
    for (const r of rows) map.set(String(r.id), r);
    return map;
}

const shortNames = (r) => (r?.names || 'Match').slice(0, 70);

async function pollTally(pollId) {
    const { rows } = await pool.query(`SELECT match_id, COUNT(*)::int AS n FROM motn_votes WHERE poll_id = $1 GROUP BY match_id`, [pollId]);
    return new Map(rows.map((r) => [String(r.match_id), r.n]));
}

async function buildPollMessage(poll, { showCounts = false } = {}) {
    const names = await matchNames(poll.match_ids);
    const tally = await pollTally(poll.id);
    const total = [...tally.values()].reduce((a, b) => a + b, 0);
    const lines = poll.match_ids.map((id, i) => {
        const r = names.get(String(id));
        const votes = tally.get(String(id)) || 0;
        return `**${i + 1}.** ${shortNames(r)}${r?.is_title_match ? ' 🏆' : ''}${r?.stipulation ? ` _(${r.stipulation})_` : ''}${showCounts ? ` — **${votes}** vote${votes === 1 ? '' : 's'}` : ''}`;
    });
    const embed = new EmbedBuilder().setColor(0xE8BF4A)
        .setTitle(poll.status === 'open' ? '⭐ Match of the Night — vote now!' : '⭐ Match of the Night — final')
        .setDescription(lines.join('\n'))
        .setFooter({ text: poll.status === 'open' ? `${total} vote${total === 1 ? '' : 's'} so far · you can change your vote by clicking another match` : `${total} votes` });
    const rows = [];
    if (poll.status === 'open') {
        for (let i = 0; i < poll.match_ids.length; i += 5) {
            rows.push(new ActionRowBuilder().addComponents(poll.match_ids.slice(i, i + 5).map((id, j) =>
                new ButtonBuilder().setCustomId(`motn:${poll.id}:${id}`).setLabel(`${i + j + 1}`).setStyle(ButtonStyle.Primary))));
        }
    }
    return { embeds: [embed], components: rows };
}

async function createPoll(guildId, matchIds, actor) {
    if (matchIds.length < 2) throw new UserError('A vote needs at least 2 logged matches. Log the card\'s results with `/match` first.');
    const { rows } = await pool.query(
        `INSERT INTO motn_polls (guild_id, match_ids, created_by) VALUES ($1, $2, $3) RETURNING *`, [guildId, matchIds, actor]);
    return rows[0];
}

async function castVote(pollId, guildId, userId, matchId) {
    const { rows } = await pool.query(`SELECT * FROM motn_polls WHERE id = $1 AND guild_id = $2`, [pollId, guildId]);
    const poll = rows[0];
    if (!poll) throw new UserError('That vote no longer exists.');
    if (poll.status !== 'open') throw new UserError('Voting on that one is closed.');
    if (!poll.match_ids.map(String).includes(String(matchId))) throw new UserError('That match isn\'t part of this vote.');
    await pool.query(
        `INSERT INTO motn_votes (poll_id, user_id, match_id) VALUES ($1,$2,$3)
         ON CONFLICT (poll_id, user_id) DO UPDATE SET match_id = EXCLUDED.match_id`, [pollId, userId, matchId]);
    return poll;
}

/** Closes a poll and returns { poll, winners:[matchId], tally }. Ties keep every tied match. */
async function closePoll(guildId, pollId = null) {
    return withTransaction(async (client) => {
        const { rows } = await client.query(
            `SELECT * FROM motn_polls WHERE guild_id = $1 AND status = 'open' AND ($2::bigint IS NULL OR id = $2) ORDER BY id DESC LIMIT 1 FOR UPDATE`, [guildId, pollId]);
        const poll = rows[0];
        if (!poll) throw new UserError('There is no open Match of the Night vote.');
        const { rows: t } = await client.query(`SELECT match_id, COUNT(*)::int AS n FROM motn_votes WHERE poll_id = $1 GROUP BY match_id ORDER BY n DESC`, [poll.id]);
        const top = t.length ? t[0].n : 0;
        const winners = t.filter((r) => r.n === top).map((r) => String(r.match_id));
        // a tie counts for every tied match (all of them get the badge); the poll remembers the first
        await client.query(`UPDATE motn_polls SET status = 'closed', winner_match_id = $2 WHERE id = $1`, [poll.id, winners[0] || null]);
        for (const w of winners.slice(1)) await client.query(`INSERT INTO motn_polls (guild_id, match_ids, status, created_by, winner_match_id) VALUES ($1,$2,'closed',$3,$4)`, [guildId, [w], poll.created_by, w]);
        return { poll: { ...poll, status: 'closed' }, winners, topVotes: top };
    });
}

module.exports = { createPoll, castVote, closePoll, buildPollMessage, matchNames, shortNames, matchLabel };
