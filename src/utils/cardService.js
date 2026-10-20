const { pool, withTransaction } = require('../db/pool');
const { MATCH_CONFIG, isTeamMatch, matchLabel, MAX_CARD_MATCHES, CARD_BRANDS, DIVISION_THEME } = require('./constants');
const { UserError } = require('./errors');
const { requireCharacter } = require('./characterUtils');
const { requireTitle, getCurrentReign } = require('./titleLogic');
const { findTeamForCharacters, getTeamMembers } = require('./teamUtils');
const { getDisplayNames } = require('./discordHelpers');

const brandLabel = (b) => CARD_BRANDS[b]?.name || b;
const divisionLabel = (d) => DIVISION_THEME[d]?.label || d;
const cardLabel = (draft) => `${brandLabel(draft.brand)} ${divisionLabel(draft.division)}`;
const ids = (arr) => arr.map(String);

// ------------------------------------------------------------------ drafts

async function getDraft(guildId, brand, division, client = pool, lock = false) {
    const { rows } = await client.query(
        `SELECT * FROM card_drafts WHERE guild_id = $1 AND brand = $2 AND division = $3 ${lock ? 'FOR UPDATE' : ''}`,
        [guildId, brand, division]
    );
    return rows[0] || null;
}

async function requireDraft(guildId, brand, division, client = pool, lock = false) {
    const d = await getDraft(guildId, brand, division, client, lock);
    if (!d) throw new UserError(`There's no ${brandLabel(brand)} ${divisionLabel(division)} card yet. Start one with \`/card new\` or \`/card auto\`.`);
    return d;
}

/** Starts a fresh, empty card for this brand + division (replacing any card already there). */
async function startDraft(guildId, brand, division, createdBy, name = null, client = pool) {
    const { rows } = await client.query(
        `INSERT INTO card_drafts (guild_id, brand, division, name, created_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (guild_id, brand, division)
         DO UPDATE SET name = EXCLUDED.name, created_by = EXCLUDED.created_by, created_at = now(), updated_at = now()
         RETURNING *`,
        [guildId, brand, division, name, createdBy]
    );
    await client.query(`DELETE FROM card_draft_matches WHERE draft_id = $1`, [rows[0].id]);
    return rows[0];
}

async function getDraftMatches(draftId, client = pool) {
    const { rows } = await client.query(`SELECT * FROM card_draft_matches WHERE draft_id = $1 ORDER BY position`, [draftId]);
    return rows.map((r) => ({ ...r, character_ids: ids(r.character_ids) }));
}

/** Rewrites the whole running order (used by add, remove, move and auto). */
async function saveMatches(client, draftId, list) {
    await client.query(`DELETE FROM card_draft_matches WHERE draft_id = $1`, [draftId]);
    for (let i = 0; i < list.length; i++) {
        const m = list[i];
        await client.query(
            `INSERT INTO card_draft_matches (draft_id, position, match_type, character_ids, title_id, stipulation)
             VALUES ($1, $2, $3, $4::bigint[], $5, $6)`,
            [draftId, i + 1, m.match_type, m.character_ids, m.title_id || null, m.stipulation || null]
        );
    }
    await client.query(`UPDATE card_drafts SET updated_at = now() WHERE id = $1`, [draftId]);
}

// ------------------------------------------------------------------ manual booking

/**
 * Checks and adds one match. Returns { number, warnings:[string] }.
 * Only plans a match: nothing is logged and no stats change until the match is logged with /match.
 */
async function addMatchToCard(guildId, brand, division, { matchType, characterIds, titleId = null, stipulation = null }) {
    const config = MATCH_CONFIG[matchType];
    if (!config) throw new UserError('Unknown match type.');
    const need = config.slots.length;
    if (characterIds.length !== need) {
        const hint = isTeamMatch(matchType)
            ? ` List Team 1 first (wrestler 1-${need / 2}), then Team 2 (wrestler ${need / 2 + 1}-${need}).`
            : '';
        throw new UserError(`A **${config.label}** needs exactly **${need}** wrestlers, but you picked ${characterIds.length}.${hint}`);
    }
    if (new Set(ids(characterIds)).size !== need) throw new UserError('The same wrestler can\'t be in a match twice.');
    if (stipulation && stipulation.length > 40) throw new UserError('Keep the stipulation under 40 characters (for example "No DQ" or "Steel Cage").');

    const chars = [];
    for (const v of characterIds) chars.push(await requireCharacter(guildId, v, { statuses: ['approved'] }));
    const wrong = chars.filter((c) => c.division !== division);
    if (wrong.length) {
        throw new UserError(`This is the **${divisionLabel(division)}** card, but ${wrong.map((c) => `**${c.name}**`).join(', ')} ${wrong.length > 1 ? 'are' : 'is'} in a different division.`);
    }

    const warnings = [];
    let title = null;
    if (titleId) {
        title = await requireTitle(guildId, titleId);
        if (title.division !== division) throw new UserError(`The **${title.name}** is a ${divisionLabel(title.division)} title, so it can't go on the ${divisionLabel(division)} card.`);
        if (title.is_tag_title && !isTeamMatch(matchType)) throw new UserError(`The **${title.name}** is a tag title. Use a tag match type (2v2, 3v3, 6-man or 8-man).`);
        if (!title.is_tag_title && isTeamMatch(matchType)) throw new UserError(`The **${title.name}** is a singles title, so it needs a singles, triple threat, fatal 4-way or 5-way match.`);
        const reign = await getCurrentReign(title.id);
        if (reign) {
            if (title.is_tag_title) {
                const half = need / 2;
                const t1 = await findTeamForCharacters(guildId, chars.slice(0, half).map((c) => c.id));
                const t2 = await findTeamForCharacters(guildId, chars.slice(half).map((c) => c.id));
                if (![t1, t2].some((t) => t && String(t.id) === String(reign.team_id))) {
                    warnings.push(`The champions (**${reign.team_name || 'the current team'}**) aren't in this match, so it can't be logged as a title match until they are.`);
                }
            } else if (!chars.some((c) => String(c.id) === String(reign.character_id))) {
                warnings.push(`The champion (**${reign.character_name || 'current champion'}**) isn't in this match, so it can't be logged as a title match until they are.`);
            }
        }
    }

    return withTransaction(async (client) => {
        const draft = await requireDraft(guildId, brand, division, client, true);
        const matches = await getDraftMatches(draft.id, client);
        if (matches.length >= MAX_CARD_MATCHES) {
            throw new UserError(`The ${cardLabel(draft)} card already has ${MAX_CARD_MATCHES} matches, which is the max. Remove one with \`/card remove\` first.`);
        }
        const onCard = new Map();
        for (const m of matches) for (const id of m.character_ids) onCard.set(id, true);
        const dupes = chars.filter((c) => onCard.has(String(c.id)));
        if (dupes.length) {
            throw new UserError(`${dupes.map((c) => `**${c.name}**`).join(', ')} ${dupes.length > 1 ? 'are' : 'is'} already booked on this card. A wrestler can only be in one match per card.`);
        }
        matches.push({ match_type: matchType, character_ids: ids(chars.map((c) => c.id)), title_id: title?.id || null, stipulation: stipulation?.trim() || null });
        await saveMatches(client, draft.id, matches);
        return { number: matches.length, warnings };
    });
}

async function removeMatchFromCard(guildId, brand, division, number) {
    return withTransaction(async (client) => {
        const draft = await requireDraft(guildId, brand, division, client, true);
        const matches = await getDraftMatches(draft.id, client);
        if (number < 1 || number > matches.length) throw new UserError(matches.length ? `Pick a match number from 1 to ${matches.length}.` : 'That card has no matches yet.');
        matches.splice(number - 1, 1);
        await saveMatches(client, draft.id, matches);
        return matches.length;
    });
}

async function moveMatchOnCard(guildId, brand, division, from, to) {
    return withTransaction(async (client) => {
        const draft = await requireDraft(guildId, brand, division, client, true);
        const matches = await getDraftMatches(draft.id, client);
        if (!matches.length) throw new UserError('That card has no matches yet.');
        if (from < 1 || from > matches.length || to < 1 || to > matches.length) throw new UserError(`Match numbers go from 1 to ${matches.length}.`);
        const [m] = matches.splice(from - 1, 1);
        matches.splice(to - 1, 0, m);
        await saveMatches(client, draft.id, matches);
        return matches.length;
    });
}

async function clearCard(guildId, brand, division) {
    const { rowCount } = await pool.query(`DELETE FROM card_drafts WHERE guild_id = $1 AND brand = $2 AND division = $3`, [guildId, brand, division]);
    if (!rowCount) throw new UserError(`There's no ${brandLabel(brand)} ${divisionLabel(division)} card to clear.`);
}

// ------------------------------------------------------------------ rendering data

/** Loads a card and everything needed to draw it. */
async function buildShowData(guild, draft) {
    const matches = await getDraftMatches(draft.id);
    const allIds = [...new Set(matches.flatMap((m) => m.character_ids))];
    const { rows: chars } = allIds.length
        ? await pool.query(`SELECT c.id, c.name, c.division, c.image_url, u.discord_id FROM characters c JOIN users u ON u.id = c.owner_id WHERE c.id = ANY($1::bigint[])`, [allIds])
        : { rows: [] };
    const owners = await getDisplayNames(guild, chars.map((c) => c.discord_id), 2500);
    const byId = new Map(chars.map((c) => [String(c.id), c]));
    const titleIds = [...new Set(matches.map((m) => m.title_id).filter(Boolean))];
    const { rows: titles } = titleIds.length ? await pool.query(`SELECT id, name FROM titles WHERE id = ANY($1::bigint[])`, [titleIds]) : { rows: [] };
    const titleName = new Map(titles.map((t) => [String(t.id), t.name]));

    const member = (id) => {
        const c = byId.get(String(id));
        return c ? { name: c.name, division: c.division, imageUrl: c.image_url, owner: owners.get(c.discord_id) || null } : { name: 'TBD', division: draft.division, imageUrl: null };
    };

    const out = [];
    for (const m of matches) {
        const config = MATCH_CONFIG[m.match_type];
        const base = {
            number: m.position, label: config?.label || m.match_type, stipulation: m.stipulation,
            title: m.title_id ? titleName.get(String(m.title_id)) || null : null
        };
        if (!config) continue;
        if (config.winnerMode === 'team') {
            const half = m.character_ids.length / 2;
            const sides = [];
            for (const part of [m.character_ids.slice(0, half), m.character_ids.slice(half)]) {
                const team = part.every((id) => byId.has(String(id))) ? await findTeamForCharacters(draft.guild_id, part) : null;
                sides.push({ teamName: team?.name || null, members: part.map(member) });
            }
            out.push({ ...base, mode: 'sides', sides });
        } else if (m.character_ids.length === 2) {
            out.push({ ...base, mode: 'sides', sides: m.character_ids.map((id) => ({ teamName: null, members: [member(id)] })) });
        } else {
            out.push({ ...base, mode: 'ffa', entrants: m.character_ids.map(member) });
        }
    }
    return { serverName: guild?.name || null, brand: draft.brand, division: draft.division, name: draft.name, matches: out };
}

/** Plain-text running order for replies. */
async function describeCard(draft) {
    const matches = await getDraftMatches(draft.id);
    if (!matches.length) return '_No matches yet._';
    const allIds = [...new Set(matches.flatMap((m) => m.character_ids))];
    const { rows: chars } = await pool.query(`SELECT id, name FROM characters WHERE id = ANY($1::bigint[])`, [allIds]);
    const nm = new Map(chars.map((c) => [String(c.id), c.name]));
    const titleIds = [...new Set(matches.map((m) => m.title_id).filter(Boolean))];
    const { rows: titles } = titleIds.length ? await pool.query(`SELECT id, name FROM titles WHERE id = ANY($1::bigint[])`, [titleIds]) : { rows: [] };
    const tn = new Map(titles.map((t) => [String(t.id), t.name]));
    const n = (id) => nm.get(String(id)) || 'TBD';
    return matches.map((m) => {
        const config = MATCH_CONFIG[m.match_type];
        let who;
        if (config?.winnerMode === 'team') {
            const half = m.character_ids.length / 2;
            who = `${m.character_ids.slice(0, half).map(n).join(' & ')} vs ${m.character_ids.slice(half).map(n).join(' & ')}`;
        } else if (m.character_ids.length === 2) who = `${n(m.character_ids[0])} vs ${n(m.character_ids[1])}`;
        else who = m.character_ids.map(n).join(', ');
        return `**${m.position}.** ${matchLabel(m.match_type)}: ${who}${m.title_id ? ` 🏆 ${tn.get(String(m.title_id)) || 'title'}` : ''}${m.stipulation ? ` _(${m.stipulation})_` : ''}`;
    }).join('\n');
}

// ------------------------------------------------------------------ auto generator

const RECENT_DAYS = 30;
const RIVALRY_DAYS = 90;

/**
 * Plans a card from what has happened lately:
 *  1. title matches for current champions (vs their #1 contender, or the best recent winner)
 *  2. rematches of recent decisive matches (a repeat that has happened 2+ times is tagged "Rivalry")
 *  3. fresh matchups for wrestlers who are not booked yet (least-faced opponents, different players first)
 * Returns matches in running order: fresh first, then rematches, then title matches last.
 */
async function planCard(guildId, division, count) {
    const { rows: pool_ } = await pool.query(
        `SELECT c.id, c.name, c.owner_id FROM characters c WHERE c.guild_id = $1 AND c.division = $2 AND c.status = 'approved'`,
        [guildId, division]
    );
    if (pool_.length < 2) throw new UserError(`There aren't enough approved ${divisionLabel(division)} wrestlers to build a card (need at least 2).`);
    const chars = new Map(pool_.map((c) => [String(c.id), c]));
    const used = new Set();
    const free = (id) => chars.has(String(id)) && !used.has(String(id));
    const take = (list) => list.forEach((i) => used.add(String(i)));

    // recent form: wins in the last RECENT_DAYS, and last time each wrestler appeared
    const { rows: act } = await pool.query(
        `SELECT mp.character_id, COUNT(*) FILTER (WHERE mp.is_winner AND m.result_type = 'decisive' AND m.created_at > now() - ($3 || ' days')::interval)::int AS recent_wins,
                MAX(m.created_at) AS last_seen
         FROM match_participants mp JOIN matches m ON m.id = mp.match_id
         JOIN characters c ON c.id = mp.character_id
         WHERE c.guild_id = $1 AND c.division = $2 GROUP BY mp.character_id`,
        [guildId, division, String(RECENT_DAYS)]
    );
    const wins = new Map(act.map((r) => [String(r.character_id), r.recent_wins]));
    const lastSeen = new Map(act.map((r) => [String(r.character_id), new Date(r.last_seen).getTime()]));

    // how often each pair has met (all time)
    const { rows: meet } = await pool.query(
        `SELECT a.character_id AS a, b.character_id AS b, COUNT(DISTINCT a.match_id)::int AS n
         FROM match_participants a JOIN match_participants b ON b.match_id = a.match_id AND a.character_id < b.character_id
         JOIN characters ca ON ca.id = a.character_id
         WHERE ca.guild_id = $1 AND ca.division = $2 GROUP BY a.character_id, b.character_id`,
        [guildId, division]
    );
    const pairKey = (x, y) => (String(x) < String(y) ? `${x}:${y}` : `${y}:${x}`);
    const meetings = new Map(meet.map((r) => [pairKey(r.a, r.b), r.n]));
    const meets = (x, y) => meetings.get(pairKey(x, y)) || 0;

    const titleMatches = [];
    const rematches = [];
    const fresh = [];

    // ---- 1. title matches
    const { rows: titles } = await pool.query(`SELECT * FROM titles WHERE guild_id = $1 AND division = $2 ORDER BY id`, [guildId, division]);
    const { rows: conts } = await pool.query(
        `SELECT title_id, character_id, team_id FROM contenders WHERE guild_id = $1 AND status = 'active'`, [guildId]);
    const contenderOf = new Map(conts.map((c) => [String(c.title_id), c]));
    const titleCap = Math.max(1, Math.floor(count / 2));
    const withContender = [...titles].sort((a, b) => (contenderOf.has(String(b.id)) ? 1 : 0) - (contenderOf.has(String(a.id)) ? 1 : 0));
    const bestFree = (excludeIds, preferNotOwner) => {
        const cands = [...chars.values()].filter((c) => free(c.id) && !excludeIds.includes(String(c.id)));
        cands.sort((x, y) =>
            ((preferNotOwner && String(x.owner_id) === String(preferNotOwner)) ? 1 : 0) - ((preferNotOwner && String(y.owner_id) === String(preferNotOwner)) ? 1 : 0) ||
            (wins.get(String(y.id)) || 0) - (wins.get(String(x.id)) || 0));
        return cands[0] || null;
    };

    for (const title of withContender) {
        if (titleMatches.length >= titleCap || titleMatches.length + 1 > count) break;
        const reign = await getCurrentReign(title.id);
        const cont = contenderOf.get(String(title.id));
        if (title.is_tag_title) {
            if (!reign?.team_id) continue;
            const champs = await getTeamMembers(reign.team_id);
            const size = champs.length;
            if (![2, 3].includes(size) || !champs.every((c) => free(c.id))) continue;
            let challengerIds = null;
            if (cont?.team_id) {
                const mem = await getTeamMembers(cont.team_id);
                if (mem.length === size && mem.every((c) => free(c.id)) && String(cont.team_id) !== String(reign.team_id)) challengerIds = mem.map((c) => String(c.id));
            }
            if (!challengerIds) {
                const { rows: teams } = await pool.query(`SELECT id FROM teams WHERE guild_id = $1 AND division = $2 AND status = 'active' AND id <> $3`, [guildId, division, reign.team_id]);
                let best = null;
                for (const t of teams) {
                    const mem = await getTeamMembers(t.id);
                    if (mem.length !== size || !mem.every((c) => free(c.id))) continue;
                    const score = mem.reduce((s, c) => s + (wins.get(String(c.id)) || 0), 0);
                    if (!best || score > best.score) best = { score, ids: mem.map((c) => String(c.id)) };
                }
                if (best) challengerIds = best.ids;
            }
            if (!challengerIds) continue;
            const mine = champs.map((c) => String(c.id));
            take(mine); take(challengerIds);
            titleMatches.push({ match_type: size === 2 ? 'tag2v2' : 'tag3v3', character_ids: [...mine, ...challengerIds], title_id: title.id, stipulation: cont?.team_id ? null : 'Open Challenge' });
        } else if (reign?.character_id && !reign.team_id) {
            const champ = chars.get(String(reign.character_id));
            if (!champ || !free(champ.id)) continue;
            let opp = cont?.character_id && free(cont.character_id) && String(cont.character_id) !== String(champ.id) ? chars.get(String(cont.character_id)) : null;
            const viaContender = Boolean(opp);
            if (!opp) opp = bestFree([String(champ.id)], champ.owner_id);
            if (!opp) continue;
            take([champ.id, opp.id]);
            titleMatches.push({ match_type: 'singles', character_ids: [String(champ.id), String(opp.id)], title_id: title.id, stipulation: viaContender ? null : 'Open Challenge' });
        }
        // vacant titles are skipped on purpose: an admin leaves them vacant deliberately
    }

    // ---- 2. rematches of recent matches
    const remaining = () => count - titleMatches.length - rematches.length - fresh.length;
    const rematchCap = Math.max(1, Math.ceil((count - titleMatches.length) * 0.4));
    const { rows: recent } = await pool.query(
        `SELECT m.id, m.match_type, m.created_at,
                json_agg(json_build_object('c', mp.character_id, 't', mp.team_number, 'w', mp.is_winner) ORDER BY mp.team_number NULLS FIRST, mp.id) AS parts
         FROM matches m JOIN match_participants mp ON mp.match_id = m.id
         WHERE m.guild_id = $1 AND m.result_type = 'decisive' AND m.title_id IS NULL AND m.contender_title_id IS NULL
           AND m.created_at > now() - ($3 || ' days')::interval
           AND NOT EXISTS (SELECT 1 FROM match_participants x JOIN characters cx ON cx.id = x.character_id WHERE x.match_id = m.id AND cx.division <> $2)
         GROUP BY m.id ORDER BY m.created_at DESC LIMIT 60`,
        [guildId, division, String(RECENT_DAYS)]
    );
    const rivalryCount = new Map();
    if (recent.length) {
        const { rows: rv } = await pool.query(
            `SELECT a.character_id AS a, b.character_id AS b, COUNT(DISTINCT a.match_id)::int AS n
             FROM match_participants a JOIN match_participants b ON b.match_id = a.match_id AND a.character_id < b.character_id
             JOIN matches m ON m.id = a.match_id JOIN characters ca ON ca.id = a.character_id
             WHERE ca.guild_id = $1 AND ca.division = $2 AND m.created_at > now() - ($3 || ' days')::interval AND m.match_type = 'singles'
             GROUP BY a.character_id, b.character_id`,
            [guildId, division, String(RIVALRY_DAYS)]);
        for (const r of rv) rivalryCount.set(pairKey(r.a, r.b), r.n);
    }
    for (const m of recent) {
        if (rematches.length >= rematchCap || remaining() <= 0) break;
        const parts = m.parts.map((p) => ({ c: String(p.c), t: p.t, w: p.w }));
        if (!parts.every((p) => free(p.c))) continue;
        let order = parts.map((p) => p.c);
        if (m.match_type === 'singles') {
            const loser = parts.find((p) => !p.w), winner = parts.find((p) => p.w);
            if (!loser || !winner) continue;
            order = [loser.c, winner.c];
        }
        const config = MATCH_CONFIG[m.match_type];
        if (!config || order.length !== config.slots.length) continue;
        take(order);
        const times = m.match_type === 'singles' ? rivalryCount.get(pairKey(order[0], order[1])) || 1 : 1;
        rematches.push({ match_type: m.match_type, character_ids: order, title_id: null, stipulation: times >= 2 ? 'Rivalry' : 'Rematch' });
    }

    // ---- 3. fresh matchups for everyone still free
    const order = [...chars.values()].filter((c) => free(c.id))
        .sort((x, y) => (lastSeen.get(String(x.id)) || 0) - (lastSeen.get(String(y.id)) || 0) || Math.random() - 0.5);
    while (remaining() > 0) {
        const a = order.find((c) => free(c.id));
        if (!a) break;
        const opps = order.filter((c) => free(c.id) && String(c.id) !== String(a.id));
        if (!opps.length) break;
        opps.sort((x, y) =>
            ((String(x.owner_id) === String(a.owner_id)) ? 1 : 0) - ((String(y.owner_id) === String(a.owner_id)) ? 1 : 0) ||
            meets(a.id, x.id) - meets(a.id, y.id) ||
            (lastSeen.get(String(x.id)) || 0) - (lastSeen.get(String(y.id)) || 0));
        const b = opps[0];
        take([a.id, b.id]);
        fresh.push({ match_type: 'singles', character_ids: [String(a.id), String(b.id)], title_id: null, stipulation: null });
    }

    // ---- 4. top up with more rematches if there were not enough fresh faces
    for (const m of recent) {
        if (remaining() <= 0) break;
        const parts = m.parts.map((p) => ({ c: String(p.c), w: p.w }));
        if (!parts.every((p) => free(p.c))) continue;
        let o = parts.map((p) => p.c);
        if (m.match_type === 'singles') { const l = parts.find((p) => !p.w), w = parts.find((p) => p.w); if (!l || !w) continue; o = [l.c, w.c]; }
        const config = MATCH_CONFIG[m.match_type];
        if (!config || o.length !== config.slots.length) continue;
        take(o);
        rematches.push({ match_type: m.match_type, character_ids: o, title_id: null, stipulation: 'Rematch' });
    }

    // main event last: title matches in reverse catalogue order (top title closes the show)
    return [...fresh, ...rematches, ...titleMatches.reverse()].slice(0, count);
}

/** Generates a card and saves it as the draft for this brand + division. */
async function autoCard(guildId, brand, division, createdBy, count, name = null) {
    const plan = await planCard(guildId, division, count);
    if (!plan.length) throw new UserError('I couldn\'t find enough free wrestlers to book any matches.');
    return withTransaction(async (client) => {
        const draft = await startDraft(guildId, brand, division, createdBy, name, client);
        await saveMatches(client, draft.id, plan);
        return { draft, planned: plan.length };
    });
}

module.exports = {
    brandLabel, divisionLabel, cardLabel, getDraft, requireDraft, startDraft, getDraftMatches,
    addMatchToCard, removeMatchFromCard, moveMatchOnCard, clearCard, buildShowData, describeCard, planCard, autoCard
};
