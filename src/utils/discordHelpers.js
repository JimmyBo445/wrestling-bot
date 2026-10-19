const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { UserError } = require('./errors');

const EPHEMERAL = MessageFlags?.Ephemeral ?? 64;
const NO_MENTIONS = { parse: [] };

function isAdmin(interaction) {
    return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

function requireAdmin(interaction, what = 'do that') {
    if (!isAdmin(interaction)) throw new UserError(`Only admins/mods (Manage Server permission) can ${what}.`);
}

/**
 * Sends a reply no matter what state the interaction is in
 * (fresh, deferred, or already replied).
 */
async function respond(interaction, payload) {
    if (interaction.deferred && !interaction.replied) {
        // an edit can't change visibility (that was decided when we deferred), so drop the flag
        const { flags, ...rest } = payload; // eslint-disable-line no-unused-vars
        return interaction.editReply(rest);
    }
    if (interaction.replied || interaction.deferred) return interaction.followUp(payload);
    return interaction.reply(payload);
}

/** Private (only-you-can-see) reply. */
function reply(interaction, content, extra = {}) {
    return respond(interaction, { content, flags: EPHEMERAL, allowedMentions: NO_MENTIONS, ...extra });
}

// ---- Display-name cache: autocomplete must answer in under 3 seconds ----
const nameCache = new Map(); // `${guildId}:${discordId}` -> { name, at }
const NAME_TTL_MS = 15 * 60 * 1000;

function cachedName(guildId, id) {
    const hit = nameCache.get(`${guildId}:${id}`);
    return hit && Date.now() - hit.at < NAME_TTL_MS ? hit.name : null;
}

/**
 * Returns Map<discordId, displayName> for many users at once. Uses the cache,
 * then one batched Discord request (with a time limit) for anything missing.
 */
async function getDisplayNames(guild, discordIds, timeoutMs = 1200) {
    const result = new Map();
    const missing = [];
    for (const id of new Set(discordIds)) {
        const name = cachedName(guild.id, id);
        if (name) result.set(id, name);
        else missing.push(id);
    }
    if (missing.length) {
        try {
            const fetched = await Promise.race([
                guild.members.fetch({ user: missing }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
            ]);
            for (const m of fetched.values()) {
                const name = m.displayName || m.user.username;
                nameCache.set(`${guild.id}:${m.id}`, { name, at: Date.now() });
                result.set(m.id, name);
            }
        } catch (_) { /* slow or members left: fall back below */ }
        for (const id of missing) {
            if (!result.has(id)) result.set(id, id);
        }
    }
    return result;
}

async function getDisplayName(guild, discordId) {
    return (await getDisplayNames(guild, [discordId], 2500)).get(discordId);
}

const DIVISION_LABELS = { mens: "Men's", womens: "Women's", custom: 'Custom', custom_womens: "Custom Women's" };

module.exports = {
    EPHEMERAL, NO_MENTIONS, isAdmin, requireAdmin, respond, reply,
    getDisplayNames, getDisplayName, DIVISION_LABELS
};
