-- 3.14: live champions board (one post per division that updates itself).
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS champions_channel_id TEXT;
