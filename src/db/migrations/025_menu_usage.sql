-- 3.10: permanent menu post, players cancelling their own requests, and the bot usage report.
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS menu_channel_id TEXT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS menu_message_id TEXT;

ALTER TABLE pending_requests DROP CONSTRAINT IF EXISTS pending_requests_status_check;
ALTER TABLE pending_requests ADD CONSTRAINT pending_requests_status_check
    CHECK (status IN ('pending','approved','denied','dismissed','cancelled'));

-- one row per command or button press; only counts are ever shown (never who did what)
CREATE TABLE IF NOT EXISTS usage_events (
    id        BIGSERIAL PRIMARY KEY,
    guild_id  TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL,
    what      TEXT NOT NULL,
    at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_events_guild_at ON usage_events (guild_id, at);
