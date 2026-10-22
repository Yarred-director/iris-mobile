-- Pin search_path on legacy dashboard-created functions and close anonymous access to scene RPCs.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('update_personality_evolution_timestamp','update_updated_at_column','reinforce_memory','decay_memories','set_updated_at','get_scene_facts','upsert_scene_fact','patch_scene_context','upsert_scene_fact_merge_json','update_user_profile_timestamp','match_shared_experiences','update_shared_experiences_timestamp','match_episodic_memory','upsert_core_origin_memory','match_episodic_memory_v2','get_scene_context')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', f.sig);
  end loop;
end $$;
revoke execute on function public.get_scene_context(text) from anon, public;
revoke execute on function public.patch_scene_context(text, jsonb) from anon, public;
