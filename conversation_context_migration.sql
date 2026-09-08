-- Janela curta de conversa + checkpoint durável do Master Brain V2.
-- O checkpoint é uma projeção compacta; eventos e mensagens continuam sendo a
-- fonte auditável, enquanto o modelo lê somente o necessário por turno.

create table if not exists public.lead_conversation_checkpoints (
    session_id uuid primary key references public.sessions(id) on delete cascade,
    summary text not null default '',
    through_message_id uuid not null,
    through_message_at timestamptz not null,
    open_loops jsonb not null default '[]'::jsonb,
    commitments jsonb not null default '[]'::jsonb,
    updated_at timestamptz not null default now(),
    constraint lead_conversation_checkpoints_summary_limit check (char_length(summary) <= 1200),
    constraint lead_conversation_checkpoints_open_loops_array check (case when jsonb_typeof(open_loops) = 'array' then jsonb_array_length(open_loops) <= 5 else false end),
    constraint lead_conversation_checkpoints_commitments_array check (case when jsonb_typeof(commitments) = 'array' then jsonb_array_length(commitments) <= 3 else false end)
);

alter table public.lead_conversation_checkpoints enable row level security;
revoke all on public.lead_conversation_checkpoints from anon, authenticated;
grant all on public.lead_conversation_checkpoints to service_role;

-- Marcador monotônico: retries do mesmo balão são idempotentes e um job antigo
-- não pode sobrescrever um checkpoint mais novo.
create or replace function public.upsert_lead_conversation_checkpoint(
    p_session_id uuid,
    p_through_message_id uuid,
    p_through_message_at timestamptz,
    p_summary text,
    p_open_loops jsonb,
    p_commitments jsonb,
    p_expected_previous_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    affected integer;
begin
    -- Leitura/atualização por sessão serializadas; compare-and-swap impede que
    -- um resumo baseado numa versão antiga apague o que outro turno resumiu.
    perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));
    if exists (
        select 1 from public.lead_conversation_checkpoints
        where session_id = p_session_id and through_message_id = p_through_message_id
    ) then return true; end if;
    if exists (
        select 1 from public.lead_conversation_checkpoints
        where session_id = p_session_id
        and through_message_id is distinct from p_expected_previous_id
    ) then return false; end if;
    insert into public.lead_conversation_checkpoints (
        session_id,
        summary,
        through_message_id,
        through_message_at,
        open_loops,
        commitments,
        updated_at
    ) values (
        p_session_id,
        left(coalesce(p_summary, ''), 1200),
        p_through_message_id,
        p_through_message_at,
        coalesce(p_open_loops, '[]'::jsonb),
        coalesce(p_commitments, '[]'::jsonb),
        now()
    )
    on conflict (session_id) do update set
        summary = excluded.summary,
        through_message_id = excluded.through_message_id,
        through_message_at = excluded.through_message_at,
        open_loops = excluded.open_loops,
        commitments = excluded.commitments,
        updated_at = case
            when excluded.through_message_id = lead_conversation_checkpoints.through_message_id
                then lead_conversation_checkpoints.updated_at
            else now()
        end
    where (excluded.through_message_at, excluded.through_message_id)
        > (lead_conversation_checkpoints.through_message_at, lead_conversation_checkpoints.through_message_id);
    get diagnostics affected = row_count;
    return affected > 0;
end;
$$;

revoke all on function public.upsert_lead_conversation_checkpoint(uuid, uuid, timestamptz, text, jsonb, jsonb, uuid) from public;
grant execute on function public.upsert_lead_conversation_checkpoint(uuid, uuid, timestamptz, text, jsonb, jsonb, uuid) to service_role;

-- Mantém a cauda operacional limitada à leitura indexada por sessão.
create index if not exists messages_session_created_id_desc_idx
    on public.messages(session_id, created_at desc, id desc);
