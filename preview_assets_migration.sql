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
