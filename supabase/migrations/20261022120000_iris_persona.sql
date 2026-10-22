-- Per-user companion persona. Every user owns and shapes their own companion; the repo
-- YAML is only a seed template. Writes are server-only (service role); users read their own row.
begin;

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
drop policy if exists iris_persona_select_own on public.iris_persona;
create policy iris_persona_select_own on public.iris_persona
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.iris_persona from anon;
revoke insert, update, delete on table public.iris_persona from authenticated;
grant select on table public.iris_persona to authenticated;
grant select, insert, update, delete on table public.iris_persona to service_role;

-- Optimistic concurrency: a patch applies only when the caller saw the current version.
create or replace function public.patch_iris_persona(p_user_id uuid, p_expected_version integer, p_patch jsonb)
returns public.iris_persona
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.iris_persona;
begin
  update public.iris_persona p set
    status = coalesce(p_patch->>'status', p.status),
    name = case when p_patch ? 'name' then nullif(btrim(p_patch->>'name'), '') else p.name end,
    identity = case when p_patch ? 'identity' then p.identity || (p_patch->'identity') else p.identity end,
    personality = case when p_patch ? 'personality' then p.personality || (p_patch->'personality') else p.personality end,
    interests = case when p_patch ? 'interests' then p_patch->'interests' else p.interests end,
    roles = case when p_patch ? 'roles' then p.roles || (p_patch->'roles') else p.roles end,
    user_identity = case when p_patch ? 'user_identity' then p.user_identity || (p_patch->'user_identity') else p.user_identity end,
    preferences = case when p_patch ? 'preferences' then p.preferences || (p_patch->'preferences') else p.preferences end,
    language = coalesce(nullif(p_patch->>'language', ''), p.language),
    awakened_at = case when p_patch->>'status' = 'alive' and p.awakened_at is null then now() else p.awakened_at end,
    version = p.version + 1,
    updated_at = now()
  where p.user_id = p_user_id and p.version = p_expected_version
  returning * into r;
  return r;
end;
$$;

revoke all on function public.patch_iris_persona(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.patch_iris_persona(uuid, integer, jsonb) to service_role;

commit;
