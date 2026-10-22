const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { renderSeasonCard } = require('../utils/cardRenderer');
const { buildSeasonData } = require('../utils/season');
const { respond, NO_MENTIONS } = require('../utils/discordHelpers');
const { UserError } = require('../utils/errors');

const yearOpt = (o) => o.setName('year').setDescription('Season year (default: this year)').setRequired(false).setMinValue(2000).setMaxValue(2100);

const data = new SlashCommandBuilder()
    .setName('season')
    .setDescription('Yearly seasons: standings and a recap graphic (nothing is ever reset)')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('recap').setDescription('Season recap picture: top wrestlers and players, champions, match of the year').addIntegerOption(yearOpt))
    .addSubcommand((s) => s.setName('standings').setDescription('Season standings as text: top wrestlers and players for a year').addIntegerOption(yearOpt));

module.exports = {
    data,
    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const year = interaction.options.getInteger('year') || new Date().getFullYear();
        await interaction.deferReply();
        const d = await buildSeasonData(interaction.guild, year);
        if (!d.matches) throw new UserError(`No matches were logged in ${year}.`);
        if (sub === 'recap') {
            const buffer = await renderSeasonCard(d);
            return interaction.editReply({ content: `🏆 **${year} Season Recap**`, files: [new AttachmentBuilder(buffer, { name: `season-${year}.png` })] });
        }
        const medal = ['🥇', '🥈', '🥉'];
        const w = d.wrestlers.map((x, i) => `${medal[i] || `**${i + 1}.**`} ${x.name} (<@${x.discordId}>): **${x.w}-${x.l}**`);
        const p = d.players.map((x, i) => `${medal[i] || `**${i + 1}.**`} <@${x.discordId}>: **${x.w}-${x.l}**`);
        const embed = new EmbedBuilder().setTitle(`${year} Season Standings`).setColor(0xE8BF4A)
            .setDescription(`${d.matches} matches · ${d.titleMatches} title matches · ${d.titleChanges} title changes`)
            .addFields({ name: 'Top wrestlers', value: w.join('\n') || 'None yet' }, { name: 'Top players', value: p.join('\n') || 'None yet' });
        return interaction.editReply({ embeds: [embed], allowedMentions: NO_MENTIONS });
    }
};
