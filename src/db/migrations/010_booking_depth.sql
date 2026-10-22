-- 010: stipulations/finishes, character depth, rematches, deadlines, calendar,
-- newsletter, feuds, tournaments, match-of-the-night polls.

-- match details
ALTER TABLE matches ADD COLUMN IF NOT EXISTS stipulation TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS finish TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS score TEXT;

-- character depth (all optional)
ALTER TABLE characters ADD COLUMN IF NOT EXISTS signatures TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS catchphrase TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS lore TEXT;

-- interim champions
ALTER TABLE title_reigns ADD COLUMN IF NOT EXISTS is_interim BOOLEAN NOT NULL DEFAULT false;

-- guild settings
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS admin_channel_id TEXT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS defense_days INT NOT NULL DEFAULT 0;      -- 0 = off
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS vacate_days INT NOT NULL DEFAULT 0;       -- 0 = off (auto-vacate)
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS rematch_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS rematch_days INT NOT NULL DEFAULT 30;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS newsletter_channel_id TEXT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS newsletter_last TEXT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS deadline_last DATE;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS tz TEXT NOT NULL DEFAULT 'UTC';

-- title watch: when staff were last warned about a title
ALTER TABLE titles ADD COLUMN IF NOT EXISTS warned_on DATE;

-- rematch clauses: a champion who loses gets a guaranteed rematch
CREATE TABLE IF NOT EXISTS rematch_rights (
    id             BIGSERIAL PRIMARY KEY,
    guild_id       TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    title_id       BIGINT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    character_id   BIGINT REFERENCES characters(id) ON DELETE SET NULL,
    team_id        BIGINT REFERENCES teams(id) ON DELETE SET NULL,
    holder_name    TEXT,
    source_match_id BIGINT REFERENCES matches(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_on     DATE NOT NULL,
    status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','used','expired','waived')),
    used_match_id  BIGINT,
    reminded       BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_rematch_active ON rematch_rights (guild_id, status);

-- booking calendar: a card draft can carry a show date
ALTER TABLE card_drafts ADD COLUMN IF NOT EXISTS show_date DATE;
ALTER TABLE card_drafts ADD COLUMN IF NOT EXISTS reminded_on DATE;

-- newsletter: admin-written entries that go into the next weekly post
CREATE TABLE IF NOT EXISTS newsletter_entries (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    created_by  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    posted_in   TEXT
);

-- storyline / feud log (heat is computed from activity, plus a manual boost)
CREATE TABLE IF NOT EXISTS feuds (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    char_a      BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    char_b      BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    boost       INT NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
    created_by  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at    TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS feud_entries (
    id          BIGSERIAL PRIMARY KEY,
    feud_id     BIGINT NOT NULL REFERENCES feuds(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    created_by  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- tournaments (single elimination, singles or tag teams)
CREATE TABLE IF NOT EXISTS tournaments (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    division    TEXT NOT NULL,
    title_id    BIGINT REFERENCES titles(id) ON DELETE SET NULL,
    status      TEXT NOT NULL DEFAULT 'signup' CHECK (status IN ('signup','active','finished','cancelled')),
    created_by  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    winner_name TEXT,
    winner_id   BIGINT REFERENCES characters(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS tournament_entrants (
    tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    character_id  BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    PRIMARY KEY (tournament_id, character_id)
);
-- one row per bracket slot-pair; entrants are stored as character ids (singles only)
CREATE TABLE IF NOT EXISTS tournament_matches (
    id            BIGSERIAL PRIMARY KEY,
    tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    round         INT NOT NULL,
    slot          INT NOT NULL,
    a_id          BIGINT REFERENCES characters(id) ON DELETE SET NULL,
    b_id          BIGINT REFERENCES characters(id) ON DELETE SET NULL,
    winner_id     BIGINT REFERENCES characters(id) ON DELETE SET NULL,
    match_id      BIGINT,
    UNIQUE (tournament_id, round, slot)
);

-- match of the night polls
CREATE TABLE IF NOT EXISTS motn_polls (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    channel_id  TEXT,
    message_id  TEXT,
    match_ids   BIGINT[] NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    created_by  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    winner_match_id BIGINT
);
CREATE TABLE IF NOT EXISTS motn_votes (
    poll_id   BIGINT NOT NULL REFERENCES motn_polls(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL,
    match_id  BIGINT NOT NULL,
    PRIMARY KEY (poll_id, user_id)
);
