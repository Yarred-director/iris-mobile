-- Production hardening v1
-- Security, private media, short-term chat history, push-token hygiene and usage quotas.

begin;

-- 1) Remove the anonymous SECURITY DEFINER entry point.
alter function public.admin_patch_scene_context(text, text, jsonb)
  set search_path = public, pg_temp;
revoke all on function public.admin_patch_scene_context(text, text, jsonb) from public;
revoke all on function public.admin_patch_scene_context(text, text, jsonb) from anon;
revoke all on function public.admin_patch_scene_context(text, text, jsonb) from authenticated;
grant execute on function public.admin_patch_scene_context(text, text, jsonb) to service_role;

-- 2) Store private reference media as bucket/path instead of permanent public URLs.
alter table public.iris_profiles
  add column if not exists reference_image_bucket text,
  add column if not exists reference_image_path text;

update public.iris_profiles
set
  reference_image_bucket = regexp_replace(
    reference_image_url,
    '^.*/storage/v1/object/public/([^/]+)/.*$',
    '\1'
  ),
  reference_image_path = regexp_replace(
    reference_image_url,
    '^.*/storage/v1/object/public/[^/]+/(.*)$',
    '\1'
  )
where reference_image_url like '%/storage/v1/object/public/%'
  and (reference_image_bucket is null or reference_image_path is null);

-- 3) Durable, user-scoped short-term conversation history.
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  image_bucket text,
  image_path text,
  client_message_id text,
  created_at timestamptz not null default now(),
  constraint chat_messages_image_pair check (
    (image_bucket is null and image_path is null)
    or (image_bucket is not null and image_path is not null)
  )
);

create index if not exists chat_messages_user_created_idx
  on public.chat_messages (user_id, created_at desc);

create unique index if not exists chat_messages_user_client_id_key
  on public.chat_messages (user_id, client_message_id)
  where client_message_id is not null;

alter table public.chat_messages enable row level security;

drop policy if exists chat_messages_select_own on public.chat_messages;
create policy chat_messages_select_own
  on public.chat_messages
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists chat_messages_insert_own on public.chat_messages;
create policy chat_messages_insert_own
  on public.chat_messages
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists chat_messages_delete_own on public.chat_messages;
create policy chat_messages_delete_own
  on public.chat_messages
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- 4) Push-token lifecycle.
alter table public.push_tokens
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists disabled_at timestamptz;

create unique index if not exists push_tokens_expo_token_key
  on public.push_tokens (expo_push_token);

create index if not exists push_tokens_user_active_idx
  on public.push_tokens (user_id, last_seen_at desc)
  where disabled_at is null;

drop policy if exists push_tokens_delete_own on public.push_tokens;
create policy push_tokens_delete_own
  on public.push_tokens
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- 5) Atomic daily usage limits. Limits are supplied by trusted server configuration.
create table if not exists public.api_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default (timezone('utc', now()))::date,
  chat_count integer not null default 0 check (chat_count >= 0),
  image_count integer not null default 0 check (image_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

alter table public.api_usage_daily enable row level security;

drop policy if exists api_usage_daily_select_own on public.api_usage_daily;
create policy api_usage_daily_select_own
  on public.api_usage_daily
  for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.consume_daily_usage(
  p_user_id uuid,
  p_kind text,
  p_limit integer
)
returns table (
  allowed boolean,
  used integer,
  limit_value integer,
  resets_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 1), 100000));
  v_used integer;
  v_day date := (timezone('utc', now()))::date;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if p_kind not in ('chat', 'image') then
    raise exception 'invalid usage kind';
  end if;

  insert into public.api_usage_daily (user_id, usage_date)
  values (p_user_id, v_day)
  on conflict (user_id, usage_date) do nothing;

  if p_kind = 'chat' then
    update public.api_usage_daily
    set chat_count = chat_count + 1,
        updated_at = now()
    where user_id = p_user_id
      and usage_date = v_day
      and chat_count < v_limit
    returning chat_count into v_used;

    if v_used is null then
      select chat_count into v_used
      from public.api_usage_daily
      where user_id = p_user_id and usage_date = v_day;
    end if;
  else
    update public.api_usage_daily
    set image_count = image_count + 1,
        updated_at = now()
    where user_id = p_user_id
      and usage_date = v_day
      and image_count < v_limit
    returning image_count into v_used;

    if v_used is null then
      select image_count into v_used
      from public.api_usage_daily
      where user_id = p_user_id and usage_date = v_day;
    end if;
  end if;

  return query
  select
    v_used <= v_limit,
    v_used,
    v_limit,
    ((v_day + 1)::timestamp at time zone 'UTC');
end;
$$;

revoke all on function public.consume_daily_usage(uuid, text, integer) from public;
revoke all on function public.consume_daily_usage(uuid, text, integer) from anon;
grant execute on function public.consume_daily_usage(uuid, text, integer) to authenticated;
grant execute on function public.consume_daily_usage(uuid, text, integer) to service_role;

-- 6) Sensitive image buckets become private. Static UI buckets remain public.
update storage.buckets
set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
where id in ('iris-photos', 'iris-ref', 'iris-temp');

drop policy if exists "Iris photos are publicly readable" on storage.objects;
drop policy if exists "Users can upload their own iris photos" on storage.objects;
drop policy if exists "Users can update their own iris photos" on storage.objects;

drop policy if exists iris_photos_select_own on storage.objects;
create policy iris_photos_select_own
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'iris-photos'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists iris_photos_insert_own on storage.objects;
create policy iris_photos_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'iris-photos'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists iris_photos_update_own on storage.objects;
create policy iris_photos_update_own
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'iris-photos'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'iris-photos'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists iris_photos_delete_own on storage.objects;
create policy iris_photos_delete_own
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'iris-photos'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

commit;
