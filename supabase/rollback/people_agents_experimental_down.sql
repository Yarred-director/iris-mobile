-- DESTRUCTIVE ROLLBACK for the experimental People/child-agent feature.
-- Safe with runtime code present because runtime fails closed when the directory RPC is absent.

drop index if exists public.chat_messages_speaker_person_idx;
alter table public.chat_messages drop column if exists speaker_person_id;
alter table public.chat_messages drop column if exists speaker_name;

drop function if exists public.prune_iris_people_agent_state(uuid, uuid);
drop function if exists public.load_iris_people_agent_context(uuid, text);
drop function if exists public.load_iris_people_directory(uuid);

drop table if exists public.iris_people_messages cascade;
drop table if exists public.iris_people_memories cascade;
drop table if exists public.iris_people_relationships cascade;
drop table if exists public.iris_people_ai_profiles cascade;
drop table if exists public.iris_people cascade;
drop table if exists public.iris_experimental_features cascade;
