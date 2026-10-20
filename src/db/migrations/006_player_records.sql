-- 006: matches remember who owned each wrestler at the time, so a player's record
-- (overall and per division) follows the player, not the character.
ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS owner_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS division TEXT;

-- Old matches: the best we know is today's owner and division.
UPDATE match_participants mp
   SET owner_id = c.owner_id, division = c.division
  FROM characters c
 WHERE c.id = mp.character_id AND (mp.owner_id IS NULL OR mp.division IS NULL);

CREATE INDEX IF NOT EXISTS idx_match_participants_owner ON match_participants(owner_id);
