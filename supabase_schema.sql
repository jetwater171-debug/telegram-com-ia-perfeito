-- Create sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    telegram_chat_id TEXT UNIQUE, -- Added for telegram mapping
    user_city TEXT,
    device_type TEXT,
    status TEXT DEFAULT 'active', -- active, paused (admin taking over), closed
    lead_score JSONB,
    user_name TEXT,
    total_paid NUMERIC DEFAULT 0,
    funnel_step TEXT,
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    last_bot_activity_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    reengagement_sent BOOLEAN DEFAULT FALSE,
    processing_token TEXT
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
    payment_data JSONB -- Stores payment info if related to payment
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

-- Enable Realtime for messages (crucial for admin chat)
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table sessions;
alter publication supabase_realtime add table prompt_blocks;
alter publication supabase_realtime add table prompt_variants;
alter publication supabase_realtime add table variant_assignments;
alter publication supabase_realtime add table funnel_events;

-- Policy (optional: currently public for anon, but in prod should be restricted)
-- For now allowing anon access to make it work with the anon key provided in env for the bot logic
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE variant_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read/write for all" ON sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable read/write for all" ON messages FOR ALL USING (true) WITH CHECK (true);
-- bot_settings deve ser protegido (use service role via API routes)
CREATE POLICY "Enable read/write for all" ON prompt_blocks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable read/write for all" ON prompt_variants FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable read/write for all" ON variant_assignments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable read/write for all" ON funnel_events FOR ALL USING (true) WITH CHECK (true);
