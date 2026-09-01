-- Avoid scanning the run ledger when a chat message is removed.
create index iris_proactive_message_ref on public.iris_proactive_runs(message_id);
