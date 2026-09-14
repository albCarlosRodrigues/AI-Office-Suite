-- ===== ENUMS =====
create type public.app_role as enum ('owner','admin','member');
create type public.agent_status as enum ('IDLE','WALKING','THINKING','WORKING','WAITING','DELEGATING','REVIEWING','MEETING','NEEDS_APPROVAL','ERROR','OFFLINE','PAUSED');
create type public.agent_kind as enum ('llm','external','controller');
create type public.mission_status as enum ('DRAFT','PLANNING','RUNNING','WAITING_APPROVAL','REVIEWING','COMPLETED','FAILED','STOPPED');
create type public.task_status as enum ('queued','running','completed','failed','waiting','blocked','cancelled');
create type public.command_status as enum ('PENDING','ACCEPTED','RUNNING','COMPLETED','FAILED','BLOCKED','NEEDS_CLARIFICATION','REQUEST_PERMISSION','REQUEST_SCOPE_EXTENSION','CANCELLED');
create type public.approval_status as enum ('PENDING','APPROVED','DENIED','MODIFIED','EXPIRED');
create type public.risk_level as enum ('LOW','MEDIUM','HIGH','CRITICAL');
create type public.provider_type as enum ('simulation','lovable_ai','openai','anthropic','gemini','openrouter','ollama','custom');
create type public.provider_health as enum ('UNKNOWN','CONNECTED','FAILED','TIMEOUT','UNAUTHORIZED','OFFLINE','DISABLED');

-- ===== HELPERS =====
create or replace function public.update_updated_at_column()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

-- ===== PROFILES =====
create table public.profiles (
  id uuid primary key,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles_select_own" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ===== ORGANIZATIONS =====
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_id uuid not null,
  simulation_mode boolean not null default true,
  kill_switch_active boolean not null default false,
  asset_mode text not null default 'auto',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  role public.app_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create or replace function public.is_org_member(_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organization_members where organization_id = _org and user_id = auth.uid())
$$;
create or replace function public.has_org_role(_org uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organization_members where organization_id = _org and user_id = auth.uid() and role = _role)
$$;

grant select, insert, update, delete on public.organizations to authenticated;
grant all on public.organizations to service_role;
grant select, insert, update, delete on public.organization_members to authenticated;
grant all on public.organization_members to service_role;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
create policy "orgs_select_member" on public.organizations for select to authenticated using (public.is_org_member(id));
create policy "orgs_update_admin" on public.organizations for update to authenticated using (public.has_org_role(id,'owner') or public.has_org_role(id,'admin'));
create policy "orgs_delete_owner" on public.organizations for delete to authenticated using (public.has_org_role(id,'owner'));
create policy "members_select" on public.organization_members for select to authenticated using (user_id = auth.uid() or public.is_org_member(organization_id));
create policy "members_insert_admin" on public.organization_members for insert to authenticated with check (public.has_org_role(organization_id,'owner') or public.has_org_role(organization_id,'admin'));
create policy "members_update_admin" on public.organization_members for update to authenticated using (public.has_org_role(organization_id,'owner') or public.has_org_role(organization_id,'admin'));
create policy "members_delete_admin" on public.organization_members for delete to authenticated using (public.has_org_role(organization_id,'owner') or public.has_org_role(organization_id,'admin') or user_id = auth.uid());
create trigger organizations_updated_at before update on public.organizations for each row execute function public.update_updated_at_column();

create table public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  policies jsonb not null default '[]'::jsonb,
  max_mission_cost numeric not null default 5,
  max_steps integer not null default 40,
  max_agent_calls integer not null default 60,
  max_delegation_depth integer not null default 4,
  max_meeting_rounds integer not null default 3,
  default_timeout_seconds integer not null default 120,
  daily_cost_limit numeric,
  monthly_cost_limit numeric,
  require_approval_for text[] not null default array['deploy_production','write_database','send_email','execute_shell'],
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.organization_settings to authenticated;
grant all on public.organization_settings to service_role;
alter table public.organization_settings enable row level security;
create policy "org_settings_all" on public.organization_settings for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

-- ===== DEPARTMENTS =====
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  color text not null default '#7c8aa5',
  description text,
  manager_agent_id uuid,
  context text,
  policies jsonb not null default '[]'::jsonb,
  tools jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (organization_id, slug)
);
grant select, insert, update, delete on public.departments to authenticated;
grant all on public.departments to service_role;
alter table public.departments enable row level security;
create policy "departments_all" on public.departments for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

-- ===== OFFICE =====
create table public.office_maps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null default 'Main Office',
  width integer not null default 44,
  height integer not null default 30,
  tile_size integer not null default 16,
  layers jsonb not null default '{}'::jsonb,
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.office_zones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  office_map_id uuid not null references public.office_maps(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  name text not null,
  kind text not null,
  x integer not null, y integer not null, width integer not null, height integer not null,
  color text,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.workstations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  office_map_id uuid not null references public.office_maps(id) on delete cascade,
  zone_id uuid references public.office_zones(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  name text not null,
  x integer not null, y integer not null,
  seat_x integer not null, seat_y integer not null,
  facing text not null default 'up',
  desk_kind text not null default 'desk',
  has_computer boolean not null default true,
  assigned_agent_id uuid,
  status text not null default 'free',
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.office_maps to authenticated;
grant all on public.office_maps to service_role;
grant select, insert, update, delete on public.office_zones to authenticated;
grant all on public.office_zones to service_role;
grant select, insert, update, delete on public.workstations to authenticated;
grant all on public.workstations to service_role;
alter table public.office_maps enable row level security;
alter table public.office_zones enable row level security;
alter table public.workstations enable row level security;
create policy "office_maps_all" on public.office_maps for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "office_zones_all" on public.office_zones for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "workstations_all" on public.workstations for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create trigger office_maps_updated_at before update on public.office_maps for each row execute function public.update_updated_at_column();

-- ===== PROVIDERS =====
create table public.agent_providers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  type public.provider_type not null default 'custom',
  base_url text,
  model text,
  temperature numeric not null default 0.7,
  max_tokens integer not null default 4096,
  timeout_ms integer not null default 60000,
  has_api_key boolean not null default false,
  headers jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  health public.provider_health not null default 'UNKNOWN',
  last_health_check_at timestamptz,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.agent_providers to authenticated;
grant all on public.agent_providers to service_role;
alter table public.agent_providers enable row level security;
create policy "providers_all" on public.agent_providers for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create trigger providers_updated_at before update on public.agent_providers for each row execute function public.update_updated_at_column();

-- Secrets: server-only. No grants to authenticated/anon, RLS with no policies.
create table public.provider_secrets (
  provider_id uuid primary key references public.agent_providers(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  api_key text,
  bearer_token text,
  secret_headers jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
grant all on public.provider_secrets to service_role;
alter table public.provider_secrets enable row level security;

-- ===== AGENTS =====
create table public.agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  manager_agent_id uuid references public.agents(id) on delete set null,
  workstation_id uuid references public.workstations(id) on delete set null,
  provider_id uuid references public.agent_providers(id) on delete set null,
  character_sprite_id text not null default 'placeholder',
  sprite_set_id text not null default 'placeholder',
  animation_set_id text not null default 'default',
  color text not null default '#f2b544',
  name text not null,
  slug text not null,
  role text not null default 'Agent',
  description text,
  kind public.agent_kind not null default 'llm',
  model text,
  system_prompt text,
  personality text,
  autonomy_level integer not null default 1 check (autonomy_level between 0 and 4),
  status public.agent_status not null default 'IDLE',
  is_primary_controller boolean not null default false,
  is_suspended boolean not null default false,
  capabilities text[] not null default '{}',
  memory_enabled boolean not null default true,
  context_limit integer not null default 8000,
  max_iterations integer not null default 10,
  max_cost numeric not null default 1,
  require_approval boolean not null default false,
  external_config jsonb not null default '{}'::jsonb,
  current_mission_id uuid,
  current_task_id uuid,
  position jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);
alter table public.departments add constraint departments_manager_fk foreign key (manager_agent_id) references public.agents(id) on delete set null;
alter table public.workstations add constraint workstations_agent_fk foreign key (assigned_agent_id) references public.agents(id) on delete set null;
grant select, insert, update, delete on public.agents to authenticated;
grant all on public.agents to service_role;
alter table public.agents enable row level security;
create policy "agents_all" on public.agents for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create trigger agents_updated_at before update on public.agents for each row execute function public.update_updated_at_column();

create or replace function public.prevent_agent_hierarchy_cycle()
returns trigger language plpgsql set search_path = public as $$
declare cur uuid; depth integer := 0; mgr_org uuid;
begin
  if new.manager_agent_id is null then return new; end if;
  if new.manager_agent_id = new.id then
    raise exception 'HIERARCHY_CYCLE: an agent cannot report to itself';
  end if;
  select organization_id into mgr_org from public.agents where id = new.manager_agent_id;
  if mgr_org is null or mgr_org <> new.organization_id then
    raise exception 'HIERARCHY_INVALID: manager must belong to the same organization';
  end if;
  cur := new.manager_agent_id;
  while cur is not null loop
    depth := depth + 1;
    if depth > 100 then raise exception 'HIERARCHY_TOO_DEEP'; end if;
    if cur = new.id then
      raise exception 'HIERARCHY_CYCLE: % would report to one of its own subordinates', new.name;
    end if;
    select manager_agent_id into cur from public.agents where id = cur;
  end loop;
  return new;
end $$;
create trigger agents_prevent_cycle before insert or update of manager_agent_id on public.agents
for each row execute function public.prevent_agent_hierarchy_cycle();

create table public.agent_tools (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  tool_id text not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (agent_id, tool_id)
);
create table public.agent_permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  permission text not null,
  granted boolean not null default true,
  always_allow boolean not null default false,
  granted_by uuid,
  created_at timestamptz not null default now(),
  unique (agent_id, permission)
);
create table public.agent_memories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete cascade,
  mission_id uuid,
  scope text not null default 'agent',
  key text,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  importance integer not null default 1,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.agent_tools to authenticated;
grant all on public.agent_tools to service_role;
grant select, insert, update, delete on public.agent_permissions to authenticated;
grant all on public.agent_permissions to service_role;
grant select, insert, update, delete on public.agent_memories to authenticated;
grant all on public.agent_memories to service_role;
alter table public.agent_tools enable row level security;
alter table public.agent_permissions enable row level security;
alter table public.agent_memories enable row level security;
create policy "agent_tools_all" on public.agent_tools for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "agent_permissions_all" on public.agent_permissions for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "agent_memories_all" on public.agent_memories for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

-- ===== MISSIONS =====
create table public.missions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  goal text not null,
  commander_agent_id uuid references public.agents(id) on delete set null,
  status public.mission_status not null default 'DRAFT',
  budget numeric not null default 2,
  max_steps integer not null default 30,
  approval_policy text not null default 'sensitive_only',
  allowed_agent_ids uuid[] not null default '{}',
  is_simulated boolean not null default true,
  current_step integer not null default 0,
  phase text not null default 'created',
  total_cost numeric not null default 0,
  total_tokens_in bigint not null default 0,
  total_tokens_out bigint not null default 0,
  result text,
  summary text,
  report jsonb,
  error text,
  stop_requested boolean not null default false,
  created_by uuid,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.mission_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  role_in_mission text not null default 'worker',
  unique (mission_id, agent_id)
);
create table public.mission_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mission_id uuid references public.missions(id) on delete cascade,
  task_id uuid,
  agent_id uuid,
  target_agent_id uuid,
  type text not null,
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  parent_task_id uuid references public.tasks(id) on delete set null,
  assigned_agent_id uuid references public.agents(id) on delete set null,
  created_by_agent_id uuid references public.agents(id) on delete set null,
  code text not null,
  title text not null,
  description text,
  status public.task_status not null default 'queued',
  depends_on uuid[] not null default '{}',
  priority integer not null default 1,
  order_index integer not null default 0,
  result text,
  evidence jsonb not null default '[]'::jsonb,
  retries integer not null default 0,
  max_retries integer not null default 2,
  cost numeric not null default 0,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  parent_command_id uuid references public.commands(id) on delete set null,
  issued_by_agent_id uuid references public.agents(id) on delete set null,
  assigned_to_agent_id uuid references public.agents(id) on delete set null,
  objective text not null,
  instructions text not null,
  constraints jsonb not null default '[]'::jsonb,
  allowed_tools text[] not null default '{}',
  forbidden_actions text[] not null default '{}',
  expected_output text,
  context jsonb not null default '{}'::jsonb,
  deadline timestamptz,
  max_iterations integer not null default 5,
  max_cost numeric not null default 0.5,
  status public.command_status not null default 'PENDING',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create table public.command_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  command_id uuid not null references public.commands(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  status public.command_status not null,
  summary text,
  output jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  cost numeric not null default 0,
  latency_ms integer,
  created_at timestamptz not null default now()
);
create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mission_id uuid references public.missions(id) on delete cascade,
  meeting_id uuid,
  from_agent_id uuid references public.agents(id) on delete set null,
  to_agent_id uuid references public.agents(id) on delete set null,
  from_user_id uuid,
  kind text not null default 'message',
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mission_id uuid references public.missions(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  command_id uuid references public.commands(id) on delete set null,
  agent_id uuid references public.agents(id) on delete set null,
  provider_id uuid references public.agent_providers(id) on delete set null,
  model text,
  status text not null default 'running',
  request_summary text,
  response_summary text,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  cost numeric not null default 0,
  latency_ms integer,
  error text,
  retries integer not null default 0,
  is_simulated boolean not null default true,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mission_id uuid references public.missions(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  agent_id uuid references public.agents(id) on delete set null,
  action text not null,
  tool_id text,
  reason text,
  risk_level public.risk_level not null default 'MEDIUM',
  required_permissions text[] not null default '{}',
  requested_action jsonb not null default '{}'::jsonb,
  kind text not null default 'permission',
  status public.approval_status not null default 'PENDING',
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  always_allow boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.tool_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  agent_id uuid references public.agents(id) on delete set null,
  mission_id uuid references public.missions(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  tool_id text not null,
  input_summary text,
  output_summary text,
  risk_level public.risk_level not null default 'LOW',
  status text not null default 'completed',
  approval_request_id uuid references public.approval_requests(id) on delete set null,
  latency_ms integer,
  created_at timestamptz not null default now()
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mission_id uuid,
  task_id uuid,
  agent_id uuid,
  actor_user_id uuid,
  action text not null,
  tool text,
  input_summary text,
  output_summary text,
  risk_level public.risk_level not null default 'LOW',
  approved_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.cost_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mission_id uuid references public.missions(id) on delete cascade,
  task_id uuid,
  agent_id uuid references public.agents(id) on delete set null,
  provider_id uuid references public.agent_providers(id) on delete set null,
  provider_type text,
  model text,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  estimated_cost numeric not null default 0,
  is_simulated boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mission_id uuid references public.missions(id) on delete cascade,
  zone_id uuid references public.office_zones(id) on delete set null,
  title text not null,
  topic text,
  status text not null default 'scheduled',
  max_rounds integer not null default 3,
  current_round integer not null default 0,
  summary text,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.meeting_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  role text not null default 'participant',
  unique (meeting_id, agent_id)
);
create table public.meeting_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  round integer not null default 1,
  content text not null,
  created_at timestamptz not null default now()
);

-- grants + RLS for mission-related tables
grant select, insert, update, delete on public.missions, public.mission_agents, public.mission_events, public.tasks, public.commands, public.command_results, public.agent_messages, public.agent_runs, public.approval_requests, public.tool_calls, public.cost_records, public.meetings, public.meeting_participants, public.meeting_messages to authenticated;
grant all on public.missions, public.mission_agents, public.mission_events, public.tasks, public.commands, public.command_results, public.agent_messages, public.agent_runs, public.approval_requests, public.tool_calls, public.cost_records, public.meetings, public.meeting_participants, public.meeting_messages, public.audit_logs to service_role;
grant select, insert on public.audit_logs to authenticated;

alter table public.missions enable row level security;
alter table public.mission_agents enable row level security;
alter table public.mission_events enable row level security;
alter table public.tasks enable row level security;
alter table public.commands enable row level security;
alter table public.command_results enable row level security;
alter table public.agent_messages enable row level security;
alter table public.agent_runs enable row level security;
alter table public.approval_requests enable row level security;
alter table public.tool_calls enable row level security;
alter table public.audit_logs enable row level security;
alter table public.cost_records enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_participants enable row level security;
alter table public.meeting_messages enable row level security;

create policy "missions_all" on public.missions for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "mission_agents_all" on public.mission_agents for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "mission_events_all" on public.mission_events for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "tasks_all" on public.tasks for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "commands_all" on public.commands for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "command_results_all" on public.command_results for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "agent_messages_all" on public.agent_messages for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "agent_runs_all" on public.agent_runs for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "approval_requests_all" on public.approval_requests for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "tool_calls_all" on public.tool_calls for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "cost_records_all" on public.cost_records for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "meetings_all" on public.meetings for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "meeting_participants_all" on public.meeting_participants for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "meeting_messages_all" on public.meeting_messages for all to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
-- audit logs: append-only
create policy "audit_logs_select" on public.audit_logs for select to authenticated using (public.is_org_member(organization_id));
create policy "audit_logs_insert" on public.audit_logs for insert to authenticated with check (public.is_org_member(organization_id));

create trigger missions_updated_at before update on public.missions for each row execute function public.update_updated_at_column();
create trigger tasks_updated_at before update on public.tasks for each row execute function public.update_updated_at_column();

create index on public.agents (organization_id);
create index on public.agents (manager_agent_id);
create index on public.tasks (mission_id);
create index on public.commands (mission_id);
create index on public.mission_events (mission_id, created_at);
create index on public.mission_events (organization_id, created_at);
create index on public.audit_logs (organization_id, created_at);
create index on public.cost_records (organization_id, created_at);
create index on public.approval_requests (organization_id, status);

-- ===== REALTIME =====
alter publication supabase_realtime add table public.agents;
alter publication supabase_realtime add table public.missions;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.commands;
alter publication supabase_realtime add table public.mission_events;
alter publication supabase_realtime add table public.approval_requests;

-- ===== ORGANIZATION CREATION + DEMO SEED =====
create or replace function public.create_organization(p_name text, p_seed_demo boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid; v_slug text; v_map uuid;
  d_exec uuid; d_eng uuid; d_res uuid; d_qa uuid; d_des uuid; d_prod uuid; d_sec uuid; d_mkt uuid; d_ops uuid;
  z_exec uuid; z_cto uuid; z_rec uuid; z_eng uuid; z_qa uuid; z_res uuid; z_des uuid; z_ops uuid; z_meet uuid; z_srv uuid; z_brk uuid; z_prod uuid;
  w_atlas uuid; w_nova uuid; w_orion uuid; w_claud uuid; w_sent uuid; w_scout uuid;
  p_sim uuid; p_claud uuid;
  a_atlas uuid; a_nova uuid; a_orion uuid; a_claud uuid; a_sent uuid; a_scout uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  v_slug := lower(regexp_replace(coalesce(nullif(trim(p_name),''),'org'), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(gen_random_uuid()::text,1,6);
  insert into public.organizations (name, slug, owner_id) values (p_name, v_slug, v_uid) returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role) values (v_org, v_uid, 'owner');
  insert into public.organization_settings (organization_id, policies) values (v_org, '[
    {"id":"prod-deploy","rule":"Production deployment requires approval","enforced":true},
    {"id":"no-repo-delete","rule":"Agents cannot delete repositories","enforced":true},
    {"id":"max-cost","rule":"Maximum mission cost = $5","enforced":true},
    {"id":"external-comm","rule":"External communication requires approval","enforced":true},
    {"id":"workers-no-delegate","rule":"Workers cannot delegate","enforced":true}
  ]'::jsonb);

  insert into public.departments (organization_id, name, slug, color, sort_order) values
    (v_org,'Executive','executive','#e0b35a',0) returning id into d_exec;
  insert into public.departments (organization_id, name, slug, color, sort_order) values (v_org,'Engineering','engineering','#5aa9e0',1) returning id into d_eng;
  insert into public.departments (organization_id, name, slug, color, sort_order) values (v_org,'Research','research','#a07ce0',2) returning id into d_res;
  insert into public.departments (organization_id, name, slug, color, sort_order) values (v_org,'QA','qa','#5ad1a6',3) returning id into d_qa;
  insert into public.departments (organization_id, name, slug, color, sort_order) values (v_org,'Design','design','#e07ca8',4) returning id into d_des;
  insert into public.departments (organization_id, name, slug, color, sort_order) values (v_org,'Product','product','#e08c5a',5) returning id into d_prod;
  insert into public.departments (organization_id, name, slug, color, sort_order) values (v_org,'Security','security','#d95a5a',6) returning id into d_sec;
  insert into public.departments (organization_id, name, slug, color, sort_order) values (v_org,'Marketing','marketing','#c8d15a',7) returning id into d_mkt;
  insert into public.departments (organization_id, name, slug, color, sort_order) values (v_org,'Operations','operations','#8a9bb0',8) returning id into d_ops;

  insert into public.office_maps (organization_id, name, width, height, tile_size, layers) values (v_org, 'Pixel Labs HQ', 44, 30, 16,
   '{"furniture":[
     {"kind":"plant","x":2,"y":3},{"kind":"bookshelf","x":8,"y":3},{"kind":"plant","x":9,"y":6},
     {"kind":"plant","x":2,"y":12},{"kind":"whiteboard","x":7,"y":12},{"kind":"cabinet","x":9,"y":12},
     {"kind":"reception_desk","x":4,"y":22},{"kind":"sofa","x":2,"y":25},{"kind":"plant","x":8,"y":25},{"kind":"plant","x":2,"y":21},
     {"kind":"whiteboard","x":25,"y":3},{"kind":"plant","x":13,"y":3},{"kind":"printer","x":26,"y":8},{"kind":"plant","x":26,"y":10},
     {"kind":"chartboard","x":17,"y":16},{"kind":"plant","x":13,"y":19},
     {"kind":"bookshelf","x":25,"y":16},{"kind":"plant","x":22,"y":19},
     {"kind":"plant","x":18,"y":25},{"kind":"plant","x":22,"y":25},{"kind":"printer","x":26,"y":25},
     {"kind":"meeting_table","x":33,"y":4},{"kind":"whiteboard","x":31,"y":3},{"kind":"plant","x":30,"y":7},{"kind":"plant","x":41,"y":7},{"kind":"chartboard","x":39,"y":3},
     {"kind":"server_rack","x":30,"y":13},{"kind":"server_rack","x":31,"y":13},{"kind":"server_rack","x":33,"y":13},{"kind":"server_rack","x":34,"y":13},
     {"kind":"vending","x":38,"y":13},{"kind":"water_cooler","x":41,"y":13},{"kind":"sofa","x":40,"y":15},{"kind":"plant","x":38,"y":16},
     {"kind":"plant","x":30,"y":21},{"kind":"bookshelf","x":40,"y":25},{"kind":"whiteboard","x":34,"y":21}
   ]}'::jsonb) returning id into v_map;

  insert into public.office_zones (organization_id, office_map_id, department_id, name, kind, x, y, width, height, color, properties) values
    (v_org, v_map, d_exec, 'Executive Office', 'executive_office', 1, 1, 10, 8, '#e0b35a', '{"door":{"x":10,"y":5},"floor":"wood","wall":"light"}') returning id into z_exec;
  insert into public.office_zones (organization_id, office_map_id, department_id, name, kind, x, y, width, height, color, properties) values
    (v_org, v_map, d_exec, 'CTO Office', 'executive_office', 1, 10, 10, 8, '#e0b35a', '{"door":{"x":10,"y":14},"floor":"carpet_brown","wall":"light"}') returning id into z_cto;
  insert into public.office_zones (organization_id, office_map_id, department_id, name, kind, x, y, width, height, color, properties) values
    (v_org, v_map, null, 'Reception', 'reception', 1, 19, 10, 10, '#8a9bb0', '{"door":{"x":10,"y":23},"floor":"tile","wall":"light"}') returning id into z_rec;
  insert into public.office_zones (organization_id, office_map_id, department_id, name, kind, x, y, width, height, color, properties) values
    (v_org, v_map, d_eng, 'Engineering', 'engineering', 12, 1, 16, 12, '#5aa9e0', '{"door":{"x":12,"y":7},"door2":{"x":19,"y":12},"floor":"carpet_dark","wall":"grey"}') returning id into z_eng;
  insert into public.office_zones (organization_id, office_map_id, department_id, name, kind, x, y, width, height, color, properties) values
    (v_org, v_map, d_qa, 'QA', 'qa', 12, 14, 8, 8, '#5ad1a6', '{"door":{"x":12,"y":17},"floor":"tile","wall":"grey"}') returning id into z_qa;
  insert into public.office_zones (organization_id, office_map_id, department_id, name, kind, x, y, width, height, color, properties) values
    (v_org, v_map, d_res, 'Research', 'research', 21, 14, 7, 8, '#a07ce0', '{"door":{"x":27,"y":17},"floor":"carpet_pattern","wall":"purple"}') returning id into z_res;
  insert into public.office_zones (organization_id, office_map_id, department_id, name, kind, x, y, width, height, color, properties) values
    (v_org, v_map, d_des, 'Design', 'design', 12, 23, 8, 6, '#e07ca8', '{"door":{"x":12,"y":26},"floor":"wood","wall":"light"}') returning id into z_des;
  insert into public.office_zones (organization_id, office_map_id, department_id, name, kind, x, y, width, height, color, properties) values
    (v_org, v_map, d_ops, 'Operations', 'operations', 21, 23, 7, 6, '#8a9bb0', '{"door":{"x":27,"y":26},"floor":"tile","wall":"grey"}') returning id into z_ops;
  insert into public.office_zones (organization_id, office_map_id, department_id, name, kind, x, y, width, height, color, properties) values
    (v_org, v_map, null, 'Meeting Room', 'meeting_room', 29, 1, 14, 9, '#f2b544', '{"door":{"x":29,"y":5},"floor":"carpet_red","wall":"brick","seats":[[33,7],[35,7],[37,7],[34,3],[36,3],[38,3],[32,5],[39,5]]}') returning id into z_meet;
  insert into public.office_zones (organization_id, office_map_id, department_id, name, kind, x, y, width, height, color, properties) values
    (v_org, v_map, d_sec, 'Server Room', 'server_room', 29, 11, 7, 7, '#d95a5a', '{"door":{"x":29,"y":14},"floor":"tile","wall":"grey"}') returning id into z_srv;
  insert into public.office_zones (organization_id, office_map_id, department_id, name, kind, x, y, width, height, color, properties) values
    (v_org, v_map, null, 'Break Room', 'break_room', 37, 11, 6, 7, '#c8d15a', '{"door":{"x":37,"y":14},"floor":"wood","wall":"light"}') returning id into z_brk;
  insert into public.office_zones (organization_id, office_map_id, department_id, name, kind, x, y, width, height, color, properties) values
    (v_org, v_map, d_prod, 'Product', 'product', 29, 19, 14, 10, '#e08c5a', '{"door":{"x":29,"y":24},"floor":"carpet_brown","wall":"light"}') returning id into z_prod;

  insert into public.workstations (organization_id, office_map_id, zone_id, department_id, name, x, y, seat_x, seat_y, desk_kind) values
    (v_org, v_map, z_exec, d_exec, 'Executive Desk', 5, 4, 5, 6, 'exec_desk') returning id into w_atlas;
  insert into public.workstations (organization_id, office_map_id, zone_id, department_id, name, x, y, seat_x, seat_y, desk_kind) values
    (v_org, v_map, z_cto, d_exec, 'CTO Desk', 5, 13, 5, 15, 'exec_desk') returning id into w_nova;
  insert into public.workstations (organization_id, office_map_id, zone_id, department_id, name, x, y, seat_x, seat_y) values
    (v_org, v_map, z_eng, d_eng, 'Engineering Lead Desk', 14, 4, 14, 6) returning id into w_orion;
  insert into public.workstations (organization_id, office_map_id, zone_id, department_id, name, x, y, seat_x, seat_y) values
    (v_org, v_map, z_eng, d_eng, 'Engineering WS-2', 18, 4, 18, 6) returning id into w_claud;
  insert into public.workstations (organization_id, office_map_id, zone_id, department_id, name, x, y, seat_x, seat_y) values
    (v_org, v_map, z_eng, d_eng, 'Engineering WS-3', 22, 4, 22, 6),
    (v_org, v_map, z_eng, d_eng, 'Engineering WS-4', 14, 8, 14, 10),
    (v_org, v_map, z_eng, d_eng, 'Engineering WS-5', 18, 8, 18, 10),
    (v_org, v_map, z_eng, d_eng, 'Engineering WS-6', 22, 8, 22, 10);
  insert into public.workstations (organization_id, office_map_id, zone_id, department_id, name, x, y, seat_x, seat_y) values
    (v_org, v_map, z_qa, d_qa, 'QA WS-1', 14, 17, 14, 19) returning id into w_sent;
  insert into public.workstations (organization_id, office_map_id, zone_id, department_id, name, x, y, seat_x, seat_y) values
    (v_org, v_map, z_qa, d_qa, 'QA WS-2', 17, 17, 17, 19);
  insert into public.workstations (organization_id, office_map_id, zone_id, department_id, name, x, y, seat_x, seat_y) values
    (v_org, v_map, z_res, d_res, 'Research WS-1', 23, 17, 23, 19) returning id into w_scout;
  insert into public.workstations (organization_id, office_map_id, zone_id, department_id, name, x, y, seat_x, seat_y) values
    (v_org, v_map, z_des, d_des, 'Design WS-1', 14, 25, 14, 27),
    (v_org, v_map, z_des, d_des, 'Design WS-2', 17, 25, 17, 27),
    (v_org, v_map, z_ops, d_ops, 'Operations WS-1', 23, 25, 23, 27),
    (v_org, v_map, z_prod, d_prod, 'Product WS-1', 31, 22, 31, 24),
    (v_org, v_map, z_prod, d_prod, 'Product WS-2', 35, 22, 35, 24),
    (v_org, v_map, z_prod, d_prod, 'Product WS-3', 39, 22, 39, 24);

  insert into public.agent_providers (organization_id, name, type, model, health, config) values
    (v_org, 'Simulation Provider', 'simulation', 'simulated-llm', 'CONNECTED', '{"note":"Deterministic simulated responses. No real AI calls."}') returning id into p_sim;
  insert into public.agent_providers (organization_id, name, type, model, health, timeout_ms, config) values
    (v_org, 'Claudinho Executor', 'custom', 'claude-executor', 'OFFLINE', 120000, '{"kind":"external_agent","health_endpoint":"/health","request_mapping":{},"response_mapping":{}}') returning id into p_claud;

  if p_seed_demo then
    insert into public.agents (organization_id, department_id, workstation_id, provider_id, name, slug, role, kind, model, autonomy_level, color, character_sprite_id, system_prompt, description, capabilities)
      values (v_org, d_exec, w_atlas, p_sim, 'Atlas', 'atlas', 'CEO', 'llm', 'simulated-llm', 4, '#e0b35a', 'placeholder:atlas',
        'You are Atlas, CEO of Pixel Labs. Set direction, approve strategy, never micromanage execution.', 'Chief Executive AI. Owns company direction.', array['delegate_tasks','approve_tasks','manage_agents']) returning id into a_atlas;
    insert into public.agents (organization_id, department_id, manager_agent_id, workstation_id, provider_id, name, slug, role, kind, model, autonomy_level, color, character_sprite_id, is_primary_controller, system_prompt, description, capabilities)
      values (v_org, d_exec, a_atlas, w_nova, p_sim, 'Nova', 'nova', 'CTO', 'controller', 'simulated-llm', 3, '#5aa9e0', 'placeholder:nova', true,
        'You are Nova, CTO. Interpret objectives, plan, split work, delegate to the right subordinates, review evidence before accepting results.', 'Primary controller. Plans and delegates technical missions.', array['delegate_tasks','approve_tasks','code_analysis']) returning id into a_nova;
    insert into public.agents (organization_id, department_id, manager_agent_id, workstation_id, provider_id, name, slug, role, kind, model, autonomy_level, color, character_sprite_id, system_prompt, description, capabilities)
      values (v_org, d_eng, a_nova, w_orion, p_sim, 'Orion', 'orion', 'Tech Lead', 'llm', 'simulated-llm', 3, '#5ad1e0', 'placeholder:orion',
        'You are Orion, Tech Lead. Break technical tasks down, assign to developers, review code evidence.', 'Engineering lead. Reviews technical evidence.', array['delegate_tasks','code_analysis','repository_read']) returning id into a_orion;
    insert into public.agents (organization_id, department_id, manager_agent_id, workstation_id, provider_id, name, slug, role, kind, model, autonomy_level, color, character_sprite_id, require_approval, system_prompt, description, capabilities, external_config)
      values (v_org, d_eng, a_orion, w_claud, p_claud, 'Claudinho', 'claudinho', 'Developer', 'external', 'claude-executor', 1, '#f2b544', 'placeholder:claudinho', true,
        'You are Claudinho, an external code executor. Execute exactly the command received. Never expand scope. Return evidence.', 'External Claude executor. Runs exactly what the controller orders.',
        array['repository_read','repository_write','shell','github','testing','browser','filesystem','code_analysis'],
        '{"endpoint":"","auth_type":"bearer","timeout_ms":120000,"health_endpoint":"/health"}') returning id into a_claud;
    insert into public.agents (organization_id, department_id, manager_agent_id, workstation_id, provider_id, name, slug, role, kind, model, autonomy_level, color, character_sprite_id, system_prompt, description, capabilities)
      values (v_org, d_qa, a_orion, w_sent, p_sim, 'Sentinel', 'sentinel', 'QA Engineer', 'llm', 'simulated-llm', 1, '#5ad1a6', 'placeholder:sentinel',
        'You are Sentinel, QA. Verify deliverables with tests. Report failures honestly. Never fake success.', 'Quality assurance. Runs tests and reports results.', array['testing','repository_read']) returning id into a_sent;
    insert into public.agents (organization_id, department_id, manager_agent_id, workstation_id, provider_id, name, slug, role, kind, model, autonomy_level, color, character_sprite_id, system_prompt, description, capabilities)
      values (v_org, d_res, a_nova, w_scout, p_sim, 'Scout', 'scout', 'Research Agent', 'llm', 'simulated-llm', 2, '#a07ce0', 'placeholder:scout',
        'You are Scout, Research. Investigate, summarize findings with references. Stay within the requested scope.', 'Research and investigation.', array['browse_web','code_analysis']) returning id into a_scout;

    update public.workstations set assigned_agent_id = a_atlas, status='occupied' where id = w_atlas;
    update public.workstations set assigned_agent_id = a_nova, status='occupied' where id = w_nova;
    update public.workstations set assigned_agent_id = a_orion, status='occupied' where id = w_orion;
    update public.workstations set assigned_agent_id = a_claud, status='occupied' where id = w_claud;
    update public.workstations set assigned_agent_id = a_sent, status='occupied' where id = w_sent;
    update public.workstations set assigned_agent_id = a_scout, status='occupied' where id = w_scout;
    update public.departments set manager_agent_id = a_atlas where id = d_exec;
    update public.departments set manager_agent_id = a_orion where id = d_eng;
    update public.departments set manager_agent_id = a_sent where id = d_qa;
    update public.departments set manager_agent_id = a_scout where id = d_res;

    insert into public.agent_permissions (organization_id, agent_id, permission) values
      (v_org, a_nova, 'delegate_tasks'), (v_org, a_nova, 'approve_tasks'), (v_org, a_nova, 'manage_agents'),
      (v_org, a_atlas, 'delegate_tasks'), (v_org, a_atlas, 'approve_tasks'), (v_org, a_atlas, 'manage_agents'),
      (v_org, a_orion, 'delegate_tasks'), (v_org, a_orion, 'approve_tasks'), (v_org, a_orion, 'read_files'),
      (v_org, a_claud, 'read_files'), (v_org, a_claud, 'write_files'), (v_org, a_claud, 'run_tests'), (v_org, a_claud, 'create_branch'), (v_org, a_claud, 'commit_code'),
      (v_org, a_sent, 'read_files'), (v_org, a_sent, 'run_tests'),
      (v_org, a_scout, 'browse_web'), (v_org, a_scout, 'read_files');

    insert into public.agent_tools (organization_id, agent_id, tool_id) values
      (v_org, a_claud, 'repository_read'), (v_org, a_claud, 'repository_write'), (v_org, a_claud, 'shell'), (v_org, a_claud, 'testing'), (v_org, a_claud, 'github'),
      (v_org, a_sent, 'testing'), (v_org, a_sent, 'repository_read'),
      (v_org, a_scout, 'web_search'), (v_org, a_scout, 'repository_read'),
      (v_org, a_orion, 'repository_read'), (v_org, a_orion, 'code_analysis');

    insert into public.agent_memories (organization_id, scope, key, content) values
      (v_org, 'organization', 'company', 'Pixel Labs builds developer tools. Main repository: pixel-labs/core. Production deploys require human approval.');
  end if;

  insert into public.audit_logs (organization_id, actor_user_id, action, output_summary, risk_level) values (v_org, v_uid, 'organization.created', p_name, 'LOW');
  return v_org;
end $$;
grant execute on function public.create_organization(text, boolean) to authenticated;
