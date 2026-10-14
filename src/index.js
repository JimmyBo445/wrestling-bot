require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, Events } = require('discord.js');
const { ensureGuild } = require('./utils/ensureGuild');
const { handleButtonInteraction } = require('./handlers/buttonHandler');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
    const command = require(path.join(commandsPath, file));
    if (command?.data?.name) {
        client.commands.set(command.data.name, command);
    }
}

client.once(Events.ClientReady, (c) => {
    console.log(`Logged in as ${c.user.tag}. Serving ${c.guilds.cache.size} guild(s).`);
});

// Auto-bootstrap a guild (create row + seed 9 titles) the moment the bot joins
client.on(Events.GuildCreate, async (guild) => {
    try {
        await ensureGuild(guild.id);
        console.log(`Bootstrapped new guild: ${guild.name} (${guild.id})`);
    } catch (err) {
        console.error('Failed to bootstrap guild', guild.id, err);
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        // Every command execution guarantees the guild/titles exist first,
        // so this also covers servers the bot was already in pre-deploy.
        if (interaction.guildId) {
            await ensureGuild(interaction.guildId);
        }

        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;
            await command.execute(interaction);
        } else if (interaction.isAutocomplete()) {
            const command = client.commands.get(interaction.commandName);
            if (!command?.autocomplete) return;
            await command.autocomplete(interaction);
        } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
            await handleButtonInteraction(interaction);
        }
    } catch (err) {
        console.error('Interaction error:', err);
        const payload = { content: 'Something went wrong handling that. Check the logs.', ephemeral: true };
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp(payload).catch(() => {});
        } else if (interaction.isRepliable?.()) {
            await interaction.reply(payload).catch(() => {});
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
