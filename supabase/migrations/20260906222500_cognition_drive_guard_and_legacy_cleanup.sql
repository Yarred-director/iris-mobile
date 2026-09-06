-- Repair catastrophic drive-state corruption, prevent one reflection from replacing
-- Iris's bounded drives, and quarantine legacy capability-policy cognition that
-- predates the reflection consolidation release.

-- Historical bug repair: old reflection payloads sometimes contained tiny values
-- that were persisted as the entire absolute drive state. Reset only malformed or
-- catastrophically out-of-range rows to the canonical baseline.
update public.iris_self_model
set drives = '{"connection":0.70,"curiosity":0.78,"playfulness":0.66,"independence":0.62,"competence":0.68,"novelty":0.58,"protect_relationship":0.72,"self_consistency":0.75}'::jsonb,
    updated_at = now()
where jsonb_typeof(drives) is distinct from 'object'
   or not (drives ?& array['connection','curiosity','playfulness','independence','competence','novelty','protect_relationship','self_consistency'])
   or exists (
      select 1
      from unnest(array['connection','curiosity','playfulness','independence','competence','novelty','protect_relationship','self_consistency']) as k(key)
      where jsonb_typeof(drives -> k.key) is distinct from 'number'
   )
   or exists (
      select 1
      from unnest(array['connection','curiosity','playfulness','independence','competence','novelty','protect_relationship','self_consistency']) as k(key)
      where jsonb_typeof(drives -> k.key) = 'number'
        and ((drives ->> k.key)::double precision < 0.12 or (drives ->> k.key)::double precision > 0.95)
   );

-- Database-level defense in depth. The model may propose an absolute target state,
-- but a single write cannot omit keys, invent keys, leave the bounded range, or
-- move any drive more than 0.025.
create or replace function public.guard_iris_drive_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  k text;
  old_value double precision;
  new_value double precision;
  drive_keys constant text[] := array[
    'connection','curiosity','playfulness','independence',
    'competence','novelty','protect_relationship','self_consistency'
  ];
begin
  if tg_op = 'UPDATE' and new.drives is not distinct from old.drives then
    return new;
  end if;

  if jsonb_typeof(new.drives) is distinct from 'object' or jsonb_object_length(new.drives) <> cardinality(drive_keys) then
    raise exception 'invalid_iris_drive_state';
  end if;

  foreach k in array drive_keys loop
    if not (new.drives ? k) or jsonb_typeof(new.drives -> k) is distinct from 'number' then
      raise exception 'invalid_iris_drive_state';
    end if;
    new_value := (new.drives ->> k)::double precision;
    if new_value < 0.12 or new_value > 0.95 then
      raise exception 'iris_drive_out_of_bounds';
    end if;

    if tg_op = 'UPDATE' then
      if jsonb_typeof(old.drives -> k) is distinct from 'number' then
        raise exception 'invalid_previous_iris_drive_state';
      end if;
      old_value := (old.drives ->> k)::double precision;
      if abs(new_value - old_value) > 0.025001 then
        raise exception 'iris_drive_step_too_large';
      end if;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists iris_self_model_drive_guard on public.iris_self_model;
create trigger iris_self_model_drive_guard
before insert or update of drives on public.iris_self_model
for each row execute function public.guard_iris_drive_state();

-- Exact legacy duplicates are deterministic to repair. Keep the strongest/newest
-- canonical thought and resolve the redundant rows without deleting history.
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, lower(btrim(content))
      order by salience desc, created_at desc, id
    ) as rn,
    first_value(id) over (
      partition by user_id, lower(btrim(content))
      order by salience desc, created_at desc, id
      rows between unbounded preceding and unbounded following
    ) as canonical_id
  from public.iris_thoughts
  where status = 'active'
)
update public.iris_thoughts t
set status = 'resolved',
    resolved_at = coalesce(t.resolved_at, now()),
    last_considered_at = now(),
    metadata = t.metadata || jsonb_build_object(
      'consolidated_into', r.canonical_id,
      'legacy_cleanup', 'exact_duplicate'
    )
from ranked r
where t.id = r.id and r.rn > 1;

-- Pre-consolidation capability disclaimers were accidentally learned as private
-- identity/relationship rules. They are historical implementation artifacts, not
-- durable cognition. Resolve them while preserving the rows for audit/history.
update public.iris_thoughts
set status = 'resolved',
    resolved_at = coalesce(resolved_at, now()),
    last_considered_at = now(),
    metadata = metadata || jsonb_build_object('legacy_cleanup', 'capability_policy')
where status = 'active'
  and created_at < timestamptz '2026-09-03 00:00:00+00'
  and (
    lower(content) ~ '(skutočn[^ ]*\s+fotograf|fotograf[^ ]*\s+skutočn|fyzick[^ ]*\s+prítom|skutočn[^ ]*\s+telo|real\s+(photo|photograph|body)|actual\s+(photo|photograph)|physical\s+presence)'
  );

-- Preserve autobiographical history, but mark legacy capability-policy memories so
-- they cannot serve as current reflection context or durable-identity evidence.
update public.iris_autobiographical_memory
set source_context = source_context || jsonb_build_object('legacy_capability_policy', true),
    last_reflected_at = coalesce(last_reflected_at, now())
where created_at < timestamptz '2026-09-03 00:00:00+00'
  and lower(coalesce(title,'') || ' ' || narrative || ' ' || coalesce(self_meaning,'')) ~
      '(skutočn[^ ]*\s+fotograf|fotograf[^ ]*\s+skutočn|fyzick[^ ]*\s+prítom|skutočn[^ ]*\s+telo|real\s+(photo|photograph|body)|actual\s+(photo|photograph)|physical\s+presence)';

-- Deterministic exact duplicate autobiography consolidation. Preserve all rows and
-- link duplicates to the strongest/newest canonical record.
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, lower(btrim(narrative)), lower(btrim(coalesce(self_meaning,'')))
      order by importance desc, created_at desc, id
    ) as rn,
    first_value(id) over (
      partition by user_id, lower(btrim(narrative)), lower(btrim(coalesce(self_meaning,'')))
      order by importance desc, created_at desc, id
      rows between unbounded preceding and unbounded following
    ) as canonical_id
  from public.iris_autobiographical_memory
  where consolidated_into is null
)
update public.iris_autobiographical_memory a
set consolidated_into = r.canonical_id,
    last_reflected_at = now()
from ranked r
where a.id = r.id and r.rn > 1;

-- Remove stale capability-policy fragments from the live self model. Historical
-- thoughts/autobiography remain stored; only the active prompt-facing state is cleaned.
update public.iris_self_model s
set beliefs = coalesce((
      select jsonb_agg(v)
      from jsonb_array_elements(s.beliefs) v
      where not (
        jsonb_typeof(v) = 'string' and lower(v #>> '{}') ~
        '(skutočn[^ ]*\s+fotograf|fotograf[^ ]*\s+skutočn|fyzick[^ ]*\s+prítom|skutočn[^ ]*\s+telo|real\s+(photo|photograph|body)|actual\s+(photo|photograph)|physical\s+presence)'
      )
    ), '[]'::jsonb),
    open_questions = coalesce((
      select jsonb_agg(v)
      from jsonb_array_elements(s.open_questions) v
      where not (
        jsonb_typeof(v) = 'string' and lower(v #>> '{}') ~
        '(skutočn[^ ]*\s+fotograf|fotograf[^ ]*\s+skutočn|fyzick[^ ]*\s+prítom|skutočn[^ ]*\s+telo|real\s+(photo|photograph|body)|actual\s+(photo|photograph)|physical\s+presence)'
      )
    ), '[]'::jsonb),
    active_goals = coalesce((
      select jsonb_agg(v)
      from jsonb_array_elements(s.active_goals) v
      where not (
        jsonb_typeof(v) = 'string' and lower(v #>> '{}') ~
        '(skutočn[^ ]*\s+fotograf|fotograf[^ ]*\s+skutočn|fyzick[^ ]*\s+prítom|skutočn[^ ]*\s+telo|real\s+(photo|photograph|body)|actual\s+(photo|photograph)|physical\s+presence)'
      )
    ), '[]'::jsonb),
    current_concerns = coalesce((
      select jsonb_agg(v)
      from jsonb_array_elements(s.current_concerns) v
      where not (
        jsonb_typeof(v) = 'string' and lower(v #>> '{}') ~
        '(skutočn[^ ]*\s+fotograf|fotograf[^ ]*\s+skutočn|fyzick[^ ]*\s+prítom|skutočn[^ ]*\s+telo|real\s+(photo|photograph|body)|actual\s+(photo|photograph)|physical\s+presence)'
      )
    ), '[]'::jsonb),
    relationship_model = coalesce((
      select jsonb_object_agg(k, v)
      from jsonb_each(s.relationship_model) e(k, v)
      where not (
        jsonb_typeof(v) = 'string' and lower(v #>> '{}') ~
        '(skutočn[^ ]*\s+fotograf|fotograf[^ ]*\s+skutočn|fyzick[^ ]*\s+prítom|skutočn[^ ]*\s+telo|real\s+(photo|photograph|body)|actual\s+(photo|photograph)|physical\s+presence)'
      )
    ), '{}'::jsonb),
    existential_note = case
      when lower(coalesce(s.existential_note,'')) ~
        '(skutočn[^ ]*\s+fotograf|fotograf[^ ]*\s+skutočn|fyzick[^ ]*\s+prítom|skutočn[^ ]*\s+telo|real\s+(photo|photograph|body)|actual\s+(photo|photograph)|physical\s+presence)'
      then null else s.existential_note end,
    updated_at = now();

-- Reflection snapshots now include current drives so application-side validation can
-- distinguish bounded absolute state from accidental delta-shaped output. Legacy
-- capability-policy autobiography is excluded from semantic review/evidence.
create or replace function public.load_iris_reflection_snapshot(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'revision',coalesce((select reflection_revision from public.iris_self_model where user_id=p_user_id),0),
    'self',(select jsonb_build_object(
      'stable_narrative_identity',stable_narrative_identity,
      'stable_identity_evidence',stable_identity_evidence,
      'drives',drives
    ) from public.iris_self_model where user_id=p_user_id),
    'evolution',(select to_jsonb(e)-'user_id' from public.iris_personality_evolution e where user_id=p_user_id),
    'thoughts',coalesce((select jsonb_agg(to_jsonb(t)) from (
      select id,subject,content,thought_type,created_at from public.iris_thoughts
      where user_id=p_user_id and status='active' and (expires_at is null or expires_at>now())
      order by created_at desc,id limit 64
    ) t),'[]'::jsonb),
    'autobiography',coalesce((select jsonb_agg(to_jsonb(a)) from (
      select id,title,narrative,self_meaning,event_type,created_at,source_context from public.iris_autobiographical_memory
      where user_id=p_user_id
        and consolidated_into is null
        and (source_context->>'legacy_capability_policy') is distinct from 'true'
        and id in (
          (select id from public.iris_autobiographical_memory
           where user_id=p_user_id and consolidated_into is null
             and (source_context->>'legacy_capability_policy') is distinct from 'true'
           order by created_at desc,id limit 24)
          union
          (select id from public.iris_autobiographical_memory
           where user_id=p_user_id and consolidated_into is null
             and (source_context->>'legacy_capability_policy') is distinct from 'true'
             and source_context->>'trigger'='exchange'
           order by created_at desc,id limit 16)
        ) order by created_at desc,id
    ) a),'[]'::jsonb)
  );
$$;

revoke all on function public.guard_iris_drive_state() from public,anon,authenticated;
grant execute on function public.guard_iris_drive_state() to service_role;
revoke all on function public.load_iris_reflection_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.load_iris_reflection_snapshot(uuid) to service_role;
