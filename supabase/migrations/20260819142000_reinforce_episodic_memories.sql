create or replace function public.reinforce_episodic_memories(
  p_user_id uuid,
  p_memory_ids uuid[],
  p_cooldown_hours integer default 24
)
returns table(
  id uuid,
  reinforcement_count integer,
  last_recalled_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  update public.episodic_memory em
  set
    reinforcement_count = coalesce(em.reinforcement_count, 0) + 1,
    last_recalled_at = now()
  where em.user_id = p_user_id
    and em.id = any(coalesce(p_memory_ids, array[]::uuid[]))
    and (
      em.last_recalled_at is null
      or em.last_recalled_at <= now() - make_interval(hours => greatest(1, least(coalesce(p_cooldown_hours, 24), 168)))
    )
  returning em.id, em.reinforcement_count, em.last_recalled_at;
$$;
