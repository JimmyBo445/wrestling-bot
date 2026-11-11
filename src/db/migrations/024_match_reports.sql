-- 024 (3.7): players report their own card match results; staff approve before they count.
CREATE TABLE IF NOT EXISTS match_reports (
    id            BIGSERIAL PRIMARY KEY,
    guild_id      TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    draft_id      BIGINT,                 -- the card division it was on (cards get rebuilt, so this can go stale)
    position      INT,
    brand         TEXT,
    division      TEXT,
    match_type    TEXT NOT NULL,
    character_ids BIGINT[] NOT NULL,      -- who was in it, so the match can be found again if it moved on the card
    title_id      BIGINT,
    stipulation   TEXT,
    reporter      TEXT NOT NULL,          -- discord id
    result_code   TEXT NOT NULL,          -- '1','2',… = winner slot/team; 'd' = draw; 'n' = no contest
    finish        TEXT,
    score         TEXT,
    notes         TEXT,
    proof_url     TEXT,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','closed')),
    channel_id    TEXT,                   -- the staff post
    message_id    TEXT,
    resolved_by   TEXT,
    deny_reason   TEXT,
    match_id      BIGINT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS match_reports_pending_idx ON match_reports (guild_id, status);
