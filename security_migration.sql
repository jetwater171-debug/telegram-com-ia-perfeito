-- Lock down bot_settings (token/table should not be public)
ALTER TABLE bot_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable read/write for all" ON bot_settings;
CREATE POLICY "Deny all anon" ON bot_settings FOR ALL USING (false) WITH CHECK (false);
