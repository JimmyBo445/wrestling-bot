-- 008: character pictures uploaded straight to Discord are stored here (Discord's own links expire).
CREATE TABLE IF NOT EXISTS character_images (
    character_id BIGINT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
    data         BYTEA NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'image/jpeg',
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
