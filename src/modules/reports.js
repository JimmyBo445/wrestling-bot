// Player-reported results (3.7)
// A player in a card match reports how it went (winner required; finish, score, notes and a screenshot
// optional). Staff get it in the staff room with ✅ Approve · ✏️ Fix & approve · ❌ Deny. Approving records
// it exactly like recording it in /card view (result picture to the results channel, titles, contenders…).
// Two different reports for the same match are both kept and flagged so staff can pick.
//
//   ui:rp:…   player side (pick a match → who won → optional details form)
//   ui:rpm:…  the player's details form coming back
//   ui:rr:…   staff side · ui:rrm / ui:rrd: staff forms (score & notes / deny reason)
const { EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, AttachmentBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { UserError } = require('../utils/errors');
const { isAdmin, requireAdmin, respond, EPHEMERAL, DIVISION_LABELS, NO_MENTIONS } = require('../utils/discordHelpers');
const { MATCH_CONFIG, FINISHES, matchLabel } = require('../utils/constants');
const { btn, row, clip, homeRow, show, onPrivateMessage, ButtonStyle } = require('../utils/panelKit');

const KINDS = ['rp', 'rpm', 'rr', 'rrm', 'rrd'];
const BRAND = { raw: 'RAW', smackdown: 'SmackDown' };
const FINISH_NAME = Object.fromEntries(FINISHES.map((f) => [f.value, f.name]));
const P = ButtonStyle.Primary, G = ButtonStyle.Success, D = ButtonStyle.Danger, S = ButtonStyle.Secondary;

// ------------------------------------------------------------------ the matches a player can report

/** Unrecorded matches on the current cards that one of this player's wrestlers is in. */
async function reportable(guildId, discordId) {
    const { rows } = await pool.query(
        `SELECT cd.id AS draft_id, cdm.position, cd.brand, cd.division, cdm.match_type, cdm.character_ids, cdm.title_id, cdm.stipulation,
                (SELECT t.name FROM titles t WHERE t.id = cdm.title_id) AS title_name
         FROM card_drafts cd JOIN card_draft_matches cdm ON cdm.draft_id = cd.id
         WHERE cd.guild_id = $1 AND cdm.match_id IS NULL
           AND EXISTS (SELECT 1 FROM characters c JOIN users u ON u.id = c.owner_id WHERE c.id = ANY(cdm.character_ids) AND u.discord_id = $2)
         ORDER BY cd.brand, cd.division, cdm.position`, [guildId, String(discordId)]);
    return withNames(rows);
}

async function withNames(rows) {
    const ids = [...new Set(rows.flatMap((r) => (r.character_ids || []).map(String)))];
    const { rows: chars } = ids.length ? await pool.query(
        `SELECT c.id, c.name, u.discord_id, u.is_placeholder FROM characters c JOIN users u ON u.id = c.owner_id WHERE c.id = ANY($1::bigint[])`, [ids]) : { rows: [] };
    const by = new Map(chars.map((c) => [String(c.id), c]));
    return rows.map((r) => ({ ...r, people: (r.character_ids || []).map((id) => by.get(String(id)) || { id, name: 'TBD' }) }));
}

/** "Ace vs Bolt" or "Ace & Bolt vs Cruz & Dax" */
function vsText(m) {
    const n = m.people.map((p) => p.name);
    if (MATCH_CONFIG[m.match_type]?.winnerMode === 'team') { const h = n.length / 2; return `${n.slice(0, h).join(' & ')} vs ${n.slice(h).join(' & ')}`; }
    return n.join(' vs ');
}
const where = (m) => `${BRAND[m.brand] || m.brand || 'Card'} · ${DIVISION_LABELS[m.division] || m.division || ''} #${m.position}`;

/** The choices for "who won" in this match: [{ code, label }] */
function outcomes(m) {
    const n = m.people.map((p) => p.name);
    const out = [];
    if (MATCH_CONFIG[m.match_type]?.winnerMode === 'team') {
        const h = n.length / 2;
        out.push({ code: '1', label: `${n.slice(0, h).join(' & ')} won` }, { code: '2', label: `${n.slice(h).join(' & ')} won` });
    } else n.forEach((x, i) => out.push({ code: String(i + 1), label: `${x} won` }));
    out.push({ code: 'd', label: 'Draw' }, { code: 'n', label: 'No contest' });
    return out;
}
const outcomeLabel = (m, code) => outcomes(m).find((o) => o.code === String(code))?.label || '?';

async function slotFor(guildId, draftId, position) {
    const { rows } = await pool.query(
        `SELECT cd.id AS draft_id, cdm.position, cd.brand, cd.division, cdm.match_type, cdm.character_ids, cdm.title_id, cdm.stipulation, cdm.match_id,
                (SELECT t.name FROM titles t WHERE t.id = cdm.title_id) AS title_name
         FROM card_drafts cd JOIN card_draft_matches cdm ON cdm.draft_id = cd.id WHERE cd.guild_id = $1 AND cd.id = $2 AND cdm.position = $3`, [guildId, draftId, position]);
    return rows[0] ? (await withNames(rows))[0] : null;
}

/** Turns typed text like "pin", "sub", "DQ" into a finish; null if empty or unknown. */
function parseFinish(text) {
    const t = String(text || '').toLowerCase().trim();
    if (!t) return null;
    const exact = FINISHES.find((f) => f.value === t || f.name.toLowerCase() === t);
    if (exact) return exact.value;
    const map = [[/^pin/, 'pinfall'], [/^sub|tap/, 'submission'], [/dq|disq/, 'dq'], [/count/, 'countout'], [/^ko|knock|stopp/, 'knockout'], [/interf/, 'interference'], [/escape|retriev|ladder|elimin/, 'escape'], [/forfeit/, 'forfeit']];
    return map.find(([re]) => re.test(t))?.[1] || null;
}

// ------------------------------------------------------------------ player side

async function playerPanel(interaction, notice = null) {
    const list = await reportable(interaction.guildId, interaction.user.id);
    const embed = new EmbedBuilder().setColor(0x3498DB).setTitle('📝 Report a match result')
        .setDescription(list.length
            ? `${list.length} of your card match${list.length === 1 ? '' : 'es'} still need${list.length === 1 ? 's' : ''} a result. Pick one, then who won.\n\n${list.map((m) => `• **${where(m)}**: ${vsText(m)}${m.title_name ? ` · 🏆 ${m.title_name}` : ''}`).join('\n')}`.slice(0, 4000)
            : 'None of your wrestlers have an unrecorded match on the current cards.')
        .setFooter({ text: 'Staff approve it before it counts. To add a screenshot, use /match report.' });
    const components = [];
    if (list.length) {
        components.push(row(new StringSelectMenuBuilder().setCustomId('ui:rp:m').setPlaceholder('Which match?')
            .addOptions(list.slice(0, 25).map((m) => ({ label: clip(vsText(m), 100), description: clip(where(m), 100), value: `${m.draft_id}:${m.position}` })))));
    }
    components.push(homeRow());
    return show(interaction, { content: notice || null, embeds: [embed], components });
}

async function pickWinner(interaction, draftId, position) {
    const m = await slotFor(interaction.guildId, draftId, position);
    if (!m || m.match_id) throw new UserError('That match is already recorded or no longer on the card.');
    if (!m.people.some((p) => p.discord_id === interaction.user.id)) throw new UserError('You can only report matches your own wrestlers are in.');
    const opts = outcomes(m);
    const winners = opts.filter((o) => !['d', 'n'].includes(o.code));
    const rows = [];
    for (let i = 0; i < winners.length; i += 4) rows.push(row(...winners.slice(i, i + 4).map((o) => btn(`ui:rp:w:${draftId}:${position}:${o.code}`, clip(`🏆 ${o.label}`, 80), P))));
    rows.push(row(btn(`ui:rp:w:${draftId}:${position}:d`, 'Draw'), btn(`ui:rp:w:${draftId}:${position}:n`, 'No contest'), btn('ui:rp:h', '◀ Back')));
    return show(interaction, { content: `**${where(m)}**: ${vsText(m)}${m.title_name ? ` · 🏆 ${m.title_name}` : ''}\n**How did it end?** Next you can add the finish, score and notes (all optional).`, embeds: [], components: rows.slice(0, 5) });
}

function detailsForm(draftId, position, code) {
    const inp = (id, label, opts = {}) => {
        const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(opts.long ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(false).setMaxLength(opts.max || 100);
        if (opts.placeholder) t.setPlaceholder(opts.placeholder);
        return new ActionRowBuilder().addComponents(t);
    };
    return new ModalBuilder().setCustomId(`ui:rpm:${draftId}:${position}:${code}`).setTitle('Match details (all optional)').addComponents(
        inp('finish', 'Finish (optional)', { max: 40, placeholder: 'Pinfall, submission, DQ, count-out, KO, forfeit…' }),
        inp('score', 'Score (optional)', { max: 20, placeholder: 'e.g. 2-1' }),
        inp('notes', 'Notes (optional)', { long: true, max: 300 }));
}

/**
 * Saves a report and posts it for staff. Same player reporting the same match again replaces their
 * earlier report. Returns the text to show the player.
 */
async function submitReport(interaction, { draftId, position, code, finish = null, score = null, notes = null, proof = null }) {
    const guildId = interaction.guildId;
    const m = await slotFor(guildId, draftId, position);
    if (!m || m.match_id) throw new UserError('That match is already recorded or no longer on the card.');
    if (!m.people.some((p) => p.discord_id === interaction.user.id)) throw new UserError('You can only report matches your own wrestlers are in.');
    if (!outcomes(m).some((o) => o.code === String(code))) throw new UserError('Pick who won from the list.');
    if (notes && notes.length > 300) throw new UserError('Keep the notes under 300 characters.');
    if (score && score.length > 20) throw new UserError('Keep the score short, like 2-1.');
    const { rows: mine } = await pool.query(
        `SELECT id FROM match_reports WHERE guild_id = $1 AND draft_id = $2 AND position = $3 AND reporter = $4 AND status = 'pending'`, [guildId, draftId, position, interaction.user.id]);
    let report;
    if (mine[0]) {
        ({ rows: [report] } = await pool.query(
            `UPDATE match_reports SET result_code = $2, finish = $3, score = $4, notes = $5, proof_url = COALESCE($6, proof_url), created_at = now() WHERE id = $1 RETURNING *`,
            [mine[0].id, String(code), finish, score, notes, proof?.url || null]));
    } else {
        ({ rows: [report] } = await pool.query(
            `INSERT INTO match_reports (guild_id, draft_id, position, brand, division, match_type, character_ids, title_id, stipulation, reporter, result_code, finish, score, notes, proof_url)
             VALUES ($1,$2,$3,$4,$5,$6,$7::bigint[],$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
            [guildId, draftId, position, m.brand, m.division, m.match_type, m.character_ids, m.title_id, m.stipulation, interaction.user.id, String(code), finish, score, notes, proof?.url || null]));
    }
    const posted = await postForStaff(interaction, report, proof, Boolean(mine[0]));
    const others = await pendingSiblings(report);
    const clash = others.some((o) => o.result_code !== report.result_code);
    return `📝 Sent! **${outcomeLabel(m, code)}** in ${where(m)} is waiting for staff to approve it${posted ? '' : ' (they\'ll see it in Staff Tools → 📝 Reported results)'}.`
        + `${clash ? '\n⚠️ Someone else in this match reported a different result, so staff will check both.' : ''}\nYou'll get a DM when it's approved or denied.`;
}

/** Other pending reports for the same match. */
async function pendingSiblings(r) {
    const { rows } = await pool.query(
        `SELECT * FROM match_reports WHERE guild_id = $1 AND id <> $2 AND status = 'pending'
           AND ((draft_id = $3 AND position = $4) OR (match_type = $5 AND (SELECT array_agg(x ORDER BY x) FROM unnest(character_ids) x) = (SELECT array_agg(x ORDER BY x) FROM unnest($6::bigint[]) x)))
         ORDER BY id`, [r.guild_id, r.id, r.draft_id, r.position, r.match_type, r.character_ids]);
    return rows;
}

// ------------------------------------------------------------------ the staff post

async function reportEmbed(r) {
    const [m] = await withNames([r]);
    const statusLine = r.status === 'pending' ? '⏳ Waiting for staff'
        : r.status === 'approved' ? `✅ Approved by <@${r.resolved_by}>${r.match_id ? ` · match #${r.match_id}` : ''}`
            : r.status === 'denied' ? `❌ Denied by <@${r.resolved_by}>${r.deny_reason ? `: ${r.deny_reason}` : ''}`
                : `➖ Closed: ${r.deny_reason || 'another report was used'}`;
    const embed = new EmbedBuilder().setColor(r.status === 'pending' ? 0xF1C40F : r.status === 'approved' ? 0x2ECC71 : 0x95A5A6)
        .setTitle(`📝 Reported result #${r.id}`)
        .setDescription([
            `**${where(r)}** (${matchLabel(r.match_type)}): ${vsText(m)}${r.title_id ? ' · 🏆 title match' : ''}${r.stipulation ? ` · ${r.stipulation}` : ''}`,
            `**Result:** ${outcomeLabel(m, r.result_code)}`,
            r.finish ? `**Finish:** ${FINISH_NAME[r.finish] || r.finish}` : null,
            r.score ? `**Score:** ${r.score}` : null,
            r.notes ? `**Notes:** ${r.notes}` : null,
            `**Reported by:** <@${r.reporter}>`,
            '', statusLine
        ].filter((x) => x !== null).join('\n').slice(0, 4000));
    if (r.status === 'pending') {
        const others = await pendingSiblings(r);
        const diff = others.filter((o) => o.result_code !== r.result_code);
        if (diff.length) embed.addFields({ name: '⚠️ Different reports for this match', value: clip([r, ...others].map((x) => `#${x.id}: ${outcomeLabel(m, x.result_code)} (by <@${x.reporter}>)`).join('\n') + '\nApprove the right one; the others close by themselves.', 1024) });
    }
    return embed;
}
const staffButtons = (r) => (r.status === 'pending' ? [row(btn(`ui:rr:ok:${r.id}`, '✅ Approve', G), btn(`ui:rr:fix:${r.id}`, '✏️ Fix & approve'), btn(`ui:rr:no:${r.id}`, '❌ Deny', D))] : []);

async function postForStaff(interaction, report, proof, replaced) {
    const { rows } = await pool.query(`SELECT admin_channel_id, pending_channel_id FROM guilds WHERE guild_id = $1`, [report.guild_id]);
    const chId = rows[0]?.admin_channel_id || rows[0]?.pending_channel_id;
    const embed = await reportEmbed(report);
    const files = [];
    if (proof?.url) {
        // keep a copy of the screenshot (Discord's links to uploads stop working after a while)
        try {
            const res = await fetch(proof.url);
            if (!res.ok) throw new Error('fetch');
            const ext = (String(proof.name || '').match(/\.(png|jpe?g|gif|webp)$/i)?.[1] || 'png').toLowerCase();
            files.push(new AttachmentBuilder(Buffer.from(await res.arrayBuffer()), { name: `proof.${ext}` }));
            embed.setImage(`attachment://proof.${ext}`);
        } catch (_) { embed.setImage(proof.url); }
    } else if (report.proof_url) embed.setImage(report.proof_url);
    const payload = { content: replaced ? '🔁 Updated report:' : undefined, embeds: [embed], files, components: staffButtons(report), allowedMentions: NO_MENTIONS };
    // a replaced report: retire the old post
    if (replaced && report.channel_id && report.message_id) {
        try { const ch = await interaction.client.channels.fetch(report.channel_id); const old = await ch.messages.fetch(report.message_id); await old.edit({ content: '🔁 Replaced by a newer report from the same player.', components: [] }); } catch (_) { /* gone */ }
    }
    if (!chId) return false;
    try {
        const ch = await interaction.client.channels.fetch(chId);
        const msg = await ch.send(payload);
        await pool.query(`UPDATE match_reports SET channel_id = $2, message_id = $3 WHERE id = $1`, [report.id, ch.id, msg.id]);
        // flag the other reports' posts too
        for (const o of await pendingSiblings(report)) await refreshPost(interaction.client, o.id);
        return true;
    } catch (err) { console.error('Report post failed:', err.message); return false; }
}

/** Redraws a report's staff post (status, flags, buttons). Never throws. */
async function refreshPost(client, id) {
    try {
        const { rows } = await pool.query(`SELECT * FROM match_reports WHERE id = $1`, [id]);
        const r = rows[0];
        if (!r?.channel_id || !r?.message_id) return;
        const ch = await client.channels.fetch(r.channel_id);
        const msg = await ch.messages.fetch(r.message_id);
        await msg.edit({ embeds: [await reportEmbed(r)], components: staffButtons(r), allowedMentions: NO_MENTIONS });
    } catch (_) { /* gone */ }
}

async function dm(client, userId, text) {
    try { const u = await client.users.fetch(userId); await u.send(text); } catch (_) { /* DMs closed */ }
}

// ------------------------------------------------------------------ staff actions

async function getReport(guildId, id, { pending = true } = {}) {
    const { rows } = await pool.query(`SELECT * FROM match_reports WHERE id = $1 AND guild_id = $2`, [id, guildId]);
    const r = rows[0];
    if (!r) throw new UserError('That report no longer exists.');
    if (pending && r.status !== 'pending') throw new UserError(`That report was already ${r.status}.`);
    return r;
}

/** Records the reported result exactly like staff recording it in /card view. Returns { r, result, channel }. */
async function approve(interaction, id) {
    requireAdmin(interaction, 'approve results');
    const guildId = interaction.guildId;
    // claim it first so two staff can't approve it twice
    const { rows: claimed } = await pool.query(
        `UPDATE match_reports SET status = 'approved', resolved_by = $3, resolved_at = now() WHERE id = $1 AND guild_id = $2 AND status = 'pending' RETURNING *`, [id, guildId, interaction.user.id]);
    if (!claimed[0]) { await getReport(guildId, id); throw new UserError('That report was already handled.'); }
    const r = claimed[0];
    try {
        // find the match on the card (it may have moved)
        let slot = await slotFor(guildId, r.draft_id, r.position);
        const same = (a, b) => [...(a || [])].map(String).sort().join(',') === [...(b || [])].map(String).sort().join(',');
        if (!slot || !same(slot.character_ids, r.character_ids) || slot.match_type !== r.match_type) {
            const { rows } = await pool.query(
                `SELECT cd.id AS draft_id, cdm.position FROM card_drafts cd JOIN card_draft_matches cdm ON cdm.draft_id = cd.id
                 WHERE cd.guild_id = $1 AND cdm.match_type = $2 AND cdm.match_id IS NULL
                   AND (SELECT array_agg(x ORDER BY x) FROM unnest(cdm.character_ids) x) = (SELECT array_agg(x ORDER BY x) FROM unnest($3::bigint[]) x) LIMIT 1`,
                [guildId, r.match_type, r.character_ids]);
            slot = rows[0] ? await slotFor(guildId, rows[0].draft_id, rows[0].position) : null;
        }
        if (!slot) throw new UserError('That match isn\'t on the card anymore, so I can\'t record it from here. Log it with `/match log` if it happened.');
        if (slot.match_id) throw new UserError('That match is already recorded.');
        // the report's winner refers to the order on the card when it was reported
        const ids = slot.character_ids.map(String);
        const repIds = r.character_ids.map(String);
        const cfg = MATCH_CONFIG[slot.match_type];
        const decisive = !['d', 'n'].includes(r.result_code);
        let winnerIndex = null, winningTeam = null;
        if (decisive && cfg.winnerMode === 'single') winnerIndex = ids.indexOf(repIds[Number(r.result_code) - 1]);
        if (decisive && cfg.winnerMode === 'team') {
            const half = repIds.length / 2;
            const side = (Number(r.result_code) === 1 ? repIds.slice(0, half) : repIds.slice(half));
            winningTeam = ids.slice(0, ids.length / 2).includes(side[0]) ? 1 : 2;
        }
        const result = await require('../utils/matchService').logMatch({
            guildId, matchType: slot.match_type, slotCharacterIds: ids, winnerIndex, winningTeam,
            resultType: decisive ? 'decisive' : r.result_code === 'd' ? 'draw' : 'no_contest',
            titleValue: slot.title_id ? String(slot.title_id) : null, stipulation: slot.stipulation,
            finish: r.finish, score: r.score, notes: r.notes, overrideCooldown: true, actor: interaction.user.id
        });
        const { presentMatch, postToResultsChannel } = require('../utils/matchPresenter');
        const { payload } = await presentMatch(interaction, result);
        const channel = await postToResultsChannel(interaction, payload);
        await require('../utils/showRecap').maybeAutoRecap(interaction, result);
        await require('../utils/audit').logAudit(guildId, interaction.user.id, 'report_approved', { report: r.id, match: result.matchId });
        const { rows: done } = await pool.query(`UPDATE match_reports SET match_id = $2 WHERE id = $1 RETURNING *`, [r.id, result.matchId]);
        // close the other reports for this match
        for (const o of await pendingSiblings(r)) {
            await pool.query(`UPDATE match_reports SET status = 'closed', resolved_by = $2, resolved_at = now(), deny_reason = $3 WHERE id = $1`, [o.id, interaction.user.id, `report #${r.id} was approved`]);
            await refreshPost(interaction.client, o.id);
            if (o.reporter !== r.reporter) await dm(interaction.client, o.reporter, `ℹ️ Staff recorded your match (${where(o)}) using another player's report.`);
        }
        await dm(interaction.client, r.reporter, `✅ Your reported result was approved: **${outcomeLabel(slot, r.result_code)}** (${where(slot)}).`);
        return { r: done[0], result, channel };
    } catch (err) {
        // put it back so staff can try again or deny it
        await pool.query(`UPDATE match_reports SET status = 'pending', resolved_by = NULL, resolved_at = NULL WHERE id = $1 AND match_id IS NULL`, [r.id]);
        throw err;
    }
}

async function fixPanel(interaction, id, notice = null) {
    requireAdmin(interaction, 'approve results');
    const r = await getReport(interaction.guildId, id);
    const [m] = await withNames([r]);
    const opts = outcomes(m);
    const rows = [];
    for (let i = 0; i < opts.length && rows.length < 2; i += 5) rows.push(row(...opts.slice(i, i + 5).map((o) => btn(`ui:rr:fw:${r.id}:${o.code}`, clip(o.label, 80), o.code === r.result_code ? P : S))));
    rows.push(row(new StringSelectMenuBuilder().setCustomId(`ui:rr:ff:${r.id}`).setPlaceholder('Finish (optional)')
        .addOptions([{ label: 'No finish', value: 'none', default: !r.finish }, ...FINISHES.map((f) => ({ label: f.name, value: f.value, default: f.value === r.finish }))])));
    rows.push(row(btn(`ui:rr:fn:${r.id}`, '📝 Score & notes'), btn(`ui:rr:fa:${r.id}`, '✅ Approve with these', G), btn(`ui:rr:no:${r.id}`, '❌ Deny', D)));
    const payload = { content: notice || 'Change anything that\'s wrong, then **Approve with these**.', embeds: [await reportEmbed(r)], components: rows.slice(0, 5), allowedMentions: NO_MENTIONS };
    if (onPrivateMessage(interaction)) return interaction.update(payload);
    return respond(interaction, { ...payload, flags: EPHEMERAL });
}

async function deny(interaction, id, reason) {
    requireAdmin(interaction, 'deny results');
    const { rows } = await pool.query(
        `UPDATE match_reports SET status = 'denied', resolved_by = $3, resolved_at = now(), deny_reason = $4 WHERE id = $1 AND guild_id = $2 AND status = 'pending' RETURNING *`,
        [id, interaction.guildId, interaction.user.id, reason || null]);
    if (!rows[0]) { await getReport(interaction.guildId, id); throw new UserError('That report was already handled.'); }
    const r = rows[0];
    await refreshPost(interaction.client, r.id);
    for (const o of await pendingSiblings(r)) await refreshPost(interaction.client, o.id);
    await require('../utils/audit').logAudit(interaction.guildId, interaction.user.id, 'report_denied', { report: r.id });
    await dm(interaction.client, r.reporter, `❌ Your reported result (${where(r)}) was denied by staff.${reason ? `\nReason: ${reason}` : ''}`);
    return r;
}

/** Staff Tools → 📝 Reported results: every pending report. */
async function staffList(interaction, notice = null) {
    requireAdmin(interaction, 'see reported results');
    const { rows } = await pool.query(`SELECT * FROM match_reports WHERE guild_id = $1 AND status = 'pending' ORDER BY id LIMIT 25`, [interaction.guildId]);
    const named = await withNames(rows);
    const embed = new EmbedBuilder().setColor(0xF1C40F).setTitle(`📝 Reported results (${rows.length})`)
        .setDescription(rows.length ? named.map((r) => `**#${r.id}** ${where(r)}: ${outcomeLabel(r, r.result_code)} · by <@${r.reporter}>`).join('\n').slice(0, 4000) : 'Nothing waiting. 👍');
    const components = [];
    if (rows.length) components.push(row(new StringSelectMenuBuilder().setCustomId('ui:rr:pick').setPlaceholder('Open a report')
        .addOptions(named.map((r) => ({ label: clip(`#${r.id} ${vsText(r)}`, 100), description: clip(outcomeLabel(r, r.result_code), 100), value: String(r.id) })))));
    components.push(row(btn('ui:h:staff', '◀ Staff Tools'), homeRow().components[0]));
    return show(interaction, { content: notice, embeds: [embed], components });
}

const pendingCount = async (guildId) => (await pool.query(`SELECT COUNT(*)::int AS n FROM match_reports WHERE guild_id = $1 AND status = 'pending'`, [guildId])).rows[0].n;

// ------------------------------------------------------------------ router

const field = (i, k) => { try { return String(i.fields.getTextInputValue(k) || '').trim(); } catch (_) { return ''; } };

async function handle(interaction, parts) {
    const [, kind, a, b, c] = parts;
    const v = interaction.values?.[0];

    if (kind === 'rp') {
        if (a === 'h') return playerPanel(interaction);
        if (a === 'm') { const [d, p] = String(v).split(':'); return pickWinner(interaction, d, Number(p)); }
        if (a === 'w') {
            // check before opening the form, so nobody fills it in for nothing
            const m = await slotFor(interaction.guildId, b, Number(c));
            if (!m || m.match_id) throw new UserError('That match is already recorded or no longer on the card.');
            if (!m.people.some((p) => p.discord_id === interaction.user.id)) throw new UserError('You can only report matches your own wrestlers are in.');
            return interaction.showModal(detailsForm(b, c, parts[5]));
        }
    }
    if (kind === 'rpm') {
        const text = field(interaction, 'finish');
        const finish = parseFinish(text);
        let notes = field(interaction, 'notes') || null;
        if (text && !finish) notes = [`Finish: ${text}`, notes].filter(Boolean).join(' · ');
        const msg = await submitReport(interaction, { draftId: a, position: Number(b), code: c, finish, score: field(interaction, 'score') || null, notes });
        return playerPanel(interaction, msg);
    }

    if (kind === 'rr') {
        requireAdmin(interaction, 'handle reported results');
        if (a === 'list') return staffList(interaction);
        if (a === 'pick') {
            const r = await getReport(interaction.guildId, v, { pending: false });
            return show(interaction, { embeds: [await reportEmbed(r)], components: [...staffButtons(r), row(btn('ui:rr:list', '◀ All reports'))] });
        }
        if (a === 'ok' || a === 'fa') {
            const fromPost = !onPrivateMessage(interaction) && interaction.message;
            if (fromPost) await interaction.deferUpdate(); else await interaction.deferUpdate?.();
            try {
                const { r, result, channel } = await approve(interaction, b);
                await refreshPost(interaction.client, r.id);
                const note = `✅ Recorded as match #${result.matchId}. The result picture was posted in <#${channel.id}>.`;
                if (fromPost) return interaction.followUp({ content: note, flags: EPHEMERAL });
                return interaction.editReply({ content: note, embeds: [await reportEmbed(r)], components: [row(btn('ui:rr:list', '📝 Other reports'))] });
            } catch (err) {
                if (!(err instanceof UserError)) throw err;
                return interaction.followUp({ content: `⚠️ ${err.message}`, flags: EPHEMERAL });
            }
        }
        if (a === 'fix') return fixPanel(interaction, b);
        if (a === 'fw') { await getReport(interaction.guildId, b); await pool.query(`UPDATE match_reports SET result_code = $2 WHERE id = $1`, [b, c]); return fixPanel(interaction, b, '✏️ Result changed.'); }
        if (a === 'ff') { await getReport(interaction.guildId, b); await pool.query(`UPDATE match_reports SET finish = $2 WHERE id = $1`, [b, v === 'none' ? null : v]); return fixPanel(interaction, b, '✏️ Finish changed.'); }
        if (a === 'fn') {
            const r = await getReport(interaction.guildId, b);
            const t = (id, label, val, max, long) => { const x = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(long ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(false).setMaxLength(max); if (val) x.setValue(String(val).slice(0, max)); return new ActionRowBuilder().addComponents(x); };
            return interaction.showModal(new ModalBuilder().setCustomId(`ui:rrm:${r.id}`).setTitle('Score & notes').addComponents(t('score', 'Score (empty = none)', r.score, 20), t('notes', 'Notes (empty = none)', r.notes, 300, true)));
        }
        if (a === 'no') {
            await getReport(interaction.guildId, b);
            const t = new TextInputBuilder().setCustomId('reason').setLabel('Why? (sent to the player, optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(300);
            return interaction.showModal(new ModalBuilder().setCustomId(`ui:rrd:${b}`).setTitle('Deny this result').addComponents(new ActionRowBuilder().addComponents(t)));
        }
    }
    if (kind === 'rrm') {
        requireAdmin(interaction, 'approve results');
        await getReport(interaction.guildId, a);
        await pool.query(`UPDATE match_reports SET score = $2, notes = $3 WHERE id = $1`, [a, field(interaction, 'score') || null, field(interaction, 'notes') || null]);
        return fixPanel(interaction, a, '✏️ Score and notes changed.');
    }
    if (kind === 'rrd') {
        const r = await deny(interaction, a, field(interaction, 'reason'));
        const note = `❌ Denied report #${r.id}. The player was told${r.deny_reason ? ' why' : ''}.`;
        if (onPrivateMessage(interaction)) return interaction.update({ content: note, embeds: [await reportEmbed(r)], components: [row(btn('ui:rr:list', '📝 Other reports'))] });
        return respond(interaction, { content: note, flags: EPHEMERAL });
    }
    throw new UserError('That button is from an older version of the bot. Run `/fnlw` again.');
}

module.exports = { KINDS, handle, reportable, outcomes, vsText, where, submitReport, parseFinish, playerPanel, staffList, pendingCount, approve, deny };
