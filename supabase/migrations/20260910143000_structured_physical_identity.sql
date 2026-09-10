alter table public.iris_physical_identity
  add column if not exists traits jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'iris_physical_identity_traits_object_chk'
      and conrelid = 'public.iris_physical_identity'::regclass
  ) then
    alter table public.iris_physical_identity
      add constraint iris_physical_identity_traits_object_chk
      check (jsonb_typeof(traits) = 'object');
  end if;
end
$$;

comment on column public.iris_physical_identity.traits is
  'Structured enduring Iris body traits. Runtime merges individual keys instead of replacing the entire identity blob.';
