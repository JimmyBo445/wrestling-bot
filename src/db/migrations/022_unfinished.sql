-- 022 (3.2): reminders for unfinished card matches. Only adds things.
-- A match counts as unfinished when its show date has passed and no result was recorded for it.
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS reminders_channel_id TEXT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS unfinished_last DATE;

-- How often each unfinished match has been pinged automatically (at most 6 days in a row).
-- Keyed by what the match is (show date, brand, type, wrestlers), so moving it on the card doesn't reset it.
CREATE TABLE IF NOT EXISTS match_reminders (
    guild_id    TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    show_date   DATE NOT NULL,
    match_key   TEXT NOT NULL,
    sent        INT  NOT NULL DEFAULT 0,
    last_on     DATE,
    PRIMARY KEY (guild_id, show_date, match_key)
);
