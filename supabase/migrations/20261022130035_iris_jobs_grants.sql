-- Jobs are server-only.
revoke all on table public.iris_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.iris_jobs to service_role;
revoke all on function public.claim_iris_jobs(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_iris_jobs(integer, integer) to service_role;
