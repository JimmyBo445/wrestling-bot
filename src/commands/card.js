const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, AttachmentBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { requireAdmin, respond, NO_MENTIONS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { autocompleteCharacters } = require('../utils/characterUtils');
const { MATCH_CONFIG, CARD_BRANDS, MAX_CARD_MATCHES, DIVISION_THEME, isTeamMatch } = require('../utils/constants');
const { renderTapeCard } = require('../cards/tapeCard');
const { buildTapeData } = require('../utils/cardData');
const svc = require('../utils/cardService');
const { parseDate, fmtYmd } = require('../utils/dates');
const motn = require('../utils/motn');

const BRAND_CHOICES = Object.entries(CARD_BRANDS).map(([value, b]) => ({ name: { raw: 'RAW (red)', smackdown: 'SmackDown (blue)', luchaderpy: 'LuchaDerpy (purple)' }[value] || b.name, value }));
const DIVISION_CHOICES = Object.entries(DIVISION_THEME).map(([value, t]) => ({ name: t.label, value }));
const TYPE_CHOICES = Object.entries(MATCH_CONFIG).map(([value, c]) => ({ name: c.label, value }));
const MAX_SLOTS = Math.max(...Object.values(MATCH_CONFIG).map((c) => c.slots.length)); // 8

const brandOpt = (s) => s.addStringOption((o) => o.setName('brand').setDescription('RAW (red) or SmackDown (blue)').setRequired(true).addChoices(...BRAND_CHOICES));
const divOpt = (s, required = true, desc = 'Which division of the card') => s.addStringOption((o) => o.setName('division').setDescription(desc).setRequired(required).addChoices(...DIVISION_CHOICES));
const channelOpt = (s, desc) => s.addChannelOption((o) => o.setName('channel').setDescription(desc).setRequired(false).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement));

const data = new SlashCommandBuilder()
    .setName('card')
    .setDescription('[Admin] Build and post the RAW and SmackDown show cards')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => brandOpt(s.setName('new').setDescription('Start an empty show card (all divisions). Replaces the card already there.'))
        .addStringOption((o) => o.setName('name').setDescription('Show name, e.g. "Monday Night Mayhem"').setRequired(false).setMaxLength(40)))
    .addSubcommand((s) => brandOpt(s.setName('auto').setDescription('Book every division at once from recent matches: rematches, title shots, fresh matchups'))
        .addIntegerOption((o) => o.setName('matches').setDescription(`Matches per division (default 3, max ${MAX_CARD_MATCHES})`).setRequired(false).setMinValue(1).setMaxValue(MAX_CARD_MATCHES))
        .addStringOption((o) => o.setName('name').setDescription('Show name, e.g. "Monday Night Mayhem"').setRequired(false).setMaxLength(40))
        .addBooleanOption((o) => o.setName('use_signup').setDescription('Book from the current signup (default: yes when there is one)').setRequired(false))
        .addBooleanOption((o) => o.setName('rematches').setDescription('Allow rematches (off = nobody faces someone they met in the last 21 days). Default: saved setting').setRequired(false))
        .addBooleanOption((o) => o.setName('match_types').setDescription('Mix in triple threats, fatal 4-ways and tag teams (up to 1/3). Default: saved setting').setRequired(false))
        .addBooleanOption((o) => o.setName('records').setDescription('Pair wrestlers with similar records. Default: saved setting').setRequired(false)))
    .addSubcommand((s) => {
        brandOpt(s.setName('add').setDescription('Add a match to the card. The division comes from the wrestlers.'))
            .addStringOption((o) => o.setName('match_type').setDescription('Type of match').setRequired(true).addChoices(...TYPE_CHOICES))
            .addStringOption((o) => o.setName('wrestler1').setDescription('Wrestler 1 (tag matches: list Team 1 first, then Team 2)').setRequired(true).setAutocomplete(true))
            .addStringOption((o) => o.setName('wrestler2').setDescription('Wrestler 2').setRequired(true).setAutocomplete(true));
        for (let i = 3; i <= MAX_SLOTS; i++) {
            s.addStringOption((o) => o.setName(`wrestler${i}`).setDescription(`Wrestler ${i}`).setRequired(false).setAutocomplete(true));
        }
        return s
            .addStringOption((o) => o.setName('title').setDescription('Make it a title match for this belt').setRequired(false).setAutocomplete(true))
            .addStringOption((o) => o.setName('stipulation').setDescription('e.g. No DQ, Steel Cage, Main Event').setRequired(false).setMaxLength(40));
    })
    .addSubcommand((s) => brandOpt(s.setName('request').setDescription('Put an approved player match request on the card as a singles match'))
        .addStringOption((o) => o.setName('request').setDescription('Approved match request').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('title').setDescription('Make it a title match for this belt').setRequired(false).setAutocomplete(true)))
    .addSubcommand((s) => divOpt(brandOpt(s.setName('edit').setDescription('Change a match: swap a wrestler, set the title or stipulation')))
        .addIntegerOption((o) => o.setName('number').setDescription('Match number in that division').setRequired(true).setMinValue(1).setMaxValue(MAX_CARD_MATCHES))
        .addStringOption((o) => o.setName('swap_out').setDescription('Wrestler to take out').setRequired(false).setAutocomplete(true))
        .addStringOption((o) => o.setName('swap_in').setDescription('Wrestler to put in their place').setRequired(false).setAutocomplete(true))
        .addStringOption((o) => o.setName('title').setDescription('Belt for this match (type a single - to remove it)').setRequired(false).setAutocomplete(true))
        .addStringOption((o) => o.setName('stipulation').setDescription('Stipulation (type a single - to clear it)').setRequired(false).setMaxLength(40)))
    // 3.19.1: pick the match from a list (the old division + number still work inside the bot)
    .addSubcommand((s) => brandOpt(s.setName('remove').setDescription('[Admin] Take a match off a card'))
        .addStringOption((o) => o.setName('match').setDescription('Start typing a wrestler\'s name, or pick from the list').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => divOpt(brandOpt(s.setName('move').setDescription('Change the running order within a division')))
        .addIntegerOption((o) => o.setName('from').setDescription('Match number to move').setRequired(true).setMinValue(1).setMaxValue(MAX_CARD_MATCHES))
        .addIntegerOption((o) => o.setName('to').setDescription('New spot').setRequired(true).setMinValue(1).setMaxValue(MAX_CARD_MATCHES)))
    .addSubcommand((s) => brandOpt(s.setName('view').setDescription('See the whole card with buttons to preview, post and edit (only you see it)')))
    .addSubcommand((s) => channelOpt(divOpt(brandOpt(s.setName('post').setDescription('Post the card: one picture per division, with the wrestlers pinged below')), false, 'Post just this division (default: all)')
        .addBooleanOption((o) => o.setName('tapes').setDescription('Also attach a tale of the tape for each title match (default: no)').setRequired(false)), 'Where to post it (default: here)'))
    .addSubcommand((s) => divOpt(brandOpt(s.setName('tape').setDescription('Tale of the tape graphic for one match on the card')))
        .addIntegerOption((o) => o.setName('number').setDescription('Match number in that division').setRequired(true).setMinValue(1).setMaxValue(MAX_CARD_MATCHES)))
    .addSubcommand((s) => channelOpt(divOpt(brandOpt(s.setName('recap').setDescription('Post a results graphic per division (matches you have logged with /match)')), false, 'Just this division (default: all)'), 'Where to post it (default: here)'))
    .addSubcommand((s) => s.setName('auto-recap').setDescription('Turn the automatic show recap on or off (posted when the card\'s last match is logged)')
        .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
    .addSubcommand((s) => brandOpt(s.setName('schedule').setDescription('Set the show date for this card (the bot posts a reminder in the staff channel that day)'))
        .addStringOption((o) => o.setName('date').setDescription('Show date as YYYY-MM-DD, or - to unschedule').setRequired(true).setMaxLength(10)))
    .addSubcommand((s) => s.setName('upcoming').setDescription('Cards that are scheduled, soonest first'))
    .addSubcommand((s) => channelOpt(brandOpt(s.setName('vote').setDescription('Open a Match of the Night vote for the matches logged from this card')), 'Where to post the vote (default: here)'))
    .addSubcommand((s) => s.setName('vote-close').setDescription('Close the open Match of the Night vote and announce the winner'))
    .addSubcommand((s) => divOpt(brandOpt(s.setName('clear').setDescription('Delete the card (or just one division of it)')), false, 'Only this division (default: the whole card)'));

/** 3.19.2: "Left off the RAW card" message for ⚡ Auto-build, per division. Empty string when nobody was left off. */
function leftOffText(BL, out, signup) {
    const why = { room: 'no room on the card', faced: 'already faced everyone left in the last 21 days (rematches off)', injured: 'injured' };
    const parts = [];
    for (const r of out.results) {
        if (!r.leftOff.length) continue;
        const lines = r.leftOff.slice(0, 40).map((w) => `• ${w.name}${w.discordId ? ` (<@${w.discordId}>)` : ''}: ${why[w.reason] || w.reason}`);
        if (r.leftOff.length > 40) lines.push(`…and ${r.leftOff.length - 40} more`);
        parts.push(`**${svc.divisionLabel(r.division)}** (${r.leftOff.length})\n${lines.join('\n')}`);
    }
    for (const x of out.skipped) parts.push(`**${svc.divisionLabel(x.division)}**: nobody booked. ${x.reason}`);
    if (!parts.length) return '';
    const from = out.signupMode === 'used' && signup ? `signed up for **${signup.title}**` : 'could have been booked';
    return `🪑 **Left off the ${BL} card:** wrestlers who ${from} but aren't on it.\n\n${parts.join('\n\n')}`.slice(0, 1990);
}

module.exports = {
    data,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        const sub = interaction.options.getSubcommand(false);
        let division = interaction.options.getString('division');
        // for /card add the division comes from the first wrestler picked
        if (!division && sub === 'add') {
            const first = interaction.options.getString('wrestler1');
            if (first && /^\d+$/.test(first) && focused.name !== 'wrestler1') {
                const { rows } = await pool.query(`SELECT division FROM characters WHERE id = $1 AND guild_id = $2`, [first, interaction.guildId]);
                division = rows[0]?.division || null;
            }
        }
        if (focused.name === 'title') {
            const params = [interaction.guildId, `%${String(focused.value).replace(/[%_]/g, '')}%`];
            let extra = '';
            if (division) { params.push(division); extra = 'AND division = $3'; }
            const { rows } = await pool.query(`SELECT id, name, is_vacant FROM titles WHERE guild_id = $1 AND name ILIKE $2 ${extra} ORDER BY name LIMIT 25`, params);
            return interaction.respond(rows.map((r) => ({ name: `${r.name}${r.is_vacant ? ' (Vacant)' : ''}`.slice(0, 100), value: String(r.id) })));
        }
        if (focused.name === 'match' && sub === 'remove') { // 3.19.1: every match on that brand's card
            const brand = interaction.options.getString('brand');
            if (!brand) return interaction.respond([{ name: 'Pick the brand (RAW, SmackDown or LuchaDerpy) first', value: 'none' }]);
            const out = [];
            for (const d of await svc.filledDrafts(interaction.guildId, brand)) {
                const ms = await svc.getDraftMatches(d.id);
                const ids_ = [...new Set(ms.flatMap((m) => m.character_ids))];
                const { rows } = ids_.length ? await pool.query(`SELECT id, name FROM characters WHERE id = ANY($1::bigint[])`, [ids_]) : { rows: [] };
                const nm = new Map(rows.map((r) => [String(r.id), r.name]));
                for (const m of ms) {
                    const who = m.character_ids.map((x) => nm.get(String(x)) || '?');
                    const half = who.length / 2;
                    const text = isTeamMatch(m.match_type) ? `${who.slice(0, half).join(' & ')} vs ${who.slice(half).join(' & ')}` : who.join(' vs ');
                    out.push({ name: `${svc.divisionLabel(d.division)} #${m.position}: ${text}${m.match_id ? ' (logged)' : ''}`.slice(0, 100), value: `${d.division}:${m.position}` });
                }
            }
            const q = String(focused.value || '').toLowerCase();
            const list = out.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 25);
            return interaction.respond(list.length ? list : [{ name: out.length ? 'No match on that card has that name' : 'That card has no matches', value: 'none' }]);
        }
        if (focused.name === 'request') {
            const { rows } = await pool.query(
                `SELECT pr.id, a.name AS a, b.name AS b, pr.payload
                 FROM pending_requests pr JOIN characters a ON a.id = pr.character_id JOIN characters b ON b.id = pr.challenger_character_id
                 WHERE pr.guild_id = $1 AND pr.request_type = 'match_request' AND pr.status = 'approved'
                   AND COALESCE(pr.payload->>'booked', 'no') <> 'yes' AND a.status = 'approved' AND b.status = 'approved'
                 ORDER BY pr.id DESC LIMIT 25`, [interaction.guildId]);
            const q = String(focused.value || '').toLowerCase();
            return interaction.respond(rows.map((r) => ({ name: `${r.a} vs ${r.b}${r.payload?.note ? ` — ${r.payload.note}` : ''}`.slice(0, 100), value: String(r.id) }))
                .filter((o) => o.name.toLowerCase().includes(q)));
        }
        if (focused.name === 'swap_out') {
            // offer the wrestlers who are in that match
            const brand = interaction.options.getString('brand');
            const number = interaction.options.getInteger('number');
            if (brand && division && number) {
                const draft = await svc.getDraft(interaction.guildId, brand, division);
                const slot = draft ? (await svc.getDraftMatches(draft.id))[number - 1] : null;
                if (slot) {
                    const { rows } = await pool.query(`SELECT id, name FROM characters WHERE id = ANY($1::bigint[])`, [slot.character_ids]);
                    const q = String(focused.value || '').toLowerCase();
                    return interaction.respond(rows.filter((r) => r.name.toLowerCase().includes(q)).map((r) => ({ name: r.name.slice(0, 100), value: String(r.id) })));
                }
            }
            return interaction.respond([]);
        }
        return interaction.respond(await autocompleteCharacters(interaction, focused.value, { division: division || null }));
    },

    async execute(interaction) {
        requireAdmin(interaction, 'build match cards');
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        const brand = interaction.options.getString('brand');
        const division = interaction.options.getString('division');
        const cardUi = require('../utils/cardUi');
        const cardPost = require('../utils/cardPost');
        const BL = brand ? svc.brandLabel(brand) : '';
        const DL = division ? svc.divisionLabel(division) : '';
        const getChannelOrFail = async (target) => {
            const channel = await interaction.guild.channels.fetch(target.id).catch(() => null);
            if (!channel || !channel.isTextBased()) throw new UserError('I can\'t post in that channel. Pick a text channel I can see and send messages in.');
            return channel;
        };

        if (sub === 'auto-recap') {
            const on = interaction.options.getBoolean('enabled');
            await pool.query(`UPDATE guilds SET auto_recap = $1 WHERE guild_id = $2`, [on, guildId]);
            return respond(interaction, { content: on ? '✅ I\'ll post a written recap and results pictures when the last match of a card is logged.' : 'Automatic show recaps are off. You can still use `/card view` → 🧰 More tools → 🧾 Post recap.', flags: 64 });
        }

        if (sub === 'new') {
            await interaction.deferReply({ flags: 64 });
            await svc.startShow(guildId, brand, interaction.user.id, interaction.options.getString('name')?.trim() || null);
            return respond(interaction, { content: `Started a fresh **${BL}** card. Add matches with \`/card add\` (the division is picked from the wrestlers), or use \`/card view\` → 🧰 More tools → ⚡ Auto-build to have me book every division.` });
        }

        if (sub === 'auto') {
            await interaction.deferReply({ flags: 64 });
            const wanted = interaction.options.getInteger('matches') || 3;
            const su = require('../utils/signupUtils');
            const wantSignup = interaction.options.getBoolean('use_signup');
            const signup = wantSignup === false ? null : await su.activeSignup(guildId, brand === 'luchaderpy' ? su.LUCHA_KIND : 'main'); // 3.16
            const signupIds = signup ? await su.signedUpIds(signup.id) : null;
            const priority = signup ? await su.passedOverCounts(guildId, [...signupIds]) : null;
            // 3.19: the saved switches, unless this build says otherwise
            const saved = await svc.autoSettings(guildId);
            const pick = (n, d) => { const v = interaction.options.getBoolean(n); return v === null ? d : v; };
            const sw = { rematches: pick('rematches', saved.rematches), matchTypes: pick('match_types', saved.matchTypes), records: pick('records', saved.records) };
            const out = await svc.autoShow(guildId, brand, interaction.user.id, wanted, interaction.options.getString('name')?.trim() || null, { signupIds, priority, ...sw });
            const lines = out.results.map((r) => `**${svc.divisionLabel(r.division)}:** ${r.planned} match${r.planned === 1 ? '' : 'es'}${r.planned < r.wanted ? ` (wanted ${r.wanted})` : ''}`);
            const skipped = out.skipped.map((x) => `⚠️ **${svc.divisionLabel(x.division)}** was skipped: ${x.reason}`);
            const via = (out.signupMode === 'used' ? `\n📝 Booked only from the **${signup.title}** signup.` : '')
                + `\n⚙️ Rematches **${sw.rematches ? 'on' : `off (no one faces someone they met in the last ${svc.NO_REMATCH_DAYS} days)`}** · Other match types **${sw.matchTypes ? 'on' : 'off'}** · Pair by records **${sw.records ? 'on' : 'off'}**`;
            const ui = await cardUi.viewMessage(guildId, brand, {
                notice: `Booked the **${BL}** card from recent matches. ${lines.join(' · ')}${via}${skipped.length ? `\n${skipped.join('\n')}` : ''}\nChange anything with the buttons below, or add a match with \`/card add\`.`
            });
            await respond(interaction, ui);
            // 3.19.2: a separate private message: who was left off the card, and why
            const left = leftOffText(BL, out, signup);
            if (left) await interaction.followUp({ content: left, flags: 64, allowedMentions: { parse: [] }, [require('../utils/panelKit').SEPARATE]: true });
            return;
        }

        if (sub === 'add') {
            await interaction.deferReply({ flags: 64 });
            const matchType = interaction.options.getString('match_type');
            const characterIds = [];
            for (let i = 1; i <= MAX_SLOTS; i++) {
                const v = interaction.options.getString(`wrestler${i}`);
                if (v !== null) characterIds.push(v);
            }
            const res = await svc.addMatchToCard(guildId, brand, {
                matchType, characterIds, titleId: interaction.options.getString('title'), stipulation: interaction.options.getString('stipulation'), createdBy: interaction.user.id
            });
            const draft = await svc.requireDraft(guildId, brand, res.division);
            return respond(interaction, {
                content: `Added as **${svc.divisionLabel(res.division)}** match **${res.number}** on the ${BL} card.${res.warnings.length ? `\n⚠️ ${res.warnings.join('\n⚠️ ')}` : ''}\n\n${await svc.describeCard(draft)}\n\n${res.number >= MAX_CARD_MATCHES ? `The ${svc.divisionLabel(res.division)} part of the card is full.` : `${MAX_CARD_MATCHES - res.number} spot${MAX_CARD_MATCHES - res.number === 1 ? '' : 's'} left in ${svc.divisionLabel(res.division)}.`} See everything with \`/card view\`.`,
                allowedMentions: NO_MENTIONS
            });
        }

        if (sub === 'request') {
            await interaction.deferReply({ flags: 64 });
            const id = parseInt(interaction.options.getString('request'), 10);
            const { rows } = Number.isInteger(id) ? await pool.query(
                `SELECT * FROM pending_requests WHERE id = $1 AND guild_id = $2 AND request_type = 'match_request' AND status = 'approved'`, [id, guildId]) : { rows: [] };
            const req = rows[0];
            if (!req) throw new UserError('Pick one of the approved match requests from the list.');
            if (req.payload?.booked === 'yes') throw new UserError('That request is already on a card.');
            const res = await svc.addMatchToCard(guildId, brand, {
                matchType: 'singles', characterIds: [String(req.character_id), String(req.challenger_character_id)],
                titleId: interaction.options.getString('title'), stipulation: req.payload?.note ? String(req.payload.note).slice(0, 40) : null, createdBy: interaction.user.id
            });
            await pool.query(`UPDATE pending_requests SET payload = COALESCE(payload, '{}'::jsonb) || '{"booked":"yes"}'::jsonb WHERE id = $1`, [id]);
            const draft = await svc.requireDraft(guildId, brand, res.division);
            return respond(interaction, {
                content: `Added the request as **${svc.divisionLabel(res.division)}** match **${res.number}** on the ${BL} card.${res.warnings.length ? `\n⚠️ ${res.warnings.join('\n⚠️ ')}` : ''}\n\n${await svc.describeCard(draft)}`,
                allowedMentions: NO_MENTIONS
            });
        }

        if (sub === 'edit') {
            await interaction.deferReply({ flags: 64 });
            const n = interaction.options.getInteger('number');
            const out = interaction.options.getString('swap_out');
            const inn = interaction.options.getString('swap_in');
            const titleRaw = interaction.options.getString('title');
            const stipRaw = interaction.options.getString('stipulation');
            if (out === null && inn === null && titleRaw === null && stipRaw === null) throw new UserError('Nothing to change: fill in `swap_out` and `swap_in`, `title` or `stipulation`.');
            if ((out === null) !== (inn === null)) throw new UserError('To swap a wrestler, fill in both `swap_out` (who leaves) and `swap_in` (who replaces them).');
            const edits = {};
            if (inn !== null) { edits.swapOut = out; edits.swapIn = inn; }
            if (titleRaw !== null) edits.titleId = titleRaw.trim() === '-' ? null : titleRaw;
            if (stipRaw !== null) edits.stipulation = stipRaw.trim() === '-' ? null : stipRaw;
            const res = await svc.editMatchOnCard(guildId, brand, division, n, edits);
            const draft = await svc.requireDraft(guildId, brand, division);
            return respond(interaction, { content: `Updated ${DL} match **${n}**.${res.warnings.length ? `\n⚠️ ${res.warnings.join('\n⚠️ ')}` : ''}\n\n${await svc.describeCard(draft)}`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'remove') {
            await interaction.deferReply({ flags: 64 });
            let div = division, n = interaction.options.getInteger('number');
            const pick = interaction.options.getString('match');
            if (pick) { // 3.19.1: "division:number" from the list
                const m = /^([a-z_]+):(\d+)$/.exec(pick);
                if (!m) throw new UserError('Pick a match from the list (start typing a wrestler\'s name).');
                [div, n] = [m[1], Number(m[2])];
            }
            if (!div || !n) throw new UserError('Pick the match to take off.');
            const before = await svc.describeCard(await svc.requireDraft(guildId, brand, div));
            const line = before.split('\n').find((l) => l.startsWith(`**${n}.**`)) || `match ${n}`;
            await svc.removeMatchFromCard(guildId, brand, div, n);
            return respond(interaction, { content: `🗑 Took this off the ${BL} card (${svc.divisionLabel(div)}):\n${line}\n\n**The ${BL} card now:**\n${await svc.describeShow(guildId, brand)}`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'move') {
            await interaction.deferReply({ flags: 64 });
            await svc.moveMatchOnCard(guildId, brand, division, interaction.options.getInteger('from'), interaction.options.getInteger('to'));
            return respond(interaction, { content: `Moved it.\n\n${await svc.describeCard(await svc.requireDraft(guildId, brand, division))}`, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'view') {
            await interaction.deferReply({ flags: 64 });
            const none = !(await svc.brandDrafts(guildId, brand)).length && !(await svc.getShow(guildId, brand));
            return respond(interaction, await cardUi.viewMessage(guildId, brand, { notice: none ? `There's no ${BL} card yet. Press 🧰 **More tools** → 🆕 New card or ⚡ Auto-build, or add a match with \`/card add\`.` : null }));
        }

        if (sub === 'post') {
            const target = interaction.options.getChannel('channel');
            await interaction.deferReply(target ? { flags: 64 } : {});
            const messages = await cardPost.buildCardMessages(interaction.guild, guildId, brand, { division, tapes: interaction.options.getBoolean('tapes') === true });
            if (target) {
                const channel = await getChannelOrFail(target);
                try { await cardPost.sendToChannel(channel, messages); }
                catch (e) { throw new UserError('I couldn\'t post there. Check that I can view the channel, send messages and attach files.'); }
                return respond(interaction, { content: `Posted the ${BL}${division ? ` ${DL}` : ''} card in <#${target.id}>.` });
            }
            return cardPost.replyWith(interaction, messages);
        }

        if (sub === 'recap') {
            const target = interaction.options.getChannel('channel');
            await interaction.deferReply(target ? { flags: 64 } : {});
            const messages = await cardPost.buildRecapMessages(interaction.guild, guildId, brand, { division });
            if (target) {
                const channel = await getChannelOrFail(target);
                try { await cardPost.sendToChannel(channel, messages); }
                catch (e) { throw new UserError('I couldn\'t post there. Check that I can view the channel, send messages and attach files.'); }
                return respond(interaction, { content: `Posted the ${BL} recap in <#${target.id}>.` });
            }
            return cardPost.replyWith(interaction, messages);
        }

        if (sub === 'tape') {
            const n = interaction.options.getInteger('number');
            const draft = await svc.requireDraft(guildId, brand, division);
            const slots = await svc.getDraftMatches(draft.id);
            const slot = slots[n - 1];
            if (!slot) throw new UserError(slots.length ? `Pick a ${DL} match number from 1 to ${slots.length}.` : 'That card has no matches yet.');
            const targets = await svc.tapeTargetsForSlot(guildId, slot);
            if (!targets) throw new UserError('A tale of the tape works for singles matches and tag matches where both sides are registered teams (`/team create`).');
            await interaction.deferReply();
            const buffer = await renderTapeCard(await buildTapeData(interaction.guild, targets));
            return respond(interaction, { files: [new AttachmentBuilder(buffer, { name: 'tale-of-the-tape.png' })] });
        }

        if (sub === 'schedule') {
            const raw = interaction.options.getString('date').trim();
            if (raw === '-') {
                await pool.query(`UPDATE card_shows SET show_date = NULL, reminded_on = NULL WHERE guild_id = $1 AND brand = $2`, [guildId, brand]);
                return respond(interaction, { content: `The ${BL} card is no longer scheduled.` });
            }
            const date = parseDate(raw, 'The show date');
            if (!(await svc.getShow(guildId, brand)) && !(await svc.brandDrafts(guildId, brand)).length) throw new UserError(`There's no ${BL} card yet. Start one first: \`/card view\` → 🧰 More tools → 🆕 New card or ⚡ Auto-build.`);
            await pool.query(
                `INSERT INTO card_shows (guild_id, brand, show_date, created_by) VALUES ($1, $2, $3, $4)
                 ON CONFLICT (guild_id, brand) DO UPDATE SET show_date = EXCLUDED.show_date, reminded_on = NULL, updated_at = now()`, [guildId, brand, date, interaction.user.id]);
            const s = await require('../utils/ensureGuild').getGuildSettings(guildId);
            return respond(interaction, { content: `📅 The **${BL}** card is set for **${date}**.${s.admin_channel_id ? ` I'll post "tonight's card" in <#${s.admin_channel_id}> from noon that day.` : ' Set a staff channel with `/admin panel` → 📺 Channels and I\'ll remind you on the day.'}` });
        }

        if (sub === 'upcoming') {
            const { rows } = await pool.query(
                `SELECT cs.*, (SELECT COALESCE(SUM((SELECT COUNT(*) FROM card_draft_matches WHERE draft_id = cd.id)), 0)::int FROM card_drafts cd WHERE cd.guild_id = cs.guild_id AND cd.brand = cs.brand) AS n
                 FROM card_shows cs WHERE cs.guild_id = $1 AND cs.show_date IS NOT NULL ORDER BY cs.show_date, cs.brand`, [guildId]);
            if (!rows.length) return respond(interaction, { content: 'No cards are scheduled. Use `/card view` → 🧰 More tools → 📅 Schedule on a card you are building.', flags: 64 });
            const lines = rows.map((r) => `**${fmtYmd(r.show_date)}** — ${svc.brandLabel(r.brand)}${r.name ? ` “${r.name}”` : ''} · ${r.n} match${r.n === 1 ? '' : 'es'}`);
            return respond(interaction, { content: `📅 **Upcoming cards**\n${lines.join('\n')}`, flags: 64 });
        }

        if (sub === 'vote') {
            const drafts = await svc.filledDrafts(guildId, brand);
            const slots = [];
            for (const d of drafts) slots.push(...(await svc.getDraftMatches(d.id)).filter((x) => x.match_id));
            const target = interaction.options.getChannel('channel');
            await interaction.deferReply(target ? { flags: 64 } : {});
            const poll = await motn.createPoll(guildId, slots.map((x) => x.match_id), interaction.user.id);
            const payload = { ...(await motn.buildPollMessage(poll)), allowedMentions: NO_MENTIONS };
            let msg;
            if (target) {
                const channel = await interaction.guild.channels.fetch(target.id).catch(() => null);
                if (!channel?.isTextBased()) throw new UserError('I can\'t post in that channel.');
                msg = await channel.send(payload).catch(() => { throw new UserError('I couldn\'t post there. Check that I can view the channel and send messages.'); });
                await respond(interaction, { content: `Vote opened in <#${target.id}>. Close it with \`/card view\` → 🧰 More tools → 🔒 Close MOTN vote.` });
            } else {
                msg = await interaction.editReply(payload);
            }
            await pool.query(`UPDATE motn_polls SET channel_id = $2, message_id = $3 WHERE id = $1`, [poll.id, msg?.channelId || target?.id || interaction.channelId, msg?.id || null]);
            return;
        }

        if (sub === 'vote-close') {
            const { poll, winners, topVotes } = await motn.closePoll(guildId);
            const names = await motn.matchNames(winners);
            const text = !winners.length
                ? 'The vote is closed. Nobody voted.'
                : `⭐ **Match of the Night:** ${winners.map((w) => `**${motn.shortNames(names.get(String(w)))}**`).join(' and ')} (${topVotes} vote${topVotes === 1 ? '' : 's'}${winners.length > 1 ? ' each, a tie' : ''}).`;
            try {
                if (poll.channel_id && poll.message_id) {
                    const ch = await interaction.client.channels.fetch(poll.channel_id);
                    const m = await ch.messages.fetch(poll.message_id);
                    await m.edit({ ...(await motn.buildPollMessage(poll, { showCounts: true })) });
                }
            } catch (err) { console.error('Could not update vote message:', err.message); }
            return respond(interaction, { content: text, allowedMentions: NO_MENTIONS });
        }

        if (sub === 'clear') {
            await interaction.deferReply({ flags: 64 });
            await svc.clearCard(guildId, brand, division);
            return respond(interaction, { content: division ? `Deleted the ${DL} part of the ${BL} card.` : `Deleted the ${BL} card.` });
        }
    }
};

// 3.8: Discord only lists /card view and /card add. Everything else is a button on the card screen
// (🧰 More tools); the old subcommands still work inside the bot because the buttons run them.
{
    const full = data.toJSON();
    const opts = full.options || [];
    const shown = { ...full, options: ['view', 'add', 'remove'].map((n) => opts.find((o) => o.name === n)) }; // 3.19.1: + remove
    module.exports.data = { name: full.name, toJSON: () => JSON.parse(JSON.stringify(shown)), full: () => JSON.parse(JSON.stringify(full)) };
}
