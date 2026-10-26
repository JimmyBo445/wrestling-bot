-- 011: show signups (players click to say which wrestlers are available for a show)
CREATE TABLE IF NOT EXISTS signups (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    channel_id  TEXT,
    message_id  TEXT,
    deadline    DATE,
    status      TEXT NOT NULL DEFAULT 'open',
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS signups_guild_idx ON signups (guild_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS signup_entries (
    signup_id    BIGINT NOT NULL REFERENCES signups(id) ON DELETE CASCADE,
    character_id BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    owner_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    division     TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (signup_id, character_id)
);
