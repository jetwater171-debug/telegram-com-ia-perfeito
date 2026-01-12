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
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
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

-- Enable Realtime for messages (crucial for admin chat)
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table sessions;

-- Policy (optional: currently public for anon, but in prod should be restricted)
-- For now allowing anon access to make it work with the anon key provided in env for the bot logic
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read/write for all" ON sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable read/write for all" ON messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable read/write for all" ON bot_settings FOR ALL USING (true) WITH CHECK (true);
