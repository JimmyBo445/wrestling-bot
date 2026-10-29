-- 014: one show card per brand (RAW / SmackDown). Each division's matches stay in their own draft row
-- underneath, so existing cards are kept as they are; the show-level name and date now live in card_shows.
CREATE TABLE IF NOT EXISTS card_shows (
    guild_id    TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    brand       TEXT NOT NULL CHECK (brand IN ('raw','smackdown')),
    name        TEXT,
    show_date   DATE,
    reminded_on DATE,
    created_by  TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (guild_id, brand)
);

-- merge: take the show name and the earliest date from whatever per-division cards already exist
INSERT INTO card_shows (guild_id, brand, name, show_date, reminded_on, created_by)
SELECT guild_id, brand,
       (array_agg(name ORDER BY updated_at DESC) FILTER (WHERE name IS NOT NULL))[1],
       MIN(show_date), MAX(reminded_on), MIN(created_by)
FROM card_drafts GROUP BY guild_id, brand
ON CONFLICT (guild_id, brand) DO NOTHING;

-- 15 matches per division (60 per show)
ALTER TABLE card_draft_matches DROP CONSTRAINT IF EXISTS card_draft_matches_position_check;
ALTER TABLE card_draft_matches ADD CONSTRAINT card_draft_matches_position_check CHECK (position BETWEEN 1 AND 15);
