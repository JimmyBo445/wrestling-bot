const { UserError } = require('./utils/errors');
const { EPHEMERAL, memberIsStaff } = require('./utils/discordHelpers');
const { ensureGuild } = require('./utils/ensureGuild');
const { handleButtonInteraction } = require('./handlers/buttonHandler');

/** Tells the user what went wrong, privately, whatever state the interaction is in. */
async function reportError(interaction, err) {
    const isUser = err instanceof UserError;
    if (!isUser) {
        console.error(`Error in ${interaction.commandName || interaction.customId || 'interaction'}:`, err);
        const where = interaction.commandName ? `/${interaction.commandName}${(() => { try { return ` ${interaction.options.getSubcommand(false) || ''}`; } catch (_) { return ''; } })()}` : `a button (${String(interaction.customId || '').split(':').slice(0, 2).join(':')})`;
        require('./utils/alerts').alertStaff(interaction.client, interaction.guildId, `err:${where}:${String(err?.message).slice(0, 60)}`,
            `\`${where.trim()}\` failed for <@${interaction.user?.id}>: ${String(err?.message || err).slice(0, 300)}. Nothing was lost; they were told to try again. If it keeps happening, send me (Claude) this message.`);
    }
    const content = isUser ? `⚠️ ${err.message}` : '⚠️ Something went wrong on my side. Nothing was lost, and the error was logged. Please try again.';
    const payload = { content, flags: EPHEMERAL, embeds: [], files: [], components: [], allowedMentions: { parse: [] } };
    try {
        if (interaction.isAutocomplete?.()) return;
        if (interaction.deferred && !interaction.replied) {
            if (interaction.ephemeral) { const { flags, ...edit } = payload; return await interaction.editReply(edit); } // eslint-disable-line no-unused-vars
            // the "thinking..." message was public; remove it and answer privately instead
            await interaction.deleteReply().catch(() => {});
            return await interaction.followUp(payload);
        }
        if (interaction.replied) return await interaction.followUp(payload);
        return await interaction.reply(payload);
    } catch (e) {
        console.error('Could not deliver error message:', e.message);
    }
}

async function handleInteraction(client, interaction) {
    try {
        if (!interaction.inGuild()) {
            if (interaction.isRepliable() && !interaction.isAutocomplete()) {
                await interaction.reply({ content: 'This bot only works inside a server.', flags: EPHEMERAL });
            }
            return;
        }
        await ensureGuild(interaction.guildId);
        // staff role members get the same bot powers as admins (checked on every interaction)
        try { if (!interaction.isAutocomplete() && await memberIsStaff(interaction)) interaction.isStaff = true; } catch (_) { /* no staff role */ }

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
        if (interaction.isAutocomplete?.()) {
            console.error('Autocomplete error:', err.message);
            try { await interaction.respond([]); } catch (_) { /* too slow or already answered */ }
            return;
        }
        await reportError(interaction, err);
    }
}

module.exports = { handleInteraction, reportError };
