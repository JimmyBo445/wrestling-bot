-- ============================================================
-- Wrestling Bot Database Schema
-- Multi-guild, fully persistent (no resets)
-- ============================================================

-- One row per Discord server the bot is active in
CREATE TABLE IF NOT EXISTS guilds (
    guild_id        TEXT PRIMARY KEY,
    pending_channel_id TEXT,      -- channel where /admin pending posts approval cards
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Discord users, scoped per guild (a user in two servers = two rows)
CREATE TABLE IF NOT EXISTS users (
    id              BIGSERIAL PRIMARY KEY,
    guild_id        TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    discord_id      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(guild_id, discord_id)
);

-- Divisions are fixed: 'mens', 'womens', 'custom'
CREATE TABLE IF NOT EXISTS characters (
    id              BIGSERIAL PRIMARY KEY,
    guild_id        TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    owner_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    division        TEXT NOT NULL CHECK (division IN ('mens','womens','custom')),
    image_url       TEXT,                       -- optional character art for cards
    alignment       TEXT CHECK (alignment IN ('face','heel','neutral')),
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','retired','denied')),
    submitted_by    TEXT NOT NULL,               -- discord_id of submitter (user or admin)
    approved_by     TEXT,                        -- discord_id of approving admin
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at     TIMESTAMPTZ
);

-- Enforce max 3 approved/pending characters per user per guild at app layer
-- (Postgres partial-index trick as a backstop)
CREATE INDEX IF NOT EXISTS idx_characters_owner ON characters(guild_id, owner_id) WHERE status IN ('approved','pending');

-- Titles: fixed catalogue of 9, but stored as data so history/vacancy logic is uniform
CREATE TABLE IF NOT EXISTS titles (
    id              BIGSERIAL PRIMARY KEY,
    guild_id        TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    division        TEXT NOT NULL CHECK (division IN ('mens','womens','custom')),
    is_tag_title    BOOLEAN NOT NULL DEFAULT false,
    is_vacant       BOOLEAN NOT NULL DEFAULT true,
    UNIQUE(guild_id, name)
);

-- Matches: one row per booked match, regardless of type
CREATE TABLE IF NOT EXISTS matches (
    id              BIGSERIAL PRIMARY KEY,
    guild_id        TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    match_type      TEXT NOT NULL CHECK (match_type IN (
                        'singles','tag2v2','tag3v3','triple_threat',
                        'fatal4way','fiveway','sixman','eightman'
                     )),
    result_type     TEXT NOT NULL DEFAULT 'decisive' CHECK (result_type IN ('decisive','draw','no_contest')),
    is_title_match  BOOLEAN NOT NULL DEFAULT false,
    is_contender_match BOOLEAN NOT NULL DEFAULT false,
    title_id        BIGINT REFERENCES titles(id),
    contender_title_id BIGINT REFERENCES titles(id),  -- title this #1 contender match is for
    logged_by       TEXT NOT NULL,       -- admin discord_id
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Participants in a match. team_number groups characters for tag matches
-- (NULL team_number = free-for-all style match)
CREATE TABLE IF NOT EXISTS match_participants (
    id              BIGSERIAL PRIMARY KEY,
    match_id        BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    character_id    BIGINT NOT NULL REFERENCES characters(id),
    team_number     INT,                  -- 1 or 2 for team matches, NULL otherwise
    is_winner       BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_match_participants_match ON match_participants(match_id);
CREATE INDEX IF NOT EXISTS idx_match_participants_char ON match_participants(character_id);

-- Title reign history — includes bot-logged reigns AND manually backfilled pre-bot history
CREATE TABLE IF NOT EXISTS title_reigns (
    id              BIGSERIAL PRIMARY KEY,
    guild_id        TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    title_id        BIGINT NOT NULL REFERENCES titles(id),
    character_id    BIGINT REFERENCES characters(id),  -- nullable in case of backfilled/unknown char
    reign_char_name TEXT,                 -- free-text name for backfilled history w/o a characters row
    won_match_id    BIGINT REFERENCES matches(id),
    won_date        DATE NOT NULL,
    lost_date       DATE,                 -- NULL = current champion
    defenses        INT NOT NULL DEFAULT 0,
    is_backfilled   BOOLEAN NOT NULL DEFAULT false,
    entered_by      TEXT NOT NULL,        -- admin discord_id
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_title_reigns_title ON title_reigns(title_id);

-- #1 Contender status — one active contender per title max, multiple titles can each have one
CREATE TABLE IF NOT EXISTS contenders (
    id              BIGSERIAL PRIMARY KEY,
    guild_id        TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    title_id        BIGINT NOT NULL REFERENCES titles(id),
    character_id    BIGINT NOT NULL REFERENCES characters(id),
    earned_via      TEXT NOT NULL CHECK (earned_via IN ('win_streak','challenge_approved','admin_award','contender_match')),
    source_match_id BIGINT REFERENCES matches(id),
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','fulfilled','revoked')),
    awarded_by      TEXT,                 -- admin discord_id, null if earned automatically
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);

-- Only one active contender per title
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_contender_per_title
    ON contenders(title_id) WHERE status = 'active';

-- Pending approval queue: character submissions AND contender challenges
CREATE TABLE IF NOT EXISTS pending_requests (
    id              BIGSERIAL PRIMARY KEY,
    guild_id        TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    request_type    TEXT NOT NULL CHECK (request_type IN ('character_submission','contender_challenge')),
    requested_by    TEXT NOT NULL,        -- discord_id
    character_id    BIGINT REFERENCES characters(id),   -- for character_submission
    title_id        BIGINT REFERENCES titles(id),        -- for contender_challenge
    challenger_character_id BIGINT REFERENCES characters(id), -- for contender_challenge
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
    resolved_by     TEXT,
    message_id      TEXT,                 -- discord message id of the approval card, for editing after action
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_requests(guild_id, status);

-- Materialized-ish stats are computed on the fly via views rather than stored,
-- so they never drift from match_participants. Kept as SQL views:

CREATE OR REPLACE VIEW character_stats AS
SELECT
    mp.character_id,
    c.guild_id,
    c.owner_id,
    COUNT(*) FILTER (WHERE mp.is_winner AND m.result_type = 'decisive') AS wins,
    COUNT(*) FILTER (WHERE NOT mp.is_winner AND m.result_type = 'decisive') AS losses,
    COUNT(*) FILTER (WHERE m.result_type = 'draw') AS draws,
    COUNT(*) FILTER (WHERE m.result_type = 'no_contest') AS no_contests,
    COUNT(*) AS total_matches
FROM match_participants mp
JOIN matches m ON m.id = mp.match_id
JOIN characters c ON c.id = mp.character_id
GROUP BY mp.character_id, c.guild_id, c.owner_id;

COMMENT ON TABLE characters IS 'Max 3 approved+pending characters per owner_id enforced in application code.';
