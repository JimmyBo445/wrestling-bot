// A tiny fake of the parts of discord.js the bot uses, so commands can be run end-to-end.
const fs = require('fs');
const path = require('path');
const { handleInteraction } = require('../src/interactionHandler');

const commands = new Map();
for (const f of fs.readdirSync(path.join(__dirname, '..', 'src', 'commands')).filter((x) => !require('../src/commands.retired').has(x))) {
    const c = require(path.join(__dirname, '..', 'src', 'commands', f));
    if (c.data) commands.set(c.data.name, c);
}
// the old two-name title-match subs still exist inside the module; tests reach them through this hidden command
commands.set('championship-legacy', require('../src/modules/championship'));
// 3.5: /faction was merged into /team; older tests still reach the faction code by its old name
commands.set('faction', require('../src/modules/faction'));
const client = { commands, user: { id: 'bot1' } };
client.channels = { fetch: async (id) => ({ ...getChannelLazy(id), messages: { fetch: fakeFetch } }) };
client.guilds = { cache: new Map() };
const dms = []; // direct messages the bot sent: { id, content }
client.users = { fetch: async (uid) => ({ id: uid, send: async (c) => { dms.push({ id: uid, content: typeof c === 'string' ? c : c.content }); } }) };
let getChannelLazy = (id) => ({ id, isTextBased: () => true, send: async () => ({ id: 'x' }) });

const sent = []; // messages posted to channels by the bot
const channelMock = (id) => ({
    id, isTextBased: () => true,
    send: async (payload) => { const m = { id: `msg${sent.length + 1}`, channelId: id, payload }; sent.push(m); return m; },
    messages: { fetch: fakeFetch }
});
const edited = []; // messages the bot edited (by id)
const deleted = []; // messages the bot deleted (by id); fetching one of these fails like on Discord
async function fakeFetch(mid) {
    if (deleted.includes(mid)) { const e = new Error('Unknown Message'); e.code = 10008; throw e; }
    return { id: mid, content: '', edit: async (p) => { edited.push({ id: mid, p }); }, delete: async () => { deleted.push(mid); } };
}
const channels = new Map();
const getChannel = (id) => { if (!channels.has(id)) channels.set(id, channelMock(id)); return channels.get(id); };
getChannelLazy = getChannel;

const guild = (id = 'g1') => ({
    id, name: 'Test Wrestling Federation',
    members: { fetch: async ({ user }) => new Map((Array.isArray(user) ? user : [user]).map((u) => [u, { id: u, displayName: `Name${u}`, user: { username: `user${u}` } }])) },
    channels: { fetch: async (cid) => getChannel(cid) }
});

function makeInteraction({ kind = 'command', commandName, sub = null, group = null, options = {}, user = 'admin1', admin = true, customId, values, guildId = 'g1', focused = null, message = null, member = null, fields = {} }) {
    const responses = [];
    const i = {
        client, kind, commandName, customId, values, guildId, channelId: 'chan1', channel: getChannel('chan1'), guild: guild(guildId),
        user: { id: user, username: `user${user}`, displayName: `Name${user}`, bot: false },
        memberPermissions: { has: () => admin },
        member: member || { roles: [] },
        message: message || { embeds: [], components: [] },
        deferred: false, replied: false, ephemeral: false, responses,
        inGuild: () => true, isRepliable: () => true,
        isChatInputCommand: () => kind === 'command', isAutocomplete: () => kind === 'autocomplete',
        isButton: () => kind === 'button', isStringSelectMenu: () => kind === 'select',
        isAnySelectMenu: () => kind === 'select' || kind === 'channel', isChannelSelectMenu: () => kind === 'channel', isModalSubmit: () => kind === 'modal',
        fields: { getTextInputValue: (k) => (fields[k] === undefined ? '' : String(fields[k])) },
        showModal: async (m) => { i.replied = true; responses.push({ type: 'modal', p: m }); },
        options: {
            getSubcommand: () => sub,
            getSubcommandGroup: () => group,
            getString: (n) => (options[n] !== undefined ? String(options[n]) : null),
            getInteger: (n) => (options[n] !== undefined ? Number(options[n]) : null),
            getBoolean: (n) => (options[n] !== undefined ? Boolean(options[n]) : null),
            getAttachment: (n) => options[n] || null,
            getUser: (n) => (options[n] ? { id: options[n], username: `user${options[n]}`, displayName: `Name${options[n]}`, bot: false } : null),
            getChannel: (n) => (options[n] ? { id: options[n] } : null),
            getRole: (n) => (options[n] ? { id: options[n] } : null),
            getFocused: (full) => (full ? { name: focused.name, value: focused.value } : focused.value)
        },
        reply: async (p) => { i.replied = true; if (p.flags & 64) i.ephemeral = true; responses.push({ type: 'reply', p }); },
        deferReply: async (p = {}) => { i.deferred = true; i.ephemeral = Boolean((p.flags || 0) & 64); },
        editReply: async (p) => { responses.push({ type: 'edit', p }); i.replied = true; },
        followUp: async (p) => { responses.push({ type: 'followUp', p }); },
        deleteReply: async () => { responses.push({ type: 'delete' }); i.replied = false; },
        deferUpdate: async () => { i.deferred = true; },
        update: async (p) => { i.replied = true; responses.push({ type: 'update', p }); },
        respond: async (c) => { responses.push({ type: 'autocomplete', choices: c }); }
    };
    return i;
}

// Tests were written with the old command names; map them to where those commands live now.
function remap(commandName, sub, opts) {
    const m = {
        leaderboard: () => ['standings', 'leaderboard', null], rankings: () => ['standings', 'rankings', null],
        season: () => ['standings', `season-${sub}`, null], roster: () => ['directory', 'roster', null],
        halloffame: () => ['directory', `hof-${sub}`, null], injury: () => ['directory', `injury-${sub}`, null],
        contender: () => ['championship', `contender-${sub}`, null], matchmaking: () => ['booking', sub, null],
        signup: () => ['booking', `signup-${sub}`, null], newsletter: () => ['admin', sub, 'newsletter'], report: () => ['admin', 'report', null]
    };
    if (commandName === 'championship') {
        if (['log-singles-title-match', 'log-tag-title-match'].includes(sub)) return ['championship-legacy', sub, opts];
        if (['vacate', 'interim', 'unify', 'watch', 'waive-rematch'].includes(sub)) return ['title', sub, opts];
        if (sub === 'contender-award' || sub === 'contender-revoke') return ['title', sub, opts];
        const r = { 'backfill-reign': 'reign-add', 'edit-reign': 'reign-edit', 'remove-reign': 'reign-remove' }[sub];
        if (r) return ['title', r, opts];
    }
    if (commandName === 'contender' && ['award', 'revoke'].includes(sub)) return ['title', `contender-${sub}`, opts];
    // 2.20: /reign moved into /title
    if (commandName === 'reign') return ['title', ['add', 'edit', 'remove'].includes(sub) ? `reign-${sub}` : sub, opts];
    if (!m[commandName]) return [commandName, sub, opts];
    const [c, s, g] = m[commandName]();
    return [c, s, g ? { ...opts, group: g } : opts];
}
async function run(commandName, sub, options = {}, opts = {}) {
    [commandName, sub, opts] = remap(commandName, sub, opts);
    const i = makeInteraction({ commandName, sub, options, ...opts });
    await handleInteraction(client, i);
    return i;
}
async function auto(commandName, sub, name, value, options = {}, opts = {}) {
    [commandName, sub, opts] = remap(commandName, sub, opts);
    const i = makeInteraction({ kind: 'autocomplete', commandName, sub, options, focused: { name, value }, ...opts });
    await handleInteraction(client, i);
    return i.responses.find((r) => r.type === 'autocomplete')?.choices || null;
}
async function click(customId, { values, kind, message, admin = true, user = 'admin1', fields, private: priv = false } = {}) {
    // private: the button sits on a private panel (so the bot updates it in place)
    const msg = message || (priv ? { id: 'panel1', flags: 64, embeds: [], components: [] } : undefined);
    const i = makeInteraction({ kind: kind || (fields ? 'modal' : values ? 'select' : 'button'), customId, values, message: msg, admin, user, fields });
    await handleInteraction(client, i);
    return i;
}

// Helpers to read what the bot said
const lastPayload = (i) => i.responses[i.responses.length - 1]?.p;
const text = (i) => i.responses.map((r) => [r.p?.content, ...(r.p?.embeds || []).map((e) => `${e.data?.title || ''} ${e.data?.description || ''} ${(e.data?.fields || []).map((f) => `${f.name}:${f.value}`).join(' ')} ${e.data?.footer?.text || ''}`)].filter(Boolean).join(' | ')).join('\n');
const hasFile = (i) => i.responses.some((r) => (r.p?.files || []).length > 0);

/** Every button / menu id in the bot's last answer (to check what someone can see). */
const ids = (i) => {
    const p = lastPayload(i) || {};
    return (p.components || []).flatMap((r) => (r.components || []).map((c) => c.data?.custom_id)).filter(Boolean);
};
/** The pop-up form the bot opened, if any: { id, inputs: [ids] }. */
const modalOf = (i) => {
    const m = i.responses.find((r) => r.type === 'modal')?.p;
    if (!m) return null;
    const j = m.toJSON();
    return { id: j.custom_id, title: j.title, inputs: j.components.map((r) => r.components[0].custom_id), json: j };
};

module.exports = { deleted, dms, edited, run, auto, click, sent, text, lastPayload, hasFile, makeInteraction, client, ids, modalOf };
