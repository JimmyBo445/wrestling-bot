-- 017: a championship history channel the bot keeps up to date.
-- Only adds things; nothing existing changes.
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS history_channel_id TEXT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS history_auto BOOLEAN NOT NULL DEFAULT true;

-- The bot's own messages in that channel, in order, so it can edit them instead of reposting.
CREATE TABLE IF NOT EXISTS history_posts (
    guild_id   TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    position   INT  NOT NULL,
    message_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, position)
);
