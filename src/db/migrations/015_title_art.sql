-- 015: belt pictures for titles, and defenses entered by hand for a reign
CREATE TABLE IF NOT EXISTS title_images (
    title_id     BIGINT PRIMARY KEY REFERENCES titles(id) ON DELETE CASCADE,
    data         BYTEA NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'image/jpeg',
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reign_defenses (
    id          BIGSERIAL PRIMARY KEY,
    reign_id    BIGINT NOT NULL REFERENCES title_reigns(id) ON DELETE CASCADE,
    opponent    TEXT NOT NULL,
    defended_on DATE,
    notes       TEXT,
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reign_defenses_reign_idx ON reign_defenses (reign_id);
