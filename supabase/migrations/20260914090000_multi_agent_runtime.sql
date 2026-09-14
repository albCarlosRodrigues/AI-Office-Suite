-- Runtime-verifiable orchestration contracts and fenced mission leases.
alter table public.missions add column if not exists lease_version bigint not null default 0;
alter table public.missions add column if not exists mission_contract jsonb;
alter table public.tasks add column if not exists task_contract jsonb;
alter table public.provider_secrets add column if not exists secret_ref text;

create or replace function public.claim_mission_step(
  p_mission_id uuid,
  p_worker_id uuid,
  p_lease_seconds integer default 180
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare claimed public.missions;
begin
  update public.missions
     set current_step = current_step + 1,
         lease_version = lease_version + 1,
         step_lock_id = p_worker_id,
         step_locked_until = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 600)))
   where id = p_mission_id
     and current_step < max_steps
     and (step_lock_id is null or step_locked_until is null or step_locked_until < now())
   returning * into claimed;
  if claimed.id is null then return null; end if;
  return jsonb_build_object(
    'mission', to_jsonb(claimed),
    'leaseId', p_worker_id,
    'leaseVersion', claimed.lease_version,
    'expiresAt', claimed.step_locked_until
  );
end;
$$;
grant execute on function public.claim_mission_step(uuid, uuid, integer) to authenticated, service_role;

-- Fencing-aware release. A stale owner/version cannot release a newer lease.
create or replace function public.release_mission_step(
  p_mission_id uuid,
  p_worker_id uuid,
  p_lease_version bigint default null
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.missions set step_lock_id = null, step_locked_until = null
   where id = p_mission_id
     and step_lock_id = p_worker_id
     and (p_lease_version is null or lease_version = p_lease_version);
  return found;
end;
$$;
grant execute on function public.release_mission_step(uuid, uuid, bigint) to authenticated, service_role;
