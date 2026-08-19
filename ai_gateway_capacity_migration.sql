-- Shared AI gateway capacity buckets for multi-instance/serverless deployments.
-- Run once in the Supabase SQL editor, then set SUPABASE_SERVICE_ROLE_KEY in Vercel.

create table if not exists public.ai_gateway_capacity (
    bucket_key text primary key,
    minute_started_at timestamptz not null default now(),
    minute_requests integer not null default 0,
    minute_tokens bigint not null default 0,
    day_started_at timestamptz not null default now(),
    day_requests integer not null default 0,
    day_tokens bigint not null default 0,
    updated_at timestamptz not null default now()
);

alter table public.ai_gateway_capacity enable row level security;
revoke all on public.ai_gateway_capacity from anon, authenticated;
grant all on public.ai_gateway_capacity to service_role;

create or replace function public.reserve_ai_gateway_capacity(
    p_bucket_key text,
    p_rpm integer,
    p_tpm bigint,
    p_rpd integer,
    p_tpd bigint,
    p_estimated_tokens integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_row public.ai_gateway_capacity%rowtype;
    v_minute_requests integer;
    v_minute_tokens bigint;
    v_day_requests integer;
    v_day_tokens bigint;
    v_minute_started timestamptz;
    v_day_started timestamptz;
    v_minute_blocked boolean;
    v_day_blocked boolean;
    v_retry_after_ms integer := 0;
begin
    insert into public.ai_gateway_capacity(bucket_key)
    values (left(p_bucket_key, 240))
    on conflict (bucket_key) do nothing;

    select * into v_row
    from public.ai_gateway_capacity
    where bucket_key = left(p_bucket_key, 240)
    for update;

    if v_now - v_row.minute_started_at >= interval '60 seconds' then
        v_minute_started := v_now;
        v_minute_requests := 0;
        v_minute_tokens := 0;
    else
        v_minute_started := v_row.minute_started_at;
        v_minute_requests := v_row.minute_requests;
        v_minute_tokens := v_row.minute_tokens;
    end if;

    if v_now - v_row.day_started_at >= interval '24 hours' then
        v_day_started := v_now;
        v_day_requests := 0;
        v_day_tokens := 0;
    else
        v_day_started := v_row.day_started_at;
        v_day_requests := v_row.day_requests;
        v_day_tokens := v_row.day_tokens;
    end if;

    v_minute_blocked := v_minute_requests + 1 > greatest(1, p_rpm)
        or v_minute_tokens + greatest(1, p_estimated_tokens) > greatest(1, p_tpm);
    v_day_blocked := v_day_requests + 1 > greatest(1, p_rpd)
        or v_day_tokens + greatest(1, p_estimated_tokens) > greatest(1, p_tpd);

    if v_minute_blocked then
        v_retry_after_ms := greatest(v_retry_after_ms, ceil(extract(epoch from (v_minute_started + interval '60 seconds' - v_now)) * 1000)::integer);
    end if;
    if v_day_blocked then
        v_retry_after_ms := greatest(v_retry_after_ms, ceil(extract(epoch from (v_day_started + interval '24 hours' - v_now)) * 1000)::integer);
    end if;

    if not v_minute_blocked and not v_day_blocked then
        v_minute_requests := v_minute_requests + 1;
        v_minute_tokens := v_minute_tokens + greatest(1, p_estimated_tokens);
        v_day_requests := v_day_requests + 1;
        v_day_tokens := v_day_tokens + greatest(1, p_estimated_tokens);
    end if;

    update public.ai_gateway_capacity
    set minute_started_at = v_minute_started,
        minute_requests = v_minute_requests,
        minute_tokens = v_minute_tokens,
        day_started_at = v_day_started,
        day_requests = v_day_requests,
        day_tokens = v_day_tokens,
        updated_at = v_now
    where bucket_key = left(p_bucket_key, 240);

    return jsonb_build_object(
        'allowed', not v_minute_blocked and not v_day_blocked,
        'retry_after_ms', greatest(0, v_retry_after_ms),
        'minute_requests', v_minute_requests,
        'minute_tokens', v_minute_tokens,
        'day_requests', v_day_requests,
        'day_tokens', v_day_tokens
    );
end;
$$;

revoke all on function public.reserve_ai_gateway_capacity(text, integer, bigint, integer, bigint, integer) from public, anon, authenticated;
grant execute on function public.reserve_ai_gateway_capacity(text, integer, bigint, integer, bigint, integer) to service_role;
