-- 030 (3.15): the LuchaDerpy division.
-- A LuchaDerpy (🟣) character is its own row in `characters` (division 'luchaderpy') linked to the Men's
-- superstar it is (base_character_id). That keeps its matches, record, standings and titles fully separate
-- from Men's. One superstar has one player at a time; the same player may hold both colors with staff approval.
ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_division_check;
ALTER TABLE characters ADD CONSTRAINT characters_division_check CHECK (division IN ('mens','womens','custom','custom_womens','luchaderpy'));
ALTER TABLE titles DROP CONSTRAINT IF EXISTS titles_division_check;
ALTER TABLE titles ADD CONSTRAINT titles_division_check CHECK (division IN ('mens','womens','custom','custom_womens','luchaderpy'));
ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_division_check;
ALTER TABLE teams ADD CONSTRAINT teams_division_check CHECK (division IN ('mens','womens','custom','custom_womens','luchaderpy'));
ALTER TABLE factions DROP CONSTRAINT IF EXISTS factions_division_check;
ALTER TABLE factions ADD CONSTRAINT factions_division_check CHECK (division IN ('mens','womens','custom','custom_womens','luchaderpy'));
ALTER TABLE card_drafts DROP CONSTRAINT IF EXISTS card_drafts_division_check;
ALTER TABLE card_drafts ADD CONSTRAINT card_drafts_division_check CHECK (division IN ('mens','womens','custom','custom_womens','luchaderpy'));

-- the third show
ALTER TABLE card_drafts DROP CONSTRAINT IF EXISTS card_drafts_brand_check;
ALTER TABLE card_drafts ADD CONSTRAINT card_drafts_brand_check CHECK (brand IN ('raw','smackdown','luchaderpy'));
ALTER TABLE card_shows DROP CONSTRAINT IF EXISTS card_shows_brand_check;
ALTER TABLE card_shows ADD CONSTRAINT card_shows_brand_check CHECK (brand IN ('raw','smackdown','luchaderpy'));

ALTER TABLE characters ADD COLUMN IF NOT EXISTS base_character_id BIGINT REFERENCES characters(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_characters_lucha_base ON characters (base_character_id) WHERE base_character_id IS NOT NULL;

ALTER TABLE guilds ADD COLUMN IF NOT EXISTS roster_channel_luchaderpy TEXT;   -- live roster + standings
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS luchaderpy_card_channel_id TEXT;  -- where the show card is posted
