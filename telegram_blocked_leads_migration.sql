-- Run before deploying blocked-lead handling. All changes are transactional.
BEGIN;
ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS telegram_membership_at timestamptz,
    ADD COLUMN IF NOT EXISTS telegram_membership_update_id bigint;

-- Replace the original session with a minimal tombstone. A new UUID ensures
-- that an already-running worker cannot repopulate the deleted conversation.
CREATE OR REPLACE FUNCTION public.apply_telegram_membership(
    p_chat_id text, p_blocked boolean, p_event_at timestamptz,
    p_update_id bigint DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    previous public.sessions%ROWTYPE;
    linked record;
BEGIN
    IF p_chat_id !~ '^[0-9]+$' OR p_event_at IS NULL THEN
        RAISE EXCEPTION 'Invalid private Telegram membership';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('telegram-membership:' || p_chat_id, 0));
    SELECT * INTO previous FROM public.sessions WHERE telegram_chat_id = p_chat_id FOR UPDATE;
    IF previous.telegram_membership_at IS NOT NULL AND
       (p_event_at < previous.telegram_membership_at OR
        (p_event_at = previous.telegram_membership_at AND
         coalesce(p_update_id, -1) <= coalesce(previous.telegram_membership_update_id, -1))) THEN
        RETURN false;
    END IF;
    IF NOT p_blocked THEN
        -- Unblocking does not trigger a campaign. Wait for the next message.
        UPDATE public.sessions SET
            status = CASE WHEN status = 'blocked' THEN 'closed' ELSE status END,
            telegram_membership_at = p_event_at,
            telegram_membership_update_id = p_update_id
        WHERE telegram_chat_id = p_chat_id;
        IF NOT FOUND THEN
            INSERT INTO public.sessions (telegram_chat_id, status, user_name, telegram_membership_at, telegram_membership_update_id)
            VALUES (p_chat_id, 'closed', NULL, p_event_at, p_update_id);
        END IF;
        RETURN true;
    END IF;
    IF previous.status = 'blocked' THEN
        UPDATE public.sessions SET telegram_membership_at = p_event_at,
            telegram_membership_update_id = p_update_id WHERE id = previous.id;
        RETURN true;
    END IF;
    -- Include links without FKs (preview_requests) and SET NULL attribution
    -- records. No shared catalog assets or global settings are removed.
    FOR linked IN
        SELECT c.table_name, c.column_name FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
          AND c.table_name <> 'sessions'
          AND c.column_name IN ('session_id', 'source_session_id', 'telegram_chat_id')
    LOOP
        EXECUTE format('DELETE FROM public.%I WHERE %I::text = $1', linked.table_name, linked.column_name)
        USING CASE WHEN linked.column_name = 'telegram_chat_id' THEN p_chat_id ELSE previous.id::text END;
    END LOOP;
    DELETE FROM public.sessions WHERE id = previous.id;
    INSERT INTO public.sessions (
        telegram_chat_id, status, user_name, lead_memory, lead_score, total_paid,
        reengagement_sent, last_message_at, last_bot_activity_at,
        telegram_membership_at, telegram_membership_update_id
    ) VALUES (p_chat_id, 'blocked', NULL, '{}'::jsonb, NULL, 0,
        true, p_event_at, NULL, p_event_at, p_update_id);
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_telegram_membership(text, boolean, timestamptz, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_telegram_membership(text, boolean, timestamptz, bigint) TO service_role;

-- Admin actions and stale updates must not reactivate a tombstone. Only the
-- service-role membership RPC may change it after Telegram confirms unblock.
CREATE OR REPLACE FUNCTION public.guard_telegram_tombstone()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'blocked' AND NEW.telegram_membership_at IS NOT DISTINCT FROM OLD.telegram_membership_at
       AND NEW.telegram_membership_update_id IS NOT DISTINCT FROM OLD.telegram_membership_update_id THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_telegram_tombstone ON public.sessions;
CREATE TRIGGER guard_telegram_tombstone BEFORE UPDATE ON public.sessions
FOR EACH ROW EXECUTE FUNCTION public.guard_telegram_tombstone();

-- Protect every per-session table, including references that have no FK.
-- A key-share lock also serializes inserts against session deletion.
CREATE OR REPLACE FUNCTION public.guard_telegram_lead_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lead_id uuid; lead_status text;
BEGIN
    lead_id := (to_jsonb(NEW)->>TG_ARGV[0])::uuid;
    IF lead_id IS NULL THEN RETURN NEW; END IF;
    SELECT status INTO lead_status FROM public.sessions WHERE id = lead_id FOR KEY SHARE;
    IF NOT FOUND OR lead_status = 'blocked' THEN
        RAISE EXCEPTION 'Lead unavailable' USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$;
DO $$ DECLARE linked record; BEGIN
    FOR linked IN SELECT c.table_name, c.column_name FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
        WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
          AND c.column_name IN ('session_id', 'source_session_id') AND c.udt_name='uuid'
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'guard_lead_' || linked.column_name, linked.table_name);
        EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_telegram_lead_write(%L)',
            'guard_lead_' || linked.column_name, linked.table_name, linked.column_name);
    END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
