-- 007: star ratings, factions, hall of fame, monthly awards, weekly backup, milestone shout-outs.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS stars SMALLINT CHECK (stars BETWEEN 1 AND 5);
ALTER TABLE matches ADD COLUMN IF NOT EXISTS rated_by TEXT;

ALTER TABLE guilds ADD COLUMN IF NOT EXISTS milestones_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS monthly_channel_id TEXT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS monthly_last TEXT;          -- 'YYYY-MM' of the last month posted
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS backup_user_id TEXT;        -- who gets the weekly spreadsheet DM
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS backup_last TIMESTAMPTZ;

-- Factions: bigger than a tag team, a wrestler can be in a faction AND a tag team.
CREATE TABLE IF NOT EXISTS factions (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    division    TEXT NOT NULL CHECK (division IN ('mens','womens','custom','custom_womens')),
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disbanded')),
    created_by  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_factions_name ON factions (guild_id, lower(name)) WHERE status = 'active';
CREATE TABLE IF NOT EXISTS faction_members (
    faction_id   BIGINT NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
    character_id BIGINT NOT NULL REFERENCES characters(id),
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at      TIMESTAMPTZ,
    PRIMARY KEY (faction_id, character_id)
);

-- Hall of Fame
CREATE TABLE IF NOT EXISTS hall_of_fame (
    id           BIGSERIAL PRIMARY KEY,
    guild_id     TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    character_id BIGINT NOT NULL REFERENCES characters(id),
    inducted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    inducted_by  TEXT NOT NULL,
    blurb        TEXT,
    UNIQUE (guild_id, character_id)
);
