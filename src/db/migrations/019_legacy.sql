-- 019: Legacy accolades (Money in the Bank, Royal Rumble, Face of FNLW MVP, year-end awards).
-- Only adds things; nothing existing changes.
CREATE TABLE IF NOT EXISTS legacy (
    id           BIGSERIAL PRIMARY KEY,
    guild_id     TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('mitb','rumble','mvp','award')),
    award_name   TEXT,                 -- year-end awards: which award
    division     TEXT,                 -- MITB / Rumble: which division
    year         INT  NOT NULL,
    character_id BIGINT REFERENCES characters(id) ON DELETE SET NULL,
    holder_name  TEXT NOT NULL,        -- the wrestler's name when it was won (kept even if renamed)
    user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,  -- the player who gets credit
    notes        TEXT,
    created_by   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legacy_guild_idx ON legacy (guild_id, kind, year DESC);
CREATE INDEX IF NOT EXISTS legacy_char_idx ON legacy (character_id);

-- The year-end award names a server uses (admins can add and remove them).
CREATE TABLE IF NOT EXISTS legacy_award_names (
    guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    sort     INT  NOT NULL DEFAULT 100
);
CREATE UNIQUE INDEX IF NOT EXISTS legacy_award_names_uq ON legacy_award_names (guild_id, lower(name));

ALTER TABLE guilds ADD COLUMN IF NOT EXISTS legacy_channel_id TEXT;
-- true once admins have edited the award list, so the starter list is never added back
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS legacy_names_set BOOLEAN NOT NULL DEFAULT false;
