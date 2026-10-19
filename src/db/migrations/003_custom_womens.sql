-- 003: add the "Custom Women's" division (stored as 'custom_womens').
ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_division_check;
ALTER TABLE characters ADD CONSTRAINT characters_division_check CHECK (division IN ('mens','womens','custom','custom_womens'));

ALTER TABLE titles DROP CONSTRAINT IF EXISTS titles_division_check;
ALTER TABLE titles ADD CONSTRAINT titles_division_check CHECK (division IN ('mens','womens','custom','custom_womens'));

ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_division_check;
ALTER TABLE teams ADD CONSTRAINT teams_division_check CHECK (division IN ('mens','womens','custom','custom_womens'));
