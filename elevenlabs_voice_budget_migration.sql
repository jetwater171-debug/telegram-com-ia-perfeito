-- Ledger financeiro e reservas atomicas para a voz ElevenLabs da Lari.
-- Aplique este arquivo no SQL Editor do Supabase antes de ativar audio em producao.

CREATE TABLE IF NOT EXISTS elevenlabs_budget_cycles (
    cycle_key TEXT PRIMARY KEY,
    reset_at TIMESTAMP WITH TIME ZONE,
    starting_credits INTEGER NOT NULL CHECK (starting_credits >= 0),
    last_live_remaining INTEGER NOT NULL CHECK (last_live_remaining >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS elevenlabs_audio_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT UNIQUE NOT NULL,
    cycle_key TEXT REFERENCES elevenlabs_budget_cycles(cycle_key) ON DELETE RESTRICT NOT NULL,
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('requested', 'ai_selected', 'spontaneous', 'admin_test')),
    status TEXT DEFAULT 'reserved' NOT NULL CHECK (status IN ('reserved', 'charged', 'released')),
    estimated_credits INTEGER NOT NULL CHECK (estimated_credits > 0),
    actual_credits INTEGER CHECK (actual_credits >= 0),
    spoken_chars INTEGER,
    tagged_chars INTEGER,
    total_paid_snapshot NUMERIC DEFAULT 0 NOT NULL,
    lead_budget_credits INTEGER DEFAULT 0 NOT NULL,
    eleven_request_id TEXT,
    failure_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    charged_at TIMESTAMP WITH TIME ZONE,
    released_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS elevenlabs_audio_usage_cycle_status_idx
ON elevenlabs_audio_usage (cycle_key, status, created_at DESC);

CREATE INDEX IF NOT EXISTS elevenlabs_audio_usage_session_status_idx
ON elevenlabs_audio_usage (session_id, status, created_at DESC);

ALTER TABLE elevenlabs_budget_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE elevenlabs_audio_usage ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION reserve_elevenlabs_audio_usage(
    p_session_id UUID,
    p_idempotency_key TEXT,
    p_source TEXT,
    p_estimated_credits INTEGER,
    p_cycle_key TEXT,
    p_cycle_reset_at TIMESTAMP WITH TIME ZONE,
    p_cycle_starting_credits INTEGER,
    p_live_remaining INTEGER,
    p_free_lead_credits INTEGER,
    p_revenue_share_percent NUMERIC,
    p_credits_per_brl NUMERIC,
    p_reserve_percent NUMERIC,
    p_acquisition_percent NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing elevenlabs_audio_usage%ROWTYPE;
    v_total_paid NUMERIC := 0;
    v_starting INTEGER := 0;
    v_reserve INTEGER := 0;
    v_acquisition_cap INTEGER := 0;
    v_payer_cap INTEGER := 0;
    v_global_spent INTEGER := 0;
    v_bucket_spent INTEGER := 0;
    v_lead_spent INTEGER := 0;
    v_lead_budget INTEGER := 0;
    v_is_payer BOOLEAN := FALSE;
    v_reservation_id UUID;
BEGIN
    IF p_estimated_credits <= 0 OR p_live_remaining < 0 OR p_cycle_starting_credits <= 0 THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_budget_input');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('elevenlabs:' || p_cycle_key));

    -- Reserva abandonada por timeout nao pode prender dinheiro para sempre.
    UPDATE elevenlabs_audio_usage
       SET status = 'released', released_at = now(), updated_at = now(), failure_reason = 'reservation_timeout'
     WHERE status = 'reserved' AND created_at < now() - interval '15 minutes';

    SELECT * INTO v_existing
      FROM elevenlabs_audio_usage
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
        RETURN jsonb_build_object(
            'allowed', false,
            'reason', 'duplicate_generation',
            'reservation_id', v_existing.id,
            'status', v_existing.status
        );
    END IF;

    SELECT COALESCE(total_paid, 0) INTO v_total_paid FROM sessions WHERE id = p_session_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'session_not_found');
    END IF;
    v_is_payer := v_total_paid > 0;

    INSERT INTO elevenlabs_budget_cycles (cycle_key, reset_at, starting_credits, last_live_remaining)
    VALUES (p_cycle_key, p_cycle_reset_at, p_cycle_starting_credits, p_live_remaining)
    ON CONFLICT (cycle_key) DO UPDATE SET
        reset_at = COALESCE(EXCLUDED.reset_at, elevenlabs_budget_cycles.reset_at),
        last_live_remaining = EXCLUDED.last_live_remaining,
        updated_at = now();

    SELECT starting_credits INTO v_starting FROM elevenlabs_budget_cycles WHERE cycle_key = p_cycle_key;
    v_reserve := FLOOR(v_starting * p_reserve_percent / 100.0);
    v_acquisition_cap := FLOOR(v_starting * p_acquisition_percent / 100.0);
    v_payer_cap := GREATEST(0, v_starting - v_reserve - v_acquisition_cap);

    SELECT COALESCE(SUM(CASE WHEN status = 'charged' THEN COALESCE(actual_credits, estimated_credits) ELSE estimated_credits END), 0)
      INTO v_global_spent
      FROM elevenlabs_audio_usage
     WHERE cycle_key = p_cycle_key AND status IN ('reserved', 'charged');

    SELECT COALESCE(SUM(CASE WHEN status = 'charged' THEN COALESCE(actual_credits, estimated_credits) ELSE estimated_credits END), 0)
      INTO v_bucket_spent
      FROM elevenlabs_audio_usage
     WHERE cycle_key = p_cycle_key
       AND status IN ('reserved', 'charged')
       AND ((v_is_payer AND total_paid_snapshot > 0) OR (NOT v_is_payer AND total_paid_snapshot <= 0));

    SELECT COALESCE(SUM(CASE WHEN status = 'charged' THEN COALESCE(actual_credits, estimated_credits) ELSE estimated_credits END), 0)
      INTO v_lead_spent
      FROM elevenlabs_audio_usage
     WHERE session_id = p_session_id AND status IN ('reserved', 'charged');

    v_lead_budget := GREATEST(
        0,
        p_free_lead_credits + FLOOR(v_total_paid * p_revenue_share_percent / 100.0 * p_credits_per_brl)
    );

    IF v_lead_spent + p_estimated_credits > v_lead_budget THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'lead_budget_exhausted', 'lead_remaining', GREATEST(0, v_lead_budget - v_lead_spent));
    END IF;
    IF v_global_spent + p_estimated_credits > v_starting - v_reserve THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'global_budget_exhausted', 'global_remaining', GREATEST(0, v_starting - v_reserve - v_global_spent));
    END IF;
    IF p_live_remaining - p_estimated_credits < v_reserve THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'account_reserve_reached', 'live_remaining', p_live_remaining, 'reserve', v_reserve);
    END IF;
    IF NOT v_is_payer AND v_bucket_spent + p_estimated_credits > v_acquisition_cap THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'acquisition_pool_exhausted');
    END IF;
    IF v_is_payer AND v_bucket_spent + p_estimated_credits > v_payer_cap THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'buyer_pool_exhausted');
    END IF;

    INSERT INTO elevenlabs_audio_usage (
        idempotency_key, cycle_key, session_id, source, status, estimated_credits,
        total_paid_snapshot, lead_budget_credits
    ) VALUES (
        p_idempotency_key, p_cycle_key, p_session_id, p_source, 'reserved', p_estimated_credits,
        v_total_paid, v_lead_budget
    ) RETURNING id INTO v_reservation_id;

    RETURN jsonb_build_object(
        'allowed', true,
        'reason', 'reserved',
        'reservation_id', v_reservation_id,
        'lead_budget', v_lead_budget,
        'lead_remaining_after', GREATEST(0, v_lead_budget - v_lead_spent - p_estimated_credits),
        'global_remaining_after', GREATEST(0, v_starting - v_reserve - v_global_spent - p_estimated_credits),
        'reserve', v_reserve
    );
END;
$$;

CREATE OR REPLACE FUNCTION settle_elevenlabs_audio_usage(
    p_reservation_id UUID,
    p_actual_credits INTEGER,
    p_request_id TEXT,
    p_spoken_chars INTEGER,
    p_tagged_chars INTEGER
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE elevenlabs_audio_usage
       SET status = 'charged',
           actual_credits = GREATEST(0, p_actual_credits),
           eleven_request_id = NULLIF(p_request_id, ''),
           spoken_chars = GREATEST(0, p_spoken_chars),
           tagged_chars = GREATEST(0, p_tagged_chars),
           charged_at = now(),
           updated_at = now()
     WHERE id = p_reservation_id AND status = 'reserved';
END;
$$;

CREATE OR REPLACE FUNCTION release_elevenlabs_audio_usage(
    p_reservation_id UUID,
    p_failure_reason TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE elevenlabs_audio_usage
       SET status = 'released',
           failure_reason = LEFT(COALESCE(p_failure_reason, 'generation_failed'), 500),
           released_at = now(),
           updated_at = now()
     WHERE id = p_reservation_id AND status = 'reserved';
END;
$$;

REVOKE ALL ON elevenlabs_budget_cycles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON elevenlabs_audio_usage FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION reserve_elevenlabs_audio_usage(UUID, TEXT, TEXT, INTEGER, TEXT, TIMESTAMP WITH TIME ZONE, INTEGER, INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION settle_elevenlabs_audio_usage(UUID, INTEGER, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_elevenlabs_audio_usage(UUID, TEXT) FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON elevenlabs_budget_cycles TO service_role;
GRANT SELECT, INSERT, UPDATE ON elevenlabs_audio_usage TO service_role;
GRANT EXECUTE ON FUNCTION reserve_elevenlabs_audio_usage(UUID, TEXT, TEXT, INTEGER, TEXT, TIMESTAMP WITH TIME ZONE, INTEGER, INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION settle_elevenlabs_audio_usage(UUID, INTEGER, TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION release_elevenlabs_audio_usage(UUID, TEXT) TO service_role;
