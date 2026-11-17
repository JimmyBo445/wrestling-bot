-- 033 (3.19): saved switches for ⚡ Auto-build (each can be changed for one build on the Auto-build screen)
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS autobuild_rematches BOOLEAN NOT NULL DEFAULT true;   -- off = no pair that met in the last 21 days
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS autobuild_match_types BOOLEAN NOT NULL DEFAULT false; -- triple threats, fatal 4-ways, tag teams (up to 1/3 of the card)
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS autobuild_records BOOLEAN NOT NULL DEFAULT true;      -- pair similar records
