-- 034 (3.20): a card match can be a #1 contender match for a belt (the winner becomes #1 contender when it's logged)
ALTER TABLE card_draft_matches ADD COLUMN IF NOT EXISTS contender_title_id BIGINT REFERENCES titles(id) ON DELETE SET NULL;
