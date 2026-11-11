// /team (3.5): tag teams AND factions in one command. The old /faction is retired.
//   /team create kind:Tag team|Faction name member1 member2 …   (a faction needs 3+; its division
//        defaults to member1's division)
//   /team list [kind] · profile · add-member · remove-member · rename · disband   (pick any team or
//        faction from the same list)
// Underneath, the original tag team and faction code does the work (src/modules/tagteam.js and
// src/modules/faction.js), so every rule and check is unchanged.
const { SlashCommandBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { UserError } = require('../utils/errors');
const { respond, EPHEMERAL } = require('../utils/discordHelpers');

const tag = () => require('../modules/tagteam');
const fac = () => require('../modules/faction');
const DIVS = [{ name: "Men's", value: 'mens' }, { name: "Women's", value: 'womens' }, { name: 'Custom', value: 'custom' }, { name: "Custom Women's", value: 'custom_womens' }];
const KIND = (o, req = true, desc = 'Tag team or faction') => o.setName('kind').setDescription(desc).setRequired(req).addChoices({ name: 'Tag team', value: 'tag' }, { name: 'Faction', value: 'faction' });
const GROUP = (o) => o.setName('group').setDescription('The tag team or faction').setRequired(true).setAutocomplete(true);
const CHAR = (o, name, desc, req) => o.setName(name).setDescription(desc).setRequired(req).setAutocomplete(true);

const data = new SlashCommandBuilder()
    .setName('team')
    .setDescription('Tag teams and factions: create, view and manage')
    .setDMPermission(false)
    .addSubcommand((s) => {
        s.setName('create').setDescription('[Admin] Create a tag team (2-4) or a faction (3-8)')
            .addStringOption((o) => KIND(o))
            .addStringOption((o) => o.setName('name').setDescription('Name').setRequired(true).setMaxLength(40))
            .addStringOption((o) => CHAR(o, 'member1', 'First member', true))
            .addStringOption((o) => CHAR(o, 'member2', 'Second member', true));
        for (let n = 3; n <= 8; n++) s.addStringOption((o) => CHAR(o, `member${n}`, n <= 4 ? `Member ${n} (optional)` : `Member ${n} (factions only)`, false));
        return s.addStringOption((o) => o.setName('division').setDescription('Factions: division (default: the first member\'s)').setRequired(false).addChoices(...DIVS))
            .addStringOption((o) => o.setName('image_url').setDescription('Tag teams: picture link (optional)').setRequired(false));
    })
    .addSubcommand((s) => s.setName('list').setDescription('All active tag teams and factions')
        .addStringOption((o) => KIND(o, false, 'Only tag teams or only factions')))
    .addSubcommand((s) => s.setName('profile').setDescription('A tag team\'s or faction\'s card').addStringOption(GROUP))
    .addSubcommand((s) => s.setName('add-member').setDescription('[Admin] Add a wrestler to a tag team or faction')
        .addStringOption(GROUP).addStringOption((o) => CHAR(o, 'character', 'Wrestler to add', true)))
    .addSubcommand((s) => s.setName('remove-member').setDescription('[Admin] Take a wrestler out of a tag team or faction')
        .addStringOption(GROUP).addStringOption((o) => CHAR(o, 'character', 'Wrestler to remove', true)))
    .addSubcommand((s) => s.setName('rename').setDescription('[Admin] Rename a tag team')
        .addStringOption(GROUP).addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(40)))
    .addSubcommand((s) => s.setName('disband').setDescription('[Admin] Disband a tag team or faction (its record is kept)').addStringOption(GROUP));

/** "t:12" / "f:7" (from the list) → { kind, id }. A bare number is looked up as a team, then a faction. */
async function resolveGroup(guildId, value) {
    const v = String(value || '').trim();
    const m = v.match(/^([tf]):(\d+)$/);
    if (m) return { kind: m[1] === 't' ? 'tag' : 'faction', id: m[2] };
    if (/^\d+$/.test(v)) {
        const { rows: t } = await pool.query(`SELECT 1 FROM teams WHERE id = $1 AND guild_id = $2`, [v, guildId]);
        if (t.length) return { kind: 'tag', id: v };
        const { rows: f } = await pool.query(`SELECT 1 FROM factions WHERE id = $1 AND guild_id = $2`, [v, guildId]);
        if (f.length) return { kind: 'faction', id: v };
    }
    // typed a name without picking from the list
    const { rows: tn } = await pool.query(`SELECT id FROM teams WHERE guild_id = $1 AND lower(name) = lower($2) ORDER BY (status = 'active') DESC, id DESC LIMIT 1`, [guildId, v]);
    if (tn.length) return { kind: 'tag', id: String(tn[0].id) };
    const { rows: fn } = await pool.query(`SELECT id FROM factions WHERE guild_id = $1 AND lower(name) = lower($2) ORDER BY (status = 'active') DESC, id DESC LIMIT 1`, [guildId, v]);
    if (fn.length) return { kind: 'faction', id: String(fn[0].id) };
    throw new UserError('I could not find that tag team or faction. Pick one from the list that appears as you type.');
}

/** Hands the interaction to the tag team or faction code with the option names it expects. */
function handOff(interaction, sub, values) {
    const orig = interaction.options;
    const options = new Proxy(orig, {
        get(t, p) {
            if (p === 'getSubcommand') return () => sub;
            if (p === 'getSubcommandGroup') return () => null;
            if (p === 'getString') return (n, req) => (n in values ? (values[n] === null ? null : String(values[n])) : orig.getString(n, req));
            const v = Reflect.get(t, p, t);
            return typeof v === 'function' ? v.bind(t) : v;
        }
    });
    return new Proxy(interaction, { get(t, p) { if (p === 'options') return options; const v = Reflect.get(t, p, t); return typeof v === 'function' ? v.bind(t) : v; } });
}

module.exports = {
    data,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        const sub = interaction.options.getSubcommand(false);
        const guildId = interaction.guildId;
        if (focused.name === 'group' || focused.name === 'team' || focused.name === 'faction') {
            const q = `%${String(focused.value || '').toLowerCase()}%`;
            const onlyTeams = sub === 'rename';
            const { rows } = await pool.query(
                `SELECT 't:' || id AS value, name, 'Tag team' AS what FROM teams WHERE guild_id = $1 AND status = 'active' AND lower(name) LIKE $2
                 UNION ALL
                 SELECT 'f:' || id, name, 'Faction' FROM factions WHERE guild_id = $1 AND status = 'active' AND lower(name) LIKE $2 AND NOT $3
                 ORDER BY 2 LIMIT 25`, [guildId, q, onlyTeams]);
            return interaction.respond(rows.map((r) => ({ name: `${r.name} (${r.what})`.slice(0, 100), value: r.value })));
        }
        // wrestler lists: removing shows the members of the picked group; otherwise everyone
        if (focused.name === 'character' && sub === 'remove-member') {
            try {
                const g = await resolveGroup(guildId, interaction.options.getString('group'));
                return (g.kind === 'tag' ? tag() : fac()).autocomplete(handOff(interaction, 'remove-member', { [g.kind === 'tag' ? 'team' : 'faction']: g.id }));
            } catch (_) { return interaction.respond([]); }
        }
        const kind = interaction.options.getString('kind');
        return (kind === 'faction' ? fac() : tag()).autocomplete(handOff(interaction, sub, {}));
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'create') {
            const kind = interaction.options.getString('kind') || 'tag';
            const members = [];
            for (let n = 1; n <= 8; n++) { const v = interaction.options.getString(`member${n}`); if (v) members.push(v); }
            if (kind === 'tag') {
                if (members.length > 4 || interaction.options.getString('member5')) throw new UserError('A tag team can have up to 4 members. For a bigger group, pick **Faction**.');
                return tag().execute(handOff(interaction, 'create', {}));
            }
            if (members.length < 3) throw new UserError('A faction needs at least 3 members. For 2, pick **Tag team**.');
            let division = interaction.options.getString('division');
            if (!division) {
                const { requireCharacter } = require('../utils/characterUtils');
                division = (await requireCharacter(guildId, members[0])).division;
            }
            // the faction code reads member1..member8 in order; fill the gaps so nobody is skipped
            const vals = { division };
            for (let n = 1; n <= 8; n++) vals[`member${n}`] = members[n - 1] || null;
            return fac().execute(handOff(interaction, 'create', vals));
        }

        if (sub === 'list') {
            const kind = interaction.options.getString('kind');
            if (kind === 'tag') return tag().execute(handOff(interaction, 'list', {}));
            if (kind === 'faction') return fac().execute(handOff(interaction, 'list', {}));
            // both: one private-or-public answer with both lists
            const { capture } = require('../utils/panelKit');
            const a = await capture(interaction, 'tagteam', 'list');
            const b = await capture(interaction, 'faction', 'list');
            return respond(interaction, {
                content: [a.content, b.content].filter(Boolean).join('\n') || undefined,
                embeds: [...(a.embeds || []), ...(b.embeds || [])].slice(0, 10),
                ...(a.flags || b.flags ? { flags: EPHEMERAL } : {})
            });
        }

        // everything else works on one picked group (the old `team:` / `faction:` options still work too)
        const raw = interaction.options.getString('group') || interaction.options.getString('team') || interaction.options.getString('faction');
        const g = await resolveGroup(guildId, raw);
        if (sub === 'rename' && g.kind === 'faction') throw new UserError('Only tag teams can be renamed for now. Ask me if you want factions too!');
        if (g.kind === 'tag') return tag().execute(handOff(interaction, sub, { team: g.id }));
        return fac().execute(handOff(interaction, sub, { faction: g.id }));
    }
};
