-- Orchestration hardening: durable worker claims, explicit execution mode,
-- idempotency and three distinct approval scopes.
create type public.execution_mode as enum ('SIMULATION', 'REAL');
create type public.approval_scope as enum ('ONCE', 'MISSION', 'PERSISTENT');
alter type public.provider_health add value if not exists 'DEGRADED';
alter type public.provider_health add value if not exists 'UNCONFIGURED';
alter type public.provider_health add value if not exists 'ERROR';

with permission_map(old_permission, new_permission) as (values
  ('read_files','repository.read'), ('write_files','repository.write'), ('execute_shell','shell.execute'),
  ('access_github','github.pr.create'), ('create_branch','git.branch.create'), ('commit_code','git.commit'),
  ('open_pull_request','github.pr.create'), ('run_tests','tests.execute'), ('browse_web','web.browse'),
  ('query_database','database.read'), ('write_database','database.write'), ('deploy_staging','deploy.staging'),
  ('deploy_production','deploy.production'), ('send_email','email.send')
)
insert into public.agent_permissions (organization_id, agent_id, permission, granted, always_allow, granted_by, created_at)
select p.organization_id, p.agent_id, m.new_permission, bool_or(p.granted), bool_or(p.always_allow), max(p.granted_by::text)::uuid, min(p.created_at)
from public.agent_permissions p join permission_map m on m.old_permission = p.permission
group by p.organization_id, p.agent_id, m.new_permission
on conflict (agent_id, permission) do update set
  granted = excluded.granted, always_allow = excluded.always_allow, granted_by = excluded.granted_by;

delete from public.agent_permissions where permission in (
  'read_files','write_files','execute_shell','access_github','create_branch','commit_code','open_pull_request',
  'run_tests','browse_web','query_database','write_database','deploy_staging','deploy_production','send_email'
);

update public.organization_settings set require_approval_for =
  array_replace(array_replace(array_replace(array_replace(require_approval_for,
    'execute_shell', 'shell.execute'), 'write_database', 'database.write'),
    'deploy_production', 'deploy.production'), 'send_email', 'email.send');

alter table public.missions add column execution_mode public.execution_mode not null default 'SIMULATION';
alter table public.missions add column step_lock_id uuid;
alter table public.missions add column step_locked_until timestamptz;
alter table public.commands add column execution_mode public.execution_mode not null default 'SIMULATION';
alter table public.commands add column idempotency_key text;
alter table public.agent_runs add column execution_mode public.execution_mode not null default 'SIMULATION';
alter table public.agent_runs add column idempotency_key text;
alter table public.tool_calls add column execution_mode public.execution_mode not null default 'SIMULATION';
alter table public.tool_calls add column idempotency_key text;
alter table public.approval_requests add column approval_scope public.approval_scope not null default 'ONCE';
alter table public.tasks add column claimed_by_run_id uuid;
alter table public.tasks add column claimed_at timestamptz;

update public.missions set execution_mode = case when is_simulated then 'SIMULATION'::public.execution_mode else 'REAL'::public.execution_mode end;
update public.agent_runs set execution_mode = case when is_simulated then 'SIMULATION'::public.execution_mode else 'REAL'::public.execution_mode end;

create unique index commands_idempotency_key_unique on public.commands (mission_id, idempotency_key);
create unique index agent_runs_idempotency_key_unique on public.agent_runs (mission_id, idempotency_key);
create unique index tool_calls_idempotency_key_unique on public.tool_calls (mission_id, idempotency_key);
create unique index command_results_one_per_command on public.command_results (command_id);

create table public.mission_permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  permission text not null,
  granted_by uuid,
  created_at timestamptz not null default now(),
  unique (mission_id, agent_id, permission)
);

grant select, insert, delete on public.mission_permissions to authenticated;
grant all on public.mission_permissions to service_role;
alter table public.mission_permissions enable row level security;
create policy "mission_permissions_all" on public.mission_permissions for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- Atomic task claim used by stateless workers. A duplicate worker receives no row.
create or replace function public.claim_mission_task(p_task_id uuid, p_run_id uuid)
returns public.tasks
language plpgsql
security invoker
set search_path = public
as $$
declare claimed public.tasks;
begin
  update public.tasks
     set status = 'running', claimed_by_run_id = p_run_id, claimed_at = now(),
         started_at = coalesce(started_at, now()), completed_at = null
   where id = p_task_id and status = 'queued' and claimed_by_run_id is null
   returning * into claimed;
  return claimed;
end;
$$;
grant execute on function public.claim_mission_task(uuid, uuid) to authenticated, service_role;

-- Claims are released only for explicit retry/requeue paths.
create or replace function public.release_mission_task_claim(p_task_id uuid, p_run_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.tasks set claimed_by_run_id = null, claimed_at = null
   where id = p_task_id and claimed_by_run_id = p_run_id;
  return found;
end;
$$;
grant execute on function public.release_mission_task_claim(uuid, uuid) to authenticated, service_role;

-- A lease protects the complete state-machine step, including provider I/O.
create or replace function public.claim_mission_step(p_mission_id uuid, p_worker_id uuid, p_lease_seconds integer default 180)
returns public.missions
language plpgsql
security invoker
set search_path = public
as $$
declare claimed public.missions;
begin
  update public.missions
     set current_step = current_step + 1,
         step_lock_id = p_worker_id,
         step_locked_until = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 600)))
   where id = p_mission_id
     and (step_lock_id is null or step_locked_until is null or step_locked_until < now())
   returning * into claimed;
  return claimed;
end;
$$;
grant execute on function public.claim_mission_step(uuid, uuid, integer) to authenticated, service_role;

create or replace function public.release_mission_step(p_mission_id uuid, p_worker_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.missions set step_lock_id = null, step_locked_until = null
   where id = p_mission_id and step_lock_id = p_worker_id;
  return found;
end;
$$;
grant execute on function public.release_mission_step(uuid, uuid) to authenticated, service_role;
