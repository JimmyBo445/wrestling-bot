-- 004: character finisher + entrance theme, and match card drafts (RAW / SmackDown).
ALTER TABLE characters ADD COLUMN IF NOT EXISTS finisher TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS entrance_theme TEXT;

-- One card being built per brand + division (e.g. "RAW Men's", "SmackDown Custom").
CREATE TABLE IF NOT EXISTS card_drafts (
    id          BIGSERIAL PRIMARY KEY,
    guild_id    TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    brand       TEXT NOT NULL CHECK (brand IN ('raw','smackdown')),
    division    TEXT NOT NULL CHECK (division IN ('mens','womens','custom','custom_womens')),
    name        TEXT,
    created_by  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (guild_id, brand, division)
);

-- Matches on a card, in running order. character_ids holds the wrestlers in slot order
-- (for tag matches: team 1 first, then team 2). No foreign key on purpose, so a deleted
-- wrestler just shows as TBD instead of breaking the card.
CREATE TABLE IF NOT EXISTS card_draft_matches (
    id            BIGSERIAL PRIMARY KEY,
    draft_id      BIGINT NOT NULL REFERENCES card_drafts(id) ON DELETE CASCADE,
    position      INT NOT NULL CHECK (position BETWEEN 1 AND 10),
    match_type    TEXT NOT NULL,
    character_ids BIGINT[] NOT NULL,
    title_id      BIGINT REFERENCES titles(id) ON DELETE SET NULL,
    stipulation   TEXT,
    UNIQUE (draft_id, position)
);
