-- Service-only durable decisions, leases, retries and atomic chat delivery.
create table public.iris_proactive_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'running' check (status in ('running','retry','skipped','sent','failed')),
  lease_token uuid not null default gen_random_uuid(),
  lease_until timestamptz not null default (now() + interval '10 minutes'),
  attempts integer not null default 1 check (attempts between 1 and 3),
  next_attempt_at timestamptz,
  outcome text,
  message_id uuid references public.chat_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  push_status text not null default 'none' check (push_status in ('none','pending','sending','retry','accepted','unavailable','failed')),
  push_attempts integer not null default 0,
  push_next_at timestamptz,
  push_lease_token uuid,
  push_result jsonb
);
create unique index iris_proactive_one_active on public.iris_proactive_runs(user_id) where status in ('running','retry');
create index iris_proactive_user_recent on public.iris_proactive_runs(user_id,created_at desc);
create index iris_proactive_push_pending on public.iris_proactive_runs(push_next_at) where push_status in ('pending','sending','retry');
alter table public.iris_proactive_runs enable row level security;
revoke all on public.iris_proactive_runs from public, anon, authenticated;
grant select, insert, update, delete on public.iris_proactive_runs to service_role;

create function public.claim_iris_proactive_run(p_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.iris_proactive_runs%rowtype;
begin
  -- Shared per-user lock serializes competing workers and preference/session writes.
  perform 1 from public.iris_profiles where user_id=p_user_id for update;
  if not found then return null; end if;
  select * into r from public.iris_proactive_runs
    where user_id=p_user_id and status in ('running','retry') for update;
  if found then
    if (r.status='running' and r.lease_until>now()) or (r.status='retry' and r.next_attempt_at>now()) then return null; end if;
    if r.attempts>=3 then
      update public.iris_proactive_runs set status='failed', outcome='attempts_exhausted', finished_at=now() where id=r.id;
      return null;
    end if;
    update public.iris_proactive_runs set status='running', attempts=attempts+1,
      lease_token=gen_random_uuid(), lease_until=now()+interval '10 minutes', next_attempt_at=null
      where id=r.id returning * into r;
  else
    if exists(select 1 from public.iris_proactive_runs where user_id=p_user_id
      and coalesce(finished_at,created_at)>now()-interval '3 hours') then return null; end if;
    insert into public.iris_proactive_runs(user_id) values(p_user_id) returning * into r;
  end if;
  return jsonb_build_object('id',r.id,'lease_token',r.lease_token,'attempts',r.attempts);
end $$;

create function public.finish_iris_proactive_run(
  p_run_id uuid, p_lease_token uuid, p_action text, p_reason text,
  p_message text default null, p_subject text default null, p_cooldown_hours integer default 16
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  r public.iris_proactive_runs%rowtype;
  p public.iris_profiles%rowtype;
  uid uuid;
  last_sent timestamptz;
  quiet_start time; quiet_end time; local_clock time; tz text;
  reason text := null;
  mid uuid;
begin
  select user_id into uid from public.iris_proactive_runs where id=p_run_id;
  select * into p from public.iris_profiles where user_id=uid for update;
  select * into r from public.iris_proactive_runs where id=p_run_id for update;
  if not found or r.lease_token is distinct from p_lease_token then raise exception 'proactive_lease_lost'; end if;
  if r.status='sent' then return jsonb_build_object('status','sent','message_id',r.message_id); end if;
  if r.status<>'running' or r.lease_until<now() then raise exception 'proactive_lease_lost'; end if;
  if p_action in ('error','terminal_error') then
    update public.iris_proactive_runs set
      status=case when attempts<3 and p_action='error' then 'retry' else 'failed' end,
      outcome=left(p_reason,120), next_attempt_at=now()+make_interval(mins=>5*attempts),
      finished_at=case when attempts>=3 or p_action='terminal_error' then now() else null end
      where id=r.id;
    return jsonb_build_object('status','error','reason',left(p_reason,120));
  end if;
  if p_action='skip' then reason:=coalesce(nullif(left(p_reason,120),''),'no_candidate');
  elsif p_action='send' then
    if p_message is null or length(btrim(p_message))=0 or length(p_message)>900 then raise exception 'invalid_proactive_message'; end if;
    if p.proactivity_enabled is not true then reason:='disabled';
    elsif p.last_interaction_at is null or p.last_interaction_at>now()-interval '6 hours' then reason:='recent_interaction';
    else
      select last_proactive_at into last_sent from public.iris_self_model where user_id=uid;
      if last_sent>now()-make_interval(hours=>greatest(16,least(168,p_cooldown_hours))) then reason:='cooldown'; end if;
      tz:=coalesce(p.user_timezone,'UTC');
      if not exists(select 1 from pg_timezone_names where name=tz) then tz:='UTC'; end if;
      local_clock:=(now() at time zone tz)::time;
      begin
        quiet_start:=coalesce(p.proactivity_quiet_hours->>'start','22:30')::time;
        quiet_end:=coalesce(p.proactivity_quiet_hours->>'end','08:00')::time;
      exception when others then quiet_start:='22:30'; quiet_end:='08:00'; end;
      if (quiet_start<quiet_end and local_clock>=quiet_start and local_clock<quiet_end)
        or (quiet_start>quiet_end and (local_clock>=quiet_start or local_clock<quiet_end)) then reason:='quiet_hours'; end if;
    end if;
  else raise exception 'invalid_proactive_action'; end if;
  if reason is not null then
    update public.iris_proactive_runs set status='skipped',outcome=reason,finished_at=now() where id=r.id;
    return jsonb_build_object('status','skipped','reason',reason);
  end if;
  -- One transaction: a failed INSERT cannot consume the cooldown.
  insert into public.chat_messages(user_id,role,content,client_message_id)
    values(uid,'assistant',p_message,'proactive:'||r.id::text) returning id into mid;
  insert into public.iris_self_model(user_id,last_proactive_at,updated_at) values(uid,now(),now())
    on conflict(user_id) do update set last_proactive_at=excluded.last_proactive_at,updated_at=excluded.updated_at;
  update public.iris_profiles set last_autonomous_message_at=now() where user_id=uid;
  update public.iris_thoughts set status='sent',sent_at=now(),last_considered_at=now()
    where user_id=uid and status='active' and subject=p_subject;
  update public.iris_proactive_runs set status='sent',outcome='sent',message_id=mid,finished_at=now(),
    push_status='pending',push_next_at=now() where id=r.id;
  return jsonb_build_object('status','sent','message_id',mid);
end $$;
revoke all on function public.claim_iris_proactive_run(uuid) from public,anon,authenticated;
revoke all on function public.finish_iris_proactive_run(uuid,uuid,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.claim_iris_proactive_run(uuid) to service_role;
grant execute on function public.finish_iris_proactive_run(uuid,uuid,text,text,text,text,integer) to service_role;
