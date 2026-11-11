// 3.9: makes a command show fewer typed parts in Discord while every old subcommand keeps working
// inside the bot (buttons, panels and older tests run them by name).
//
//   asScreen(mod, …)  the command becomes ONE command with a few options that opens a button screen
//   keepSubs(mod, …)  Discord lists only some subcommands (plus new ones); the rest stay hidden
const { EPHEMERAL } = require('./discordHelpers');

const clone = (x) => JSON.parse(JSON.stringify(x));
const subOf = (i) => { try { return i.options.getSubcommand(false); } catch (_) { return null; } };

/** The "show everyone" option (default: only the person who ran it sees the screen). */
const SHOW = { type: 5, name: 'show_everyone', description: 'Let everyone in the channel see it (default: only you)', required: false };

/**
 * Wraps the interaction so the FIRST answer is private or public as the person chose.
 * Buttons pressed afterwards still answer only the person who pressed them.
 */
function visible(interaction) {
    let pub = false;
    try { pub = interaction.options.getBoolean('show_everyone') === true; } catch (_) { pub = false; }
    const fix = (p = {}) => {
        const o = typeof p === 'string' ? { content: p } : { ...p };
        const f = Number(o.flags) || 0;
        o.flags = pub ? (f & ~EPHEMERAL) : (f | EPHEMERAL);
        if (pub && !o.flags) delete o.flags;
        return o;
    };
    return new Proxy(interaction, {
        get(t, p) {
            if (p === 'reply') return (x) => t.reply(fix(x));
            if (p === 'deferReply') return (x) => t.deferReply(fix(x));
            const v = Reflect.get(t, p, t);
            return typeof v === 'function' ? v.bind(t) : v;
        }
    });
}

/**
 * One command, no subcommands in Discord: `/name option:…` opens `screen(interaction)`.
 * options = extra option JSON (show_everyone is added at the end).
 */
function asScreen(mod, { description, options = [], screen, autocomplete = null, show = true }) {
    const full = mod.data.toJSON();
    const json = { name: full.name, description, dm_permission: false, options: [...options, ...(show ? [SHOW] : [])] };
    if (full.default_member_permissions != null) json.default_member_permissions = full.default_member_permissions;
    const old = { execute: mod.execute, autocomplete: mod.autocomplete };
    mod.data = { name: full.name, toJSON: () => clone(json), full: () => clone(full) };
    mod.execute = async (interaction) => (subOf(interaction) ? old.execute(interaction) : screen(visible(interaction)));
    mod.autocomplete = async (interaction) => {
        if (subOf(interaction)) return old.autocomplete ? old.autocomplete(interaction) : interaction.respond([]);
        return autocomplete ? autocomplete(interaction) : interaction.respond([]);
    };
    return mod;
}

/**
 * Discord lists only the subcommands in `show` (names of existing ones, or new parts
 * `{ json, run, autocomplete? }`), in that order. Everything else still works inside the bot.
 */
function keepSubs(mod, { show, description = null }) {
    const full = mod.data.toJSON();
    const extras = new Map();
    const options = show.map((s) => {
        if (typeof s === 'string') {
            const o = (full.options || []).find((x) => x.name === s);
            if (!o) throw new Error(`/${full.name} has no subcommand ${s}`);
            return o;
        }
        extras.set(s.json.name, s);
        return { type: 1, ...s.json };
    });
    const json = { ...full, options, ...(description ? { description } : {}) };
    const old = { execute: mod.execute, autocomplete: mod.autocomplete };
    mod.data = { name: full.name, toJSON: () => clone(json), full: () => clone(full) };
    mod.execute = async (interaction) => {
        const x = extras.get(subOf(interaction));
        return x ? x.run(visible(interaction)) : old.execute(interaction);
    };
    mod.autocomplete = async (interaction) => {
        const x = extras.get(subOf(interaction));
        if (x) return x.autocomplete ? x.autocomplete(interaction) : interaction.respond([]);
        return old.autocomplete ? old.autocomplete(interaction) : interaction.respond([]);
    };
    return mod;
}

module.exports = { asScreen, keepSubs, visible, SHOW, subOf };
