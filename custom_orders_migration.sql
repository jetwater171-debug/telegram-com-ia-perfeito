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

CREATE INDEX IF NOT EXISTS custom_orders_status_created_idx
    ON custom_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS custom_orders_session_idx
    ON custom_orders (session_id, created_at DESC);

ALTER TABLE custom_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable read/write for all" ON custom_orders;
CREATE POLICY "Enable read/write for all" ON custom_orders FOR ALL USING (true) WITH CHECK (true);

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE custom_orders;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
