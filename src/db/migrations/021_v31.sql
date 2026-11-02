-- 021 (3.1): fan ratings for matches. Only adds things.
-- Anyone can rate a match 1-5 stars with the button under its result (one rating per person,
-- they can change it). This is separate from the staff rating (/match rate), which still
-- decides "best match" for Wrestler of the Month.
CREATE TABLE IF NOT EXISTS match_ratings (
    match_id    BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    discord_id  TEXT   NOT NULL,
    stars       INT    NOT NULL CHECK (stars BETWEEN 1 AND 5),
    rated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (match_id, discord_id)
);
