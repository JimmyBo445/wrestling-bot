const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isAdmin, respond, EPHEMERAL } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');

// Friendly order and one-line purpose for the overview. Anything not listed still appears at the end.
const ORDER = ['character', 'team', 'stats', 'leaderboard', 'rankings', 'championship', 'contender', 'matchmaking', 'match', 'card', 'admin'];
const BLURB = {
    character: 'Your wrestlers: submit, edit, view profile cards',
    team: 'Registered tag teams',
    stats: 'Records, streaks, head-to-head, history',
    leaderboard: 'Leaderboards with category and time dropdowns',
    rankings: 'Division ladders (last 90 days)',
    championship: 'Titles, belts, reign history',
    contender: '#1 contender challenges and awards',
    matchmaking: 'Find fresh opponents or request a match',
    match: 'Log, undo and edit match results',
    card: 'Build and post RAW / SmackDown match cards',
    admin: 'Server settings and the approval queue'
};

const ADMIN_TAG = /^\[Admin\]\s*/i;
const clean = (d) => String(d || '').replace(ADMIN_TAG, '');
const isAdminSub = (d) => ADMIN_TAG.test(String(d || ''));

const data = new SlashCommandBuilder()
    .setName('help')
    .setDescription('See every command and what it does')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('command').setDescription('Show the details for one command, e.g. match').setRequired(false).setAutocomplete(true));

/** What this person can see: commands for admins are hidden from everyone else. */
function visibleCommands(interaction) {
    const admin = isAdmin(interaction);
    return [...interaction.client.commands.values()]
        .map((c) => c.data.toJSON())
        .filter((j) => j.name !== 'help')
        .filter((j) => admin || j.default_member_permissions == null)
        .map((j) => {
            const subs = (j.options || []).filter((o) => o.type === 1)
                .filter((s) => admin || !isAdminSub(s.description));
            return { ...j, subs, adminOnly: j.default_member_permissions != null || /^\[Admin\]/i.test(j.description) };
        })
        .filter((j) => !((j.options || []).some((o) => o.type === 1) && j.subs.length === 0))
        .sort((a, b) => {
            const ia = ORDER.indexOf(a.name), ib = ORDER.indexOf(b.name);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
        });
}

module.exports = {
    data,

    async autocomplete(interaction) {
        const typed = String(interaction.options.getFocused()).toLowerCase();
        const list = visibleCommands(interaction).filter((c) => c.name.includes(typed)).slice(0, 25);
        return interaction.respond(list.map((c) => ({ name: `/${c.name}`, value: c.name })));
    },

    async execute(interaction) {
        const admin = isAdmin(interaction);
        const cmds = visibleCommands(interaction);
        const wanted = interaction.options.getString('command')?.replace(/^\//, '').trim().toLowerCase() || null;

        if (wanted) {
            const c = cmds.find((x) => x.name === wanted);
            if (!c) throw new UserError(`I don't have a \`/${wanted}\` command${admin ? '' : ' that you can use'}. Type \`/help\` to see the list.`);
            const lines = c.subs.length
                ? c.subs.map((s) => `**/${c.name} ${s.name}**${admin && isAdminSub(s.description) ? ' 🔒' : ''}\n${clean(s.description)}`)
                : [`**/${c.name}**\n${clean(c.description)}`];
            const embed = new EmbedBuilder().setTitle(`/${c.name}`).setColor(0xC0392B)
                .setDescription(`${clean(c.description)}\n\n${lines.join('\n\n')}`.slice(0, 4000))
                .setFooter({ text: admin ? '🔒 = admins only' : 'Type / in the chat box to start any command' });
            return respond(interaction, { embeds: [embed], flags: EPHEMERAL });
        }

        const fields = cmds.map((c) => ({
            name: `/${c.name}${admin && c.adminOnly ? ' 🔒' : ''}`,
            value: `${BLURB[c.name] || clean(c.description)}${c.subs.length ? `\n${c.subs.map((s) => `\`${s.name}\``).join(' ')}`.slice(0, 700) : ''}`.slice(0, 1000)
        }));
        const embed = new EmbedBuilder().setTitle('Wrestling Bot: Help').setColor(0xC0392B)
            .setDescription([
                '**Players:** `/character submit` to add a wrestler (an admin approves it), then `/character profile` for their card. ' +
                'Check records with `/stats`, ladders with `/rankings`, and ask for matches with `/matchmaking request`.',
                admin ? '**Admins:** book shows with `/card auto` or `/card add`, log results with `/match`, and handle approvals with `/admin pending`.' : null,
                '',
                'Use **`/help command:<name>`** for the full list of one command, for example `/help command:match`.'
            ].filter((x) => x !== null).join('\n'))
            .addFields(fields.slice(0, 24))
            .setFooter({ text: admin ? '🔒 = admins only' : 'Some commands are only for admins' });
        return respond(interaction, { embeds: [embed], flags: EPHEMERAL });
    }
};
