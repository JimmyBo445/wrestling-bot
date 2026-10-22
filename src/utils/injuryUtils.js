const { pool } = require('../db/pool');

const ACTIVE = `i.cleared_at IS NULL AND i.returns_at >= CURRENT_DATE`;

/** Map of characterId -> { returns_at (YYYY-MM-DD), reason } for those currently injured. */
async function injuredMap(characterIds, client = pool) {
    const ids = (characterIds || []).map(String).filter((x) => /^\d+$/.test(x));
    if (!ids.length) return new Map();
    const { rows } = await client.query(
        `SELECT i.character_id, to_char(i.returns_at, 'YYYY-MM-DD') AS returns_at, i.reason
         FROM injuries i WHERE i.character_id = ANY($1::bigint[]) AND ${ACTIVE}`, [ids]);
    return new Map(rows.map((r) => [String(r.character_id), r]));
}

const fmt = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Warning lines for any injured wrestlers in a list of { id, name }. */
async function injuryWarnings(chars) {
    const m = await injuredMap(chars.map((c) => c.id));
    return chars.filter((c) => m.has(String(c.id))).map((c) => {
        const i = m.get(String(c.id));
        return `**${c.name}** is injured until ${fmt(i.returns_at)}${i.reason ? ` (${i.reason})` : ''}.`;
    });
}

module.exports = { ACTIVE, injuredMap, injuryWarnings, fmt };
