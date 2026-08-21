create table if not exists public.iris_physical_identity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  body_description text,
  source text not null default 'user_explicit',
  confidence real not null default 0.8 check (confidence >= 0 and confidence <= 1),
  updated_at timestamptz not null default now()
);

alter table public.iris_physical_identity enable row level security;

drop policy if exists iris_physical_identity_select_own on public.iris_physical_identity;
create policy iris_physical_identity_select_own on public.iris_physical_identity for select using (auth.uid() = user_id);
drop policy if exists iris_physical_identity_insert_own on public.iris_physical_identity;
create policy iris_physical_identity_insert_own on public.iris_physical_identity for insert with check (auth.uid() = user_id);
drop policy if exists iris_physical_identity_update_own on public.iris_physical_identity;
create policy iris_physical_identity_update_own on public.iris_physical_identity for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists iris_physical_identity_delete_own on public.iris_physical_identity;
create policy iris_physical_identity_delete_own on public.iris_physical_identity for delete using (auth.uid() = user_id);

create table if not exists public.iris_activity_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_activity text,
  next_steps jsonb not null default '[]'::jsonb,
  commitments jsonb not null default '[]'::jsonb,
  pending_promises jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.iris_activity_state enable row level security;

drop policy if exists iris_activity_state_select_own on public.iris_activity_state;
create policy iris_activity_state_select_own on public.iris_activity_state for select using (auth.uid() = user_id);
drop policy if exists iris_activity_state_insert_own on public.iris_activity_state;
create policy iris_activity_state_insert_own on public.iris_activity_state for insert with check (auth.uid() = user_id);
drop policy if exists iris_activity_state_update_own on public.iris_activity_state;
create policy iris_activity_state_update_own on public.iris_activity_state for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists iris_activity_state_delete_own on public.iris_activity_state;
create policy iris_activity_state_delete_own on public.iris_activity_state for delete using (auth.uid() = user_id);

create table if not exists public.iris_scheduled_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action_type text not null check (action_type in ('image')),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','cancelled')),
  due_at timestamptz not null,
  request_text text not null,
  conversation_snapshot jsonb not null default '[]'::jsonb,
  visual_state_snapshot jsonb not null default '{}'::jsonb,
  physical_identity_snapshot jsonb not null default '{}'::jsonb,
  activity_snapshot jsonb not null default '{}'::jsonb,
  scene_context_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  failure_reason text
);

create index if not exists iris_scheduled_actions_due_idx on public.iris_scheduled_actions (status, due_at);
create index if not exists iris_scheduled_actions_user_idx on public.iris_scheduled_actions (user_id, created_at desc);

alter table public.iris_scheduled_actions enable row level security;

drop policy if exists iris_scheduled_actions_select_own on public.iris_scheduled_actions;
create policy iris_scheduled_actions_select_own on public.iris_scheduled_actions for select using (auth.uid() = user_id);
drop policy if exists iris_scheduled_actions_insert_own on public.iris_scheduled_actions;
create policy iris_scheduled_actions_insert_own on public.iris_scheduled_actions for insert with check (auth.uid() = user_id);
drop policy if exists iris_scheduled_actions_update_own on public.iris_scheduled_actions;
create policy iris_scheduled_actions_update_own on public.iris_scheduled_actions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists iris_scheduled_actions_delete_own on public.iris_scheduled_actions;
create policy iris_scheduled_actions_delete_own on public.iris_scheduled_actions for delete using (auth.uid() = user_id);