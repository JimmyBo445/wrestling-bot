-- 3.12: the live roster can use a separate channel per division; posts are plain text now.
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS roster_channel_mens TEXT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS roster_channel_womens TEXT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS roster_channel_custom TEXT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS roster_channel_custom_womens TEXT;

ALTER TABLE roster_board_posts ADD COLUMN IF NOT EXISTS channel_id TEXT;
UPDATE roster_board_posts p SET channel_id = g.roster_channel_id FROM guilds g WHERE g.guild_id = p.guild_id AND p.channel_id IS NULL;
DELETE FROM roster_board_posts WHERE channel_id IS NULL;
ALTER TABLE roster_board_posts ALTER COLUMN channel_id SET NOT NULL;
ALTER TABLE roster_board_posts DROP CONSTRAINT IF EXISTS roster_board_posts_pkey;
ALTER TABLE roster_board_posts ADD PRIMARY KEY (guild_id, channel_id, position);
