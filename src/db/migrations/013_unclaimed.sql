-- 013: characters can be taken off a player and left unclaimed (held by a placeholder "player" row)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_placeholder BOOLEAN NOT NULL DEFAULT false;
