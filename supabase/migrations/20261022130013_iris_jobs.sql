-- Durable background work. Jobs survive restarts and deploys, are claimed with row locks so any
-- number of workers can run, and are generic: the job kind maps to a handler in server/jobs.
create table if not exists public.iris_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{1,63}$'),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  lease_until timestamptz,
  dedupe_key text,
  last_error text,
  result jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create unique index if not exists iris_jobs_dedupe_key on public.iris_jobs(dedupe_key) where dedupe_key is not null;
create index if not exists iris_jobs_due on public.iris_jobs(run_at) where status in ('pending', 'running');
create index if not exists iris_jobs_user_kind on public.iris_jobs(user_id, kind, created_at desc);

alter table public.iris_jobs enable row level security;

-- Claims due jobs (and jobs whose lease expired after a crash) without blocking other workers.
create or replace function public.claim_iris_jobs(p_limit integer default 5, p_lease_seconds integer default 300)
returns setof public.iris_jobs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
  with due as (
    select j.id from public.iris_jobs j
    where j.run_at <= now()
      and (j.status = 'pending' or (j.status = 'running' and j.lease_until < now()))
      and j.attempts < j.max_attempts
    order by j.run_at
    limit greatest(1, least(coalesce(p_limit, 5), 50))
    for update skip locked
  )
  update public.iris_jobs j set
    status = 'running',
    attempts = j.attempts + 1,
    lease_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 300), 3600)))
  from due where j.id = due.id
  returning j.*;
end;
$$;
