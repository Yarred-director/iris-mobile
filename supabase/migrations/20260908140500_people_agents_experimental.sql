-- EXPERIMENTAL / REVERSIBLE: isolated People + child-AI subsystem.
-- No existing Iris memory/self tables are altered. Runtime is fail-closed behind
-- the per-user feature flag `people_agents`. See supabase/rollback/
-- people_agents_experimental_down.sql for destructive rollback.

create table if not exists public.iris_experimental_features (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_key text not null,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, feature_key),
  constraint iris_experimental_features_key_chk check (feature_key ~ '^[a-z0-9_]{2,64}$')
);

create table if not exists public.iris_people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('real','ai')),
  slug text not null,
  name text not null,
  aliases text[] not null default '{}',
  is_user_self boolean not null default false,
  description text,
  reference_image_bucket text,
  reference_image_path text,
  reference_image_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug),
  constraint iris_people_slug_chk check (slug ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  constraint iris_people_name_chk check (char_length(btrim(name)) between 1 and 120)
);

create unique index if not exists iris_people_user_self_uq
  on public.iris_people(user_id) where is_user_self;

create table if not exists public.iris_people_ai_profiles (
  person_id uuid primary key references public.iris_people(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  core_identity text not null,
  core_story text not null default '',
  personality jsonb not null default '{}'::jsonb,
  speech_style jsonb not null default '{}'::jsonb,
  self_model jsonb not null default '{}'::jsonb,
  provider text not null default 'auto' check (provider in ('auto','openai','grok')),
  memory_limit smallint not null default 20 check (memory_limit between 4 and 32),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint iris_people_ai_profile_identity_chk check (char_length(core_identity) between 1 and 12000),
  constraint iris_people_ai_profile_story_chk check (char_length(core_story) <= 30000)
);

create table if not exists public.iris_people_relationships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_person_id uuid not null references public.iris_people(id) on delete cascade,
  target_person_id uuid not null references public.iris_people(id) on delete cascade,
  relationship_type text not null default 'known',
  summary text,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_person_id, target_person_id),
  constraint iris_people_relationship_no_self_chk check (source_person_id <> target_person_id)
);

create table if not exists public.iris_people_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  owner_person_id uuid not null references public.iris_people(id) on delete cascade,
  about_person_id uuid references public.iris_people(id) on delete set null,
  memory_type text not null default 'exchange' check (memory_type in ('exchange','relationship','preference','event','self_reflection')),
  narrative text not null,
  importance smallint not null default 50 check (importance between 1 and 100),
  emotional_weight real not null default 0 check (emotional_weight between 0 and 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_recalled_at timestamptz,
  constraint iris_people_memory_narrative_chk check (char_length(narrative) between 1 and 2400)
);

create index if not exists iris_people_memories_owner_recent_idx
  on public.iris_people_memories(user_id, owner_person_id, created_at desc);
create index if not exists iris_people_memories_owner_importance_idx
  on public.iris_people_memories(user_id, owner_person_id, importance desc, created_at desc);

create table if not exists public.iris_people_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  person_id uuid not null references public.iris_people(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now(),
  constraint iris_people_message_content_chk check (char_length(content) between 1 and 12000)
);

create index if not exists iris_people_messages_recent_idx
  on public.iris_people_messages(user_id, person_id, created_at desc);

alter table public.iris_experimental_features enable row level security;
alter table public.iris_people enable row level security;
alter table public.iris_people_ai_profiles enable row level security;
alter table public.iris_people_relationships enable row level security;
alter table public.iris_people_memories enable row level security;
alter table public.iris_people_messages enable row level security;

create policy iris_experimental_features_owner_all on public.iris_experimental_features
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy iris_people_owner_all on public.iris_people
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy iris_people_ai_profiles_owner_all on public.iris_people_ai_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy iris_people_relationships_owner_all on public.iris_people_relationships
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy iris_people_memories_owner_all on public.iris_people_memories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy iris_people_messages_owner_all on public.iris_people_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.load_iris_people_directory(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when not exists (
      select 1 from public.iris_experimental_features f
      where f.user_id = p_user_id and f.feature_key = 'people_agents' and f.enabled
    ) then '[]'::jsonb
    else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'kind', p.kind,
        'slug', p.slug,
        'name', p.name,
        'aliases', p.aliases,
        'is_user_self', p.is_user_self,
        'description', p.description,
        'metadata', p.metadata,
        'agent_active', coalesce(a.active, false)
      ) order by p.is_user_self desc, p.name)
      from public.iris_people p
      left join public.iris_people_ai_profiles a on a.person_id = p.id
      where p.user_id = p_user_id
    ), '[]'::jsonb)
  end;
$$;

create or replace function public.load_iris_people_agent_context(p_user_id uuid, p_slug text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with selected as (
    select p.*, a.core_identity, a.core_story, a.personality, a.speech_style,
           a.self_model, a.provider, a.memory_limit, a.active
    from public.iris_people p
    join public.iris_people_ai_profiles a on a.person_id = p.id
    where p.user_id = p_user_id
      and p.slug = lower(btrim(p_slug))
      and p.kind = 'ai'
      and a.active
      and exists (
        select 1 from public.iris_experimental_features f
        where f.user_id = p_user_id and f.feature_key = 'people_agents' and f.enabled
      )
    limit 1
  )
  select case when not exists (select 1 from selected) then null else jsonb_build_object(
    'person', (select jsonb_build_object(
      'id', id, 'slug', slug, 'name', name, 'aliases', aliases,
      'description', description, 'metadata', metadata
    ) from selected),
    'profile', (select jsonb_build_object(
      'core_identity', core_identity,
      'core_story', core_story,
      'personality', personality,
      'speech_style', speech_style,
      'self_model', self_model,
      'provider', provider,
      'memory_limit', memory_limit
    ) from selected),
    'memories', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.created_at asc)
      from (
        select id, memory_type, narrative, importance, emotional_weight, metadata, created_at
        from public.iris_people_memories
        where user_id = p_user_id
          and owner_person_id = (select id from selected)
        order by created_at desc
        limit 12
      ) m
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(to_jsonb(msg) order by msg.created_at asc)
      from (
        select role, content, created_at
        from public.iris_people_messages
        where user_id = p_user_id
          and person_id = (select id from selected)
        order by created_at desc
        limit 18
      ) msg
    ), '[]'::jsonb),
    'relationships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'target_id', r.target_person_id,
        'target_name', target.name,
        'relationship_type', r.relationship_type,
        'summary', r.summary,
        'state', r.state
      ) order by target.name)
      from public.iris_people_relationships r
      join public.iris_people target on target.id = r.target_person_id
      where r.user_id = p_user_id
        and r.source_person_id = (select id from selected)
    ), '[]'::jsonb)
  ) end;
$$;

create or replace function public.prune_iris_people_agent_state(p_user_id uuid, p_person_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  keep_memories integer;
begin
  select memory_limit into keep_memories
  from public.iris_people_ai_profiles
  where user_id = p_user_id and person_id = p_person_id;

  if keep_memories is null then return; end if;

  delete from public.iris_people_messages
  where id in (
    select id from public.iris_people_messages
    where user_id = p_user_id and person_id = p_person_id
    order by created_at desc
    offset 40
  );

  delete from public.iris_people_memories
  where id in (
    select id from public.iris_people_memories
    where user_id = p_user_id and owner_person_id = p_person_id
    order by importance desc, created_at desc
    offset keep_memories
  );
end;
$$;

revoke all on function public.load_iris_people_directory(uuid) from public, anon;
revoke all on function public.load_iris_people_agent_context(uuid, text) from public, anon;
revoke all on function public.prune_iris_people_agent_state(uuid, uuid) from public, anon;
grant execute on function public.load_iris_people_directory(uuid) to authenticated, service_role;
grant execute on function public.load_iris_people_agent_context(uuid, text) to authenticated, service_role;
grant execute on function public.prune_iris_people_agent_state(uuid, uuid) to authenticated, service_role;
