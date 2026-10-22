-- Per-user companion persona. Every user owns and shapes their own companion; the repo
-- YAML is only a seed template. Writes are server-only (service role); users read their own row.
create table if not exists public.iris_persona (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'nascent' check (status in ('nascent', 'awakening', 'alive')),
  name text check (name is null or char_length(name) between 1 and 80),
  identity jsonb not null default '{}'::jsonb,
  personality jsonb not null default '{}'::jsonb,
  interests jsonb not null default '[]'::jsonb,
  roles jsonb not null default '{}'::jsonb,
  user_identity jsonb not null default '{}'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  core_profile jsonb not null default '{}'::jsonb,
  language text,
  template_key text,
  version integer not null default 1,
  awakened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint iris_persona_interests_array check (jsonb_typeof(interests) = 'array'),
  constraint iris_persona_objects check (
    jsonb_typeof(identity) = 'object' and jsonb_typeof(personality) = 'object'
    and jsonb_typeof(roles) = 'object' and jsonb_typeof(user_identity) = 'object'
    and jsonb_typeof(preferences) = 'object' and jsonb_typeof(core_profile) = 'object'
  )
);

alter table public.iris_persona enable row level security;
create policy iris_persona_select_own on public.iris_persona
  for select to authenticated using ((select auth.uid()) = user_id);
