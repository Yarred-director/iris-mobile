-- Temporal Session v2
-- Keeps the absence before the current session frozen while individual messages
-- continue to update last_interaction_at.

alter table public.iris_profiles
  add column if not exists current_session_started_at timestamptz,
  add column if not exists previous_session_ended_at timestamptz,
  add column if not exists session_gap_seconds bigint;

create index if not exists iris_profiles_current_session_started_at_idx
  on public.iris_profiles (current_session_started_at);

create or replace function public.begin_or_touch_temporal_session(
  p_user_id uuid,
  p_user_timezone text default null,
  p_session_timeout_seconds integer default 1800,
  p_now timestamptz default now()
)
returns table (
  user_id uuid,
  user_timezone text,
  last_interaction_at timestamptz,
  relationship_started_at timestamptz,
  last_photo_sent_at timestamptz,
  current_session_started_at timestamptz,
  previous_session_ended_at timestamptz,
  session_gap_seconds bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.iris_profiles%rowtype;
  v_is_new_session boolean := false;
  v_gap_seconds bigint := null;
  v_timezone text := nullif(trim(p_user_timezone), '');
begin
  if auth.uid() is distinct from p_user_id
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_session_timeout_seconds < 300 or p_session_timeout_seconds > 86400 then
    raise exception 'invalid_session_timeout' using errcode = '22023';
  end if;

  select *
    into v_profile
    from public.iris_profiles
   where iris_profiles.user_id = p_user_id
   for update;

  if not found then
    insert into public.iris_profiles (
      user_id,
      user_timezone,
      last_interaction_at,
      relationship_started_at,
      current_session_started_at,
      previous_session_ended_at,
      session_gap_seconds,
      updated_at
    ) values (
      p_user_id,
      coalesce(v_timezone, 'UTC'),
      p_now,
      p_now,
      p_now,
      null,
      null,
      p_now
    )
    returning * into v_profile;
  else
    v_is_new_session :=
      v_profile.last_interaction_at is null
      or extract(epoch from (p_now - v_profile.last_interaction_at)) > p_session_timeout_seconds;

    if v_is_new_session and v_profile.last_interaction_at is not null then
      v_gap_seconds := greatest(
        0,
        floor(extract(epoch from (p_now - v_profile.last_interaction_at)))::bigint
      );
    end if;

    update public.iris_profiles
       set user_timezone = coalesce(v_timezone, v_profile.user_timezone, 'UTC'),
           relationship_started_at = coalesce(v_profile.relationship_started_at, p_now),
           current_session_started_at = case
             when v_is_new_session then p_now
             else coalesce(v_profile.current_session_started_at, p_now)
           end,
           previous_session_ended_at = case
             when v_is_new_session and v_profile.last_interaction_at is not null
               then v_profile.last_interaction_at
             else v_profile.previous_session_ended_at
           end,
           session_gap_seconds = case
             when v_is_new_session then v_gap_seconds
             else v_profile.session_gap_seconds
           end,
           last_interaction_at = p_now,
           updated_at = p_now
     where iris_profiles.user_id = p_user_id
     returning * into v_profile;
  end if;

  return query
  select
    v_profile.user_id,
    v_profile.user_timezone,
    v_profile.last_interaction_at,
    v_profile.relationship_started_at,
    v_profile.last_photo_sent_at,
    v_profile.current_session_started_at,
    v_profile.previous_session_ended_at,
    v_profile.session_gap_seconds;
end;
$$;

revoke all on function public.begin_or_touch_temporal_session(uuid, text, integer, timestamptz)
  from public, anon;

grant execute on function public.begin_or_touch_temporal_session(uuid, text, integer, timestamptz)
  to authenticated, service_role;
