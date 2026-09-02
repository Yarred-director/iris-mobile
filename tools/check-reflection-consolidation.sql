-- Run after the migration, with iris.test_user_id set to an authorized test
-- account. Entire fixture and all changes are rolled back, including on errors.
begin;
set local statement_timeout = '10s';
set local lock_timeout = '3s';
set local role service_role;
do $$
declare
  uid uuid := current_setting('iris.test_user_id')::uuid;
  marker text := gen_random_uuid()::text;
  t1 uuid; t2 uuid; a1 uuid; a2 uuid; a3 uuid; a4 uuid;
  canonical_thought uuid; canonical_memory uuid;
  initial_revision bigint; rev bigint; cid uuid;
  initial_identity text; initial_ttl timestamptz;
  p jsonb; result jsonb; skip jsonb := '{"action":"skip","target_id":null,"merge_ids":[]}';
begin
  assert exists(select 1 from public.iris_profiles where user_id=uid), 'Test account missing';
  insert into public.iris_self_model(user_id) values(uid) on conflict(user_id) do nothing;
  select reflection_revision,narrative_identity into initial_revision,initial_identity from public.iris_self_model where user_id=uid;
  rev:=initial_revision;
  insert into public.iris_thoughts(user_id,content,expires_at) values(uid,marker||'-thought',now()+interval '2 days') returning id,expires_at into t1,initial_ttl;
  insert into public.iris_thoughts(user_id,content) values(uid,marker||'-paraphrase') returning id into t2;
  insert into public.iris_autobiographical_memory(user_id,narrative,self_meaning,created_at,source_context)
    values(uid,marker||'-memory','test meaning','2026-08-29 12:00Z','{"trigger":"exchange"}') returning id into a1;
  insert into public.iris_autobiographical_memory(user_id,narrative,created_at,source_context)
    values(uid,marker||'-exchange2','2026-08-30 12:00Z','{"trigger":"exchange"}') returning id into a2;
  insert into public.iris_autobiographical_memory(user_id,narrative,created_at,source_context)
    values(uid,marker||'-background','2026-08-31 12:00Z','{"trigger":"background_reflection"}') returning id into a3;
  insert into public.iris_autobiographical_memory(user_id,narrative,created_at,source_context)
    values(uid,marker||'-same-day','2026-08-30 14:00Z','{"trigger":"exchange"}') returning id into a4;
  result:=public.load_iris_reflection_snapshot(uid);
  assert (result->>'revision')::bigint=rev, 'Snapshot revision';
  assert jsonb_array_length(result->'thoughts')<=64, 'Bounded thoughts';
  assert jsonb_array_length(result->'autobiography')<=40, 'Bounded memories';

  p:=jsonb_build_object('self',jsonb_build_object('reflection',marker),
    'thoughts',jsonb_build_array(jsonb_build_object('action','duplicate','target_id',t1,'merge_ids',jsonb_build_array(t2))),
    'autobiography',jsonb_build_object('action','duplicate','target_id',a1,'merge_ids',jsonb_build_array(a3)),
    'personality',null,'evidence_ids','[]'::jsonb);
  cid:=gen_random_uuid();
  result:=public.commit_iris_reflection(uid,rev,cid,p); rev:=rev+1;
  assert (result->>'committed')::boolean and (result->>'inserted_thoughts')::int=0 and (result->>'inserted_memories')::int=0, 'Duplicate creates no rows';
  assert (select status='active' and expires_at=initial_ttl from public.iris_thoughts where id=t1), 'Duplicate must not extend TTL';
  assert (select status='resolved' and (metadata->>'consolidated_into')::uuid=t1 and content=marker||'-paraphrase' from public.iris_thoughts where id=t2), 'Superseded thought retained';
  assert (select consolidated_into=a1 and narrative=marker||'-background' from public.iris_autobiographical_memory where id=a3), 'Superseded memory retained';
  result:=public.commit_iris_reflection(uid,initial_revision,cid,p);
  assert (result->>'replayed')::boolean, 'Immediate replay idempotent';
  result:=public.commit_iris_reflection(uid,initial_revision,gen_random_uuid(),p);
  assert not (result->>'committed')::boolean, 'Stale revision rejected';

  p:=jsonb_build_object('self','{}'::jsonb,'thoughts',jsonb_build_array(jsonb_build_object('action','new','target_id',null,'merge_ids','[]'::jsonb,
    'data',jsonb_build_object('content',marker||'-thought','thought_type','reflection','salience',55,'emotional_weight',50))),
    'autobiography',jsonb_build_object('action','new','target_id',null,'merge_ids','[]'::jsonb,
      'data',jsonb_build_object('narrative',marker||'-memory','self_meaning','test meaning','event_type','reflection','importance',0.6,'emotional_weight',50)),
    'personality',null);
  result:=public.commit_iris_reflection(uid,rev,gen_random_uuid(),p); rev:=rev+1;
  assert (result->>'inserted_thoughts')::int=0 and (result->>'inserted_memories')::int=0, 'Global exact-content dedup';

  p:=jsonb_set(p,'{thoughts,0,action}','"revise"');
  p:=jsonb_set(p,'{thoughts,0,target_id}',to_jsonb(t1));
  p:=jsonb_set(p,'{thoughts,0,data,content}',to_jsonb(marker||'-changed-thought'));
  p:=jsonb_set(p,'{autobiography,action}','"revise"');
  p:=jsonb_set(p,'{autobiography,target_id}',to_jsonb(a1));
  p:=jsonb_set(p,'{autobiography,data,narrative}',to_jsonb(marker||'-changed-memory'));
  p:=p||'{"source_context":{"trigger":"background_reflection"}}'::jsonb;
  result:=public.commit_iris_reflection(uid,rev,gen_random_uuid(),p); rev:=rev+1;
  assert (result->>'inserted_thoughts')::int=1 and (result->>'inserted_memories')::int=1, 'Material revisions insert new canonical rows';
  select (metadata->>'consolidated_into')::uuid into canonical_thought from public.iris_thoughts where id=t1;
  select consolidated_into into canonical_memory from public.iris_autobiographical_memory where id=a1;
  assert (select content=marker||'-thought' and status='resolved' from public.iris_thoughts where id=t1), 'Original thought preserved';
  assert (select content=marker||'-changed-thought' and status='active' from public.iris_thoughts where id=canonical_thought), 'Revised thought active';
  assert (select narrative=marker||'-changed-memory' and consolidated_into is null from public.iris_autobiographical_memory where id=canonical_memory), 'Revised memory current';

  -- Invalid target follows a valid proposed insert: the whole RPC must roll back.
  p:=jsonb_build_object('self','{}'::jsonb,'thoughts',jsonb_build_array(
    jsonb_build_object('action','new','target_id',null,'merge_ids','[]'::jsonb,'data',jsonb_build_object('content',marker||'-must-rollback','thought_type','reflection','salience',55,'emotional_weight',50)),
    jsonb_build_object('action','duplicate','target_id',gen_random_uuid(),'merge_ids','[]'::jsonb)), 'autobiography',skip);
  begin
    perform public.commit_iris_reflection(uid,rev,gen_random_uuid(),p);
    raise exception 'Expected invalid target error';
  exception when others then
    if sqlerrm<>'reflection_target_changed' then raise; end if;
  end;
  assert not exists(select 1 from public.iris_thoughts where user_id=uid and content=marker||'-must-rollback'), 'No partial insert';
  assert (select reflection_revision=rev from public.iris_self_model where user_id=uid), 'Failure does not advance revision';

  p:=jsonb_build_object('self',jsonb_build_object('stable_narrative_identity',marker||'-stable'),
    'thoughts','[]'::jsonb,'autobiography',skip,'personality',null,'evidence_ids',jsonb_build_array(a1));
  for result in select value from jsonb_array_elements(jsonb_build_array(jsonb_build_array(a1),jsonb_build_array(a2,a3),jsonb_build_array(a2,a4))) loop
    begin
      perform public.commit_iris_reflection(uid,rev,gen_random_uuid(),jsonb_set(p,'{evidence_ids}',result));
      raise exception 'Expected insufficient evidence error';
    exception when others then
      if sqlerrm<>'insufficient_identity_evidence' then raise; end if;
    end;
  end loop;
  p:=jsonb_set(p,'{evidence_ids}',jsonb_build_array(a1,a2));
  p:=p||'{"personality":{"trait_state":{"curiosity":0.81},"trait_evidence":{"curiosity":"test evidence"},"developed_interests":["test interest"],"evolved_self_summary":"test stable summary"}}'::jsonb;
  result:=public.commit_iris_reflection(uid,rev,gen_random_uuid(),p); rev:=rev+1;
  assert (result->>'committed')::boolean, 'Distinct exchange evidence accepted';
  assert (select stable_narrative_identity=marker||'-stable' and narrative_identity is not distinct from initial_identity from public.iris_self_model where user_id=uid), 'Stable and legacy identity separated';
  assert (select trait_state->>'curiosity'='0.81' from public.iris_personality_evolution where user_id=uid), 'Approved trait update persisted';
  begin
    perform public.commit_iris_reflection(uid,rev,gen_random_uuid(),p);
    raise exception 'Expected reused evidence error';
  exception when others then
    if sqlerrm<>'identity_evidence_already_applied' then raise; end if;
  end;
  assert not has_function_privilege('anon','public.commit_iris_reflection(uuid,bigint,uuid,jsonb)','EXECUTE'), 'No anonymous writes';
  assert not has_function_privilege('authenticated','public.load_iris_reflection_snapshot(uuid)','EXECUTE'), 'No end-user cross-account snapshot reads';
end $$;
rollback;
select 'reflection_postgres_smoke_passed_all_fixture_changes_rolled_back' as result;
