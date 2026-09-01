-- Run inside BEGIN/ROLLBACK with SET LOCAL iris.test_user='<authorized user uuid>'.
-- No message, cooldown, or preference change from this check may be committed.
do $$
declare
  uid uuid := current_setting('iris.test_user')::uuid;
  r jsonb; r2 jsonb; result jsonb; original_count bigint; mid uuid;
begin
  select count(*) into original_count from public.chat_messages where user_id=uid;
  update public.iris_profiles set proactivity_enabled=true,
    last_interaction_at=now()-interval '4 days', user_timezone='UTC',
    proactivity_quiet_hours='{"start":"00:00","end":"00:00"}' where user_id=uid;
  update public.iris_self_model set last_proactive_at=null where user_id=uid;
  r:=public.claim_iris_proactive_run(uid);
  assert r is not null, 'test user already has a recent run; choose an idle authorized account';
  assert public.claim_iris_proactive_run(uid) is null, 'duplicate lease';
  begin
    perform public.finish_iris_proactive_run((r->>'id')::uuid,null,'skip',null);
    raise exception 'null lease accepted';
  exception when others then
    if sqlerrm <> 'proactive_lease_lost' then raise; end if;
  end;
  result:=public.finish_iris_proactive_run((r->>'id')::uuid,(r->>'lease_token')::uuid,'skip',null);
  assert result->>'status'='skipped', 'null skip reason must not send';
  update public.iris_proactive_runs set finished_at=now()-interval '4 hours' where id=(r->>'id')::uuid;

  r:=public.claim_iris_proactive_run(uid);
  begin
    perform public.finish_iris_proactive_run((r->>'id')::uuid,(r->>'lease_token')::uuid,'send',null,repeat('x',901));
    raise exception 'invalid message accepted';
  exception when others then
    if sqlerrm <> 'invalid_proactive_message' then raise; end if;
  end;
  assert (select last_proactive_at is null from public.iris_self_model where user_id=uid), 'failed send consumed cooldown';
  perform public.finish_iris_proactive_run((r->>'id')::uuid,(r->>'lease_token')::uuid,'error','test_failure');
  assert public.claim_iris_proactive_run(uid) is null, 'retry delay ignored';
  update public.iris_proactive_runs set next_attempt_at=now()-interval '1 minute' where id=(r->>'id')::uuid;
  r2:=public.claim_iris_proactive_run(uid);
  assert r2->>'attempts'='2' and r2->>'lease_token'<>r->>'lease_token', 'lease not rotated';
  begin
    perform public.finish_iris_proactive_run((r->>'id')::uuid,(r->>'lease_token')::uuid,'send',null,'test');
    raise exception 'stale lease accepted';
  exception when others then
    if sqlerrm <> 'proactive_lease_lost' then raise; end if;
  end;
  r:=r2;
  perform public.finish_iris_proactive_run((r->>'id')::uuid,(r->>'lease_token')::uuid,'error','test_failure');
  update public.iris_proactive_runs set next_attempt_at=now()-interval '1 minute' where id=(r->>'id')::uuid;
  r:=public.claim_iris_proactive_run(uid);
  assert r->>'attempts'='3', 'third retry missing';
  perform public.finish_iris_proactive_run((r->>'id')::uuid,(r->>'lease_token')::uuid,'error','test_failure');
  assert (select status='failed' from public.iris_proactive_runs where id=(r->>'id')::uuid), 'retries not bounded';
  update public.iris_proactive_runs set finished_at=now()-interval '4 hours' where id=(r->>'id')::uuid;

  r:=public.claim_iris_proactive_run(uid);
  update public.iris_profiles set proactivity_enabled=false where user_id=uid;
  result:=public.finish_iris_proactive_run((r->>'id')::uuid,(r->>'lease_token')::uuid,'send',null,'test');
  assert result->>'reason'='disabled', 'preference change not respected';
  update public.iris_proactive_runs set finished_at=now()-interval '4 hours' where id=(r->>'id')::uuid;
  update public.iris_profiles set proactivity_enabled=true where user_id=uid;

  r:=public.claim_iris_proactive_run(uid);
  result:=public.finish_iris_proactive_run((r->>'id')::uuid,(r->>'lease_token')::uuid,'send',null,'Transactional test: never commit');
  assert result->>'status'='sent', 'message not persisted';
  mid:=(result->>'message_id')::uuid;
  result:=public.finish_iris_proactive_run((r->>'id')::uuid,(r->>'lease_token')::uuid,'error','lost_response');
  assert result->>'status'='sent' and (result->>'message_id')::uuid=mid, 'finalization is not idempotent';
  assert (select count(*)=original_count+1 from public.chat_messages where user_id=uid), 'duplicate message';
  assert (select last_proactive_at=now() from public.iris_self_model where user_id=uid), 'cooldown not committed with message';
  assert (select push_status='pending' from public.iris_proactive_runs where id=(r->>'id')::uuid), 'push not queued';
  update public.iris_proactive_runs set finished_at=now()-interval '4 hours' where id=(r->>'id')::uuid;
  r:=public.claim_iris_proactive_run(uid);
  result:=public.finish_iris_proactive_run((r->>'id')::uuid,(r->>'lease_token')::uuid,'send',null,'test');
  assert result->>'reason'='cooldown', 'database cooldown ignored';
end $$;
