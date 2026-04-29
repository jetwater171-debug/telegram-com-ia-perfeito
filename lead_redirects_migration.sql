CREATE TABLE IF NOT EXISTS lead_redirects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    clicked_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    claimed_at TIMESTAMP WITH TIME ZONE,
    telegram_chat_id TEXT,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    ip TEXT,
    user_agent TEXT,
    referer TEXT,
    country TEXT,
    region TEXT,
    city TEXT,
    timezone TEXT,
    source_url TEXT,
    utm JSONB DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_lead_redirects_code ON lead_redirects (code);
CREATE INDEX IF NOT EXISTS idx_lead_redirects_chat ON lead_redirects (telegram_chat_id);

ALTER TABLE lead_redirects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable read/write for all" ON lead_redirects FOR ALL USING (true) WITH CHECK (true);
