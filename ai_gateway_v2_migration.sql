-- AI gateway v2: encrypted credential metadata and durable usage accounting.
-- Configure AI_CREDENTIALS_ENCRYPTION_KEY before adding credentials via admin.

create table if not exists public.ai_provider_credentials (
    id text primary key,
    provider text not null check (provider in ('bai','gemini','groq','nvidia','cloudflare','mistral','openrouter','cerebras','custom')),
    label text not null,
    project_id text,
    account_id text,
    quota_group_id text,
    base_url text,
    model text,
    priority integer not null default 100,
    weight numeric not null default 1,
    enabled boolean not null default true,
    quota_rpm integer,
    quota_tpm bigint,
    quota_rpd integer,
    quota_tpd bigint,
    max_concurrency integer,
    timeout_ms integer,
    max_queue_ms integer,
    input_cost_per_million numeric,
    output_cost_per_million numeric,
    secret_ciphertext text not null,
    secret_iv text not null,
    secret_tag text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists ai_provider_credentials_provider_enabled_idx
    on public.ai_provider_credentials(provider, enabled, priority, id);
alter table public.ai_provider_credentials
    add column if not exists account_id text,
    add column if not exists quota_group_id text;

create index if not exists ai_provider_credentials_quota_group_idx
    on public.ai_provider_credentials(provider, quota_group_id, enabled, priority, id);

create table if not exists public.ai_gateway_usage_events (
    id uuid primary key default gen_random_uuid(),
    occurred_at timestamptz not null default now(),
    provider text not null,
    model text not null,
    credential_id text,
    quota_group_id text not null,
    project_id text,
    role text,
    tier text,
    status text not null check (status in ('attempt','retry','success','error','skipped')),
    request_count integer not null default 1,
    duration_ms integer not null default 0,
    estimated_input_tokens bigint not null default 0,
    input_tokens bigint not null default 0,
    output_tokens bigint not null default 0,
    reasoning_tokens bigint not null default 0,
    context_tokens bigint not null default 0,
    total_tokens bigint not null default 0,
    estimated_cost_usd numeric not null default 0,
    http_status integer,
    error_kind text,
    error_message text,
    cooldown_until timestamptz,
    provider_request_id text,
    metadata jsonb not null default '{}'::jsonb
);

alter table public.ai_gateway_usage_events
    add column if not exists request_count integer not null default 1;

alter table public.ai_gateway_usage_events
    drop constraint if exists ai_gateway_usage_events_status_check;
alter table public.ai_gateway_usage_events
    add constraint ai_gateway_usage_events_status_check
    check (status in ('attempt','retry','success','error','skipped'));

create index if not exists ai_gateway_usage_quota_time_idx
    on public.ai_gateway_usage_events(quota_group_id, model, occurred_at desc);
create index if not exists ai_gateway_usage_provider_time_idx
    on public.ai_gateway_usage_events(provider, model, occurred_at desc);
create index if not exists ai_gateway_usage_credential_time_idx
    on public.ai_gateway_usage_events(credential_id, occurred_at desc);

alter table public.ai_provider_credentials enable row level security;
alter table public.ai_gateway_usage_events enable row level security;
revoke all on public.ai_provider_credentials from anon, authenticated;
revoke all on public.ai_gateway_usage_events from anon, authenticated;
grant all on public.ai_provider_credentials to service_role;
grant all on public.ai_gateway_usage_events to service_role;

create or replace view public.ai_gateway_usage_rolling
with (security_invoker = true)
as
with scoped_events as (
    select
        events.*,
        case
            when provider = 'gemini' then
                date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles'
            else now() - interval '24 hours'
        end as daily_window_start
    from public.ai_gateway_usage_events events
    where occurred_at >= now() - interval '24 hours'
)
select
    provider,
    model,
    credential_id,
    quota_group_id,
    project_id,
    coalesce(sum(request_count) filter (where occurred_at >= now() - interval '1 minute' and status <> 'skipped'), 0)::bigint as minute_requests,
    coalesce(sum(total_tokens) filter (where occurred_at >= now() - interval '1 minute'), 0)::bigint as minute_tokens,
    coalesce(sum(request_count) filter (where occurred_at >= daily_window_start and status <> 'skipped'), 0)::bigint as day_requests,
    coalesce(sum(input_tokens) filter (where occurred_at >= daily_window_start), 0)::bigint as day_input_tokens,
    coalesce(sum(output_tokens) filter (where occurred_at >= daily_window_start), 0)::bigint as day_output_tokens,
    coalesce(sum(reasoning_tokens) filter (where occurred_at >= daily_window_start), 0)::bigint as day_reasoning_tokens,
    coalesce(sum(context_tokens) filter (where occurred_at >= daily_window_start), 0)::bigint as day_context_tokens,
    coalesce(sum(total_tokens) filter (where occurred_at >= daily_window_start), 0)::bigint as day_total_tokens,
    coalesce(sum(estimated_cost_usd) filter (where occurred_at >= daily_window_start), 0)::numeric as day_estimated_cost_usd,
    count(*) filter (where occurred_at >= daily_window_start and status = 'success')::bigint as successes,
    count(*) filter (where occurred_at >= daily_window_start and status = 'error')::bigint as errors,
    count(*) filter (where occurred_at >= daily_window_start and http_status = 429)::bigint as errors_429,
    count(*) filter (where occurred_at >= daily_window_start and http_status between 500 and 599)::bigint as errors_5xx,
    max(occurred_at) as last_event_at,
    max(cooldown_until) filter (where cooldown_until > now()) as cooldown_until
from scoped_events
group by provider, model, credential_id, quota_group_id, project_id;

revoke all on public.ai_gateway_usage_rolling from anon, authenticated;
grant select on public.ai_gateway_usage_rolling to service_role;

-- Retenção explícita para evitar crescimento infinito da telemetria. Agende
-- esta função diariamente no Supabase Cron quando quiser outro prazo.
create or replace function public.prune_ai_gateway_usage_events(p_retention_days integer default 90)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_deleted bigint;
begin
    if p_retention_days < 7 or p_retention_days > 3650 then
        raise exception 'retention_days_must_be_between_7_and_3650';
    end if;
    delete from public.ai_gateway_usage_events
    where occurred_at < now() - make_interval(days => p_retention_days);
    get diagnostics v_deleted = row_count;
    return v_deleted;
end;
$$;

revoke all on function public.prune_ai_gateway_usage_events(integer) from public, anon, authenticated;
grant execute on function public.prune_ai_gateway_usage_events(integer) to service_role;
