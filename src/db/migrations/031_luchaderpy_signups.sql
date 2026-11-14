-- 031 (3.16): LuchaDerpy has its own sign-ups, separate from the normal ones (Men's, Women's, Custom, Custom Women's).
ALTER TABLE signups ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'main';
ALTER TABLE signups DROP CONSTRAINT IF EXISTS signups_kind_check;
ALTER TABLE signups ADD CONSTRAINT signups_kind_check CHECK (kind IN ('main','luchaderpy'));
-- LuchaDerpy characters that joined a normal sign-up that is still running come off it
DELETE FROM signup_entries e USING signups s
 WHERE s.id = e.signup_id AND s.kind = 'main' AND s.status IN ('open','closed') AND e.division = 'luchaderpy';
