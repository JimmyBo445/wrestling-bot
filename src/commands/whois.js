// /whois: who plays a wrestler, and every wrestler that player has. Anyone can use it.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { respond, NO_MENTIONS, getDisplayNames, DIVISION_LABELS } = require('../utils/discordHelpers');
const { autocompleteCharacters, requireCharacter } = require('../utils/characterUtils');
const { characterSummary } = require('../utils/statsQueries');
const { rosterRows, currentTitles, activeTeams, shortTitle } = require('../utils/rosterInfo');
const { UserError } = require('../utils/errors');

const data = new SlashCommandBuilder()
    .setName('whois')
    .setDescription('Who plays a wrestler, and all of that player\'s wrestlers')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('character').setDescription('A wrestler (start typing)').setRequired(false).setAutocomplete(true))
    .addUserOption((o) => o.setName('player').setDescription('Or pick a player to see their wrestlers').setRequired(false));

/** One line per wrestler: name, division, record with this player, belts, team. */
async function lines(guildId, chars, highlightId = null) {
    const [titles, teams] = await Promise.all([currentTitles(guildId), activeTeams(guildId)]);
    const out = [];
    for (const c of chars) {
        const s = await characterSummary(c.id, null, c.owner_id);
        const rec = `${s.wins}-${s.losses}${s.draws ? `-${s.draws}` : ''}`;
        const belts = titles.get(String(c.id));
        const team = teams.get(String(c.id));
        const bits = [DIVISION_LABELS[c.division] || c.division, rec, belts && `🏆 ${belts.map(shortTitle).join(', ')}`, team && `Team: ${team.join(', ')}`].filter(Boolean);
        const name = String(c.id) === String(highlightId) ? `**${c.name}** ◀` : `**${c.name}**`;
        out.push(`${name}${c.status === 'retired' ? ' _(retired)_' : ''}\n${bits.join(' · ')}`);
    }
    return out;
}

module.exports = {
    data,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused();
        return interaction.respond(await autocompleteCharacters(interaction, focused, { statuses: ['approved', 'retired'] }));
    },

    async execute(interaction) {
        const guildId = interaction.guildId;
        const charVal = interaction.options.getString('character');
        const player = interaction.options.getUser('player');
        if (!charVal && !player) throw new UserError('Pick a `character` (who plays them?) or a `player` (which wrestlers do they have?).');

        let ownerId, picked = null;
        if (charVal) {
            picked = await requireCharacter(guildId, charVal, { statuses: ['approved', 'retired'] });
            if (picked.unclaimed) {
                const embed = new EmbedBuilder().setColor(0x95A5A6).setTitle(`Who is ${picked.name}?`)
                    .setDescription(`**${picked.name}** (${DIVISION_LABELS[picked.division]}) has **no player** right now. They're unclaimed.`);
                return respond(interaction, { embeds: [embed], allowedMentions: NO_MENTIONS });
            }
            ownerId = picked.owner_discord_id;
        } else {
            ownerId = player.id;
        }

        const chars = await rosterRows(guildId, { statuses: ['approved', 'retired'], ownerDiscordId: ownerId });
        // active wrestlers first, then retired
        chars.sort((a, b) => (a.status === 'retired') - (b.status === 'retired'));
        const name = (await getDisplayNames(interaction.guild, [ownerId])).get(ownerId) || 'that player';

        const embed = new EmbedBuilder().setColor(0xC0392B);
        if (picked) {
            embed.setTitle(`Who is ${picked.name}?`).setDescription(`**${picked.name}** is played by <@${ownerId}> (${name}).`);
        } else {
            embed.setTitle(`${name}'s wrestlers`).setDescription(chars.length ? `<@${ownerId}> plays **${chars.length}** wrestler${chars.length === 1 ? '' : 's'}.` : `<@${ownerId}> doesn't have any wrestlers yet.`);
        }
        if (chars.length) {
            const list = (await lines(guildId, chars, picked?.id)).join('\n\n');
            embed.addFields({ name: picked ? `All of ${name}'s wrestlers (${chars.length})` : 'Wrestlers', value: list.slice(0, 1024) });
        }
        embed.setFooter({ text: 'Record is with this player · /directory list shows the whole roster' });
        return respond(interaction, { embeds: [embed], allowedMentions: NO_MENTIONS });
    }
};
