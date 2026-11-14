-- 3.11: live roster channel ("Jey Uso (91 Overall) : @player") and a staff-set overall rating.
ALTER TABLE characters ADD COLUMN IF NOT EXISTS overall SMALLINT CHECK (overall IS NULL OR (overall BETWEEN 1 AND 99));
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS roster_channel_id TEXT;

-- the messages the bot posted in the roster channel, in order (one or more per division, then the "how to" post)
CREATE TABLE IF NOT EXISTS roster_board_posts (
    guild_id    TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    position    INT NOT NULL,
    slot        TEXT NOT NULL,
    message_id  TEXT NOT NULL,
    hash        TEXT NOT NULL,
    PRIMARY KEY (guild_id, position)
);
