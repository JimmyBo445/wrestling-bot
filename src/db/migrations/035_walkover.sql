-- 035 (3.21): a Walkover gives the winner a win and the no-show nothing. The no-show's row keeps is_winner NULL,
-- so it counts as neither a win nor a loss everywhere records are counted.
ALTER TABLE match_participants ALTER COLUMN is_winner DROP NOT NULL;
