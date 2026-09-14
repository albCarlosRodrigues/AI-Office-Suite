-- Slice 3: durable delivery, fencing, idempotency, approvals, budgets, rate limits and outbox.
create table if not exists public.tool_requests (
  tool_call_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  command_id uuid references public.commands(id) on delete set null,
  agent_run_id uuid,
  agent_id uuid references public.agents(id) on delete set null,
  tool_id text not null,
  arguments jsonb not null default '{}'::jsonb,
  input_hash text not null,
  risk_level integer not null,
  approval_policy text not null,
  policy_version text not null,
  status text not null check (status in ('REQUESTED','WAITING_APPROVAL','READY','CLAIMED','RUNNING','COMPLETED','FAILED','CANCELLED','DENIED','DEAD_LETTER')),
  attempt integer not null default 0,
  max_attempts integer not null default 3,
  created_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  claimed_by text,
  claim_token uuid,
  claim_version bigint not null default 0,
  claim_expires_at timestamptz,
  heartbeat_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  idempotency_key text not null unique,
  tool_result_id uuid,
  failure_code text,
  failure_message text,
  failure_history jsonb not null default '[]'::jsonb
);

create table if not exists public.tool_results (
  id uuid primary key default gen_random_uuid(),
  tool_call_id uuid not null unique references public.tool_requests(tool_call_id) on delete cascade,
  result jsonb not null,
  recovered_effect boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.tool_requests drop constraint if exists tool_requests_tool_result_id_fkey;
alter table public.tool_requests add constraint tool_requests_tool_result_id_fkey
  foreign key (tool_result_id) references public.tool_results(id) on delete set null;

create table if not exists public.idempotency_records (
  idempotency_key text primary key,
  operation_type text not null,
  status text not null check (status in ('RESERVED','RUNNING','COMPLETED','FAILED_RETRYABLE','FAILED_FINAL')),
  result_ref text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.approval_requests add column if not exists tool_call_id uuid;
alter table public.approval_requests add column if not exists expires_at timestamptz;
alter table public.approval_requests add column if not exists decision text;
alter table public.approval_requests add column if not exists decision_by uuid;
alter table public.approval_requests add column if not exists decision_at timestamptz;
alter table public.approval_requests add column if not exists policy_snapshot jsonb;
alter table public.approval_requests add column if not exists input_hash text;
alter table public.approval_requests add column if not exists policy_version text;

create table if not exists public.budget_reservations (
  reservation_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  provider text not null,
  model text not null,
  estimated_input_tokens bigint not null,
  reserved_output_tokens bigint not null,
  reserved_cost numeric(14,6) not null,
  status text not null check (status in ('RESERVED','CONSUMED','RELEASED','EXPIRED')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reconciled_at timestamptz,
  actual_tokens bigint,
  actual_cost numeric(14,6)
);

create table if not exists public.rate_limit_state (
  key text primary key,
  provider text not null,
  model text not null,
  window_started_at timestamptz not null,
  window_ms bigint not null,
  requests_consumed bigint not null default 0,
  tokens_consumed bigint not null default 0,
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  version bigint not null default 0
);

create table if not exists public.outbox_events (
  event_id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  attempt integer not null default 0
);
create table if not exists public.processed_events (
  consumer text not null,
  event_id uuid not null references public.outbox_events(event_id) on delete cascade,
  processed_at timestamptz not null default now(),
  primary key (consumer, event_id)
);
create table if not exists public.runtime_metrics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  value double precision not null,
  recorded_at timestamptz not null default now(),
  mission_id uuid,
  task_id uuid,
  command_id uuid,
  agent_run_id uuid,
  tool_call_id uuid,
  attributes jsonb not null default '{}'::jsonb
);

create index if not exists tool_requests_ready_idx on public.tool_requests(status, available_at, created_at);
create index if not exists tool_requests_lease_idx on public.tool_requests(status, claim_expires_at);
create index if not exists outbox_unpublished_idx on public.outbox_events(created_at) where published_at is null;
create index if not exists budget_active_idx on public.budget_reservations(mission_id, status);

create or replace function public.claim_tool_request(p_worker_id text, p_lease_seconds integer default 60)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare claimed public.tool_requests;
begin
  with candidate as (
    select tool_call_id from public.tool_requests
     where status = 'READY' and available_at <= now()
     order by created_at for update skip locked limit 1
  )
  update public.tool_requests r
     set status = 'CLAIMED', claimed_by = p_worker_id, claim_token = gen_random_uuid(),
         claim_version = claim_version + 1, claim_expires_at = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 600))),
         heartbeat_at = now(), attempt = attempt + 1
    from candidate c where r.tool_call_id = c.tool_call_id returning r.* into claimed;
  if claimed.tool_call_id is null then return null; end if;
  update public.idempotency_records set status = 'RUNNING'
   where idempotency_key = claimed.idempotency_key and status <> 'COMPLETED';
  return to_jsonb(claimed);
end $$;

create or replace function public.complete_tool_request(
  p_tool_call_id uuid, p_claim_token uuid, p_claim_version bigint, p_result jsonb, p_recovered_effect boolean default false
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare request public.tool_requests; saved public.tool_results;
begin
  select * into request from public.tool_requests
   where tool_call_id = p_tool_call_id and claim_token = p_claim_token and claim_version = p_claim_version
   for update;
  if request.tool_call_id is null then raise exception 'STALE_TOOL_LEASE'; end if;
  if exists(select 1 from public.missions where id = request.mission_id and status = 'CANCELLED')
    then raise exception 'MISSION_CANCELLED'; end if;
  insert into public.tool_results(tool_call_id, result, recovered_effect)
    values (p_tool_call_id, p_result, p_recovered_effect)
    on conflict (tool_call_id) do update set result = excluded.result
    returning * into saved;
  update public.tool_requests set status = 'COMPLETED', tool_result_id = saved.id, completed_at = now()
   where tool_call_id = p_tool_call_id;
  update public.idempotency_records set status = 'COMPLETED', result_ref = saved.id::text, completed_at = now()
   where idempotency_key = request.idempotency_key;
  insert into public.outbox_events(event_type, aggregate_type, aggregate_id, payload)
    values ('TOOL_COMPLETED', 'tool_request', p_tool_call_id::text, jsonb_build_object('resultId', saved.id));
  return to_jsonb(saved);
end $$;

grant execute on function public.claim_tool_request(text, integer) to authenticated, service_role;
grant execute on function public.complete_tool_request(uuid, uuid, bigint, jsonb, boolean) to authenticated, service_role;
