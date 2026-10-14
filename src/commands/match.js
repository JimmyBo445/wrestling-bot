const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { pool, withTransaction } = require('../db/pool');
const { autocompleteCharacters, getCharacterById } = require('../utils/characterUtils');
const { renderMatchCard } = require('../utils/cardRenderer');
const { checkAndAwardWinStreak } = require('../utils/contenderLogic');

// Config drives both the slash command shape and the execution logic, so
// adding a new match type later means editing one array, not the whole file.
//
// slots: array of { name, label, team } — team is 1 or 2 for team matches, null for FFA
// winnerMode: 'single' (pick one winner participant) or 'team' (pick winning team number)
const MATCH_CONFIG = {
    singles: {
        label: 'Singles',
        slots: [
            { name: 'participant1', label: 'Wrestler 1', team: null },
            { name: 'participant2', label: 'Wrestler 2', team: null }
        ],
        winnerMode: 'single'
    },
    tag2v2: {
        label: 'Tag Team (2v2)',
        slots: [
            { name: 'team1_p1', label: 'Team 1 - Wrestler 1', team: 1 },
            { name: 'team1_p2', label: 'Team 1 - Wrestler 2', team: 1 },
            { name: 'team2_p1', label: 'Team 2 - Wrestler 1', team: 2 },
            { name: 'team2_p2', label: 'Team 2 - Wrestler 2', team: 2 }
        ],
        winnerMode: 'team'
    },
    tag3v3: {
        label: 'Tag Team (3v3)',
        slots: [
            { name: 'team1_p1', label: 'Team 1 - Wrestler 1', team: 1 },
            { name: 'team1_p2', label: 'Team 1 - Wrestler 2', team: 1 },
            { name: 'team1_p3', label: 'Team 1 - Wrestler 3', team: 1 },
            { name: 'team2_p1', label: 'Team 2 - Wrestler 1', team: 2 },
            { name: 'team2_p2', label: 'Team 2 - Wrestler 2', team: 2 },
            { name: 'team2_p3', label: 'Team 2 - Wrestler 3', team: 2 }
        ],
        winnerMode: 'team'
    },
    triple_threat: {
        label: 'Triple Threat',
        slots: [1, 2, 3].map((n) => ({ name: `participant${n}`, label: `Wrestler ${n}`, team: null })),
        winnerMode: 'single'
    },
    fatal4way: {
        label: 'Fatal 4-Way',
        slots: [1, 2, 3, 4].map((n) => ({ name: `participant${n}`, label: `Wrestler ${n}`, team: null })),
        winnerMode: 'single'
    },
    fiveway: {
        label: '5-Way',
        slots: [1, 2, 3, 4, 5].map((n) => ({ name: `participant${n}`, label: `Wrestler ${n}`, team: null })),
        winnerMode: 'single'
    },
    sixman: {
        label: '6-Man Tag',
        slots: [
            { name: 'team1_p1', label: 'Team 1 - Wrestler 1', team: 1 },
            { name: 'team1_p2', label: 'Team 1 - Wrestler 2', team: 1 },
            { name: 'team1_p3', label: 'Team 1 - Wrestler 3', team: 1 },
            { name: 'team2_p1', label: 'Team 2 - Wrestler 1', team: 2 },
            { name: 'team2_p2', label: 'Team 2 - Wrestler 2', team: 2 },
            { name: 'team2_p3', label: 'Team 2 - Wrestler 3', team: 2 }
        ],
        winnerMode: 'team'
    },
    eightman: {
        label: '8-Man Tag',
        slots: [
            { name: 'team1_p1', label: 'Team 1 - Wrestler 1', team: 1 },
            { name: 'team1_p2', label: 'Team 1 - Wrestler 2', team: 1 },
            { name: 'team1_p3', label: 'Team 1 - Wrestler 3', team: 1 },
            { name: 'team1_p4', label: 'Team 1 - Wrestler 4', team: 1 },
            { name: 'team2_p1', label: 'Team 2 - Wrestler 1', team: 2 },
            { name: 'team2_p2', label: 'Team 2 - Wrestler 2', team: 2 },
            { name: 'team2_p3', label: 'Team 2 - Wrestler 3', team: 2 },
            { name: 'team2_p4', label: 'Team 2 - Wrestler 4', team: 2 }
        ],
        winnerMode: 'team'
    }
};

const RESULT_CHOICES = [
    { name: 'Decisive (has a winner)', value: 'decisive' },
    { name: 'Draw', value: 'draw' },
    { name: 'No Contest', value: 'no_contest' }
];

function buildSubcommand(sub, key, config) {
    sub.setName(`log-${key.replace(/_/g, '-')}`).setDescription(`Log a ${config.label} match result`);
    for (const slot of config.slots) {
        sub.addStringOption((o) => o.setName(slot.name).setDescription(slot.label).setRequired(true).setAutocomplete(true));
    }
    if (config.winnerMode === 'single') {
        sub.addIntegerOption((o) =>
            o.setName('winner')
                .setDescription('Which numbered wrestler won (1-indexed, matches the slot order above)')
                .setRequired(true)
        );
    } else {
        sub.addIntegerOption((o) =>
            o.setName('winning_team').setDescription('Which team won: 1 or 2').setRequired(true).addChoices({ name: 'Team 1', value: 1 }, { name: 'Team 2', value: 2 })
        );
    }
    sub.addStringOption((o) => o.setName('result_type').setDescription('Result type').setRequired(false).addChoices(...RESULT_CHOICES));
    sub.addStringOption((o) => o.setName('notes').setDescription('Optional notes / stipulation').setRequired(false));
    return sub;
}

const data = new SlashCommandBuilder()
    .setName('match')
    .setDescription('Log match results')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

for (const [key, config] of Object.entries(MATCH_CONFIG)) {
    data.addSubcommand((sub) => buildSubcommand(sub, key, config));
}

async function checkSinglesCooldown(guildId, char1Id, char2Id) {
    const { SINGLES_COOLDOWN_HOURS } = require('../utils/constants');
    const { rows } = await pool.query(
        `SELECT m.created_at FROM matches m
         JOIN match_participants mp1 ON mp1.match_id = m.id AND mp1.character_id = $2
         JOIN match_participants mp2 ON mp2.match_id = m.id AND mp2.character_id = $3
         WHERE m.guild_id = $1 AND m.match_type = 'singles'
         ORDER BY m.created_at DESC LIMIT 1`,
        [guildId, char1Id, char2Id]
    );
    if (!rows.length) return null;
    const hoursSince = (Date.now() - new Date(rows[0].created_at).getTime()) / 36e5;
    if (hoursSince < SINGLES_COOLDOWN_HOURS) {
        return Math.ceil(SINGLES_COOLDOWN_HOURS - hoursSince);
    }
    return null;
}

module.exports = {
    data,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused();
        const choices = await autocompleteCharacters(interaction, focused);
        await interaction.respond(choices);
    },

    async execute(interaction) {
        const subName = interaction.options.getSubcommand();
        const key = subName.replace(/^log-/, '').replace(/-/g, '_');
        const config = MATCH_CONFIG[key];
        if (!config) return interaction.reply({ content: 'Unknown match type.', ephemeral: true });

        const guildId = interaction.guildId;
        const resultType = interaction.options.getString('result_type') || 'decisive';
        const notes = interaction.options.getString('notes');

        const slotCharacterIds = config.slots.map((slot) => interaction.options.getString(slot.name));
        const uniqueCheck = new Set(slotCharacterIds);
        if (uniqueCheck.size !== slotCharacterIds.length) {
            return interaction.reply({ content: 'The same character can\'t be booked twice in one match.', ephemeral: true });
        }

        // Singles cooldown check (only applies to plain singles matches)
        if (key === 'singles' && resultType === 'decisive') {
            const hoursLeft = await checkSinglesCooldown(guildId, slotCharacterIds[0], slotCharacterIds[1]);
            if (hoursLeft) {
                return interaction.reply({
                    content: `These two just wrestled recently. Wait ~${hoursLeft}h before rebooking this singles matchup (cooldown doesn't apply to contender/title/tag matches).`,
                    ephemeral: true
                });
            }
        }

        let winnerSlotIndexes = [];
        if (config.winnerMode === 'single') {
            const winnerNum = interaction.options.getInteger('winner');
            if (winnerNum < 1 || winnerNum > config.slots.length) {
                return interaction.reply({ content: `Winner must be between 1 and ${config.slots.length}.`, ephemeral: true });
            }
            if (resultType === 'decisive') winnerSlotIndexes = [winnerNum - 1];
        } else {
            const winningTeam = interaction.options.getInteger('winning_team');
            if (resultType === 'decisive') {
                config.slots.forEach((slot, i) => { if (slot.team === winningTeam) winnerSlotIndexes.push(i); });
            }
        }

        await interaction.deferReply();

        const matchId = await withTransaction(async (client) => {
            const { rows } = await client.query(
                `INSERT INTO matches (guild_id, match_type, result_type, logged_by, notes)
                 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                [guildId, key, resultType, interaction.user.id, notes]
            );
            const mId = rows[0].id;

            for (let i = 0; i < config.slots.length; i++) {
                await client.query(
                    `INSERT INTO match_participants (match_id, character_id, team_number, is_winner)
                     VALUES ($1, $2, $3, $4)`,
                    [mId, slotCharacterIds[i], config.slots[i].team, winnerSlotIndexes.includes(i)]
                );
            }
            return mId;
        });

        // Fetch full character objects for the card + streak logic
        const characters = await Promise.all(slotCharacterIds.map(getCharacterById));
        const winners = characters.filter((_, i) => winnerSlotIndexes.includes(i));
        const losers = characters.filter((_, i) => !winnerSlotIndexes.includes(i));

        // Auto-award #1 contender status on a hot win streak (best-effort, non-blocking)
        let streakNotice = '';
        if (resultType === 'decisive') {
            for (const w of winners) {
                const hot = await checkAndAwardWinStreak(guildId, w.id);
                if (hot) streakNotice += `\n🔥 **${w.name}** is on a ${hot.streak}-match win streak — consider \`/contender award\` for a title shot.`;
            }
        }

        const buffer = await renderMatchCard({ matchType: config.label, resultType, winners, losers, notes });
        const embed = new EmbedBuilder()
            .setTitle(`${config.label} Result`)
            .setColor(resultType === 'decisive' ? 0x27AE60 : 0x95A5A6)
            .setImage('attachment://match.png')
            .setFooter({ text: `Logged by ${interaction.user.username} · Match #${matchId}` });

        await interaction.editReply({ embeds: [embed], files: [{ attachment: buffer, name: 'match.png' }], content: streakNotice || undefined });
    }
};
