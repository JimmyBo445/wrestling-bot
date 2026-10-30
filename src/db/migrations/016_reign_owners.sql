-- Remembers which PLAYER a title reign belongs to (whoever owned the wrestler at the time).
-- Transferring a character later does not move the credit.
CREATE TABLE IF NOT EXISTS reign_owners (
    reign_id BIGINT NOT NULL REFERENCES title_reigns(id) ON DELETE CASCADE,
    user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (reign_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_reign_owners_user ON reign_owners(user_id);

CREATE OR REPLACE FUNCTION add_reign_owner(rid BIGINT, cid BIGINT) RETURNS void AS $$
    INSERT INTO reign_owners (reign_id, user_id)
    SELECT rid, u.id FROM characters c JOIN users u ON u.id = c.owner_id
    WHERE c.id = cid AND NOT u.is_placeholder
    ON CONFLICT DO NOTHING;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION trg_reign_insert() RETURNS trigger AS $$
BEGIN
    IF NEW.character_id IS NOT NULL AND NEW.team_id IS NULL THEN PERFORM add_reign_owner(NEW.id, NEW.character_id); END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_reign_update() RETURNS trigger AS $$
BEGIN
    DELETE FROM reign_owners WHERE reign_id = NEW.id;
    IF NEW.character_id IS NOT NULL AND NEW.team_id IS NULL THEN PERFORM add_reign_owner(NEW.id, NEW.character_id); END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_reign_member_insert() RETURNS trigger AS $$
BEGIN
    IF NEW.character_id IS NOT NULL THEN PERFORM add_reign_owner(NEW.reign_id, NEW.character_id); END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reign_owner_insert ON title_reigns;
CREATE TRIGGER reign_owner_insert AFTER INSERT ON title_reigns FOR EACH ROW EXECUTE FUNCTION trg_reign_insert();
DROP TRIGGER IF EXISTS reign_owner_update ON title_reigns;
CREATE TRIGGER reign_owner_update AFTER UPDATE OF character_id, team_id ON title_reigns FOR EACH ROW
    WHEN (OLD.character_id IS DISTINCT FROM NEW.character_id OR OLD.team_id IS DISTINCT FROM NEW.team_id) EXECUTE FUNCTION trg_reign_update();
DROP TRIGGER IF EXISTS reign_owner_member ON title_reign_members;
CREATE TRIGGER reign_owner_member AFTER INSERT ON title_reign_members FOR EACH ROW EXECUTE FUNCTION trg_reign_member_insert();

-- existing reigns: credit whoever owns the wrestlers now (the best information available)
SELECT add_reign_owner(id, character_id) FROM title_reigns WHERE character_id IS NOT NULL AND team_id IS NULL;
SELECT add_reign_owner(reign_id, character_id) FROM title_reign_members WHERE character_id IS NOT NULL;
