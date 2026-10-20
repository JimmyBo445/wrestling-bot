-- 005: a card slot remembers which logged match fulfilled it (so recaps and results can use the show's look).
ALTER TABLE card_draft_matches ADD COLUMN IF NOT EXISTS match_id BIGINT REFERENCES matches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_card_draft_matches_match ON card_draft_matches(match_id) WHERE match_id IS NOT NULL;
