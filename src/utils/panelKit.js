// Shared pieces for the button panels (2.20 home menu, 3.1 panels).
// A panel is a private message (only the person who opened it sees it) that updates in place
// when you press its buttons. Buttons under PUBLIC messages answer privately instead, so one
// person's clicks never change what everyone else sees.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { respond, EPHEMERAL, NO_MENTIONS } = require('./discordHelpers');
const { UserError } = require('./errors');

const NOPING = NO_MENTIONS;
const btn = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
const row = (...c) => new ActionRowBuilder().addComponents(...c);
/** 3.15: buttons split into rows of 5 (Discord's limit), e.g. All + 5 division tabs. */
const rows5 = (buttons) => { const out = []; for (let i = 0; i < buttons.length; i += 5) out.push(row(...buttons.slice(i, i + 5))); return out; };
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const homeRow = () => row(btn('ui:h:home', '🏠 Home'));

/** True when the message the button sits on is private (only the clicker sees it), so it can be updated in place. */
function onPrivateMessage(interaction) {
    const f = interaction.message?.flags;
    if (!f) return false;
    if (typeof f.has === 'function') return f.has(MessageFlags.Ephemeral);
    return Boolean(Number(f) & 64);
}

/** Shows a result: replaces a private panel in place, or answers privately under a public message (so nobody else's view changes). */
async function show(interaction, payload) {
    if (onPrivateMessage(interaction)) return interaction.update({ content: null, embeds: [], files: [], attachments: [], components: [], ...payload });
    return respond(interaction, { ...payload, flags: EPHEMERAL, allowedMentions: NOPING });
}

/**
 * Runs an existing slash command from a button, privately (so a click never posts in the channel).
 * values = the options the command would have had.
 */
function privately(interaction, sub, values = {}) {
    const get = (n) => (values[n] === undefined || values[n] === null ? null : values[n]);
    const options = {
        getSubcommand: () => sub, getSubcommandGroup: () => null,
        getString: (n) => (get(n) === null ? null : String(get(n))), getInteger: (n) => (get(n) === null ? null : Number(get(n))),
        getBoolean: (n) => (get(n) === null ? null : Boolean(get(n))), getUser: (n) => get(n), getChannel: (n) => get(n), getRole: (n) => get(n),
        getAttachment: () => null, getFocused: () => ''
    };
    const priv = (p = {}) => ({ ...p, flags: (Number(p.flags) || 0) | EPHEMERAL });
    return new Proxy(interaction, {
        get(t, p) {
            if (p === 'options') return options;
            if (p === 'reply') return (x) => t.reply(priv(x));
            if (p === 'deferReply') return (x) => t.deferReply(priv(x));
            if (p === 'followUp') return (x) => t.followUp(priv(x));
            const v = Reflect.get(t, p, t);
            return typeof v === 'function' ? v.bind(t) : v;
        }
    });
}

// commands that were merged away but whose code the panels still use directly
const MODULES = {
    tagteam: () => require('../modules/tagteam'), faction: () => require('../modules/faction'),
    // 3.8: parts of /admin and /booking the panels reach directly
    signup: () => require('../modules/signup'), matchmaking: () => require('../modules/matchmaking'),
    newsletter: () => require('../modules/newsletter'), report: () => require('../modules/report')
};
const command = (interaction, name) => {
    const c = MODULES[name] ? MODULES[name]() : interaction.client.commands.get(name);
    if (!c) throw new UserError(`The /${name} command isn't available right now.`);
    return c;
};

/**
 * Runs an existing slash command and hands back what it WOULD have sent, without sending it.
 * The panels use this to show a command's answer inside the panel, with their own buttons.
 * All the command's own checks (admin only, owner only...) still apply.
 */
async function capture(interaction, name, sub, values = {}) {
    const cmd = command(interaction, name);
    let payload = null;
    const take = async (x = {}) => {
        const p = typeof x === 'string' ? { content: x } : { ...x };
        if (!payload) payload = p;
        else payload = { ...payload, content: [payload.content, p.content].filter(Boolean).join('\n') || payload.content };
        return { id: 'captured' };
    };
    const base = privately(interaction, sub, values);
    const fake = new Proxy(base, {
        get(t, p) {
            if (p === 'reply' || p === 'followUp') return take;
            if (p === 'editReply') return async (x = {}) => { payload = typeof x === 'string' ? { content: x } : { ...x }; return { id: 'captured' }; };
            if (p === 'deferReply' || p === 'deferUpdate' || p === 'deleteReply') return async () => {};
            if (p === 'fetchReply') return async () => ({ id: 'captured' });
            if (p === 'deferred' || p === 'replied') return false;
            return Reflect.get(t, p, t);
        }
    });
    await cmd.execute(fake);
    const out = payload || {};
    delete out.flags;
    return out;
}

/** "⚠️ message" with the given buttons, for showing a problem inside a panel. */
const hasHome = (rows) => rows.some((r) => (r.components || []).some((c) => c.data?.custom_id === 'ui:h:home'));
const problem = (err, rows = []) => ({ content: `⚠️ ${err.message}`, embeds: [], files: [], components: (hasHome(rows) ? rows : [...rows, homeRow()]).slice(0, 5) });

/**
 * Opens a panel that may take a moment (pictures): updates a private panel in place,
 * or answers privately under a public message. A friendly error (UserError) is shown in the
 * panel with `backRows`, so the person isn't left with a dead end.
 */
async function open(interaction, build, { backRows = [] } = {}) {
    const inPlace = onPrivateMessage(interaction);
    if (inPlace) await interaction.deferUpdate();
    else await interaction.deferReply({ flags: EPHEMERAL });
    let payload;
    try { payload = await build(); } catch (err) {
        if (!(err instanceof UserError)) throw err;
        payload = problem(err, backRows);
    }
    const { flags, ...rest } = payload || {}; // eslint-disable-line no-unused-vars
    return interaction.editReply({ content: null, embeds: [], files: [], attachments: [], components: [], allowedMentions: NOPING, ...rest });
}

/** Adds a ✅ / ⚠️ line above a panel. */
function withNotice(payload, notice) {
    if (!notice) return payload;
    return { ...payload, content: [notice, payload.content].filter(Boolean).join('\n').slice(0, 1900) };
}

module.exports = { NOPING, btn, row, rows5, clip, homeRow, onPrivateMessage, show, privately, command, capture, open, problem, withNotice, ButtonStyle };
