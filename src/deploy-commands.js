// Manual fallback: `npm run deploy`. The bot also registers its commands automatically on startup.
require('dotenv').config();
const { registerCommands } = require('./registerCommands');

registerCommands({ token: process.env.DISCORD_TOKEN, clientId: process.env.CLIENT_ID, guildId: process.env.GUILD_ID || null })
    .catch((err) => { console.error(err); process.exit(1); });
