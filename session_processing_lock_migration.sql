ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS processing_token TEXT,
    ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sessions_processing_started_at
    ON sessions(processing_started_at)
    WHERE processing_token IS NOT NULL;
