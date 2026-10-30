const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { UserError } = require('./errors');
const { MATCH_CONFIG, STIPULATIONS } = require('./constants');
const { fmtYmd } = require('./dates');
const svc = require('./cardService');

const PAGE = 25;
const btn = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);

async function getDraftById(guildId, draftId) {
    const { rows } = await pool.query(`SELECT * FROM card_drafts WHERE id = $1 AND guild_id = $2`, [draftId, guildId]);
    if (!rows[0]) throw new UserError('That card no longer exists. Run `/card view` again.');
    return rows[0];
}

/** Short names for a match slot, used in dropdowns. */
async function slotNames(slots) {
    const allIds = [...new Set(slots.flatMap((m) => m.character_ids))];
    const { rows } = allIds.length ? await pool.query(`SELECT id, name FROM characters WHERE id = ANY($1::bigint[])`, [allIds]) : { rows: [] };
    const nm = new Map(rows.map((c) => [String(c.id), c.name]));
    const n = (id) => nm.get(String(id)) || 'TBD';
    return slots.map((m) => {
        const cfg = MATCH_CONFIG[m.match_type];
        if (cfg?.winnerMode === 'team') {
            const half = m.character_ids.length / 2;
            return `${m.character_ids.slice(0, half).map(n).join(' & ')} vs ${m.character_ids.slice(half).map(n).join(' & ')}`;
        }
        return m.character_ids.length === 2 ? `${n(m.character_ids[0])} vs ${n(m.character_ids[1])}` : m.character_ids.map(n).join(', ');
    });
}

/** The main card screen: the running order plus Preview / Post and a dropdown to pick a match. */
async function viewMessage(guildId, brand, { page = 0, notice = null } = {}) {
    const show = await svc.getShow(guildId, brand);
    const drafts = await svc.filledDrafts(guildId, brand);
    const head = `**${svc.brandLabel(brand)} card${show?.name ? ` — ${show.name}` : ''}**${show?.show_date ? ` · 📅 ${fmtYmd(show.show_date)}` : ''}`;
    const body = await svc.describeShow(guildId, brand);
    const content = `${notice ? `${notice}\n\n` : ''}${head}\n\n${body}`.slice(0, 1950);
    const rows = [];
    rows.push(new ActionRowBuilder().addComponents(
        btn(`cardui:pv:${brand}`, '👁 Preview', ButtonStyle.Primary, !drafts.length),
        btn(`cardui:po:${brand}`, '📣 Post here', ButtonStyle.Success, !drafts.length)));
    const options = [];
    for (const d of drafts) {
        const slots = await svc.getDraftMatches(d.id);
        const names = await slotNames(slots);
        slots.forEach((s, i) => options.push({ label: `${svc.divisionLabel(d.division)} ${s.position}: ${names[i]}`.slice(0, 100), value: `${d.id}:${s.position}`, description: s.match_id ? 'Already logged' : undefined }));
    }
    const pages = Math.max(1, Math.ceil(options.length / PAGE));
    const pg = Math.min(Math.max(0, page), pages - 1);
    if (options.length) {
        rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId(`cardui:pick:${brand}`).setPlaceholder('Pick a match to move, edit or remove').addOptions(options.slice(pg * PAGE, (pg + 1) * PAGE))));
    }
    if (pages > 1) {
        rows.push(new ActionRowBuilder().addComponents(
            btn(`cardui:pg:${brand}:${pg - 1}`, '◀ Previous', ButtonStyle.Secondary, pg === 0),
            btn(`cardui:pg:${brand}:${pg + 1}`, 'Next ▶', ButtonStyle.Secondary, pg >= pages - 1)));
    }
    return { content, components: rows, files: [], embeds: [], allowedMentions: { parse: [] } };
}

/** One match: move, edit, remove. */
async function matchPanel(guildId, draftId, position, { notice = null } = {}) {
    const draft = await getDraftById(guildId, draftId);
    const slots = await svc.getDraftMatches(draft.id);
    const slot = slots[position - 1];
    if (!slot) return viewMessage(guildId, draft.brand, { notice: notice || 'That match is gone.' });
    const [name] = await slotNames([slot]);
    const logged = Boolean(slot.match_id);
    const cfg = MATCH_CONFIG[slot.match_type];
    const content = `${notice ? `${notice}\n\n` : ''}**${svc.brandLabel(draft.brand)} · ${svc.divisionLabel(draft.division)} · match ${position} of ${slots.length}**\n${cfg?.label || slot.match_type}: ${name}${slot.stipulation ? ` _(${slot.stipulation})_` : ''}${logged ? '\n✅ Already logged, so it can\'t be changed here.' : ''}`;
    const rows = [new ActionRowBuilder().addComponents(
        btn(`cardui:mu:${draft.id}:${position}`, '⬆ Up', ButtonStyle.Secondary, position <= 1),
        btn(`cardui:md:${draft.id}:${position}`, '⬇ Down', ButtonStyle.Secondary, position >= slots.length),
        btn(`cardui:ed:${draft.id}:${position}`, '✏️ Edit', ButtonStyle.Primary, logged),
        btn(`cardui:rm:${draft.id}:${position}`, '🗑 Remove', ButtonStyle.Danger, logged),
        btn(`cardui:bk:${draft.brand}`, '↩ Back'))];
    rows.push(new ActionRowBuilder().addComponents(btn(`cardui:rc:${draft.id}:${position}`, logged ? '✅ Recorded' : '🎬 Record result', logged ? ButtonStyle.Secondary : ButtonStyle.Success, logged)));
    return { content, components: rows, files: [], embeds: [], allowedMentions: { parse: [] } };
}

/** Who won? One button per wrestler (or per team), plus Draw and No contest. */
async function recordPanel(guildId, draftId, position) {
    const draft = await getDraftById(guildId, draftId);
    const slots = await svc.getDraftMatches(draft.id);
    const slot = slots[position - 1];
    if (!slot) return viewMessage(guildId, draft.brand, { notice: 'That match is gone.' });
    if (slot.match_id) return matchPanel(guildId, draftId, position, { notice: 'That match is already recorded.' });
    if (slot.character_ids.some((c) => !c)) throw new UserError('This match still has a TBD wrestler. Edit it first.');
    const cfg = MATCH_CONFIG[slot.match_type];
    const allIds = slot.character_ids;
    const { rows } = await pool.query(`SELECT id, name FROM characters WHERE id = ANY($1::bigint[])`, [allIds]);
    const nm = new Map(rows.map((c) => [String(c.id), c.name]));
    const n = (id) => nm.get(String(id)) || 'TBD';
    const id = (code) => `cardui:rw:${draft.id}:${position}:${code}`;
    const buttons = [];
    if (cfg.winnerMode === 'team') {
        const half = allIds.length / 2;
        buttons.push(btn(id(1), `🏆 ${allIds.slice(0, half).map(n).join(' & ')}`.slice(0, 80), ButtonStyle.Primary), btn(id(2), `🏆 ${allIds.slice(half).map(n).join(' & ')}`.slice(0, 80), ButtonStyle.Primary));
    } else {
        allIds.forEach((c, i) => buttons.push(btn(id(i + 1), `🏆 ${n(c)}`.slice(0, 80), ButtonStyle.Primary)));
    }
    const rows2 = [new ActionRowBuilder().addComponents(buttons.slice(0, 5)),
        new ActionRowBuilder().addComponents(btn(id('d'), 'Draw'), btn(id('n'), 'No contest'), btn(`cardui:mp:${draft.id}:${position}`, '↩ Cancel'))];
    const [name] = await slotNames([slot]);
    const content = `**Record ${svc.divisionLabel(draft.division)} match ${position}**\n${cfg.label}: ${name}${slot.stipulation ? ` _(${slot.stipulation})_` : ''}${slot.title_id ? ' 🏆 title match' : ''}\n\n**Who won?** The result picture goes to the match results channel. Add a finish, score or notes afterwards with \`/match edit\`.`;
    return { content, components: rows2, files: [], embeds: [], allowedMentions: { parse: [] } };
}

function removeConfirm(draftId, position, brand) {
    return {
        content: 'Remove this match from the card?',
        components: [new ActionRowBuilder().addComponents(
            btn(`cardui:rmy:${draftId}:${position}`, 'Yes, remove it', ButtonStyle.Danger),
            btn(`cardui:mp:${draftId}:${position}`, 'Keep it'))],
        files: [], embeds: [], allowedMentions: { parse: [] }
    };
}

/** Wrestlers that could replace someone in this match: same division, claimed, healthy, not already booked on the card. */
async function candidates(draft, slot, page) {
    const booked = new Set();
    for (const d of await svc.brandDrafts(draft.guild_id, draft.brand)) for (const m of await svc.getDraftMatches(d.id)) m.character_ids.forEach((id) => booked.add(String(id)));
    const { rows } = await pool.query(
        `SELECT c.id, c.name FROM characters c JOIN users u ON u.id = c.owner_id
         WHERE c.guild_id = $1 AND c.division = $2 AND c.status = 'approved' AND NOT u.is_placeholder
           AND NOT EXISTS (SELECT 1 FROM injuries i WHERE i.character_id = c.id AND i.cleared_at IS NULL AND i.returns_at >= CURRENT_DATE)
         ORDER BY c.name`, [draft.guild_id, draft.division]);
    const free = rows.filter((c) => !booked.has(String(c.id)));
    const pages = Math.max(1, Math.ceil(free.length / PAGE));
    const pg = Math.min(Math.max(0, page), pages - 1);
    return { list: free.slice(pg * PAGE, (pg + 1) * PAGE), page: pg, pages, total: free.length };
}

/** The edit screen: choose who to replace, then who comes in; title and stipulation dropdowns. */
async function editPanel(guildId, draftId, position, { slot = null, page = 0, notice = null } = {}) {
    const draft = await getDraftById(guildId, draftId);
    const slots = await svc.getDraftMatches(draft.id);
    const m = slots[position - 1];
    if (!m) return viewMessage(guildId, draft.brand, { notice: 'That match is gone.' });
    const { rows: chars } = await pool.query(`SELECT id, name FROM characters WHERE id = ANY($1::bigint[])`, [m.character_ids]);
    const nm = new Map(chars.map((c) => [String(c.id), c.name]));
    const [vs] = await slotNames([m]);
    const rows = [];
    rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`cardui:sl:${draft.id}:${position}`).setPlaceholder('Replace which wrestler?')
            .addOptions(m.character_ids.map((id, i) => ({ label: (nm.get(String(id)) || 'TBD').slice(0, 100), value: String(i), default: slot !== null && Number(slot) === i })))));
    let pagerRow = null;
    if (slot !== null && m.character_ids[slot] !== undefined) {
        const c = await candidates(draft, m, page);
        if (c.list.length) {
            rows.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId(`cardui:wr:${draft.id}:${position}:${slot}`).setPlaceholder(`Replace ${nm.get(String(m.character_ids[slot])) || 'them'} with… (page ${c.page + 1}/${c.pages})`)
                    .addOptions(c.list.map((x) => ({ label: x.name.slice(0, 100), value: String(x.id) })))));
            if (c.pages > 1) pagerRow = [btn(`cardui:wp:${draft.id}:${position}:${slot}:${c.page - 1}`, '◀ Previous', ButtonStyle.Secondary, c.page === 0), btn(`cardui:wp:${draft.id}:${position}:${slot}:${c.page + 1}`, 'Next ▶', ButtonStyle.Secondary, c.page >= c.pages - 1)];
        } else notice = `${notice ? `${notice}\n` : ''}No free healthy ${svc.divisionLabel(draft.division)} wrestlers to swap in.`;
    }
    // title
    const tag = isTag(m.match_type);
    const { rows: titles } = await pool.query(`SELECT id, name FROM titles WHERE guild_id = $1 AND division = $2 AND is_tag_title = $3 ORDER BY name LIMIT 24`, [draft.guild_id, draft.division, tag]);
    if (titles.length) {
        rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId(`cardui:tt:${draft.id}:${position}`).setPlaceholder('Title on the line?')
                .addOptions([{ label: 'No title', value: 'none', default: !m.title_id }, ...titles.map((t) => ({ label: t.name.slice(0, 100), value: String(t.id), default: String(m.title_id) === String(t.id) }))])));
    }
    rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`cardui:st:${draft.id}:${position}`).setPlaceholder('Stipulation?')
            .addOptions([{ label: 'No stipulation', value: 'none', default: !m.stipulation }, ...STIPULATIONS.slice(0, 24).map((s) => ({ label: s, value: s, default: m.stipulation === s }))])));
    const nav = [...(pagerRow || []), btn(`cardui:mp:${draft.id}:${position}`, '✅ Done')];
    rows.push(new ActionRowBuilder().addComponents(...nav));
    return {
        content: `${notice ? `${notice}\n\n` : ''}**Editing ${svc.divisionLabel(draft.division)} match ${position}:** ${vs}${m.stipulation ? ` _(${m.stipulation})_` : ''}\nPick who to replace, then who comes in. The dropdowns below set the title and stipulation.`,
        components: rows, files: [], embeds: [], allowedMentions: { parse: [] }
    };
}

function isTag(matchType) { return MATCH_CONFIG[matchType]?.winnerMode === 'team'; }

module.exports = {
    recordPanel, viewMessage, matchPanel, editPanel, removeConfirm, getDraftById };
