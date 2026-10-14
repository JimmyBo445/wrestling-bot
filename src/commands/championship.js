const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { pool, withTransaction } = require('../db/pool');
const { autocompleteCharacters, getCharacterById } = require('../utils/characterUtils');
const { renderMatchCard } = require('../utils/cardRenderer');

async function autocompleteTitles(interaction, focusedValue) {
    const { rows } = await pool.query(
        `SELECT id, name, is_vacant FROM titles WHERE guild_id = $1 AND name ILIKE $2 ORDER BY name LIMIT 25`,
        [interaction.guildId, `%${focusedValue}%`]
    );
    return rows.map((r) => ({ name: `${r.name}${r.is_vacant ? ' (Vacant)' : ''}`, value: String(r.id) }));
}

async function getCurrentChampion(titleId) {
    const { rows } = await pool.query(
        `SELECT tr.*, c.name AS character_name, u.discord_id
         FROM title_reigns tr
         LEFT JOIN characters c ON c.id = tr.character_id
         LEFT JOIN users u ON u.id = c.owner_id
         WHERE tr.title_id = $1 AND tr.lost_date IS NULL
         ORDER BY tr.won_date DESC LIMIT 1`,
        [titleId]
    );
    return rows[0] || null;
}

async function endReignAndStartNew(client, { guildId, titleId, newCharacterId, matchId, enteredBy }) {
    const { rows: currentRows } = await client.query(
        `SELECT id, character_id FROM title_reigns WHERE title_id = $1 AND lost_date IS NULL LIMIT 1`,
        [titleId]
    );
    const current = currentRows[0];

    // Champion retained: just log a successful defense, don't churn the reign row
    if (current && String(current.character_id) === String(newCharacterId)) {
        await client.query(`UPDATE title_reigns SET defenses = defenses + 1 WHERE id = $1`, [current.id]);
    } else {
        await client.query(
            `UPDATE title_reigns SET lost_date = CURRENT_DATE WHERE title_id = $1 AND lost_date IS NULL`,
            [titleId]
        );
        await client.query(
            `INSERT INTO title_reigns (guild_id, title_id, character_id, won_match_id, won_date, entered_by)
             VALUES ($1, $2, $3, $4, CURRENT_DATE, $5)`,
            [guildId, titleId, newCharacterId, matchId, enteredBy]
        );
        await client.query(`UPDATE titles SET is_vacant = false WHERE id = $1`, [titleId]);
    }

    // Any active contender for this title has now fulfilled their shot, win or lose
    await client.query(
        `UPDATE contenders SET status = 'fulfilled', resolved_at = now() WHERE title_id = $1 AND status = 'active'`,
        [titleId]
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('championship')
        .setDescription('Manage championship titles')
        .addSubcommand((sub) => sub.setName('list').setDescription('List all titles and current champions'))
        .addSubcommand((sub) =>
            sub.setName('log-singles-title-match')
                .setDescription('[Admin] Log a singles championship match')
                .addStringOption((o) => o.setName('title').setDescription('Title on the line').setRequired(true).setAutocomplete(true))
                .addStringOption((o) => o.setName('champion_or_p1').setDescription('Defending champion (or wrestler 1 if vacant)').setRequired(true).setAutocomplete(true))
                .addStringOption((o) => o.setName('challenger_or_p2').setDescription('Challenger (or wrestler 2 if vacant)').setRequired(true).setAutocomplete(true))
                .addIntegerOption((o) => o.setName('winner').setDescription('1 = champion/p1 wins, 2 = challenger/p2 wins').setRequired(true).addChoices({ name: 'Wrestler 1', value: 1 }, { name: 'Wrestler 2', value: 2 }))
        )
        .addSubcommand((sub) =>
            sub.setName('log-tag-title-match')
                .setDescription('[Admin] Log a 2v2 tag championship match')
                .addStringOption((o) => o.setName('title').setDescription('Tag title on the line').setRequired(true).setAutocomplete(true))
                .addStringOption((o) => o.setName('team1_p1').setDescription('Team 1 - Wrestler 1').setRequired(true).setAutocomplete(true))
                .addStringOption((o) => o.setName('team1_p2').setDescription('Team 1 - Wrestler 2').setRequired(true).setAutocomplete(true))
                .addStringOption((o) => o.setName('team2_p1').setDescription('Team 2 - Wrestler 1').setRequired(true).setAutocomplete(true))
                .addStringOption((o) => o.setName('team2_p2').setDescription('Team 2 - Wrestler 2').setRequired(true).setAutocomplete(true))
                .addIntegerOption((o) => o.setName('winning_team').setDescription('Which team won').setRequired(true).addChoices({ name: 'Team 1', value: 1 }, { name: 'Team 2', value: 2 }))
        )
        .addSubcommand((sub) =>
            sub.setName('vacate')
                .setDescription('[Admin] Vacate a title')
                .addStringOption((o) => o.setName('title').setDescription('Title').setRequired(true).setAutocomplete(true))
        )
        .addSubcommand((sub) =>
            sub.setName('history')
                .setDescription('View reign history for a title')
                .addStringOption((o) => o.setName('title').setDescription('Title').setRequired(true).setAutocomplete(true))
        )
        .addSubcommand((sub) =>
            sub.setName('backfill-reign')
                .setDescription('[Admin] Add pre-bot championship history')
                .addStringOption((o) => o.setName('title').setDescription('Title').setRequired(true).setAutocomplete(true))
                .addStringOption((o) => o.setName('champion_name').setDescription('Champion name (character or free text)').setRequired(true))
                .addStringOption((o) => o.setName('won_date').setDescription('Date won, YYYY-MM-DD').setRequired(true))
                .addStringOption((o) => o.setName('lost_date').setDescription('Date lost, YYYY-MM-DD (omit if still champion)').setRequired(false))
                .addIntegerOption((o) => o.setName('defenses').setDescription('Number of successful defenses').setRequired(false))
        ),

    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        if (focusedOption.name === 'title') {
            return interaction.respond(await autocompleteTitles(interaction, focusedOption.value));
        }
        return interaction.respond(await autocompleteCharacters(interaction, focusedOption.value));
    },

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        if (sub === 'list') {
            const { rows } = await pool.query(
                `SELECT t.id, t.name, t.division, t.is_vacant, c.name AS champ_name, u.discord_id
                 FROM titles t
                 LEFT JOIN title_reigns tr ON tr.title_id = t.id AND tr.lost_date IS NULL
                 LEFT JOIN characters c ON c.id = tr.character_id
                 LEFT JOIN users u ON u.id = c.owner_id
                 WHERE t.guild_id = $1
                 ORDER BY t.division, t.name`,
                [guildId]
            );

            const byDivision = { mens: [], womens: [], custom: [] };
            for (const r of rows) byDivision[r.division].push(r);

            const fmt = (list) => list.map((r) => {
                const holder = r.is_vacant || !r.champ_name ? '_Vacant_' : `**${r.champ_name}** (<@${r.discord_id}>)`;
                return `**${r.name}**\n${holder}`;
            }).join('\n\n');

            const embed = new EmbedBuilder()
                .setTitle('Championship Titles')
                .setColor(0xD4AF37)
                .addFields(
                    { name: "Men's Division", value: fmt(byDivision.mens) || 'None' },
                    { name: "Women's Division", value: fmt(byDivision.womens) || 'None' },
                    { name: 'Customs Division', value: fmt(byDivision.custom) || 'None' }
                );

            return interaction.reply({ embeds: [embed] });
        }

        if (sub === 'log-singles-title-match' || sub === 'log-tag-title-match') {
            if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
                return interaction.reply({ content: 'Only admins/mods can log title matches.', ephemeral: true });
            }
            const titleId = interaction.options.getString('title');
            const { rows: titleRows } = await pool.query(`SELECT * FROM titles WHERE id = $1`, [titleId]);
            const title = titleRows[0];

            await interaction.deferReply();

            let slotCharacterIds, matchType, winnerSlotIndexes, teams;
            if (sub === 'log-singles-title-match') {
                matchType = 'singles';
                slotCharacterIds = [interaction.options.getString('champion_or_p1'), interaction.options.getString('challenger_or_p2')];
                teams = [null, null];
                const winnerNum = interaction.options.getInteger('winner');
                winnerSlotIndexes = [winnerNum - 1];
            } else {
                matchType = 'tag2v2';
                slotCharacterIds = [
                    interaction.options.getString('team1_p1'), interaction.options.getString('team1_p2'),
                    interaction.options.getString('team2_p1'), interaction.options.getString('team2_p2')
                ];
                teams = [1, 1, 2, 2];
                const winningTeam = interaction.options.getInteger('winning_team');
                winnerSlotIndexes = teams.map((t, i) => (t === winningTeam ? i : -1)).filter((i) => i >= 0);
            }

            const matchId = await withTransaction(async (client) => {
                const { rows } = await client.query(
                    `INSERT INTO matches (guild_id, match_type, result_type, is_title_match, title_id, logged_by)
                     VALUES ($1, $2, 'decisive', true, $3, $4) RETURNING id`,
                    [guildId, matchType, titleId, interaction.user.id]
                );
                const mId = rows[0].id;
                for (let i = 0; i < slotCharacterIds.length; i++) {
                    await client.query(
                        `INSERT INTO match_participants (match_id, character_id, team_number, is_winner)
                         VALUES ($1, $2, $3, $4)`,
                        [mId, slotCharacterIds[i], teams[i], winnerSlotIndexes.includes(i)]
                    );
                }

                // New champion(s) = winning side. For tag titles both winners become co-champions
                // by inserting a reign row for each; for singles just the one winner.
                for (const idx of winnerSlotIndexes) {
                    await endReignAndStartNew(client, {
                        guildId, titleId, newCharacterId: slotCharacterIds[idx], matchId: mId, enteredBy: interaction.user.id
                    });
                }
                // Bump defense count if champion retained (winner is the same as prior champion)
                return mId;
            });

            const characters = await Promise.all(slotCharacterIds.map(getCharacterById));
            const winners = characters.filter((_, i) => winnerSlotIndexes.includes(i));
            const losers = characters.filter((_, i) => !winnerSlotIndexes.includes(i));

            const buffer = await renderMatchCard({ matchType: `${title.name} — Championship Match`, resultType: 'decisive', winners, losers });
            const embed = new EmbedBuilder()
                .setTitle(`${title.name} Championship Match`)
                .setColor(0xD4AF37)
                .setImage('attachment://match.png')
                .setFooter({ text: `Match #${matchId}` });

            return interaction.editReply({ embeds: [embed], files: [{ attachment: buffer, name: 'match.png' }] });
        }

        if (sub === 'vacate') {
            if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
                return interaction.reply({ content: 'Only admins/mods can vacate titles.', ephemeral: true });
            }
            const titleId = interaction.options.getString('title');
            await pool.query(`UPDATE title_reigns SET lost_date = CURRENT_DATE WHERE title_id = $1 AND lost_date IS NULL`, [titleId]);
            await pool.query(`UPDATE titles SET is_vacant = true WHERE id = $1`, [titleId]);
            return interaction.reply('Title vacated.');
        }

        if (sub === 'history') {
            const titleId = interaction.options.getString('title');
            const { rows } = await pool.query(
                `SELECT tr.*, c.name AS char_name, u.discord_id
                 FROM title_reigns tr
                 LEFT JOIN characters c ON c.id = tr.character_id
                 LEFT JOIN users u ON u.id = c.owner_id
                 WHERE tr.title_id = $1
                 ORDER BY tr.won_date DESC LIMIT 20`,
                [titleId]
            );
            const { rows: titleRows } = await pool.query(`SELECT name FROM titles WHERE id = $1`, [titleId]);

            if (!rows.length) return interaction.reply({ content: 'No reign history recorded yet.', ephemeral: true });

            const lines = rows.map((r) => {
                const name = r.char_name || r.reign_char_name || 'Unknown';
                const who = r.discord_id ? `${name} (<@${r.discord_id}>)` : name;
                const dates = `${r.won_date.toISOString().slice(0, 10)} → ${r.lost_date ? r.lost_date.toISOString().slice(0, 10) : 'Present'}`;
                return `**${who}**\n${dates}${r.is_backfilled ? ' _(historical)_' : ''}`;
            });

            const embed = new EmbedBuilder().setTitle(`${titleRows[0].name} — Reign History`).setColor(0xD4AF37).setDescription(lines.join('\n\n'));
            return interaction.reply({ embeds: [embed] });
        }

        if (sub === 'backfill-reign') {
            if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
                return interaction.reply({ content: 'Only admins/mods can backfill history.', ephemeral: true });
            }
            const titleId = interaction.options.getString('title');
            const championName = interaction.options.getString('champion_name');
            const wonDate = interaction.options.getString('won_date');
            const lostDate = interaction.options.getString('lost_date') || null;
            const defenses = interaction.options.getInteger('defenses') || 0;

            if (!/^\d{4}-\d{2}-\d{2}$/.test(wonDate) || (lostDate && !/^\d{4}-\d{2}-\d{2}$/.test(lostDate))) {
                return interaction.reply({ content: 'Dates must be in YYYY-MM-DD format.', ephemeral: true });
            }

            await pool.query(
                `INSERT INTO title_reigns (guild_id, title_id, reign_char_name, won_date, lost_date, defenses, is_backfilled, entered_by)
                 VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
                [guildId, titleId, championName, wonDate, lostDate, defenses, interaction.user.id]
            );

            if (!lostDate) {
                await pool.query(`UPDATE titles SET is_vacant = false WHERE id = $1`, [titleId]);
            }

            return interaction.reply(`Backfilled reign for **${championName}** added to history.`);
        }
    }
};
