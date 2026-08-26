-- A tela de conversa sempre filtra por sessao e ordena pelas mensagens mais recentes.
-- Sem este indice, o Postgres precisa filtrar e ordenar a tabela inteira a cada sync.
CREATE INDEX IF NOT EXISTS idx_messages_session_created_at
ON messages (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_funnel_events_session_created_at
ON funnel_events (session_id, created_at DESC);
