-- 3.13: players can switch their Men's/Women's character for an open one (staff approve).
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS switch_cooldown_days INT NOT NULL DEFAULT 14 CHECK (switch_cooldown_days BETWEEN 0 AND 365);

ALTER TABLE pending_requests DROP CONSTRAINT IF EXISTS pending_requests_request_type_check;
ALTER TABLE pending_requests ADD CONSTRAINT pending_requests_request_type_check
    CHECK (request_type IN ('character_submission','contender_challenge','match_request','streak_contender','character_claim','character_switch'));
