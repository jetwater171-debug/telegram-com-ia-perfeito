-- Fila exclusiva de fotos, com briefing estruturado por IA.
ALTER TABLE preview_requests
    ADD COLUMN IF NOT EXISTS media_type TEXT,
    ADD COLUMN IF NOT EXISTS admin_brief TEXT,
    ADD COLUMN IF NOT EXISTS request_analysis JSONB,
    ADD COLUMN IF NOT EXISTS analysis_model TEXT,
    ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMP WITH TIME ZONE;

-- Classifica os registros antigos antes de fixar o valor padrao.
UPDATE preview_requests
SET media_type = CASE
    WHEN (
        (requested_description ~* '\m(video|filmagem|gravacao|gravação)\M' OR COALESCE(tags, ARRAY[]::TEXT[]) && ARRAY['video','vídeo','filmagem','gravacao','gravação'])
        AND NOT (requested_description ~* '\m(foto|fotinha|selfie|imagem|nude|pelada|nua)\M' OR COALESCE(tags, ARRAY[]::TEXT[]) && ARRAY['foto','fotinha','selfie','imagem','nude','pelada','nua'])
    ) THEN 'video'
    ELSE 'photo'
END
WHERE media_type IS NULL;

-- Vídeos antigos não são apagados: ficam arquivados e podem ser auditados.
UPDATE preview_requests
SET status = 'dismissed', updated_at = timezone('utc'::text, now())
WHERE media_type <> 'photo' AND status = 'pending';

ALTER TABLE preview_requests
    ALTER COLUMN media_type SET DEFAULT 'photo',
    ALTER COLUMN media_type SET NOT NULL;

CREATE INDEX IF NOT EXISTS preview_requests_photo_queue_idx
    ON preview_requests (media_type, status, priority DESC, request_count DESC, last_requested_at DESC);
