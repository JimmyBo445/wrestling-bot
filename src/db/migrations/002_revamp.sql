-- ============================================================
-- 002 Revamp: teams, undo support, settings, audit log, requests
-- Safe to run on a live database that already has 001 applied.
-- ============================================================

-- ---------- Guild settings ----------
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS matches_channel_id TEXT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS singles_cooldown_hours INT NOT NULL DEFAULT 24;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS cooldown_scope TEXT NOT NULL DEFAULT 'user';
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS streak_threshold INT NOT NULL DEFAULT 3;
DO $$ BEGIN
    ALTER TABLE guilds ADD CONSTRAINT guilds_cooldown_scope_check CHECK (cooldown_scope IN ('user','character'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Characters ----------
ALTER TABLE characters ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;

-- ---------- Teams ----------
CREATE TABLE IF NOT EXISTS teams (
    id              BIGSERIAL PRIMARY KEY,
    guild_id        TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    division        TEXT NOT NULL CHECK (division IN ('mens','womens','custom')),
    image_url       TEXT,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disbanded')),
    created_by      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    disbanded_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_active_name ON teams(guild_id, lower(name)) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS team_members (
    id              BIGSERIAL PRIMARY KEY,
    team_id         BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    character_id    BIGINT NOT NULL REFERENCES characters(id),
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_active ON team_members(team_id, character_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_team_members_char ON team_members(character_id) WHERE left_at IS NULL;

-- ---------- Matches ----------
ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_match_participants_team ON match_participants(team_id) WHERE team_id IS NOT NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS title_effect JSONB;      -- what a title match changed, so it can be undone
ALTER TABLE matches ADD COLUMN IF NOT EXISTS cooldown_overridden BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_matches_guild_created ON matches(guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_title ON matches(title_id) WHERE title_id IS NOT NULL;

-- ---------- Title reigns ----------
ALTER TABLE title_reigns ADD COLUMN IF NOT EXISTS team_id BIGINT REFERENCES teams(id);
ALTER TABLE title_reigns ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE TABLE IF NOT EXISTS title_reign_members (
    id              BIGSERIAL PRIMARY KEY,
    reign_id        BIGINT NOT NULL REFERENCES title_reigns(id) ON DELETE CASCADE,
    character_id    BIGINT REFERENCES characters(id),
    member_name     TEXT
);
CREATE INDEX IF NOT EXISTS idx_reign_members_reign ON title_reign_members(reign_id);
CREATE INDEX IF NOT EXISTS idx_reign_members_char ON title_reign_members(character_id);

-- A deleted/undone match must not delete reign history
DO $$ BEGIN
    ALTER TABLE title_reigns DROP CONSTRAINT IF EXISTS title_reigns_won_match_id_fkey;
    ALTER TABLE title_reigns ADD CONSTRAINT title_reigns_won_match_id_fkey
        FOREIGN KEY (won_match_id) REFERENCES matches(id) ON DELETE SET NULL;
END $$;

-- ---------- Contenders ----------
ALTER TABLE contenders ALTER COLUMN character_id DROP NOT NULL;
ALTER TABLE contenders ADD COLUMN IF NOT EXISTS team_id BIGINT REFERENCES teams(id);
ALTER TABLE contenders ADD COLUMN IF NOT EXISTS fulfilled_match_id BIGINT;
DO $$ BEGIN
    ALTER TABLE contenders DROP CONSTRAINT IF EXISTS contenders_source_match_id_fkey;
    ALTER TABLE contenders ADD CONSTRAINT contenders_source_match_id_fkey
        FOREIGN KEY (source_match_id) REFERENCES matches(id) ON DELETE SET NULL;
    ALTER TABLE contenders ADD CONSTRAINT contenders_fulfilled_match_id_fkey
        FOREIGN KEY (fulfilled_match_id) REFERENCES matches(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE contenders ADD CONSTRAINT contenders_subject_check CHECK (character_id IS NOT NULL OR team_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Pending requests ----------
ALTER TABLE pending_requests ADD COLUMN IF NOT EXISTS team_id BIGINT REFERENCES teams(id);
ALTER TABLE pending_requests ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE pending_requests ADD COLUMN IF NOT EXISTS channel_id TEXT;
ALTER TABLE pending_requests DROP CONSTRAINT IF EXISTS pending_requests_request_type_check;
ALTER TABLE pending_requests ADD CONSTRAINT pending_requests_request_type_check
    CHECK (request_type IN ('character_submission','contender_challenge','match_request','streak_contender'));
ALTER TABLE pending_requests DROP CONSTRAINT IF EXISTS pending_requests_status_check;
ALTER TABLE pending_requests ADD CONSTRAINT pending_requests_status_check
    CHECK (status IN ('pending','approved','denied','dismissed'));

-- ---------- Audit log ----------
CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGSERIAL PRIMARY KEY,
    guild_id        TEXT NOT NULL,
    actor_id        TEXT NOT NULL,
    action          TEXT NOT NULL,
    details         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_guild ON audit_log(guild_id, created_at DESC);
