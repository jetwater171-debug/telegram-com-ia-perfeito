-- Prompt variants + assignments for automatic learning
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

alter publication supabase_realtime add table prompt_variants;
alter publication supabase_realtime add table variant_assignments;

ALTER TABLE prompt_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE variant_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read/write for all" ON prompt_variants FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable read/write for all" ON variant_assignments FOR ALL USING (true) WITH CHECK (true);

-- Optional seed examples (disabled by default)
INSERT INTO prompt_variants (stage, label, content, enabled, weight)
VALUES
('PREVIEW', 'Preview A', 'Mantenha o tom provocante e leve o lead a querer ver o video completo.', false, 1),
('PREVIEW', 'Preview B', 'Use curiosidade + convite direto para o VIP, sem repetir preco.', false, 1)
ON CONFLICT DO NOTHING;
