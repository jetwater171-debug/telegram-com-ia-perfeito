-- Create sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    telegram_chat_id TEXT UNIQUE, -- Added for telegram mapping
    user_city TEXT,
    device_type TEXT,
    status TEXT DEFAULT 'active', -- active, paused (admin taking over), closed
    lead_score JSONB,
    lead_memory JSONB DEFAULT '{}'::jsonb,
    user_name TEXT,
    total_paid NUMERIC DEFAULT 0,
    funnel_step TEXT,
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    last_bot_activity_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    reengagement_sent BOOLEAN DEFAULT FALSE,
    processing_token TEXT,
    processing_started_at TIMESTAMP WITH TIME ZONE
);


-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    sender TEXT NOT NULL, -- 'user', 'bot', 'system', 'admin'
    content TEXT,
    media_url TEXT,
    media_type TEXT, -- 'image', 'video', 'audio'
    payment_data JSONB, -- Stores payment info if related to payment
    ai_debug JSONB -- Stores full prompt, raw response and model telemetry for advanced inspector
);

-- Create bot_settings table (for dynamic token)
CREATE TABLE IF NOT EXISTS bot_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Dynamic prompt blocks (editable without deploy)
CREATE TABLE IF NOT EXISTS prompt_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    label TEXT,
    content TEXT NOT NULL,
    enabled BOOLEAN DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Prompt variants for automatic learning (bandit)
CREATE TABLE IF NOT EXISTS prompt_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stage TEXT NOT NULL,
    label TEXT,
    content TEXT NOT NULL,
    enabled BOOLEAN DEFAULT true,
    weight NUMERIC DEFAULT 1,
    successes INTEGER DEFAULT 0,
    failures INTEGER DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS variant_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES prompt_variants(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    success BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

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

-- Funnel events for analytics
CREATE TABLE IF NOT EXISTS funnel_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    step TEXT NOT NULL,
    source TEXT DEFAULT 'ai',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index para reengajamento
CREATE INDEX IF NOT EXISTS idx_sessions_reengagement ON sessions (last_bot_activity_at) WHERE reengagement_sent = FALSE;
CREATE INDEX IF NOT EXISTS idx_lead_redirects_code ON lead_redirects (code);
CREATE INDEX IF NOT EXISTS idx_lead_redirects_chat ON lead_redirects (telegram_chat_id);

-- Enable Realtime for messages (crucial for admin chat)
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table sessions;
alter publication supabase_realtime add table prompt_blocks;
alter publication supabase_realtime add table prompt_variants;
alter publication supabase_realtime add table variant_assignments;
alter publication supabase_realtime add table lead_redirects;
alter publication supabase_realtime add table funnel_events;

-- Policy (optional: currently public for anon, but in prod should be restricted)
-- For now allowing anon access to make it work with the anon key provided in env for the bot logic
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE variant_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_redirects ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read/write for all" ON sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable read/write for all" ON messages FOR ALL USING (true) WITH CHECK (true);
-- bot_settings deve ser protegido (use service role via API routes)
CREATE POLICY "Enable read/write for all" ON prompt_blocks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable read/write for all" ON prompt_variants FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable read/write for all" ON variant_assignments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable read/write for all" ON lead_redirects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable read/write for all" ON funnel_events FOR ALL USING (true) WITH CHECK (true);

-- Preview assets (midias de previa configuraveis pelo admin)
CREATE TABLE IF NOT EXISTS preview_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    triggers TEXT,
    tags TEXT[],
    stage TEXT DEFAULT 'PREVIEW',
    min_tarado INTEGER DEFAULT 0,
    max_tarado INTEGER DEFAULT 100,
    media_type TEXT NOT NULL, -- image | video
    media_url TEXT NOT NULL,
    storage_path TEXT,
    priority INTEGER DEFAULT 0,
    enabled BOOLEAN DEFAULT true
);

alter publication supabase_realtime add table preview_assets;
ALTER TABLE preview_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable read/write for all" ON preview_assets FOR ALL USING (true) WITH CHECK (true);

-- Storage policies for previews bucket (public upload/read/delete)
CREATE POLICY "Public read previews" ON storage.objects
FOR SELECT USING (bucket_id = 'previews');

CREATE POLICY "Public insert previews" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'previews');

CREATE POLICY "Public delete previews" ON storage.objects
FOR DELETE USING (bucket_id = 'previews');

-- Metadados de analise visual e pedidos de novas previas
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
    matched_preview_id UUID REFERENCES preview_assets(id) ON DELETE SET NULL,
    media_type TEXT DEFAULT 'photo' NOT NULL,
    admin_brief TEXT,
    request_analysis JSONB,
    analysis_model TEXT,
    analyzed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS preview_requests_status_priority_idx
    ON preview_requests (status, priority DESC, request_count DESC, last_requested_at DESC);
CREATE INDEX IF NOT EXISTS preview_requests_photo_queue_idx
    ON preview_requests (media_type, status, priority DESC, request_count DESC, last_requested_at DESC);

ALTER TABLE preview_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable read/write for all" ON preview_requests FOR ALL USING (true) WITH CHECK (true);

-- Fila operacional de qualquer pedido personalizado vendido pela Lari
CREATE TABLE IF NOT EXISTS custom_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE NOT NULL,
    payment_id TEXT UNIQUE,
    gateway TEXT,
    status TEXT DEFAULT 'awaiting_payment' NOT NULL,
    request_brief TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    payment_data JSONB DEFAULT '{}'::jsonb,
    admin_notes TEXT,
    paid_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS custom_orders_status_created_idx ON custom_orders (status, created_at DESC);
ALTER TABLE custom_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable read/write for all" ON custom_orders FOR ALL USING (true) WITH CHECK (true);
