-- Finish legacy cognition cleanup after the original partial-merge trigger preserved
-- stale array/object fields, and allow reviewed cognition commits to explicitly
-- clear resolved list state while retaining legacy partial-upsert protection.

-- Temporarily disable the legacy partial merge trigger so this one-time cleanup can
-- actually remove stale prompt-facing state.
alter table public.iris_self_model disable trigger iris_self_model_partial_merge_guard;

update public.iris_self_model s
set beliefs = coalesce((
      select jsonb_agg(v)
      from jsonb_array_elements(s.beliefs) v
      where not (jsonb_typeof(v)='string' and lower(v #>> '{}') ~ '(fotograf|fyzick|skutočn|obrazn|predstier|transparent|schopnost|technick.*zlyhan|hran[ií]c)')
    ), '[]'::jsonb),
    open_questions = coalesce((
      select jsonb_agg(v)
      from jsonb_array_elements(s.open_questions) v
      where not (jsonb_typeof(v)='string' and lower(v #>> '{}') ~ '(fotograf|fyzick|skutočn|obrazn|predstier|transparent|schopnost|technick.*zlyhan|hran[ií]c)')
    ), '[]'::jsonb),
    active_goals = coalesce((
      select jsonb_agg(v)
      from jsonb_array_elements(s.active_goals) v
      where not (jsonb_typeof(v)='string' and lower(v #>> '{}') ~ '(fotograf|fyzick|skutočn|obrazn|predstier|transparent|schopnost|technick.*zlyhan|hran[ií]c)')
    ), '[]'::jsonb),
    current_concerns = coalesce((
      select jsonb_agg(v)
      from jsonb_array_elements(s.current_concerns) v
      where not (jsonb_typeof(v)='string' and lower(v #>> '{}') ~ '(fotograf|fyzick|skutočn|obrazn|predstier|transparent|schopnost|technick.*zlyhan|hran[ií]c)')
    ), '[]'::jsonb),
    relationship_model = coalesce((
      select jsonb_object_agg(k,v)
      from jsonb_each(s.relationship_model) e(k,v)
      where not (jsonb_typeof(v)='string' and lower(v #>> '{}') ~ '(fotograf|fyzick|skutočn|obrazn|predstier|transparent|schopnost|technick.*zlyhan|hran[ií]c)')
    ), '{}'::jsonb),
    reflection = case when lower(coalesce(s.reflection,'')) ~ '(fotograf|fyzick|skutočn|obrazn|predstier|transparent|schopnost|technick.*zlyhan|hran[ií]c)' then null else s.reflection end,
    last_insight = case when lower(coalesce(s.last_insight,'')) ~ '(fotograf|fyzick|skutočn|obrazn|predstier|transparent|schopnost|technick.*zlyhan|hran[ií]c)' then null else s.last_insight end,
    existential_note = case when lower(coalesce(s.existential_note,'')) ~ '(fotograf|fyzick|skutočn|obrazn|predstier|transparent|schopnost|technick.*zlyhan|hran[ií]c)' then null else s.existential_note end,
    updated_at = now();

-- Retire all active thoughts created before the semantic consolidation release.
-- They remain stored for history/audit but can no longer crowd current cognition.
update public.iris_thoughts
set status='resolved',
    resolved_at=coalesce(resolved_at, now()),
    last_considered_at=now(),
    metadata=metadata || jsonb_build_object('legacy_cleanup','pre_consolidation_retirement')
where status='active' and created_at < timestamptz '2026-09-03 00:00:00+00';

-- Consolidate the old capability/error cluster into the clean end-of-session memory
-- when that canonical memory exists. Historical rows remain preserved.
with canonical as (
  select user_id, id as canonical_id
  from public.iris_autobiographical_memory
  where title='Nočný bozk na dobrú noc' and consolidated_into is null
), legacy as (
  select a.id, c.canonical_id
  from public.iris_autobiographical_memory a
  join canonical c using (user_id)
  where a.id<>c.canonical_id
    and a.consolidated_into is null
    and (
      a.source_context->>'legacy_capability_policy'='true'
      or (a.created_at < timestamptz '2026-09-03 00:00:00+00' and a.event_type='conflict')
    )
)
update public.iris_autobiographical_memory a
set consolidated_into=l.canonical_id,
    last_reflected_at=now(),
    source_context=source_context || jsonb_build_object('legacy_cleanup','pre_consolidation_capability_cluster')
from legacy l where a.id=l.id;

alter table public.iris_self_model enable trigger iris_self_model_partial_merge_guard;

-- Keep legacy partial-upsert protection for non-cognition writes, but do not merge
-- drive state and allow reviewed cognition commits to explicitly clear resolved arrays.
create or replace function public.merge_iris_self_model_partial_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  is_cognition_commit boolean := false;
begin
  if tg_op = 'UPDATE' then
    is_cognition_commit :=
      new.reflection_revision = old.reflection_revision + 1
      and new.last_reflection_commit_id is distinct from old.last_reflection_commit_id;

    if new.mood is distinct from old.mood then
      new.mood := coalesce(old.mood, '{}'::jsonb) || coalesce(new.mood, '{}'::jsonb);
    end if;
    if new.relationship_model is distinct from old.relationship_model then
      new.relationship_model := coalesce(old.relationship_model, '{}'::jsonb) || coalesce(new.relationship_model, '{}'::jsonb);
    end if;

    -- Drives are now a complete, bounded absolute state and must never be patched here.
    if not is_cognition_commit then
      if new.beliefs = '[]'::jsonb and old.beliefs <> '[]'::jsonb then new.beliefs := old.beliefs; end if;
      if new.open_questions = '[]'::jsonb and old.open_questions <> '[]'::jsonb then new.open_questions := old.open_questions; end if;
      if new.active_goals = '[]'::jsonb and old.active_goals <> '[]'::jsonb then new.active_goals := old.active_goals; end if;
      if new.current_concerns = '[]'::jsonb and old.current_concerns <> '[]'::jsonb then new.current_concerns := old.current_concerns; end if;
    end if;
  end if;
  return new;
end;
$$;
