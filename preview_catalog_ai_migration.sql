-- Catalogo visual inteligente e fila de imagens pedidas pelos leads.
ALTER TABLE preview_assets
    ADD COLUMN IF NOT EXISTS ai_analysis JSONB,
    ADD COLUMN IF NOT EXISTS analysis_status TEXT DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS analysis_model TEXT,
    ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS source_request_id UUID;

CREATE TABLE IF NOT EXISTS preview_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    first_requested_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_requested_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    normalized_key TEXT NOT NULL UNIQUE,
    requested_description TEXT NOT NULL,
    example_phrase TEXT,
    tags TEXT[],
    request_count INTEGER DEFAULT 1 NOT NULL,
    priority INTEGER DEFAULT 0 NOT NULL,
    status TEXT DEFAULT 'pending' NOT NULL,
    source_session_id UUID,
    matched_preview_id UUID REFERENCES preview_assets(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS preview_requests_status_priority_idx
    ON preview_requests (status, priority DESC, request_count DESC, last_requested_at DESC);

ALTER TABLE preview_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable read/write for all" ON preview_requests;
CREATE POLICY "Enable read/write for all" ON preview_requests FOR ALL USING (true) WITH CHECK (true);

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE preview_requests;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

