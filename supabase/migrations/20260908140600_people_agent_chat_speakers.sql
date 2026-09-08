-- EXPERIMENTAL companion to people_agents_experimental.
-- Nullable speaker metadata prevents child-agent replies from being interpreted as
-- Iris's own prior first-person turns when the shared chat history is reused.

alter table public.chat_messages
  add column if not exists speaker_person_id uuid references public.iris_people(id) on delete set null;

alter table public.chat_messages
  add column if not exists speaker_name text;

create index if not exists chat_messages_speaker_person_idx
  on public.chat_messages(user_id, speaker_person_id, created_at desc)
  where speaker_person_id is not null;
