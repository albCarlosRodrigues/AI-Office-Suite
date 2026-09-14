-- Final slice: distributed cancellation, operational health, supervision and tracing.
alter table public.tool_requests add column if not exists cancellation_version bigint not null default 0;

create table if not exists public.cancellation_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  agent_run_id uuid,
  scope_type text not null check (scope_type in ('MISSION','TASK','AGENT_RUN')),
  scope_id uuid not null,
  status text not null default 'REQUESTED' check (status in ('REQUESTED','OBSERVED','COMPLETED')),
  reason text not null,
  requested_at timestamptz not null default now(),
  requested_by text not null,
  version bigint not null,
  unique(scope_type, scope_id, version)
);
create index if not exists cancellation_tokens_mission_idx
  on public.cancellation_tokens(mission_id, requested_at desc);

create table if not exists public.backend_health (
  backend_id text primary key,
  provider text not null,
  model text not null,
  configured boolean not null default false,
  credentials_available boolean not null default false,
  enabled boolean not null default true,
  circuit_state text not null default 'CLOSED' check (circuit_state in ('CLOSED','OPEN','HALF_OPEN')),
  consecutive_failures integer not null default 0,
  successes bigint not null default 0,
  failures bigint not null default 0,
  latencies_ms jsonb not null default '[]'::jsonb,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  rate_limited_until timestamptz,
  circuit_opened_at timestamptz,
  last_error_code text,
  updated_at timestamptz not null default now()
);

create table if not exists public.worker_heartbeats (
  worker_id text primary key,
  worker_type text not null check (worker_type in ('MISSION','TOOL','OUTBOX','RECOVERY','HEALTH')),
  started_at timestamptz not null,
  heartbeat_at timestamptz not null,
  status text not null check (status in ('STARTING','RUNNING','DEGRADED','STOPPING','STOPPED','FAILED')),
  current_work text,
  restart_count integer not null default 0,
  last_error text
);

create table if not exists public.runtime_traces (
  span_id uuid primary key,
  trace_id uuid not null,
  parent_span_id uuid,
  name text not null,
  recorded_at timestamptz not null default now(),
  duration_ms double precision,
  status text not null,
  mission_id uuid,
  task_id uuid,
  agent_id uuid,
  provider text,
  model text,
  tool_call_id uuid,
  attributes jsonb not null default '{}'::jsonb
);
create index if not exists runtime_traces_trace_idx on public.runtime_traces(trace_id, recorded_at);

create table if not exists public.recovery_history (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  reason text not null,
  original_state text not null,
  new_state text not null,
  recorded_at timestamptz not null default now()
);

create or replace function public.cancel_runtime_scope(
  p_organization_id uuid, p_mission_id uuid, p_task_id uuid, p_agent_run_id uuid,
  p_reason text, p_requested_by text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_scope_type text; v_scope_id uuid; v_version bigint; saved public.cancellation_tokens;
begin
  v_scope_type := case when p_agent_run_id is not null then 'AGENT_RUN'
                       when p_task_id is not null then 'TASK' else 'MISSION' end;
  v_scope_id := coalesce(p_agent_run_id, p_task_id, p_mission_id);
  perform pg_advisory_xact_lock(hashtextextended(v_scope_type || ':' || v_scope_id::text, 0));
  select coalesce(max(version), 0) + 1 into v_version from public.cancellation_tokens
    where scope_type = v_scope_type and scope_id = v_scope_id;
  insert into public.cancellation_tokens(organization_id, mission_id, task_id, agent_run_id,
    scope_type, scope_id, reason, requested_by, version)
    values (p_organization_id, p_mission_id, p_task_id, p_agent_run_id,
      v_scope_type, v_scope_id, p_reason, p_requested_by, v_version) returning * into saved;
  if v_scope_type = 'MISSION' then
    update public.missions set status = 'CANCELLED', updated_at = now() where id = p_mission_id;
  end if;
  update public.tasks set status = 'CANCELLED', updated_at = now()
    where mission_id = p_mission_id and status <> 'COMPLETED'
      and (v_scope_type = 'MISSION' or id = p_task_id);
  update public.tool_requests set status = 'CANCELLED', completed_at = now()
    where mission_id = p_mission_id and status in ('REQUESTED','WAITING_APPROVAL','READY')
      and (v_scope_type = 'MISSION' or task_id = p_task_id);
  update public.budget_reservations set status = 'RELEASED', reconciled_at = now()
    where mission_id = p_mission_id and status = 'RESERVED';
  return to_jsonb(saved);
end $$;

grant execute on function public.cancel_runtime_scope(uuid, uuid, uuid, uuid, text, text)
  to authenticated, service_role;
