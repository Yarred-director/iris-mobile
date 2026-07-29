-- Manual entitlements and tier-specific daily limits. Billing providers can update this table later.

create table if not exists public.user_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free', 'plus', 'pro', 'admin')),
  status text not null default 'active' check (status in ('active', 'past_due', 'cancelled', 'paused')),
  chat_daily_limit integer check (chat_daily_limit is null or chat_daily_limit > 0),
  image_daily_limit integer check (image_daily_limit is null or image_daily_limit > 0),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.user_entitlements enable row level security;

drop policy if exists user_entitlements_select_own on public.user_entitlements;
create policy user_entitlements_select_own
  on public.user_entitlements
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete on public.user_entitlements from anon, authenticated;
