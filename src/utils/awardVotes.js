// Award votes (3.0): admins open a vote for Face of FNLW MVP or a year-end award, nominees are added
// (by admins, or by everyone if the vote allows it), then members vote in secret with a dropdown.
// An admin closes it: the winner gets the Legacy accolade automatically. Nobody ever sees who voted for whom,
// and the public only sees the winner, never the totals.
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { pool, withTransaction } = require('../db/pool');
const { UserError } = require('./errors');
const L = require('./legacy');

const MAX_NOMINEES = 25; // one dropdown
const GOLD = 0xE8BF4A;
const pollName = (p) => L.accoladeName({ kind: p.kind, award_name: p.award_name, year: p.year });

async function getPoll(guildId, id) {
    const { rows } = await pool.query(`SELECT * FROM award_polls WHERE id = $1 AND guild_id = $2`, [id, guildId]);
    if (!rows[0]) throw new UserError('I couldn\'t find that vote. Pick it from the list that appears as you type.');
    return rows[0];
}
async function nominees(pollId) {
    const { rows } = await pool.query(`SELECT * FROM award_nominees WHERE poll_id = $1 ORDER BY id`, [pollId]);
    return rows;
}

/** The public post while nominations are open. */
async function nominationsPayload(p) {
    const list = await nominees(p.id);
    const embed = new EmbedBuilder().setColor(GOLD).setTitle(`🗳 ${pollName(p)}: nominations`)
        .setDescription([
            p.nominate_who === 'everyone' ? 'Nominations are **open to everyone**: `/legacy nominate`.' : 'Admins are picking the nominees.',
            '',
            list.length ? list.map((n) => `• ${n.label}`).join('\n') : '_No nominees yet._'
        ].join('\n').slice(0, 4000))
        .setFooter({ text: `Voting starts when an admin opens it · ${p.vote_who === 'everyone' ? 'everyone can vote' : 'admins vote'}` });
    return { embeds: [embed], components: [staffRow(p, 'start')], allowedMentions: { parse: [] } };
}

/** The public post while voting is open: a dropdown, nothing about who is ahead. */
async function votingPayload(p) {
    const list = await nominees(p.id);
    const embed = new EmbedBuilder().setColor(GOLD).setTitle(`🗳 Vote: ${pollName(p)}`)
        .setDescription([
            `${p.vote_who === 'everyone' ? 'Everyone' : 'Admins and staff'} can vote. Pick below. **Votes are secret**: nobody sees who you picked, and only the winner is announced.`,
            'You can change your vote until an admin closes it.',
            '',
            list.map((n) => `• ${n.label}`).join('\n')
        ].join('\n').slice(0, 4000));
    const menu = new StringSelectMenuBuilder().setCustomId(`ui:av:${p.id}`).setPlaceholder('Cast your vote')
        .addOptions(list.slice(0, MAX_NOMINEES).map((n) => ({ label: n.label.slice(0, 100), value: String(n.id) })));
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), staffRow(p, 'close')], allowedMentions: { parse: [] } };
}

/** 3.5: staff-only buttons on the vote post (anyone can see them; only admins/staff can use them). */
function staffRow(p, what) {
    const { ButtonBuilder, ButtonStyle } = require('discord.js');
    return new ActionRowBuilder().addComponents(what === 'start'
        ? new ButtonBuilder().setCustomId(`ui:vx:s:${p.id}`).setLabel('▶️ Start voting (staff)').setStyle(ButtonStyle.Secondary)
        : new ButtonBuilder().setCustomId(`ui:vx:c:${p.id}`).setLabel('🔒 Close vote (staff)').setStyle(ButtonStyle.Secondary));
}

/** Posts (or updates) the vote's message in its channel. Returns the message, or null. */
async function postOrUpdate(client, p, payload) {
    if (!p.channel_id) return null;
    try {
        const ch = await client.channels.fetch(p.channel_id);
        if (p.message_id) {
            try { const m = await ch.messages.fetch(p.message_id); await m.edit(payload); return m; } catch (_) { /* gone: post again */ }
        }
        const m = await ch.send(payload);
        await pool.query(`UPDATE award_polls SET message_id = $2 WHERE id = $1`, [p.id, m.id]);
        return m;
    } catch (_) { return null; }
}

async function openPoll(guildId, { kind, awardName, year, nominateWho, voteWho, channelId, actor }) {
    const { rows: open } = await pool.query(
        `SELECT 1 FROM award_polls WHERE guild_id = $1 AND kind = $2 AND COALESCE(lower(award_name),'') = COALESCE(lower($3),'') AND year = $4 AND status IN ('nominating','voting')`,
        [guildId, kind, awardName, year]);
    if (open.length) throw new UserError(`There's already an open vote for **${L.accoladeName({ kind, award_name: awardName, year })}**.`);
    const { rows } = await pool.query(
        `INSERT INTO award_polls (guild_id, kind, award_name, year, nominate_who, vote_who, channel_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [guildId, kind, awardName, year, nominateWho, voteWho, channelId, actor]);
    return rows[0];
}

async function addNominee(p, { character, character2 = null, label = null, actor }) {
    if (p.status !== 'nominating') throw new UserError('Nominations for that vote are closed.');
    const list = await nominees(p.id);
    if (list.length >= MAX_NOMINEES) throw new UserError(`That vote already has ${MAX_NOMINEES} nominees, the most a dropdown can hold.`);
    const text = (label?.trim() || (character2 ? `${character.name} & ${character2.name}` : character.name)).slice(0, 100);
    const same = list.find((n) => String(n.character_id) === String(character.id) && String(n.character2_id || '') === String(character2?.id || ''));
    if (same) throw new UserError(`**${same.label}** is already nominated.`);
    const { rows } = await pool.query(
        `INSERT INTO award_nominees (poll_id, character_id, character2_id, label, nominated_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [p.id, character.id, character2?.id || null, text, actor]);
    return rows[0];
}

async function castVote(p, voterId, nomineeId) {
    if (p.status !== 'voting') throw new UserError('Voting for that award is closed.');
    const list = await nominees(p.id);
    if (!list.some((n) => String(n.id) === String(nomineeId))) throw new UserError('That nominee isn\'t in this vote.');
    await pool.query(
        `INSERT INTO award_votes (poll_id, voter_id, nominee_id) VALUES ($1,$2,$3)
         ON CONFLICT (poll_id, voter_id) DO UPDATE SET nominee_id = EXCLUDED.nominee_id, voted_at = now()`, [p.id, voterId, nomineeId]);
    return list.find((n) => String(n.id) === String(nomineeId));
}

/** Counts the votes. Returns { totals:[{nominee, votes}], winners:[nominee], voters }. */
async function tally(pollId) {
    const list = await nominees(pollId);
    const { rows } = await pool.query(`SELECT nominee_id, COUNT(*)::int AS n FROM award_votes WHERE poll_id = $1 GROUP BY nominee_id`, [pollId]);
    const count = new Map(rows.map((r) => [String(r.nominee_id), r.n]));
    const totals = list.map((n) => ({ nominee: n, votes: count.get(String(n.id)) || 0 })).sort((a, b) => b.votes - a.votes);
    const top = totals[0]?.votes || 0;
    return { totals, winners: top ? totals.filter((t) => t.votes === top).map((t) => t.nominee) : [], voters: rows.reduce((a, r) => a + r.n, 0) };
}

/**
 * Closes a vote. One clear winner gets the accolade (each wrestler named in the nominee).
 * A tie or no votes awards nothing; admins can use /legacy award to settle it.
 */
async function closePoll(client, guildId, p, { cancel = false, actor }) {
    const claimed = await withTransaction(async (c) => {
        const { rowCount } = await c.query(`UPDATE award_polls SET status = $2, closed_at = now() WHERE id = $1 AND status IN ('nominating','voting')`, [p.id, cancel ? 'cancelled' : 'closed']);
        return rowCount;
    });
    if (!claimed) throw new UserError('That vote is already closed.');
    if (cancel) {
        await postOrUpdate(client, { ...p }, { embeds: [new EmbedBuilder().setColor(0x95A5A6).setTitle(`🗳 ${pollName(p)}`).setDescription('This vote was cancelled.')], components: [] });
        return { cancelled: true };
    }
    const t = await tally(p.id);
    const given = [];
    let publicText;
    if (t.winners.length === 1) {
        const w = t.winners[0];
        const { requireCharacter } = require('./characterUtils');
        for (const cid of [w.character_id, w.character2_id].filter(Boolean)) {
            const ch = await requireCharacter(guildId, String(cid)).catch(() => null);
            if (!ch) continue;
            const row = await L.giveAccolade(guildId, { kind: p.kind, awardName: p.award_name, year: p.year, character: ch, notes: w.label !== ch.name && w.character2_id ? w.label : null, actor });
            if (row) given.push({ row, ch });
        }
        publicText = `🏆 **${w.label}** won **${pollName(p)}**!`;
    } else if (t.winners.length > 1) {
        publicText = `It's a **tie** between ${t.winners.map((w) => `**${w.label}**`).join(' and ')}. The staff will decide.`;
    } else {
        publicText = 'No votes were cast.';
    }
    await postOrUpdate(client, p, { embeds: [new EmbedBuilder().setColor(GOLD).setTitle(`🗳 ${pollName(p)}: voting closed`).setDescription(publicText)], components: [], allowedMentions: { parse: [] } });
    for (const g of given) await L.announceAccolade(client, guildId, g.row, g.ch, 'Voted by the FNLW community.');
    return { ...t, given };
}

/** Autocomplete for the `vote` option: open votes (or every vote with all=true). */
async function pollChoices(guildId, typed, statuses) {
    const { rows } = await pool.query(
        `SELECT * FROM award_polls WHERE guild_id = $1 AND status = ANY($2::text[]) ORDER BY id DESC LIMIT 50`, [guildId, statuses]);
    const t = String(typed || '').toLowerCase();
    return rows.filter((p) => pollName(p).toLowerCase().includes(t)).slice(0, 25)
        .map((p) => ({ name: `${pollName(p)} (${p.status === 'nominating' ? 'nominations' : p.status})`.slice(0, 100), value: Number(p.id) }));
}

module.exports = { getPoll, nominees, openPoll, addNominee, castVote, tally, closePoll, nominationsPayload, votingPayload, postOrUpdate, pollChoices, pollName };
