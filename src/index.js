require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, Events } = require('discord.js');
const { runMigrations } = require('./db/migrator');
const { ensureGuild } = require('./utils/ensureGuild');
const { handleInteraction } = require('./interactionHandler');
const { registerCommands } = require('./registerCommands');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js') && !require('./commands.retired').has(f))) {
    const command = require(path.join(commandsPath, file));
    if (command?.data?.name) client.commands.set(command.data.name, command);
}

client.once(Events.ClientReady, async (c) => {
    console.log(`Logged in as ${c.user.tag}. Serving ${c.guilds.cache.size} server(s).`);
    require('./utils/scheduler').start(c);
    if (process.env.AUTO_DEPLOY_COMMANDS !== 'false') {
        try {
            await registerCommands({
                token: process.env.DISCORD_TOKEN,
                clientId: process.env.CLIENT_ID || c.user.id,
                guildId: process.env.GUILD_ID || null,
                guildIds: [...c.guilds.cache.keys()]
            });
        } catch (err) {
            console.error('Could not register slash commands (the bot still works with the old ones):', err.message);
        }
    }
});

client.on(Events.GuildCreate, async (guild) => {
    try {
        await ensureGuild(guild.id);
        console.log(`Set up new server: ${guild.name} (${guild.id})`);
    } catch (err) {
        console.error('Failed to set up server', guild.id, err);
    }
});

client.on(Events.InteractionCreate, (interaction) => handleInteraction(client, interaction));

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

async function main() {
    if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN is not set.');
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
    // The database can take a moment to wake up after a deploy, so retry for about a minute.
    for (let attempt = 1; ; attempt++) {
        try {
            await runMigrations();
            break;
        } catch (err) {
            if (attempt >= 8) throw err;
            console.error(`Database not ready (attempt ${attempt}/8): ${err.message}. Retrying in 8s...`);
            await new Promise((r) => setTimeout(r, 8000));
        }
    }
    await client.login(process.env.DISCORD_TOKEN);
}

main().catch((err) => {
    console.error('Startup failed:', err);
    process.exit(1);
});
