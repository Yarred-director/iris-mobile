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
