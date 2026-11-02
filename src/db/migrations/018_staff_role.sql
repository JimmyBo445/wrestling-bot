-- 018: a staff role whose members can use the bot's admin tools without the Manage Server permission.
-- Only adds a setting; nothing existing changes.
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS staff_role_id TEXT;
