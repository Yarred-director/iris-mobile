-- Server-only writes: users may read their own persona, never modify it directly.
revoke all on table public.iris_persona from anon;
revoke insert, update, delete on table public.iris_persona from authenticated;
grant select on table public.iris_persona to authenticated;
grant select, insert, update, delete on table public.iris_persona to service_role;

revoke all on function public.patch_iris_persona(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.patch_iris_persona(uuid, integer, jsonb) to service_role;
