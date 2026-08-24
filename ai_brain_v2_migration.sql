-- Lari Master Brain V2
-- Camadas append-only + projecoes deterministicas. Esta migracao so adiciona
-- estruturas; o fluxo legado continua funcionando durante o rollout.

create table if not exists public.lead_events (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.sessions(id) on delete cascade,
    event_type text not null,
    source text not null default 'backend',
    source_id text,
    payload jsonb not null default '{}'::jsonb,
    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint lead_events_type_not_blank check (length(trim(event_type)) > 0),
    constraint lead_events_source_not_blank check (length(trim(source)) > 0)
);

-- PostgreSQL permite vários NULL em índice UNIQUE. Sem predicado parcial, o
-- PostgREST consegue inferir este índice no upsert(onConflict), mantendo
-- idempotência quando source_id existe e aceitando eventos sem source_id.
create unique index if not exists lead_events_idempotency_idx
    on public.lead_events(session_id, event_type, source_id);
create index if not exists lead_events_session_time_idx
    on public.lead_events(session_id, occurred_at desc, id desc);
create index if not exists lead_events_type_time_idx
    on public.lead_events(event_type, occurred_at desc);

create table if not exists public.lead_reality_states (
    session_id uuid primary key references public.sessions(id) on delete cascade,
    version bigint not null default 0,
    adult_verified boolean not null default false,
    payment jsonb not null default '{}'::jsonb,
    media jsonb not null default '{}'::jsonb,
    commercial jsonb not null default '{}'::jsonb,
    meeting jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

create table if not exists public.lead_twins (
    session_id uuid primary key references public.sessions(id) on delete cascade,
    version bigint not null default 0,
    relationship jsonb not null default '{}'::jsonb,
    conversation_style jsonb not null default '{}'::jsonb,
    interests jsonb not null default '{}'::jsonb,
    media_preferences jsonb not null default '{}'::jsonb,
    commercial jsonb not null default '{}'::jsonb,
    open_loops jsonb not null default '[]'::jsonb,
    updated_at timestamptz not null default now()
);

create table if not exists public.lead_episode_states (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.sessions(id) on delete cascade,
    episode_key text not null,
    status text not null default 'active' check (status in ('active', 'closed', 'compacted')),
    topic text,
    summary text,
    open_loops jsonb not null default '[]'::jsonb,
    momentum numeric not null default 0 check (momentum >= 0 and momentum <= 1),
    important_outcomes jsonb not null default '[]'::jsonb,
    started_at timestamptz not null default now(),
    ended_at timestamptz,
    updated_at timestamptz not null default now(),
    unique(session_id, episode_key)
);
create index if not exists lead_episode_states_active_idx
    on public.lead_episode_states(session_id, status, updated_at desc);

create table if not exists public.lead_memory_items (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.sessions(id) on delete cascade,
    episode_id uuid references public.lead_episode_states(id) on delete set null,
    kind text not null check (kind in ('fact', 'hypothesis', 'preference', 'episode', 'outcome')),
    status text not null default 'active' check (status in ('active', 'superseded', 'uncertain', 'expired')),
    memory_key text not null,
    content text not null,
    value jsonb not null default '{}'::jsonb,
    confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
    importance numeric not null default 0.5 check (importance >= 0 and importance <= 1),
    source_event_id uuid references public.lead_events(id) on delete set null,
    superseded_by uuid references public.lead_memory_items(id) on delete set null,
    valid_from timestamptz not null default now(),
    valid_until timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists lead_memory_items_retrieval_idx
    on public.lead_memory_items(session_id, status, kind, updated_at desc);
create index if not exists lead_memory_items_key_idx
    on public.lead_memory_items(session_id, memory_key, status);

create table if not exists public.ai_decisions (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.sessions(id) on delete cascade,
    source_event_id uuid references public.lead_events(id) on delete set null,
    model text,
    provider text,
    next_best_action text not null,
    legacy_action text not null default 'none',
    confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
    preview_id uuid references public.preview_assets(id) on delete set null,
    offer_id text,
    state_snapshot jsonb not null default '{}'::jsonb,
    validator_result jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);
create index if not exists ai_decisions_session_time_idx
    on public.ai_decisions(session_id, created_at desc);

create table if not exists public.ai_outcomes (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.sessions(id) on delete cascade,
    decision_id uuid references public.ai_decisions(id) on delete set null,
    event_id uuid references public.lead_events(id) on delete set null,
    outcome_type text not null,
    reward numeric not null default 0,
    horizon text not null default 'immediate' check (horizon in ('immediate', 'next_turn', 'next_day', 'seven_day', 'lifetime')),
    metadata jsonb not null default '{}'::jsonb,
    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);
create index if not exists ai_outcomes_session_time_idx
    on public.ai_outcomes(session_id, occurred_at desc);
create index if not exists ai_outcomes_decision_idx
    on public.ai_outcomes(decision_id, occurred_at desc);

alter table public.preview_assets
    add column if not exists performance jsonb not null default '{"sent":0,"positive_reactions":0,"followups":0,"purchases":0}'::jsonb,
    add column if not exists exploration_weight numeric not null default 0.05,
    add column if not exists last_sent_at timestamptz;

alter table public.lead_events enable row level security;
alter table public.lead_reality_states enable row level security;
alter table public.lead_twins enable row level security;
alter table public.lead_episode_states enable row level security;
alter table public.lead_memory_items enable row level security;
alter table public.ai_decisions enable row level security;
alter table public.ai_outcomes enable row level security;

revoke all on public.lead_events, public.lead_reality_states, public.lead_twins,
    public.lead_episode_states, public.lead_memory_items, public.ai_decisions,
    public.ai_outcomes from anon, authenticated;
grant all on public.lead_events, public.lead_reality_states, public.lead_twins,
    public.lead_episode_states, public.lead_memory_items, public.ai_decisions,
    public.ai_outcomes to service_role;
