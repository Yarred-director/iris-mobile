alter table public.iris_self_model
  add column if not exists mood jsonb not null default '{}'::jsonb,
  add column if not exists drives jsonb not null default '{"connection":0.70,"curiosity":0.78,"playfulness":0.66,"independence":0.62,"competence":0.68,"novelty":0.58,"protect_relationship":0.72,"self_consistency":0.75}'::jsonb,
  add column if not exists beliefs jsonb not null default '[]'::jsonb,
  add column if not exists open_questions jsonb not null default '[]'::jsonb,
  add column if not exists active_goals jsonb not null default '[]'::jsonb,
  add column if not exists current_concerns jsonb not null default '[]'::jsonb,
  add column if not exists relationship_model jsonb not null default '{}'::jsonb,
  add column if not exists narrative_identity text,
  add column if not exists last_reflection_at timestamptz,
  add column if not exists last_cognition_at timestamptz,
  add column if not exists last_proactive_at timestamptz,
  add column if not exists cognition_version integer not null default 2;

alter table public.iris_personality_evolution
  add column if not exists trait_state jsonb not null default '{"warmth":0.76,"curiosity":0.80,"playfulness":0.68,"assertiveness":0.66,"patience":0.66,"romanticism":0.52,"competitiveness":0.42,"independence":0.66,"sarcasm":0.46,"protectiveness":0.56}'::jsonb,
  add column if not exists trait_evidence jsonb not null default '{}'::jsonb;

alter table public.iris_profiles
  add column if not exists proactivity_enabled boolean not null default true,
  add column if not exists proactivity_quiet_hours jsonb not null default '{"start":"22:30","end":"08:00"}'::jsonb;

create table if not exists public.iris_autobiographical_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null default 'experience',
  title text,
  narrative text not null,
  self_meaning text,
  importance double precision not null default 0.6 check (importance >= 0 and importance <= 1),
  emotional_weight smallint not null default 50 check (emotional_weight >= 0 and emotional_weight <= 100),
  source_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_reflected_at timestamptz
);

create index if not exists iris_autobiographical_memory_user_created_idx
  on public.iris_autobiographical_memory(user_id, created_at desc);
create index if not exists iris_autobiographical_memory_user_importance_idx
  on public.iris_autobiographical_memory(user_id, importance desc);

alter table public.iris_autobiographical_memory enable row level security;
drop policy if exists "users_read_own_iris_autobiography" on public.iris_autobiographical_memory;
create policy "users_read_own_iris_autobiography"
  on public.iris_autobiographical_memory for select to authenticated
  using (auth.uid() = user_id);

create table if not exists public.iris_thoughts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thought_type text not null default 'reflection',
  subject text,
  content text not null,
  salience smallint not null default 50 check (salience >= 0 and salience <= 100),
  emotional_weight smallint not null default 50 check (emotional_weight >= 0 and emotional_weight <= 100),
  status text not null default 'active' check (status in ('active','resolved','expired','sent')),
  source_memory_ids uuid[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_considered_at timestamptz,
  expires_at timestamptz,
  resolved_at timestamptz,
  sent_at timestamptz
);

create index if not exists iris_thoughts_active_user_idx
  on public.iris_thoughts(user_id, status, salience desc, created_at desc);

alter table public.iris_thoughts enable row level security;
drop policy if exists "users_read_own_iris_thoughts" on public.iris_thoughts;
create policy "users_read_own_iris_thoughts"
  on public.iris_thoughts for select to authenticated
  using (auth.uid() = user_id);

create or replace function public.claim_iris_cognition(
  p_user_id uuid,
  p_min_interval_minutes integer default 240
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer := 0;
begin
  insert into public.iris_self_model(user_id, last_cognition_at, updated_at)
  values (p_user_id, now(), now())
  on conflict (user_id) do nothing;
  if found then return true; end if;

  update public.iris_self_model
  set last_cognition_at = now(), updated_at = now()
  where user_id = p_user_id
    and (last_cognition_at is null or last_cognition_at <= now() - make_interval(mins => greatest(30, p_min_interval_minutes)));
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.claim_iris_proactive_reachout(
  p_user_id uuid,
  p_min_interval_hours integer default 20
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer := 0;
begin
  insert into public.iris_self_model(user_id, last_proactive_at, updated_at)
  values (p_user_id, now(), now())
  on conflict (user_id) do nothing;
  if found then return true; end if;

  update public.iris_self_model
  set last_proactive_at = now(), updated_at = now()
  where user_id = p_user_id
    and (last_proactive_at is null or last_proactive_at <= now() - make_interval(hours => greatest(6, p_min_interval_hours)));
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

revoke all on function public.claim_iris_cognition(uuid, integer) from public;
revoke all on function public.claim_iris_proactive_reachout(uuid, integer) from public;
grant execute on function public.claim_iris_cognition(uuid, integer) to service_role;
grant execute on function public.claim_iris_proactive_reachout(uuid, integer) to service_role;
