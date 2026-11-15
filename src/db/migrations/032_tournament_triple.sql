-- 032 (3.18): tournaments can open with triple threats. The first round is triple threats (the staff pick who is
-- in which match), the winners go into the usual one-on-one bracket.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'singles';
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_format_check;
ALTER TABLE tournaments ADD CONSTRAINT tournaments_format_check CHECK (format IN ('singles','triple'));
ALTER TABLE tournament_entrants ADD COLUMN IF NOT EXISTS grp INT;                 -- first-round match the staff picked
ALTER TABLE tournament_matches ADD COLUMN IF NOT EXISTS c_id BIGINT REFERENCES characters(id) ON DELETE SET NULL; -- third wrestler
