-- 012: contracts (just for fun), show recaps, weekly staff report
CREATE TABLE IF NOT EXISTS contracts (
    id            BIGSERIAL PRIMARY KEY,
    guild_id      TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    character_id  BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    months        INT NOT NULL,
    salary        BIGINT NOT NULL,            -- per month
    clauses       TEXT,
    status        TEXT NOT NULL DEFAULT 'offered', -- offered, requested, active, expired, released, replaced, declined, rejected, withdrawn
    start_date    DATE,
    end_date      DATE,
    signed_at     TIMESTAMPTZ,
    warned        BOOLEAN NOT NULL DEFAULT false,
    offered_by    TEXT,
    requested_by  TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contracts_char_idx ON contracts (character_id, status);
CREATE INDEX IF NOT EXISTS contracts_guild_idx ON contracts (guild_id, status);

ALTER TABLE guilds ADD COLUMN IF NOT EXISTS contract_win_bonus BIGINT NOT NULL DEFAULT 500;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS contract_title_bonus BIGINT NOT NULL DEFAULT 2000;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS auto_recap BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS report_last TEXT;
ALTER TABLE card_drafts ADD COLUMN IF NOT EXISTS recap_posted BOOLEAN NOT NULL DEFAULT false;
