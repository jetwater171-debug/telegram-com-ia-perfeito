ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS lead_memory JSONB DEFAULT '{}'::jsonb;
