// Combines several slash commands into one without copying their code.
// Each route remembers which original command + subcommand to hand the interaction to.
const { requireAdmin } = require('./discordHelpers');

const clip = (s) => (s.length > 100 ? `${s.slice(0, 99)}…` : s);
const ADMIN_TAG = /^\[Admin\]\s*/i;

/**
 * Turns an existing command into a list of subcommand definitions.
 *  - a command with subcommands keeps them (names get `prefix` in front)
 *  - a command that is just options becomes ONE subcommand called `asSub`
 * Returns [{ json, route }] where route = { cmd, orig, admin }.
 */
function partsOf(cmd, { prefix = '', asSub = null, only = null } = {}) {
    const j = cmd.data.toJSON();
    const wholeAdmin = j.default_member_permissions != null;
    const subs = (j.options || []).filter((o) => o.type === 1);
    const out = [];
    if (!subs.length) {
        const name = asSub || j.name;
        const admin = wholeAdmin || ADMIN_TAG.test(j.description);
        out.push({ json: { type: 1, name, description: clip(`${admin && !ADMIN_TAG.test(j.description) ? '[Admin] ' : ''}${j.description}`), options: j.options || [] }, route: { cmd, orig: null, admin } });
        return out;
    }
    for (const s of subs) {
        if (only && !only.includes(s.name)) continue;
        const admin = wholeAdmin || ADMIN_TAG.test(s.description);
        const name = `${prefix}${s.name}`;
        out.push({ json: { ...s, name, description: clip(`${admin && !ADMIN_TAG.test(s.description) ? '[Admin] ' : ''}${s.description}`) }, route: { cmd, orig: s.name, admin } });
    }
    return out;
}

/** Hands an interaction to another command, pretending the subcommand is `orig`. */
function proxyFor(interaction, orig) {
    const options = new Proxy(interaction.options, {
        get(target, prop) {
            if (prop === 'getSubcommand') return () => orig;
            if (prop === 'getSubcommandGroup') return () => null;
            const v = Reflect.get(target, prop, target);
            return typeof v === 'function' ? v.bind(target) : v;
        }
    });
    return new Proxy(interaction, {
        get(target, prop) {
            if (prop === 'options') return options;
            const v = Reflect.get(target, prop, target);
            return typeof v === 'function' ? v.bind(target) : v;
        }
    });
}

async function runRoute(interaction, route) {
    if (route.admin) requireAdmin(interaction, 'do that');
    return route.cmd.execute(proxyFor(interaction, route.orig));
}

async function autocompleteRoute(interaction, route) {
    if (!route || typeof route.cmd.autocomplete !== 'function') return interaction.respond([]);
    return route.cmd.autocomplete(proxyFor(interaction, route.orig));
}

/**
 * One subcommand that stands in for several (3.5): a choice option picks which one runs.
 *   cases = [{ value, label, part }]   (part = one entry from partsOf)
 *   pick  = optional (interaction) => value, for when the choice isn't a plain string option
 * The options are the union of the cases' options (required only if every case requires it),
 * plus `extra` options at the end.
 */
function choicePart({ name, description, choice = null, cases, pick = null, extra = [] }) {
    const union = [];
    for (const c of cases) {
        for (const o of c.part.json.options || []) {
            if (!union.find((u) => u.name === o.name)) union.push({ ...o, required: cases.every((k) => (k.part.json.options || []).some((x) => x.name === o.name && x.required)) });
        }
    }
    const opts = [];
    if (choice) opts.push({ type: 3, name: choice.name, description: clip(choice.description), required: choice.required !== false, choices: cases.map((c) => ({ name: c.label, value: c.value })) });
    opts.push(...union.filter((o) => o.required), ...union.filter((o) => !o.required), ...extra);
    const chosen = (interaction) => {
        const v = pick ? pick(interaction) : (interaction.options.getString(choice.name) || choice.default || cases[0].value);
        return cases.find((c) => c.value === v) || cases[0];
    };
    const admin = cases.every((c) => c.part.route.admin);
    const pseudo = {
        async execute(interaction) {
            const c = chosen(interaction);
            return runRoute(interaction, c.part.route);
        },
        async autocomplete(interaction) { return autocompleteRoute(interaction, chosen(interaction).part.route); }
    };
    return { json: { type: 1, name, description: clip(`${admin && !ADMIN_TAG.test(description) ? '[Admin] ' : ''}${description}`), options: opts }, route: { cmd: pseudo, orig: null, admin } };
}

/**
 * A brand-new command made only of other commands.
 * `hidden` parts still work (for older buttons, panels and tests) but aren't shown in Discord.
 */
function makeUmbrella({ name, description, parts, hidden = [] }) {
    const routes = new Map([...hidden, ...parts].map((p) => [p.json.name, p.route]));
    const json = { name, description: clip(description), dm_permission: false, options: parts.map((p) => p.json) };
    return {
        data: { name, toJSON: () => JSON.parse(JSON.stringify(json)) },
        routes,
        async autocomplete(interaction) { return autocompleteRoute(interaction, routes.get(interaction.options.getSubcommand(false))); },
        async execute(interaction) {
            const route = routes.get(interaction.options.getSubcommand());
            return runRoute(interaction, route);
        }
    };
}

/**
 * Adds more subcommands / groups to a command that already exists.
 * `extras` = parts to add as plain subcommands; `groups` = [{ name, description, parts }].
 * The original module keeps working for everything it already did.
 */
function extend(mod, { extras = [], groups = [] }) {
    const base = mod.data.toJSON();
    const routes = new Map(extras.map((p) => [p.json.name, p.route]));
    const groupRoutes = new Map();
    const options = [...(base.options || []), ...extras.map((p) => p.json)];
    for (const g of groups) {
        options.push({ type: 2, name: g.name, description: clip(g.description), options: g.parts.map((p) => p.json) });
        groupRoutes.set(g.name, new Map(g.parts.map((p) => [p.json.name, p.route])));
    }
    const json = { ...base, options };
    const original = { execute: mod.execute, autocomplete: mod.autocomplete };
    const routeFor = (interaction) => {
        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand(false);
        if (group) return groupRoutes.get(group)?.get(sub) || null;
        return routes.get(sub) || null;
    };
    mod.data = { name: base.name, toJSON: () => JSON.parse(JSON.stringify(json)) };
    mod.execute = async (interaction) => {
        const route = routeFor(interaction);
        return route ? runRoute(interaction, route) : original.execute(interaction);
    };
    mod.autocomplete = async (interaction) => {
        const route = routeFor(interaction);
        return route ? autocompleteRoute(interaction, route) : original.autocomplete(interaction);
    };
    return mod;
}

module.exports = { partsOf, makeUmbrella, extend, proxyFor, choicePart };
