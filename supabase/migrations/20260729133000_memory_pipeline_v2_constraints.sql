-- Memory pipeline v2: make per-user governance rows truly singleton.
-- Safe for the current database where these tables have no duplicate user rows.

create unique index if not exists iris_relationship_user_id_key
  on public.iris_relationship (user_id);

create unique index if not exists iris_internal_state_user_id_key
  on public.iris_internal_state (user_id);

create index if not exists iris_relationship_user_id_idx
  on public.iris_relationship (user_id);

create index if not exists iris_internal_state_user_id_idx
  on public.iris_internal_state (user_id);
