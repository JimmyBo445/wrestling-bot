// 3.10: counts which commands and buttons people use, so staff can see what's working.
// Only totals and "how many different people" are ever shown. Nothing here ever names a member.
const { EmbedBuilder } = require('discord.js');
const { pool } = require('../db/pool');

const HOME = {
    home: '/fnlw home', champs: 'Champions', show: 'Next show', results: 'Results', roster: 'Roster', mine: 'My wrestlers', help: 'Help menu',
    staff: 'Staff Tools', pending: 'Approvals', card: 'Card screen', watch: 'Title watch', stand: 'Standings', stats: 'Stats', legacy: 'Legacy',
    teams: 'Teams', feuds: 'Feuds', tourn: 'Tournaments', contract: 'Contracts'
};
const KIND = {
    sx: 'Stats', sd: 'Standings', lx: 'Legacy', tf: 'Teams', tn: 'Tournaments', m: 'Result buttons (⭐ / 🛠)', k: 'Contracts', mw: 'Edit a wrestler',
    fd: 'Feuds', ch: 'Channels (staff)', hi: 'Hall of Fame & injuries', md: 'Forms', uf: 'Unfinished matches (staff)', ws: 'Wrestler staff buttons', vx: 'Vote staff buttons',
    rp: 'Report a result', rpm: 'Report a result', rr: 'Reported results (staff)', rrm: 'Reported results (staff)', rrd: 'Reported results (staff)',
    ad: 'Admin panel', adm: 'Admin panel', bk: 'Signups & booking', bkm: 'Signups & booking', ct: 'Card tools (staff)', ctm: 'Card tools (staff)', cs: 'Championship buttons',
    sv: 'Compare players', lz: 'Legacy (staff)', lzm: 'Legacy (staff)', nm: 'Nominate', dr: 'Roster cards', kb: 'Contract bonuses', kbm: 'Contract bonuses',
    pl: 'PLEs', plm: 'PLEs', tt: 'Title manage (staff)', ttm: 'Title manage (staff)', mr: 'My requests', mk: 'Make a custom wrestler', mkm: 'Make a custom wrestler', rq: 'Request a character', mp: 'Menu post (staff)',
    us: 'Bot usage (staff)', av: 'Award vote', w: 'Wrestler screen', pg: 'Wrestler picker', pk: 'Wrestler picker', belt: 'Belt menu', help: 'Help menu', r: 'Roster', lg: 'Legacy'
};

/** A short, friendly name for what this interaction was, or null to skip it. */
function labelFor(interaction) {
    if (interaction.isAutocomplete?.()) return null;
    if (interaction.isChatInputCommand?.()) {
        let sub = null, group = null;
        try { sub = interaction.options.getSubcommand(false); } catch (_) { sub = null; }
        try { group = interaction.options.getSubcommandGroup(false); } catch (_) { group = null; }
        return [`/${interaction.commandName}`, group, sub].filter(Boolean).join(' ');
    }
    const id = String(interaction.customId || '');
    if (!id) return null;
    const parts = id.split(/[:_]/);
    const last = parts[parts.length - 1];
    const fromMenu = last === 'mp' ? '📌 Menu post → ' : last === 'rb' ? '📋 Roster channel → ' : '';
    if (parts[0] === 'ui') {
        if (parts[1] === 'h') return `${fromMenu}${HOME[parts[2]] || parts[2]}`;
        if ((parts[1] === 'pg' || parts[1] === 'pk') && parts[2] === 'nom') return 'Nominate';
        return `${fromMenu}${KIND[parts[1]] || parts[1]}`;
    }
    if (parts[0] === 'chmp') return 'Belt buttons';
    if (parts[0] === 'cardui') return 'Card screen (staff)';
    if (parts[0] === 'signup') return 'Signup post';
    if (parts[0] === 'pending' || parts[0] === 'approve' || parts[0] === 'deny') return 'Approvals (staff)';
    return parts[0];
}

/** Remembers one use. Never throws and never slows anything down. */
function record(interaction) {
    try {
        const what = labelFor(interaction);
        if (!what || !interaction.guildId || !interaction.user?.id) return;
        pool.query(`INSERT INTO usage_events (guild_id, user_id, what) VALUES ($1, $2, $3)`, [interaction.guildId, interaction.user.id, what.slice(0, 80)]).catch(() => {});
    } catch (_) { /* never matters */ }
}

/** Uses per thing over the last `days` days: [{ what, n, people }], plus totals. */
async function summary(guildId, days = 7) {
    const { rows } = await pool.query(
        `SELECT what, COUNT(*)::int AS n, COUNT(DISTINCT user_id)::int AS people FROM usage_events
         WHERE guild_id = $1 AND at > now() - make_interval(days => $2) GROUP BY what ORDER BY n DESC, what`, [guildId, days]);
    const { rows: t } = await pool.query(
        `SELECT COUNT(*)::int AS n, COUNT(DISTINCT user_id)::int AS people FROM usage_events WHERE guild_id = $1 AND at > now() - make_interval(days => $2)`, [guildId, days]);
    // commands nobody used (by their first word, e.g. /stats)
    let names = [];
    try { names = require('../registerCommands').loadCommandData().map((c) => c.name).filter((n) => n !== 'help'); } catch (_) { names = []; }
    const used = new Set(rows.filter((r) => r.what.startsWith('/')).map((r) => r.what.split(' ')[0].slice(1)));
    return { rows, total: t[0].n, people: t[0].people, unused: names.filter((n) => !used.has(n)).sort() };
}

const line = (r) => `**${r.what}** · ${r.n} use${r.n === 1 ? '' : 's'} · ${r.people} ${r.people === 1 ? 'person' : 'people'}`;

/** A field for the weekly staff report. */
async function reportField(guildId) {
    const s = await summary(guildId, 7);
    if (!s.total) return { name: '📈 Bot usage (7 days)', value: 'Nobody used the bot this week (or it was just updated).' };
    const top = s.rows.slice(0, 6).map((r) => `• ${line(r)}`).join('\n');
    const menu = s.rows.filter((r) => r.what.startsWith('📌')).reduce((a, r) => a + r.n, 0);
    const value = [`**${s.total}** uses by **${s.people}** ${s.people === 1 ? 'person' : 'people'}${menu ? ` · 📌 menu post: ${menu}` : ''}`, top,
        s.unused.length ? `Not used: ${s.unused.map((n) => `/${n}`).join(', ')}` : null, 'More: `/admin panel` → 📈 Bot usage'].filter(Boolean).join('\n');
    return { name: '📈 Bot usage (7 days)', value: value.slice(0, 1024) };
}

/** The full screen for /admin panel → 📈 Bot usage. */
async function usageEmbed(guildId, days = 7) {
    const s = await summary(guildId, days);
    const embed = new EmbedBuilder().setColor(0x9B59B6).setTitle(`📈 Bot usage: last ${days} days`)
        .setFooter({ text: 'Counts only. The bot never shows who used what.' });
    if (!s.total) return embed.setDescription('Nothing yet. Usage is counted from version 3.10 on.');
    const cmds = s.rows.filter((r) => r.what.startsWith('/'));
    const menu = s.rows.filter((r) => r.what.startsWith('📌'));
    const btns = s.rows.filter((r) => !r.what.startsWith('/') && !r.what.startsWith('📌'));
    embed.setDescription(`**${s.total}** uses by **${s.people}** ${s.people === 1 ? 'person' : 'people'}.`);
    const field = (name, list) => { if (list.length) embed.addFields({ name, value: list.slice(0, 15).map(line).join('\n').slice(0, 1024) }); };
    field('⌨️ Commands', cmds);
    field('🔘 Buttons and screens', btns);
    field('📌 Menu post', menu);
    if (s.unused.length) embed.addFields({ name: '💤 Commands nobody used', value: s.unused.map((n) => `/${n}`).join(', ').slice(0, 1024) });
    return embed;
}

/** Old rows aren't needed: keep about four months. */
async function prune() {
    await pool.query(`DELETE FROM usage_events WHERE at < now() - interval '120 days'`).catch(() => {});
}

module.exports = { labelFor, record, summary, reportField, usageEmbed, prune };
