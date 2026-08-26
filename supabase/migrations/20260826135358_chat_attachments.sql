begin;

create table if not exists public.chat_attachments (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid references public.chat_messages(id) on delete set null,
  client_message_id text not null,
  bucket text not null default 'iris-photos' check (bucket = 'iris-photos'),
  path text not null,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 8388608),
  retention text not null check (retention in ('temporary', 'user_appearance')),
  status text not null default 'pending' check (status in ('pending', 'attached')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  attached_at timestamptz,
  constraint chat_attachments_expiration_check check (
    (status = 'pending' and expires_at is not null)
    or (status = 'attached' and retention = 'temporary' and expires_at is not null)
    or (status = 'attached' and retention = 'user_appearance' and expires_at is null)
  ),
  unique (user_id, path)
);

create index if not exists chat_attachments_message_idx
  on public.chat_attachments (message_id, created_at);
create index if not exists chat_attachments_user_created_idx
  on public.chat_attachments (user_id, created_at desc);
create index if not exists chat_attachments_expiry_idx
  on public.chat_attachments (expires_at)
  where expires_at is not null;

alter table public.chat_attachments enable row level security;

drop policy if exists chat_attachments_select_own on public.chat_attachments;
create policy chat_attachments_select_own
  on public.chat_attachments for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.chat_attachments from anon;
revoke all on table public.chat_attachments from authenticated;
grant select on table public.chat_attachments to authenticated;
grant select, insert, update, delete on table public.chat_attachments to service_role;

commit;
