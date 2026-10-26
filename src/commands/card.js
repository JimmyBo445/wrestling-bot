const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, AttachmentBuilder } = require('discord.js');
const { pool } = require('../db/pool');
const { requireAdmin, respond, NO_MENTIONS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');
const { autocompleteCharacters } = require('../utils/characterUtils');
const { MATCH_CONFIG, CARD_BRANDS, MAX_CARD_MATCHES, DIVISION_THEME } = require('../utils/constants');
const { renderShowCard } = require('../cards/showCard');
const { renderTapeCard } = require('../cards/tapeCard');
const { buildTapeData } = require('../utils/cardData');
const svc = require('../utils/cardService');
const { parseDate, fmtYmd } = require('../utils/dates');
const motn = require('../utils/motn');

const BRAND_CHOICES = Object.entries(CARD_BRANDS).map(([value, b]) => ({ name: b.label === 'RAW' ? 'RAW (red)' : 'SmackDown (blue)', value }));
const DIVISION_CHOICES = Object.entries(DIVISION_THEME).map(([value, t]) => ({ name: t.label, value }));
const TYPE_CHOICES = Object.entries(MATCH_CONFIG).map(([value, c]) => ({ name: c.label, value }));
const MAX_SLOTS = Math.max(...Object.values(MATCH_CONFIG).map((c) => c.slots.length)); // 8

// Every subcommand starts with the same two choices: which show, which division.
const showOpts = (sub) => sub
    .addStringOption((o) => o.setName('brand').setDescription('RAW (red) or SmackDown (blue)').setRequired(true).addChoices(...BRAND_CHOICES))
    .addStringOption((o) => o.setName('division').setDescription('Division for this card').setRequired(true).addChoices(...DIVISION_CHOICES));

const data = new SlashCommandBuilder()
    .setName('card')
    .setDescription('[Admin] Build and post match cards for RAW and SmackDown')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => showOpts(s.setName('new').setDescription(`Start an empty card (up to ${MAX_CARD_MATCHES} matches). Replaces the card already there.`))
        .addStringOption((o) => o.setName('name').setDescription('Show name, e.g. "Monday Night Mayhem"').setRequired(false).setMaxLength(40)))
    .addSubcommand((s) => showOpts(s.setName('auto').setDescription('Generate a card from recent matches: rematches, title shots and fresh matchups'))
        .addIntegerOption((o) => o.setName('matches').setDescription(`How many matches (default 5, max ${MAX_CARD_MATCHES})`).setRequired(false).setMinValue(1).setMaxValue(MAX_CARD_MATCHES))
        .addStringOption((o) => o.setName('name').setDescription('Show name, e.g. "Monday Night Mayhem"').setRequired(false).setMaxLength(40))
        .addBooleanOption((o) => o.setName('use_signup').setDescription('Book from the current signup (default: yes when there is one)').setRequired(false)))
    .addSubcommand((s) => {
        showOpts(s.setName('add').setDescription('Add a match to the card and pick who is in it'))
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
    .addSubcommand((s) => showOpts(s.setName('request').setDescription('Put an approved player match request on the card as a singles match'))
        .addStringOption((o) => o.setName('request').setDescription('Approved match request').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('title').setDescription('Make it a title match for this belt').setRequired(false).setAutocomplete(true)))
    .addSubcommand((s) => showOpts(s.setName('remove').setDescription('Take a match off the card'))
        .addIntegerOption((o) => o.setName('number').setDescription('Match number').setRequired(true).setMinValue(1).setMaxValue(MAX_CARD_MATCHES)))
    .addSubcommand((s) => showOpts(s.setName('move').setDescription('Change the running order'))
        .addIntegerOption((o) => o.setName('from').setDescription('Match number to move').setRequired(true).setMinValue(1).setMaxValue(MAX_CARD_MATCHES))
        .addIntegerOption((o) => o.setName('to').setDescription('New spot').setRequired(true).setMinValue(1).setMaxValue(MAX_CARD_MATCHES)))
    .addSubcommand((s) => showOpts(s.setName('view').setDescription('Preview the card (only you see it)')))
    .addSubcommand((s) => showOpts(s.setName('post').setDescription('Post the finished card as a picture (title matches get a tale of the tape)'))
        .addBooleanOption((o) => o.setName('tapes').setDescription('Attach a tale of the tape for each title match (default: yes)').setRequired(false))
        .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: here)').setRequired(false)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => showOpts(s.setName('tape').setDescription('Tale of the tape graphic for one match on the card'))
        .addIntegerOption((o) => o.setName('number').setDescription('Match number').setRequired(true).setMinValue(1).setMaxValue(MAX_CARD_MATCHES)))
    .addSubcommand((s) => showOpts(s.setName('recap').setDescription('Post a results graphic for the show (matches you have logged with /match)'))
        .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: here)').setRequired(false)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => showOpts(s.setName('schedule').setDescription('Set the show date for this card (the bot posts a reminder in the staff channel that day)'))
        .addStringOption((o) => o.setName('date').setDescription('Show date as YYYY-MM-DD, or - to unschedule').setRequired(true).setMaxLength(10)))
    .addSubcommand((s) => s.setName('upcoming').setDescription('Cards that are scheduled, soonest first'))
    .addSubcommand((s) => showOpts(s.setName('vote').setDescription('Open a Match of the Night vote for the matches logged from this card'))
        .addChannelOption((o) => o.setName('channel').setDescription('Where to post the vote (default: here)').setRequired(false)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('vote-close').setDescription('Close the open Match of the Night vote and announce the winner'))
    .addSubcommand((s) => showOpts(s.setName('clear').setDescription('Delete the card')));


module.exports = {
    data,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        const division = interaction.options.getString('division');
        if (focused.name === 'title') {
            const params = [interaction.guildId, `%${String(focused.value).replace(/[%_]/g, '')}%`];
            let extra = '';
            if (division) { params.push(division); extra = 'AND division = $3'; }
            const { rows } = await pool.query(`SELECT id, name, is_vacant FROM titles WHERE guild_id = $1 AND name ILIKE $2 ${extra} ORDER BY name LIMIT 25`, params);
            return interaction.respond(rows.map((r) => ({ name: `${r.name}${r.is_vacant ? ' (Vacant)' : ''}`.slice(0, 100), value: String(r.id) })));
        }
        if (focused.name === 'request') {
            const { rows } = await pool.query(
                `SELECT pr.id, a.name AS a, b.name AS b, pr.payload
                 FROM pending_requests pr JOIN characters a ON a.id = pr.character_id JOIN characters b ON b.id = pr.challenger_character_id
                 WHERE pr.guild_id = $1 AND pr.request_type = 'match_request' AND pr.status = 'approved'
                   AND COALESCE(pr.payload->>'booked', 'no') <> 'yes' AND a.status = 'approved' AND b.status = 'approved'
                   AND ($2::text IS NULL OR a.division = $2)
                 ORDER BY pr.id DESC LIMIT 25`, [interaction.guildId, division || null]);
            const q = String(focused.value || '').toLowerCase();
            return interaction.respond(rows.map((r) => ({ name: `${r.a} vs ${r.b}${r.payload?.note ? ` — ${r.payload.note}` : ''}`.slice(0, 100), value: String(r.id) }))
                .filter((o) => o.name.toLowerCase().includes(q)));
        }
        return interaction.respond(await autocompleteCharacters(interaction, focused.value, { division: division || null }));
    },

    async execute(interaction) {
        requireAdmin(interaction, 'build match cards');
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        const brand = interaction.options.getString('brand');
        const division = interaction.options.getString('division');
        const label = brand ? `${svc.brandLabel(brand)} ${svc.divisionLabel(division)}` : '';
        const list = async () => svc.describeCard(await svc.requireDraft(guildId, brand, division));

        if (sub === 'new') {
            await interaction.deferReply({ flags: 64 });
            await svc.startDraft(guildId, brand, division, interaction.user.id, interaction.options.getString('name')?.trim() || null);
            return respond(interaction, { content: `Started a fresh **${label}** card. Add matches with \`/card add\`, or use \`/card auto\` to have me book one.` });
        }

        if (sub === 'auto') {
            await interaction.deferReply({ flags: 64 });
            const wanted = interaction.options.getInteger('matches') || 5;
            const su = require('../utils/signupUtils');
            const wantSignup = interaction.options.getBoolean('use_signup');
            const signup = wantSignup === false ? null : await su.activeSignup(guildId);
            const signupIds = signup ? await su.signedUpIds(signup.id) : null;
            const priority = signup ? await su.passedOverCounts(guildId, [...signupIds]) : null;
            const { draft, planned, signupMode, signedCount } = await svc.autoCard(guildId, brand, division, interaction.user.id, wanted, interaction.options.getString('name')?.trim() || null, { signupIds, priority });
            const via = signupMode === 'used' ? `\n📝 Booked from the **${signup.title}** signup (${signedCount} wrestler${signedCount === 1 ? '' : 's'} available in this division).`
                : signupMode === 'fallback' ? `\n⚠️ Fewer than 2 ${label} wrestlers signed up for **${signup.title}**, so I booked from everyone.` : '';
            const buffer = await renderShowCard(await svc.buildShowData(interaction.guild, draft));
            const short = (planned < wanted ? `\nOnly ${planned} of ${wanted} matches could be booked (not enough free wrestlers).` : '') + via;
            return respond(interaction, {
                content: `Booked a **${label}** card from recent matches:\n${await svc.describeCard(draft)}${short}\n\nTweak it with \`/card add\`, \`/card remove\` and \`/card move\`, then \`/card post\`.`,
                files: [new AttachmentBuilder(buffer, { name: 'card-preview.png' })]
            });
        }

        if (sub === 'add') {
            await interaction.deferReply({ flags: 64 });
            const matchType = interaction.options.getString('match_type');
            const characterIds = [];
            for (let i = 1; i <= MAX_SLOTS; i++) {
                const v = interaction.options.getString(`wrestler${i}`);
                if (v !== null) characterIds.push(v);
            }
            const { number, warnings } = await svc.addMatchToCard(guildId, brand, division, {
                matchType, characterIds, titleId: interaction.options.getString('title'), stipulation: interaction.options.getString('stipulation')
            });
            const draft = await svc.requireDraft(guildId, brand, division);
            return respond(interaction, {
                content: `Added as match **${number}** on the ${label} card.${warnings.length ? `\n⚠️ ${warnings.join('\n⚠️ ')}` : ''}\n\n${await svc.describeCard(draft)}\n\n${number >= MAX_CARD_MATCHES ? 'The card is full.' : `${MAX_CARD_MATCHES - number} spot${MAX_CARD_MATCHES - number === 1 ? '' : 's'} left.`}`,
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
            const { number, warnings } = await svc.addMatchToCard(guildId, brand, division, {
                matchType: 'singles', characterIds: [String(req.character_id), String(req.challenger_character_id)],
                titleId: interaction.options.getString('title'), stipulation: req.payload?.note ? String(req.payload.note).slice(0, 40) : null
            });
            await pool.query(`UPDATE pending_requests SET payload = COALESCE(payload, '{}'::jsonb) || '{"booked":"yes"}'::jsonb WHERE id = $1`, [id]);
            const draft = await svc.requireDraft(guildId, brand, division);
            return respond(interaction, {
                content: `Added the request as match **${number}** on the ${label} card.${warnings.length ? `\n⚠️ ${warnings.join('\n⚠️ ')}` : ''}\n\n${await svc.describeCard(draft)}`,
                allowedMentions: NO_MENTIONS
            });
        }

        if (sub === 'remove') {
            await interaction.deferReply({ flags: 64 });
            const n = interaction.options.getInteger('number');
            await svc.removeMatchFromCard(guildId, brand, division, n);
            return respond(interaction, { content: `Removed match ${n}.\n\n${await list()}` });
        }

        if (sub === 'move') {
            await interaction.deferReply({ flags: 64 });
            await svc.moveMatchOnCard(guildId, brand, division, interaction.options.getInteger('from'), interaction.options.getInteger('to'));
            return respond(interaction, { content: `Moved it.\n\n${await list()}` });
        }

        if (sub === 'view') {
            await interaction.deferReply({ flags: 64 });
            const draft = await svc.requireDraft(guildId, brand, division);
            const buffer = await renderShowCard(await svc.buildShowData(interaction.guild, draft));
            return respond(interaction, { content: `**${label}** card preview:\n${await svc.describeCard(draft)}`, files: [new AttachmentBuilder(buffer, { name: 'card-preview.png' })] });
        }

        if (sub === 'post' || sub === 'recap') {
            const recap = sub === 'recap';
            const draft = await svc.requireDraft(guildId, brand, division);
            const slots = await svc.getDraftMatches(draft.id);
            if (!slots.length) throw new UserError(`The ${label} card has no matches yet.`);
            if (recap && !slots.some((s) => s.match_id)) {
                throw new UserError(`None of the ${label} card's matches have been logged yet. Log them with \`/match\` (use the same wrestlers and match type as the card) and I'll connect them automatically.`);
            }
            const target = interaction.options.getChannel('channel');
            await interaction.deferReply(target ? { flags: 64 } : {});
            const data = recap ? await svc.buildRecapData(interaction.guild, draft) : await svc.buildShowData(interaction.guild, draft);
            const files = [new AttachmentBuilder(await renderShowCard(data), { name: `${draft.brand}-${draft.division}-${recap ? 'recap' : 'card'}.png` })];
            if (!recap && interaction.options.getBoolean('tapes') !== false) {
                for (const slot of slots.filter((s) => s.title_id).slice(0, 9)) {
                    try {
                        const t = await svc.tapeTargetsForSlot(guildId, slot);
                        if (!t) continue;
                        files.push(new AttachmentBuilder(await renderTapeCard(await buildTapeData(interaction.guild, t)), { name: `tape-${slot.position}.png` }));
                    } catch (err) { console.error('Tale of the tape failed:', err.message); }
                }
            }
            const noun = recap ? 'recap' : 'card';
            if (target) {
                const channel = await interaction.guild.channels.fetch(target.id).catch(() => null);
                if (!channel || !channel.isTextBased()) throw new UserError('I can\'t post in that channel. Pick a text channel I can see and send messages in.');
                try { await channel.send({ files, allowedMentions: NO_MENTIONS }); }
                catch (e) { throw new UserError('I couldn\'t post there. Check that I can view the channel, send messages and attach files.'); }
                return respond(interaction, { content: `Posted the ${label} ${noun} in <#${target.id}>.` });
            }
            return respond(interaction, { files });
        }

        if (sub === 'tape') {
            const n = interaction.options.getInteger('number');
            const draft = await svc.requireDraft(guildId, brand, division);
            const slots = await svc.getDraftMatches(draft.id);
            const slot = slots[n - 1];
            if (!slot) throw new UserError(slots.length ? `Pick a match number from 1 to ${slots.length}.` : 'That card has no matches yet.');
            const targets = await svc.tapeTargetsForSlot(guildId, slot);
            if (!targets) throw new UserError('A tale of the tape works for singles matches and tag matches where both sides are registered teams (`/team create`).');
            await interaction.deferReply();
            const buffer = await renderTapeCard(await buildTapeData(interaction.guild, targets));
            return respond(interaction, { files: [new AttachmentBuilder(buffer, { name: 'tale-of-the-tape.png' })] });
        }

        if (sub === 'schedule') {
            const raw = interaction.options.getString('date').trim();
            const draft = await svc.requireDraft(guildId, brand, division);
            if (raw === '-') {
                await pool.query(`UPDATE card_drafts SET show_date = NULL, reminded_on = NULL WHERE id = $1`, [draft.id]);
                return respond(interaction, { content: `The ${label} card is no longer scheduled.` });
            }
            const date = parseDate(raw, 'The show date');
            await pool.query(`UPDATE card_drafts SET show_date = $2, reminded_on = NULL WHERE id = $1`, [draft.id, date]);
            const s = await require('../utils/ensureGuild').getGuildSettings(guildId);
            return respond(interaction, { content: `📅 The **${label}** card is set for **${date}**.${s.admin_channel_id ? ` I'll post "tonight's card" in <#${s.admin_channel_id}> from noon that day.` : ' Set a staff channel with `/admin set-admin-channel` and I\'ll remind you on the day.'}` });
        }

        if (sub === 'upcoming') {
            const { rows } = await pool.query(
                `SELECT cd.*, (SELECT COUNT(*)::int FROM card_draft_matches WHERE draft_id = cd.id) AS n
                 FROM card_drafts cd WHERE cd.guild_id = $1 AND cd.show_date IS NOT NULL ORDER BY cd.show_date, cd.id`, [guildId]);
            if (!rows.length) return respond(interaction, { content: 'No cards are scheduled. Use `/card schedule` on a card you are building.', flags: 64 });
            const lines = rows.map((r) => `**${fmtYmd(r.show_date)}** — ${svc.cardLabel(r)}${r.name ? ` “${r.name}”` : ''} · ${r.n} match${r.n === 1 ? '' : 'es'}`);
            return respond(interaction, { content: `📅 **Upcoming cards**\n${lines.join('\n')}`, flags: 64 });
        }

        if (sub === 'vote') {
            const draft = await svc.requireDraft(guildId, brand, division);
            const slots = (await svc.getDraftMatches(draft.id)).filter((s) => s.match_id);
            const target = interaction.options.getChannel('channel');
            await interaction.deferReply(target ? { flags: 64 } : {});
            const poll = await motn.createPoll(guildId, slots.map((s) => s.match_id), interaction.user.id);
            const payload = { ...(await motn.buildPollMessage(poll)), allowedMentions: NO_MENTIONS };
            let msg;
            if (target) {
                const channel = await interaction.guild.channels.fetch(target.id).catch(() => null);
                if (!channel?.isTextBased()) throw new UserError('I can\'t post in that channel.');
                msg = await channel.send(payload).catch(() => { throw new UserError('I couldn\'t post there. Check that I can view the channel and send messages.'); });
                await respond(interaction, { content: `Vote opened in <#${target.id}>. Close it with \`/card vote-close\`.` });
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
            return respond(interaction, { content: `Deleted the ${label} card.` });
        }
    }
};
