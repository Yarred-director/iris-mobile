-- Memory and scene RPCs as they existed in production on 2026-10-22 (reference snapshot).
-- search_path hardening for these functions lives in supabase/migrations.

create or replace function public.match_episodic_memory_v2(query_embedding vector, match_threshold double precision, match_count integer, p_user_id uuid, w_similarity double precision default 0.7, w_importance double precision default 0.3)
returns table(id uuid, title text, narrative text, emotional_tags text[], importance double precision, created_at timestamptz, similarity double precision)
language sql stable as $$
  select em.id, em.title, em.narrative, em.emotional_tags, em.importance, em.created_at,
         (1 - (em.embedding <=> query_embedding)) as similarity
  from public.episodic_memory em
  where em.user_id = p_user_id
    and em.embedding is not null
    and (1 - (em.embedding <=> query_embedding)) >= match_threshold
    and (em.decay_score is null or em.decay_score >= 10)
  order by (w_similarity * (1 - (em.embedding <=> query_embedding)) + w_importance * coalesce(em.importance, 0.5)) desc
  limit match_count;
$$;

create or replace function public.match_shared_experiences(query_embedding vector, match_threshold double precision, match_count integer, p_user_id uuid)
returns table(id uuid, location text, summary text, actions text[], emotional_tone text, intensity text, iris_emotion text, importance double precision, created_at timestamptz, similarity double precision)
language plpgsql as $$
begin
  return query
  select e.id, e.location, e.summary, e.actions, e.emotional_tone, e.intensity, e.iris_emotion, e.importance, e.created_at,
         1 - (e.embedding <=> query_embedding) as similarity
  from public.shared_experiences e
  where e.user_id = p_user_id
    and e.embedding is not null
    and 1 - (e.embedding <=> query_embedding) > match_threshold
  order by e.embedding <=> query_embedding
  limit match_count;
end;
$$;

create or replace function public.get_scene_facts(p_user_id text, p_scene_key text, p_scope text default 'global')
returns table(fact_key text, fact_value text, value_type text, confidence double precision, source text, updated_at timestamptz)
language sql stable as $$
  select fact_key, fact_value, value_type, confidence, source, updated_at
  from public.scene_facts
  where user_id = p_user_id and scene_key = p_scene_key and scope = p_scope
  order by updated_at desc;
$$;

create or replace function public.upsert_scene_fact(p_user_id text, p_scene_key text, p_scope text, p_fact_key text, p_fact_value text, p_value_type text default 'text', p_confidence double precision default 0.9, p_source text default 'user')
returns void language sql as $$
  insert into public.scene_facts(user_id, scene_key, scope, fact_key, fact_value, value_type, confidence, source)
  values (p_user_id, p_scene_key, coalesce(p_scope, 'global'), p_fact_key, p_fact_value, p_value_type, p_confidence, p_source)
  on conflict (user_id, scene_key, scope, fact_key) do update set
    fact_value = excluded.fact_value, value_type = excluded.value_type,
    confidence = excluded.confidence, source = excluded.source, updated_at = now();
$$;

create or replace function public.get_scene_context(p_scene_key text)
returns table(user_id text, scene_key text, country text, city text, place text, location_country text, location_city text, time_of_day text, room text, interaction_mode text, last_subject text, last_engine text, last_engine_reply text, bridge_buffer jsonb, updated_at timestamptz, engine_lock_count integer, session_gap_anchor timestamptz)
language sql security definer as $$
  select sc.user_id, sc.scene_key, sc.country, sc.city, sc.place, sc.location_country, sc.location_city,
         sc.time_of_day, sc.room, sc.interaction_mode, sc.last_subject, sc.last_engine, sc.last_engine_reply,
         sc.bridge_buffer, sc.updated_at, sc.engine_lock_count, sc.session_gap_anchor
  from public.scene_context sc
  where sc.user_id = auth.uid()::text and sc.scene_key = coalesce(p_scene_key, 'global')
  limit 1;
$$;

create or replace function public.patch_scene_context(p_scene_key text, p_patch jsonb)
returns void language plpgsql security definer as $$
declare
  v_user_id text := auth.uid()::text;
begin
  if v_user_id is null then
    raise exception 'patch_scene_context: auth.uid() is null (no JWT / not authenticated)';
  end if;
  insert into public.scene_context as sc (
    user_id, scene_key, country, city, place, location_country, location_city, time_of_day, room,
    interaction_mode, last_subject, last_engine, last_engine_reply, bridge_buffer, engine_lock_count, session_gap_anchor
  ) values (
    v_user_id, coalesce(p_scene_key, 'global'),
    p_patch->>'country', p_patch->>'city', p_patch->>'place',
    p_patch->>'location_country', p_patch->>'location_city', p_patch->>'time_of_day', p_patch->>'room',
    p_patch->>'interaction_mode', p_patch->>'last_subject', p_patch->>'last_engine', p_patch->>'last_engine_reply',
    p_patch->'bridge_buffer', nullif(p_patch->>'engine_lock_count', '')::integer,
    nullif(p_patch->>'session_gap_anchor', '')::timestamptz
  )
  on conflict (user_id, scene_key) do update set
    country = coalesce(excluded.country, sc.country),
    city = coalesce(excluded.city, sc.city),
    place = coalesce(excluded.place, sc.place),
    location_country = coalesce(excluded.location_country, sc.location_country),
    location_city = coalesce(excluded.location_city, sc.location_city),
    time_of_day = coalesce(excluded.time_of_day, sc.time_of_day),
    room = coalesce(excluded.room, sc.room),
    interaction_mode = coalesce(excluded.interaction_mode, sc.interaction_mode),
    last_subject = coalesce(excluded.last_subject, sc.last_subject),
    last_engine = coalesce(excluded.last_engine, sc.last_engine),
    last_engine_reply = coalesce(excluded.last_engine_reply, sc.last_engine_reply),
    bridge_buffer = coalesce(excluded.bridge_buffer, sc.bridge_buffer),
    engine_lock_count = coalesce(excluded.engine_lock_count, sc.engine_lock_count),
    session_gap_anchor = coalesce(excluded.session_gap_anchor, sc.session_gap_anchor);
end;
$$;
