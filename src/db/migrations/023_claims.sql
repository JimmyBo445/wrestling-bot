-- 023 (3.4): players can ask to claim a wrestler that has no player (from the signup picker).
-- Only adds a request type; nothing else changes.
ALTER TABLE pending_requests DROP CONSTRAINT IF EXISTS pending_requests_request_type_check;
ALTER TABLE pending_requests ADD CONSTRAINT pending_requests_request_type_check
    CHECK (request_type IN ('character_submission','contender_challenge','match_request','streak_contender','character_claim'));
