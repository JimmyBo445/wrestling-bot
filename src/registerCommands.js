const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

function loadCommandData() {
    const dir = path.join(__dirname, 'commands');
    const retired = require('./commands.retired');
    return fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !retired.has(f))
        .map((f) => require(path.join(dir, f)))
        .filter((c) => c?.data)
        .map((c) => c.data.toJSON());
}

/**
 * Pushes the slash commands to Discord.
 *  - With GUILD_ID set: registers only in that server (instant) and clears global ones.
 *  - Without it: registers globally and clears any per-server copies (so you never see duplicates).
 */
async function registerCommands({ token, clientId, guildId = null, guildIds = [], log = console.log }) {
    const rest = new REST().setToken(token);
    const commands = loadCommandData();
    log(`Registering ${commands.length} slash commands (${guildId ? `server ${guildId}` : 'global'})...`);

    if (guildId) {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
        await rest.put(Routes.applicationCommands(clientId), { body: [] });
    } else {
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        for (const gid of guildIds) {
            try { await rest.put(Routes.applicationGuildCommands(clientId, gid), { body: [] }); }
            catch (err) { log(`Could not clear old per-server commands in ${gid}: ${err.message}`); }
        }
    }
    log('Slash commands registered.');
    return commands.length;
}

module.exports = { registerCommands, loadCommandData };
