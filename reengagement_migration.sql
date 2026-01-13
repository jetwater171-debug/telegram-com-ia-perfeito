-- Adicionar colunas para suporte ao reengajamento (Nudge)
ALTER TABLE sessions 
ADD COLUMN last_bot_activity_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN reengagement_sent BOOLEAN DEFAULT FALSE;

-- Opcional: Criar índex para melhorar performance da busca do cron
CREATE INDEX idx_sessions_reengagement ON sessions (last_bot_activity_at) WHERE reengagement_sent = FALSE;
