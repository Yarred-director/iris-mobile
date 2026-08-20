create or replace function public.merge_iris_self_model_partial_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.mood is distinct from old.mood then
      new.mood := coalesce(old.mood, '{}'::jsonb) || coalesce(new.mood, '{}'::jsonb);
    end if;
    if new.drives is distinct from old.drives then
      new.drives := coalesce(old.drives, '{}'::jsonb) || coalesce(new.drives, '{}'::jsonb);
    end if;
    if new.relationship_model is distinct from old.relationship_model then
      new.relationship_model := coalesce(old.relationship_model, '{}'::jsonb) || coalesce(new.relationship_model, '{}'::jsonb);
    end if;

    if new.beliefs = '[]'::jsonb and old.beliefs <> '[]'::jsonb then new.beliefs := old.beliefs; end if;
    if new.open_questions = '[]'::jsonb and old.open_questions <> '[]'::jsonb then new.open_questions := old.open_questions; end if;
    if new.active_goals = '[]'::jsonb and old.active_goals <> '[]'::jsonb then new.active_goals := old.active_goals; end if;
    if new.current_concerns = '[]'::jsonb and old.current_concerns <> '[]'::jsonb then new.current_concerns := old.current_concerns; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists iris_self_model_partial_merge_guard on public.iris_self_model;
create trigger iris_self_model_partial_merge_guard
before update on public.iris_self_model
for each row execute function public.merge_iris_self_model_partial_update();
