const { AttachmentBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { renderShowCard } = require('../cards/showCard');
const { renderTapeCard } = require('../cards/tapeCard');
const { buildTapeData } = require('./cardData');
const { UserError } = require('./errors');
const svc = require('./cardService');

const slug = (s) => String(s).replace(/[^a-z0-9]+/gi, '-').toLowerCase();

/**
 * The messages that make up a posted show card: for each division with matches, one message with its
 * picture and, underneath, who is in which match (the owners are pinged). Long lists spill into extra messages.
 * Returns [{ content, files, allowedMentions }].
 */
async function buildCardMessages(guild, guildId, brand, { division = null, tapes = false, ping = true } = {}) {
    const drafts = await svc.filledDrafts(guildId, brand, division);
    if (!drafts.length) throw new UserError(division ? `There are no ${svc.divisionLabel(division)} matches on the ${svc.brandLabel(brand)} card yet.` : `The ${svc.brandLabel(brand)} card has no matches yet. Add some with \`/card add\` or \`/card auto\`.`);
    const out = [];
    for (const draft of drafts) {
        const files = [new AttachmentBuilder(await renderShowCard(await svc.buildShowData(guild, draft)), { name: `${draft.brand}-${slug(draft.division)}-card.png` })];
        if (tapes) {
            for (const slot of (await svc.getDraftMatches(draft.id)).filter((s) => s.title_id).slice(0, 9)) {
                try {
                    const t = await svc.tapeTargetsForSlot(guildId, slot);
                    if (!t) continue;
                    files.push(new AttachmentBuilder(await renderTapeCard(await buildTapeData(guild, t)), { name: `tape-${slug(draft.division)}-${slot.position}.png` }));
                } catch (err) { console.error('Tale of the tape failed:', err.message); }
            }
        }
        const { lines, userIds } = await svc.pingLines(draft);
        const header = `📣 **${svc.brandLabel(draft.brand)} · ${svc.divisionLabel(draft.division)}**${draft.name ? ` — ${draft.name}` : ''}`;
        const chunks = svc.chunkLines(header, lines);
        const allowedMentions = ping ? { users: userIds } : { parse: [] };
        out.push({ content: chunks[0], files, allowedMentions });
        for (const extra of chunks.slice(1)) out.push({ content: extra, allowedMentions });
    }
    return out;
}

/** Results pictures (one per division with logged matches) plus the written recap on the last message. */
async function buildRecapMessages(guild, guildId, brand, { division = null } = {}) {
    const { buildShowRecap } = require('./showRecap');
    const drafts = (await svc.filledDrafts(guildId, brand, division));
    const withLogged = [];
    for (const d of drafts) {
        const { rows } = await pool.query(`SELECT 1 FROM card_draft_matches WHERE draft_id = $1 AND match_id IS NOT NULL LIMIT 1`, [d.id]);
        if (rows.length) withLogged.push(d);
    }
    if (!withLogged.length) throw new UserError(`None of the ${svc.brandLabel(brand)} card's matches have been logged yet. Log them with \`/match\` (use the same wrestlers and match type as the card) and I'll connect them automatically.`);
    const out = [];
    for (const draft of withLogged) {
        const file = new AttachmentBuilder(await renderShowCard(await svc.buildRecapData(guild, draft)), { name: `${draft.brand}-${slug(draft.division)}-recap.png` });
        out.push({ content: `🎬 **${svc.brandLabel(draft.brand)} · ${svc.divisionLabel(draft.division)} results**`, files: [file], allowedMentions: { parse: [] } });
    }
    const written = await buildShowRecap(withLogged);
    if (written) out[out.length - 1].embeds = [written.embed];
    return out;
}

/** Sends the messages into a channel (in order). */
async function sendToChannel(channel, messages) {
    for (const m of messages) await channel.send(m);
}

/** Replies with the first message, then follows up with the rest. `ephemeral` keeps them private. */
async function replyWith(interaction, messages, { ephemeral = false, first = 'edit' } = {}) {
    const flags = ephemeral ? { flags: 64 } : {};
    for (let i = 0; i < messages.length; i++) {
        const payload = { ...messages[i] };
        if (i === 0 && first === 'edit') await interaction.editReply(payload);
        else await interaction.followUp({ ...payload, ...flags });
    }
}

module.exports = { buildCardMessages, buildRecapMessages, sendToChannel, replyWith };
