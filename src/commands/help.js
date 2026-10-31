const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isAdmin, respond, EPHEMERAL } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');

// Friendly order and one-line purpose for the overview. Anything not listed still appears at the end.
const ORDER = ['character', 'team', 'stats', 'standings', 'championship', 'title', 'reign', 'booking', 'contract', 'match', 'card', 'directory', 'feud', 'tournament', 'faction', 'admin'];
// Old command names that were merged into combined commands (so `/help command:injury` can point people to the new home).
const MOVED = {
    leaderboard: '/standings leaderboard', rankings: '/standings rankings', season: '/standings season-standings | season-recap', roster: '/directory roster',
    halloffame: '/directory hof-list | hof-view | hof-induct | hof-remove', injury: '/directory injury-list | injury-add | injury-clear',
    contender: '/championship contender-challenge | contender-list (admins: /title contender-award | contender-revoke)',
    matchmaking: '/booking suggest | request', signup: '/booking signup-open | signup-list | signup-close | signup-done | signup-add | signup-remove',
    newsletter: '/admin newsletter add | list | remove | preview | post', report: '/admin report'
};
const BLURB = {
    character: 'Your wrestlers: submit, edit, profile cards, story and moves',
    team: 'Registered tag teams',
    standings: 'Leaderboards, division rankings and season standings',
    booking: 'Find opponents, request matches, run show signups',
    directory: 'Roster pages and a text roster list, Hall of Fame and the injury report',
    whois: 'Who plays a wrestler, and all of that player\'s wrestlers',
    stats: 'Records, streaks, head-to-head, history, most decorated players',
    leaderboard: 'Leaderboards with category and time dropdowns',
    rankings: 'Division ladders (last 90 days)',
    championship: 'Look at titles: champions, belt cards, a button panel, history, defenses',
    title: 'Admins: log a title match (title, challenger, winner), contenders, vacate, belt pictures',
    reign: 'Admins: add old reigns with dates and defenses, edit or remove them',
    contender: '#1 contender challenges and awards',
    matchmaking: 'Find fresh opponents or request a match',
    signup: 'Show signups: players click to say who is available',
    contract: 'Contracts and career earnings (just for fun)',
    report: 'Staff report: idle wrestlers, thin divisions, stale titles',
    match: 'Log, undo and edit match results',
    card: 'Build and post the RAW / SmackDown show cards, one picture per division',
    season: 'Yearly standings and a season recap picture',
    injury: 'Injury report: who is out and until when',
    roster: 'Flip through a division A to Z with profile cards',
    faction: 'Factions: groups of 3-8 with a shared record',
    halloffame: 'Hall of Fame: retired legends',
    feud: 'Rivalries: a timeline and heat meter for each feud',
    tournament: 'Tournaments with a bracket picture',
    newsletter: 'Weekly newsletter: add lines, preview, post',
    admin: 'Server settings, monthly awards, backups and the approval queue'
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
            const subs = (j.options || []).flatMap((o) => (o.type === 2 ? (o.options || []).map((x) => ({ ...x, name: `${o.name} ${x.name}` })) : o.type === 1 ? [o] : []))
                .filter((s) => admin || !isAdminSub(s.description));
            return { ...j, subs, adminOnly: j.default_member_permissions != null || /^\[Admin\]/i.test(j.description) };
        })
        .filter((j) => !((j.options || []).some((o) => o.type === 1 || o.type === 2) && j.subs.length === 0))
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
            if (!c && MOVED[wanted]) {
                return respond(interaction, { content: `\`/${wanted}\` was merged into a combined command: **${MOVED[wanted]}**. Try \`/help command:${MOVED[wanted].split(' ')[0].slice(1)}\` for the full list.`, flags: EPHEMERAL });
            }
            if (!c) throw new UserError(`I don't have a \`/${wanted}\` command${admin ? '' : ' that you can use'}. Type \`/help\` to see the list.`);
            const lines = c.subs.length
                ? c.subs.map((s) => `**/${c.name} ${s.name}**${admin && isAdminSub(s.description) ? ' 🔒' : ''}\n${clean(s.description)}`)
                : [`**/${c.name}**\n${clean(c.description)}`];
            const embed = new EmbedBuilder().setTitle(`/${c.name}`).setColor(0xC0392B)
                .setDescription(`${clean(c.description)}\n\n${lines.join('\n\n')}`.slice(0, 4000))
                .setFooter({ text: admin ? '🔒 = admins only' : 'Type / in the chat box to start any command' });
            return respond(interaction, { embeds: [embed], flags: EPHEMERAL });
        }

        const subList = (subs) => {
            let out = '';
            for (const s of subs) {
                const token = `\`${s.name}\``;
                if ((out + ' ' + token).length > 320) return `${out} …`;
                out = out ? `${out} ${token}` : token;
            }
            return out;
        };
        const fields = cmds.map((c) => ({
            name: `/${c.name}${admin && c.adminOnly ? ' 🔒' : ''}`,
            value: `${BLURB[c.name] || clean(c.description)}${c.subs.length ? `\n${subList(c.subs)}` : ''}`.slice(0, 700)
        }));
        const embed = new EmbedBuilder().setTitle('Wrestling Bot: Help').setColor(0xC0392B)
            .setDescription([
                '**Players:** `/character submit` to add a wrestler (an admin approves it), then `/character profile` for their card. ' +
                'Check records with `/stats`, ladders with `/standings rankings`, ask for matches with `/booking request`, and see who plays who with `/whois`.',
                admin ? '**Admins:** book shows with `/card auto` or `/card add`, log results with `/match`, and handle approvals with `/admin pending`.' : null,
                '',
                'Use **`/help command:<name>`** for the full list of one command, for example `/help command:match`.'
            ].filter((x) => x !== null).join('\n'))
            .addFields(fields.slice(0, 24))
            .setFooter({ text: admin ? '🔒 = admins only' : 'Some commands are only for admins' });
        return respond(interaction, { embeds: [embed], flags: EPHEMERAL });
    }
};
