-- Dynamic prompt blocks + funnel analytics
CREATE TABLE IF NOT EXISTS prompt_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    label TEXT,
    content TEXT NOT NULL,
    enabled BOOLEAN DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS funnel_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    step TEXT NOT NULL,
    source TEXT DEFAULT 'ai',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

alter publication supabase_realtime add table prompt_blocks;
alter publication supabase_realtime add table funnel_events;

ALTER TABLE prompt_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read/write for all" ON prompt_blocks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable read/write for all" ON funnel_events FOR ALL USING (true) WITH CHECK (true);

-- Optional seed examples
INSERT INTO prompt_blocks (key, label, content, enabled)
VALUES
('tone_override', 'Tom de Conversa (Override)', 'Se este bloco existir, ele tem prioridade sobre instrucoes anteriores. Ajuste o tom, scripts e regras aqui.', false)
ON CONFLICT (key) DO NOTHING;
