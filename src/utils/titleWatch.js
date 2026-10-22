const { pool, withTransaction } = require('../db/pool');
const { vacateTitle } = require('./titleLogic');
const { NO_MENTIONS } = require('./discordHelpers');
const { logAudit } = require('./audit');

const DAY = 864e5;
const daysSince = (d) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / DAY));

/** Today's date (YYYY-MM-DD) and hour in a time zone. */
function localNow(tz = 'UTC', now = new Date()) {
    let zone = tz;
    try { new Intl.DateTimeFormat('en-CA', { timeZone: zone }); } catch (_) { zone = 'UTC'; }
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hour12: false }).format(now)) % 24;
    return { date, hour };
}

/**
 * For every title that has a champion: how long since the belt was last defended,
 * and how long since the champion last wrestled at all.
 */
async function titleStatus(guildId) {
    const { rows: reigns } = await pool.query(
        `SELECT t.id AS title_id, t.name AS title_name, t.division, tr.id AS reign_id, tr.won_date, tr.character_id, tr.team_id, tr.is_interim,
                COALESCE(tm.name, c.name, tr.reign_char_name) AS holder
         FROM titles t
         JOIN title_reigns tr ON tr.title_id = t.id AND tr.lost_date IS NULL
         LEFT JOIN characters c ON c.id = tr.character_id
         LEFT JOIN teams tm ON tm.id = tr.team_id
         WHERE t.guild_id = $1 ORDER BY t.division, t.name`, [guildId]);
    const out = [];
    for (const r of reigns) {
        let charIds = [];
        if (r.team_id) {
            const { rows } = await pool.query(`SELECT character_id FROM title_reign_members WHERE reign_id = $1`, [r.reign_id]);
            charIds = rows.map((x) => x.character_id);
        } else if (r.character_id) charIds = [r.character_id];
        if (!charIds.length) continue; // a plain-text champion can't be tracked
        const { rows: a } = await pool.query(
            `SELECT (SELECT MAX(created_at) FROM matches WHERE title_id = $1) AS last_title,
                    (SELECT MAX(m.created_at) FROM matches m JOIN match_participants mp ON mp.match_id = m.id WHERE mp.character_id = ANY($2::bigint[])) AS last_any,
                    EXISTS (SELECT 1 FROM injuries WHERE character_id = ANY($2::bigint[]) AND cleared_at IS NULL AND returns_at >= CURRENT_DATE) AS injured`,
            [r.title_id, charIds]);
        const won = new Date(r.won_date);
        const later = (x) => (x && new Date(x) > won ? new Date(x) : won);
        out.push({
            ...r, charIds,
            daysSinceDefense: daysSince(later(a[0].last_title)),
            daysSinceActive: daysSince(later(a[0].last_any)),
            injured: a[0].injured
        });
    }
    return out;
}

async function adminChannel(client, g, { fallbackMatches = false } = {}) {
    const id = g.admin_channel_id || (fallbackMatches ? g.matches_channel_id : null);
    if (!id) return null;
    const ch = await client.channels.fetch(id).catch(() => null);
    return ch?.isTextBased() ? ch : null;
}

/** Daily: auto-vacate inactive champions, warn about belts that have not been defended. */
async function runTitleWatch(client, g) {
    if (!(g.defense_days > 0 || g.vacate_days > 0)) return;
    const { date } = localNow(g.tz);
    const { rowCount } = await pool.query(`UPDATE guilds SET deadline_last = $1 WHERE guild_id = $2 AND deadline_last IS DISTINCT FROM $1::date`, [date, g.guild_id]);
    if (!rowCount) return; // already done today
    const status = await titleStatus(g.guild_id);
    const warns = [];
    const vacated = [];
    for (const s of status) {
        if (g.vacate_days > 0 && s.daysSinceActive >= g.vacate_days) {
            const ended = await withTransaction((c) => vacateTitle(c, s.title_id));
            if (ended) {
                await pool.query(`UPDATE title_reigns SET notes = COALESCE(notes || ' · ', '') || 'Vacated: champion inactive' WHERE id = $1`, [ended.id]);
                await logAudit(g.guild_id, 'bot', 'title_auto_vacated', { title: s.title_name, holder: s.holder, inactiveDays: s.daysSinceActive });
                vacated.push(`🏳️ The **${s.title_name}** was vacated: **${s.holder}** has not wrestled in ${s.daysSinceActive} days.`);
                continue;
            }
        }
        if (g.vacate_days > 0 && s.daysSinceActive >= g.vacate_days - 7 && s.daysSinceActive < g.vacate_days) {
            warns.push({ titleId: s.title_id, line: `⏳ **${s.holder}** (${s.title_name}) has not wrestled in ${s.daysSinceActive} days. The belt is vacated at ${g.vacate_days}.${s.injured ? ' (injured)' : ''}` });
        }
        if (g.defense_days > 0 && s.daysSinceDefense >= g.defense_days) {
            warns.push({ titleId: s.title_id, line: `⚠️ The **${s.title_name}** has not been defended in ${s.daysSinceDefense} days (champion: **${s.holder}**${s.injured ? ', injured' : ''}).` });
        }
    }
    // warnings repeat at most once a week per title
    const warnIds = [...new Set(warns.map((w) => w.titleId))];
    let fresh = [];
    if (warnIds.length) {
        const { rows } = await pool.query(`UPDATE titles SET warned_on = $2::date WHERE id = ANY($1::bigint[]) AND (warned_on IS NULL OR warned_on <= $2::date - 7) RETURNING id`, [warnIds, date]);
        const ok = new Set(rows.map((r) => String(r.id)));
        fresh = warns.filter((w) => ok.has(String(w.titleId))).map((w) => w.line);
    }
    const all = [...vacated, ...fresh];
    if (!all.length) return;
    const ch = await adminChannel(client, g, { fallbackMatches: vacated.length > 0 });
    if (ch) await ch.send({ content: `**Title watch**\n${all.join('\n')}`.slice(0, 1900), allowedMentions: NO_MENTIONS }).catch((e) => console.error('Title watch post failed:', e.message));
    if (vacated.length && g.matches_channel_id && g.matches_channel_id !== ch?.id) {
        const pub = await client.channels.fetch(g.matches_channel_id).catch(() => null);
        if (pub?.isTextBased()) await pub.send({ content: vacated.join('\n'), allowedMentions: NO_MENTIONS }).catch(() => {});
    }
}

/** Expire old rematch rights and remind staff when one is about to run out. */
async function runRematchWatch(client, g) {
    await pool.query(`UPDATE rematch_rights SET status = 'expired' WHERE guild_id = $1 AND status = 'active' AND expires_on < CURRENT_DATE`, [g.guild_id]);
    const { rows } = await pool.query(
        `SELECT rr.id, rr.holder_name, rr.expires_on, t.name AS title_name
         FROM rematch_rights rr JOIN titles t ON t.id = rr.title_id
         WHERE rr.guild_id = $1 AND rr.status = 'active' AND NOT rr.reminded AND rr.expires_on - CURRENT_DATE <= 3`, [g.guild_id]);
    if (!rows.length) return;
    const ch = await adminChannel(client, g);
    await pool.query(`UPDATE rematch_rights SET reminded = true WHERE id = ANY($1::bigint[])`, [rows.map((r) => r.id)]);
    if (!ch) return;
    const lines = rows.map((r) => `🔁 **${r.holder_name}** is still owed a rematch for the **${r.title_name}** (expires ${new Date(r.expires_on).toISOString().slice(0, 10)}).`);
    await ch.send({ content: `**Rematch reminder**\n${lines.join('\n')}`, allowedMentions: NO_MENTIONS }).catch((e) => console.error('Rematch reminder failed:', e.message));
}

module.exports = { titleStatus, runTitleWatch, runRematchWatch, localNow, adminChannel, daysSince };
