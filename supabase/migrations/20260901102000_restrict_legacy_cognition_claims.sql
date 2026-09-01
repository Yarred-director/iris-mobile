-- Both functions are backend worker operations, never client RPCs.
-- Revoking PUBLIC alone did not remove Supabase's explicit role grants.
revoke execute on function public.claim_iris_cognition(uuid,integer) from public,anon,authenticated;
revoke execute on function public.claim_iris_proactive_reachout(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_iris_cognition(uuid,integer) to service_role;
grant execute on function public.claim_iris_proactive_reachout(uuid,integer) to service_role;
