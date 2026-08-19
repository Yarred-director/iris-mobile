create table if not exists public.iris_visual_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  scene_key text not null default 'global',
  state jsonb not null default '{}'::jsonb,
  source text not null default 'inferred',
  confidence real not null default 0.8 check (confidence >= 0 and confidence <= 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, scene_key)
);

alter table public.iris_visual_state enable row level security;

drop policy if exists iris_visual_state_select_own on public.iris_visual_state;
create policy iris_visual_state_select_own on public.iris_visual_state
for select to authenticated using (auth.uid() = user_id);

drop policy if exists iris_visual_state_insert_own on public.iris_visual_state;
create policy iris_visual_state_insert_own on public.iris_visual_state
for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists iris_visual_state_update_own on public.iris_visual_state;
create policy iris_visual_state_update_own on public.iris_visual_state
for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists iris_visual_state_delete_own on public.iris_visual_state;
create policy iris_visual_state_delete_own on public.iris_visual_state
for delete to authenticated using (auth.uid() = user_id);

create index if not exists iris_visual_state_updated_at_idx
  on public.iris_visual_state (updated_at desc);
