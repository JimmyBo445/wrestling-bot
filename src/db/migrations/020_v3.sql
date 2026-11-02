-- 020 (3.0): award voting, PLE tags on matches, weekly power rankings. Only adds things.

-- Award votes: one per accolade. Nominations first, then secret voting, closed by an admin.
CREATE TABLE IF NOT EXISTS award_polls (
    id            BIGSERIAL PRIMARY KEY,
    guild_id      TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    kind          TEXT NOT NULL CHECK (kind IN ('mvp','award')),
    award_name    TEXT,
    year          INT  NOT NULL,
    nominate_who  TEXT NOT NULL DEFAULT 'admins' CHECK (nominate_who IN ('admins','everyone')),
    vote_who      TEXT NOT NULL DEFAULT 'everyone' CHECK (vote_who IN ('admins','everyone')),
    status        TEXT NOT NULL DEFAULT 'nominating' CHECK (status IN ('nominating','voting','closed','cancelled')),
    channel_id    TEXT,
    message_id    TEXT,
    created_by    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at     TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS award_nominees (
    id             BIGSERIAL PRIMARY KEY,
    poll_id        BIGINT NOT NULL REFERENCES award_polls(id) ON DELETE CASCADE,
    character_id   BIGINT REFERENCES characters(id) ON DELETE SET NULL,
    character2_id  BIGINT REFERENCES characters(id) ON DELETE SET NULL,  -- rivalries / matches can name two wrestlers
    label          TEXT NOT NULL,
    nominated_by   TEXT
);
CREATE TABLE IF NOT EXISTS award_votes (
    poll_id     BIGINT NOT NULL REFERENCES award_polls(id) ON DELETE CASCADE,
    voter_id    TEXT NOT NULL,                      -- Discord user id; never shown to anyone
    nominee_id  BIGINT NOT NULL REFERENCES award_nominees(id) ON DELETE CASCADE,
    voted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (poll_id, voter_id)
);

-- PLE (premium live event) a match happened at, e.g. "WrestleMania 2026"
ALTER TABLE matches ADD COLUMN IF NOT EXISTS ple TEXT;
CREATE INDEX IF NOT EXISTS idx_matches_ple ON matches(guild_id, ple) WHERE ple IS NOT NULL;

-- Weekly power rankings: where to post, and last week's order (for the ▲▼ arrows)
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS power_channel_id TEXT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS power_last TEXT;
CREATE TABLE IF NOT EXISTS power_snapshots (
    guild_id     TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    week         TEXT NOT NULL,
    division     TEXT NOT NULL,
    character_id BIGINT NOT NULL,
    rank         INT NOT NULL,
    PRIMARY KEY (guild_id, week, division, character_id)
);
