-- 009: injuries (wrestlers marked out until a return date)
CREATE TABLE IF NOT EXISTS injuries (
    id           BIGSERIAL PRIMARY KEY,
    guild_id     TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    character_id BIGINT NOT NULL REFERENCES characters(id),
    reason       TEXT,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    returns_at   DATE NOT NULL,
    created_by   TEXT NOT NULL,
    cleared_at   TIMESTAMPTZ,
    announced    BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_injuries_active ON injuries (character_id) WHERE cleared_at IS NULL;

-- yearly season recap post (uses the monthly awards channel)
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS season_last INT;
