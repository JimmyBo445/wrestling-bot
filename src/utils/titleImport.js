// Brings in old title history from a CSV file (/admin import what:titles).
// Each line is one reign. Reigns are added as historical (backfilled) reigns with a plain-text holder name,
// and every Discord ID in `members` gets player credit for the reign.
// It never changes or removes anything already in the bot: lines that overlap an existing reign are skipped.
const { pool, withTransaction } = require('../db/pool');
const { UserError } = require('./errors');
const { ensureUser } = require('./ensureGuild');
const { setVacancy } = require('./titleLogic');
const { logAudit } = require('./audit');

const MAX_TITLE_ROWS = 500;

/** "FNLW Women's World Champion" and "Women's World Championship" both become "womensworld". */
const normTitle = (s) => String(s || '').toLowerCase()
    .replace(/<@&\d+>/g, '')
    .replace(/\bfnlw\b|\bchampionships?\b|\bchampions?\b|\btitles?\b|\bbelts?\b|\(retired\)/g, '')
    .replace(/[^a-z0-9]/g, '');
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Accepts 4/1/23, 4/1/2023 or 2023-04-01. Returns YYYY-MM-DD, null for empty, or false if it isn't a real date. */
function parseFlexDate(raw) {
    const v = String(raw || '').trim();
    if (!v) return null;
    let y, m, d;
    let hit = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (hit) [, y, m, d] = hit.map(Number);
    else if ((hit = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) {
        [, m, d, y] = hit.map(Number);
        if (y < 100) y += 2000;
    } else return false;
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const t = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso) return false;
    return iso;
}

/** "<@123> <@456>", "123 & 456" → ['123','456']. Anything that isn't a Discord ID is ignored. */
const parseMembers = (raw) => [...new Set((String(raw || '').match(/\d{15,25}/g) || []))];

const INF = '9999-12-31';
const overlaps = (a, b) => a.won < (b.lost || INF) && (a.lost || INF) > b.won;

/** Dry-runs (apply=false) or imports title reigns. Returns { ok:[], problems:[], skipped:[] }. */
async function importTitles(guildId, rows, { apply, actor, today = new Date().toISOString().slice(0, 10) }) {
    if (rows.length > MAX_TITLE_ROWS) throw new UserError(`Up to ${MAX_TITLE_ROWS} reigns per file, please. Split it into two files.`);
    const { rows: titles } = await pool.query(`SELECT id, name, is_tag_title FROM titles WHERE guild_id = $1`, [guildId]);
    const byNorm = new Map(titles.map((t) => [normTitle(t.name), t]));

    const ok = [], problems = [], skipped = [];
    for (const r of rows) {
        const rawTitle = r.title || r.championship || r.belt;
        const title = byNorm.get(normTitle(rawTitle));
        const holder = (r.holder || r.champion || r.team || r.name || '').slice(0, 80).trim();
        const won = parseFlexDate(r.won || r.wondate || r.start || r.from);
        const lost = parseFlexDate(r.lost || r.lostdate || r.end || r.to);
        const defenses = r.defenses === undefined || r.defenses === '' ? 0 : Number(r.defenses);
        const where = `Line ${r._line}${holder ? ` (${holder})` : ''}`;
        if (!title) { problems.push(`${where}: I don't know a title called "${rawTitle || ''}". Use the name from \`/championship list\`.`); continue; }
        if (!holder) { problems.push(`${where}: no holder name.`); continue; }
        if (!won) { problems.push(`${where}: the won date ${won === false ? 'isn\'t a real date' : 'is missing'} (use 4/1/23 or 2023-04-01).`); continue; }
        if (lost === false) { problems.push(`${where}: the lost date isn't a real date. Leave it empty for the current champion.`); continue; }
        if (won > today || (lost && lost > today)) { problems.push(`${where}: that date is in the future.`); continue; }
        if (lost && lost < won) { problems.push(`${where}: the lost date is before the won date.`); continue; }
        if (!Number.isInteger(defenses) || defenses < 0 || defenses > 999) { problems.push(`${where}: defenses must be a whole number.`); continue; }
        ok.push({ line: r._line, title, holder, won, lost, defenses, members: parseMembers(r.members || r.players || r.discordids || r.ids), notes: (r.notes || '').slice(0, 200).trim() || null });
    }

    // Same order the bot numbers reigns in: by won date, a one-day reign before one that starts the same day.
    ok.sort((a, b) => a.title.id - b.title.id || a.won.localeCompare(b.won) || (a.lost || INF).localeCompare(b.lost || INF) || a.line - b.line);

    const keep = [];
    const { rows: existing } = await pool.query(
        `SELECT tr.title_id, tr.won_date::text AS won, tr.lost_date::text AS lost, COALESCE(tm.name, c.name, tr.reign_char_name) AS holder
         FROM title_reigns tr JOIN titles t ON t.id = tr.title_id
         LEFT JOIN characters c ON c.id = tr.character_id LEFT JOIN teams tm ON tm.id = tr.team_id
         WHERE t.guild_id = $1`, [guildId]);
    for (const x of ok) {
        const where = `Line ${x.line} (${x.holder}, ${x.title.name})`;
        const mine = existing.filter((e) => String(e.title_id) === String(x.title.id));
        if (mine.some((e) => e.won === x.won && normName(e.holder) === normName(x.holder))) { skipped.push(`${where}: already in the bot.`); continue; }
        const clash = mine.find((e) => overlaps(x, e));
        if (clash) { problems.push(`${where}: overlaps **${clash.holder}** (${clash.won} → ${clash.lost || 'now'}) already in the bot. Skipped.`); continue; }
        const prev = keep.filter((k) => k.title.id === x.title.id).find((k) => overlaps(x, k));
        if (prev) { problems.push(`${where}: overlaps line ${prev.line} (${prev.holder}) in this file. Skipped.`); continue; }
        keep.push(x);
    }

    if (apply && keep.length) {
        await withTransaction(async (client) => {
            for (const x of keep) {
                const { rows: ins } = await client.query(
                    `INSERT INTO title_reigns (guild_id, title_id, reign_char_name, won_date, lost_date, defenses, is_backfilled, entered_by, notes)
                     VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8) RETURNING id`,
                    [guildId, x.title.id, x.holder, x.won, x.lost, x.defenses, actor, x.notes]);
                for (const id of x.members) {
                    const userId = await ensureUser(guildId, id, client);
                    await client.query(`INSERT INTO reign_owners (reign_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ins[0].id, userId]);
                }
            }
            for (const tid of new Set(keep.map((x) => x.title.id))) await setVacancy(client, tid);
        });
        await logAudit(guildId, actor, 'import_titles', { count: keep.length });
    }
    return { ok: keep, problems, skipped };
}

const TEMPLATE = 'title,holder,members,won,lost,defenses,notes\n'
    + 'World Heavyweight Championship,Jey Uso,123456789012345678,4/1/23,5/23/23,1,\n'
    + "Men's Tag Team Championship,The Bloodline,123456789012345678 234567890123456789,5/10/25,6/8/25,3,\n"
    + 'Intercontinental Championship,Some Champ,345678901234567890,4/30/26,,2,\n';

module.exports = { importTitles, parseFlexDate, normTitle, parseMembers, TEMPLATE, MAX_TITLE_ROWS };
