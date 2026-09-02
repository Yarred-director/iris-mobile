-- Additive: legacy scene-derived narratives remain stored, never promoted to
-- stable identity. Superseded memories are linked, not deleted.
alter table public.iris_self_model
  add column reflection_revision bigint not null default 0,
  add column last_reflection_commit_id uuid,
  add column stable_narrative_identity text,
  add column stable_identity_evidence jsonb not null default '[]'::jsonb;
alter table public.iris_autobiographical_memory
  add column consolidated_into uuid references public.iris_autobiographical_memory(id) on delete set null,
  add constraint iris_autobiography_not_self_merged check (consolidated_into is distinct from id);
create index iris_autobiography_consolidated_idx on public.iris_autobiographical_memory(consolidated_into) where consolidated_into is not null;
create index iris_autobiography_current_idx on public.iris_autobiographical_memory(user_id,created_at desc) where consolidated_into is null;

create function public.load_iris_reflection_snapshot(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'revision',coalesce((select reflection_revision from public.iris_self_model where user_id=p_user_id),0),
    'self',(select jsonb_build_object('stable_narrative_identity',stable_narrative_identity,'stable_identity_evidence',stable_identity_evidence) from public.iris_self_model where user_id=p_user_id),
    'evolution',(select to_jsonb(e)-'user_id' from public.iris_personality_evolution e where user_id=p_user_id),
    'thoughts',coalesce((select jsonb_agg(to_jsonb(t)) from (
      select id,subject,content,thought_type,created_at from public.iris_thoughts
      where user_id=p_user_id and status='active' and (expires_at is null or expires_at>now())
      order by created_at desc,id limit 64
    ) t),'[]'::jsonb),
    'autobiography',coalesce((select jsonb_agg(to_jsonb(a)) from (
      select id,title,narrative,self_meaning,event_type,created_at,source_context from public.iris_autobiographical_memory
      where user_id=p_user_id and consolidated_into is null and id in (
        (select id from public.iris_autobiographical_memory where user_id=p_user_id and consolidated_into is null order by created_at desc,id limit 24)
        union
        -- Background sweeps must not crowd all original exchange evidence out.
        (select id from public.iris_autobiographical_memory where user_id=p_user_id and consolidated_into is null and source_context->>'trigger'='exchange' order by created_at desc,id limit 16)
      ) order by created_at desc,id
    ) a),'[]'::jsonb)
  );
$$;

create function public.commit_iris_reflection(p_user_id uuid,p_expected_revision bigint,p_commit_id uuid,p_plan jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  s public.iris_self_model%rowtype;
  sp public.iris_self_model%rowtype;
  ep public.iris_personality_evolution%rowtype;
  item jsonb; payload jsonb; kind text; action text; target uuid; canonical uuid; old_id uuid;
  seen_thoughts uuid[] := '{}'; seen_memories uuid[] := '{}';
  evidence uuid[]; evidence_count integer; evidence_days integer;
  inserted_thoughts integer := 0; inserted_memories integer := 0;
begin
  if p_user_id is null or p_commit_id is null or p_expected_revision is null or jsonb_typeof(p_plan) is distinct from 'object' then
    raise exception 'invalid_reflection_plan';
  end if;
  -- Same lock order as proactive delivery; no LLM calls inside this transaction.
  perform 1 from public.iris_profiles where user_id=p_user_id for update;
  if not found then raise exception 'reflection_profile_missing'; end if;
  insert into public.iris_self_model(user_id) values(p_user_id) on conflict(user_id) do nothing;
  select * into s from public.iris_self_model where user_id=p_user_id for update;
  if s.last_reflection_commit_id=p_commit_id then return jsonb_build_object('committed',true,'replayed',true); end if;
  if s.reflection_revision<>p_expected_revision then return jsonb_build_object('committed',false,'reason','revision_conflict'); end if;
  if jsonb_typeof(p_plan->'thoughts') is distinct from 'array' or jsonb_array_length(p_plan->'thoughts')>4 then raise exception 'invalid_reflection_plan'; end if;

  for kind,item in
    select 'thought',value from jsonb_array_elements(p_plan->'thoughts')
    union all select 'memory',p_plan->'autobiography'
  loop
    action:=item->>'action'; target:=nullif(item->>'target_id','')::uuid;
    payload:=item->'data'; canonical:=null;
    if action is null or action not in ('new','duplicate','revise','skip') or
      jsonb_typeof(item->'merge_ids') is distinct from 'array' or jsonb_array_length(item->'merge_ids')>8 then raise exception 'invalid_reflection_action'; end if;
    if action in ('new','skip') and (target is not null or jsonb_array_length(item->'merge_ids')>0) then raise exception 'invalid_reflection_target'; end if;
    if action='skip' then continue; end if;
    if action in ('duplicate','revise') then
      if kind='thought' then
        perform 1 from public.iris_thoughts where id=target and user_id=p_user_id and status='active' and (expires_at is null or expires_at>now());
      else
        perform 1 from public.iris_autobiographical_memory where id=target and user_id=p_user_id and consolidated_into is null;
      end if;
      if not found then raise exception 'reflection_target_changed'; end if;
    end if;
    if action in ('new','revise') then
      if kind='thought' then
        if coalesce(length(btrim(payload->>'content')),0)=0 or length(payload->>'content')>600 then raise exception 'invalid_reflection_content'; end if;
        -- Global exact-content guard even outside the bounded semantic window.
        select id into canonical from public.iris_thoughts where user_id=p_user_id and status='active'
          and (expires_at is null or expires_at>now()) and lower(btrim(content))=lower(btrim(payload->>'content')) order by created_at,id limit 1;
        if canonical is null then
          insert into public.iris_thoughts(user_id,thought_type,subject,content,salience,emotional_weight,expires_at,metadata)
            values(p_user_id,payload->>'thought_type',payload->>'subject',payload->>'content',(payload->>'salience')::smallint,
              (payload->>'emotional_weight')::smallint,(payload->>'expires_at')::timestamptz,
              jsonb_build_object('reflection_commit_id',p_commit_id,'consolidation_reason',item->>'reason','revises',target)) returning id into canonical;
          inserted_thoughts:=inserted_thoughts+1;
        end if;
      else
        if coalesce(length(btrim(payload->>'narrative')),0)=0 or length(payload->>'narrative')>1000 then raise exception 'invalid_reflection_content'; end if;
        select id into canonical from public.iris_autobiographical_memory where user_id=p_user_id and consolidated_into is null
          and lower(btrim(narrative))=lower(btrim(payload->>'narrative'))
          and lower(btrim(coalesce(self_meaning,'')))=lower(btrim(coalesce(payload->>'self_meaning',''))) order by created_at,id limit 1;
        if canonical is null then
          insert into public.iris_autobiographical_memory(user_id,event_type,title,narrative,self_meaning,importance,emotional_weight,source_context)
            values(p_user_id,payload->>'event_type',payload->>'title',payload->>'narrative',payload->>'self_meaning',
              (payload->>'importance')::double precision,(payload->>'emotional_weight')::smallint,
              coalesce(p_plan->'source_context','{}'::jsonb)||jsonb_build_object('reflection_commit_id',p_commit_id,'consolidation_reason',item->>'reason','revises',target)) returning id into canonical;
          inserted_memories:=inserted_memories+1;
        end if;
      end if;
    else canonical:=target;
    end if;
    -- Preserve all superseded rows. A duplicate never renews TTL or salience.
    for old_id in select value::uuid from jsonb_array_elements_text(item->'merge_ids')
      union all select target where target is not null
    loop
      if kind='thought' then
        if old_id=any(seen_thoughts) then raise exception 'duplicate_reflection_target'; end if;
        seen_thoughts:=array_append(seen_thoughts,old_id);
        update public.iris_thoughts set last_considered_at=now(),
          status=case when id=canonical then status else 'resolved' end,
          resolved_at=case when id=canonical then resolved_at else now() end,
          metadata=case when id=canonical then metadata else metadata||jsonb_build_object('consolidated_into',canonical,'reflection_commit_id',p_commit_id) end
          where id=old_id and user_id=p_user_id and status='active';
      else
        if old_id=any(seen_memories) then raise exception 'duplicate_reflection_target'; end if;
        seen_memories:=array_append(seen_memories,old_id);
        update public.iris_autobiographical_memory set last_reflected_at=now(),
          consolidated_into=case when id=canonical then null else canonical end
          where id=old_id and user_id=p_user_id and consolidated_into is null;
      end if;
      if not found then raise exception 'reflection_target_changed'; end if;
    end loop;
  end loop;

  for old_id in select value::uuid from jsonb_array_elements_text(coalesce(p_plan->'resolved_ids','[]'::jsonb)) loop
    update public.iris_thoughts set status='resolved',resolved_at=now() where id=old_id and user_id=p_user_id and status='active';
    if not found then raise exception 'reflection_target_changed'; end if;
  end loop;

  if (p_plan->'personality' is not null and p_plan->'personality'<>'null'::jsonb)
     or (p_plan->'self' ? 'stable_narrative_identity') then
    evidence:=array(select value::uuid from jsonb_array_elements_text(p_plan->'evidence_ids'));
    select count(distinct id),count(distinct (created_at at time zone 'UTC')::date) into evidence_count,evidence_days
      from public.iris_autobiographical_memory where user_id=p_user_id and id=any(evidence)
        and source_context->>'trigger'='exchange';
    if coalesce(cardinality(evidence),0)<2 or evidence_count<>cardinality(evidence) or evidence_days<2 then raise exception 'insufficient_identity_evidence'; end if;
    -- The same evidence cannot repeatedly push traits during background sweeps.
    if s.stable_identity_evidence @> to_jsonb(evidence) then raise exception 'identity_evidence_already_applied'; end if;
  end if;
  sp:=jsonb_populate_record(s,coalesce(p_plan->'self','{}'::jsonb)-'narrative_identity');
  update public.iris_self_model set reflection=sp.reflection,existential_note=sp.existential_note,last_insight=sp.last_insight,
    mood=sp.mood,drives=sp.drives,beliefs=sp.beliefs,open_questions=sp.open_questions,active_goals=sp.active_goals,
    current_concerns=sp.current_concerns,relationship_model=sp.relationship_model,
    stable_narrative_identity=sp.stable_narrative_identity,
    stable_identity_evidence=case when evidence is null then stable_identity_evidence else
      (select jsonb_agg(distinct value) from jsonb_array_elements(stable_identity_evidence||to_jsonb(evidence))) end,
    reflection_revision=reflection_revision+1,last_reflection_commit_id=p_commit_id,
    last_reflection_at=now(),updated_at=now(),cognition_version=3 where user_id=p_user_id;
  if p_plan->'personality' is not null and p_plan->'personality'<>'null'::jsonb then
    insert into public.iris_personality_evolution(user_id) values(p_user_id) on conflict(user_id) do nothing;
    select * into ep from public.iris_personality_evolution where user_id=p_user_id for update;
    ep:=jsonb_populate_record(ep,p_plan->'personality');
    update public.iris_personality_evolution set trait_state=ep.trait_state,trait_evidence=ep.trait_evidence,
      developed_interests=ep.developed_interests,evolved_self_summary=ep.evolved_self_summary,
      evolution_count=coalesce(evolution_count,0)+1,last_evolution_at=now(),updated_at=now() where user_id=p_user_id;
  end if;
  return jsonb_build_object('committed',true,'revision',s.reflection_revision+1,'inserted_thoughts',inserted_thoughts,'inserted_memories',inserted_memories);
end $$;

revoke all on function public.load_iris_reflection_snapshot(uuid) from public,anon,authenticated;
revoke all on function public.commit_iris_reflection(uuid,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.load_iris_reflection_snapshot(uuid) to service_role;
grant execute on function public.commit_iris_reflection(uuid,bigint,uuid,jsonb) to service_role;
