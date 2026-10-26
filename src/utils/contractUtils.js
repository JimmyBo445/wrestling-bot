const { pool, withTransaction } = require('../db/pool');
const { UserError } = require('./errors');
const { localNow } = require('./titleWatch');

const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const prettyDate = (d) => new Date(`${ymd(d)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

async function todayFor(guildId) {
    const { rows } = await pool.query(`SELECT tz FROM guilds WHERE guild_id = $1`, [guildId]);
    return localNow(rows[0]?.tz || 'UTC').date;
}

async function getActive(characterId, client = pool) {
    const { rows } = await client.query(`SELECT * FROM contracts WHERE character_id = $1 AND status = 'active' ORDER BY id DESC LIMIT 1`, [characterId]);
    return rows[0] || null;
}

async function getContract(id, guildId) {
    const { rows } = await pool.query(
        `SELECT k.*, c.name AS char_name, c.division, c.image_url, c.owner_id, u.discord_id AS owner_discord_id
         FROM contracts k JOIN characters c ON c.id = k.character_id JOIN users u ON u.id = c.owner_id
         WHERE k.id = $1 AND k.guild_id = $2`, [id, guildId]);
    return rows[0] || null;
}

/**
 * Career earnings per wrestler, computed from the matches themselves (so undoing a match changes it):
 * salary per day while under contract + a bonus per win + a bigger bonus per title-match win.
 * Returns Map(characterId -> { salary, wins, titleWins, total }).
 */
async function earningsMap(guildId, { characterId = null } = {}) {
    const today = await todayFor(guildId);
    const { rows: g } = await pool.query(`SELECT contract_win_bonus, contract_title_bonus FROM guilds WHERE guild_id = $1`, [guildId]);
    const winBonus = Number(g[0]?.contract_win_bonus ?? 500), titleBonus = Number(g[0]?.contract_title_bonus ?? 2000);
    const { rows } = await pool.query(
        `WITH k AS (
            SELECT id, character_id, salary, start_date, LEAST(end_date, $2::date) AS eff_end
            FROM contracts WHERE guild_id = $1 AND status IN ('active','expired','released','replaced') AND start_date IS NOT NULL
              AND ($3::bigint IS NULL OR character_id = $3)
         )
         SELECT k.character_id, k.salary, GREATEST(0, k.eff_end - k.start_date) AS days,
                (SELECT COUNT(*)::int FROM match_participants mp JOIN matches m ON m.id = mp.match_id
                  WHERE mp.character_id = k.character_id AND mp.is_winner AND m.result_type = 'decisive'
                    AND m.created_at >= k.start_date AND m.created_at < k.eff_end + 1) AS wins,
                (SELECT COUNT(*)::int FROM match_participants mp JOIN matches m ON m.id = mp.match_id
                  WHERE mp.character_id = k.character_id AND mp.is_winner AND m.result_type = 'decisive' AND m.is_title_match
                    AND m.created_at >= k.start_date AND m.created_at < k.eff_end + 1) AS title_wins
         FROM k`, [guildId, today, characterId]);
    const out = new Map();
    for (const r of rows) {
        const e = out.get(String(r.character_id)) || { salary: 0, wins: 0, titleWins: 0, total: 0, winBonus, titleBonus };
        e.salary += Math.floor(Number(r.salary) * Number(r.days) / 30);
        e.wins += r.wins; e.titleWins += r.title_wins;
        out.set(String(r.character_id), e);
    }
    for (const e of out.values()) e.total = e.salary + (e.wins - e.titleWins) * winBonus + e.titleWins * (winBonus + titleBonus);
    return out;
}

/** Makes a pending offer/request the active contract (ends any current one first). */
async function activate(contractId, guildId) {
    const today = await todayFor(guildId);
    return withTransaction(async (client) => {
        const { rows } = await client.query(`SELECT * FROM contracts WHERE id = $1 AND guild_id = $2 FOR UPDATE`, [contractId, guildId]);
        const k = rows[0];
        if (!k || !['offered', 'requested'].includes(k.status)) throw new UserError('That contract is no longer waiting for an answer.');
        await client.query(
            `UPDATE contracts SET status = 'replaced', end_date = $2::date WHERE character_id = $1 AND status = 'active'`, [k.character_id, today]);
        const { rows: out } = await client.query(
            `UPDATE contracts SET status = 'active', start_date = $2::date, end_date = ($2::date + ($3 || ' months')::interval)::date, signed_at = now(), warned = false
             WHERE id = $1 RETURNING *`, [contractId, today, String(k.months)]);
        return out[0];
    });
}

async function closePending(contractId, guildId, status) {
    const { rowCount } = await pool.query(
        `UPDATE contracts SET status = $3 WHERE id = $1 AND guild_id = $2 AND status IN ('offered','requested')`, [contractId, guildId, status]);
    if (!rowCount) throw new UserError('That contract is no longer waiting for an answer.');
}

/** One line for a profile: "Contract through Mar 12, 2027 · $5,000/month · career earnings $48,500". */
async function profileLine(character) {
    const k = await getActive(character.id);
    if (!k) return null;
    const e = (await earningsMap(k.guild_id, { characterId: character.id })).get(String(character.id));
    return `📝 Contract through **${prettyDate(k.end_date)}** · ${money(k.salary)}/month${e ? ` · career earnings ${money(e.total)}` : ''}`;
}

/** Daily: expire finished contracts, warn about ones ending soon. Posts to the staff channel. */
async function runContractWatch(client, g) {
    const today = localNow(g.tz).date;
    const { rows: expired } = await pool.query(
        `UPDATE contracts SET status = 'expired' WHERE guild_id = $1 AND status = 'active' AND end_date < $2::date RETURNING id, character_id`, [g.guild_id, today]);
    const { rows: soon } = await pool.query(
        `UPDATE contracts SET warned = true WHERE guild_id = $1 AND status = 'active' AND warned = false AND end_date >= $2::date AND end_date <= ($2::date + 14) RETURNING id, character_id, end_date`, [g.guild_id, today]);
    if (!expired.length && !soon.length) return;
    const ids = [...expired, ...soon].map((r) => r.character_id);
    const { rows: who } = await pool.query(`SELECT c.id, c.name, u.discord_id FROM characters c JOIN users u ON u.id = c.owner_id WHERE c.id = ANY($1::bigint[])`, [ids]);
    const by = new Map(who.map((w) => [String(w.id), w]));
    const lines = [];
    for (const r of expired) lines.push(`⏰ **${by.get(String(r.character_id))?.name}**'s contract has expired (<@${by.get(String(r.character_id))?.discord_id}>). Renew it with \`/contract offer\`, or leave them as a free agent.`);
    for (const r of soon) lines.push(`📝 **${by.get(String(r.character_id))?.name}**'s contract ends ${prettyDate(r.end_date)} (<@${by.get(String(r.character_id))?.discord_id}> can ask for a renewal with \`/contract request\`).`);
    const id = g.admin_channel_id;
    if (!id) return;
    const ch = await client.channels.fetch(id).catch(() => null);
    if (ch?.isTextBased()) await ch.send({ content: lines.join('\n').slice(0, 1900), allowedMentions: { users: who.map((w) => w.discord_id) } });
}

module.exports = { money, ymd, prettyDate, todayFor, getActive, getContract, earningsMap, activate, closePending, profileLine, runContractWatch };
