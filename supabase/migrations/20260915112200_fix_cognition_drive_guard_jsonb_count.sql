create or replace function public.guard_iris_drive_state()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  k text;
  old_value double precision;
  new_value double precision;
  drive_count integer;
  drive_keys constant text[] := array[
    'connection','curiosity','playfulness','independence',
    'competence','novelty','protect_relationship','self_consistency'
  ];
begin
  if tg_op = 'UPDATE' and new.drives is not distinct from old.drives then
    return new;
  end if;

  if jsonb_typeof(new.drives) is distinct from 'object' then
    raise exception 'invalid_iris_drive_state';
  end if;

  select count(*) into drive_count from jsonb_object_keys(new.drives);
  if drive_count <> cardinality(drive_keys) then
    raise exception 'invalid_iris_drive_state';
  end if;

  foreach k in array drive_keys loop
    if not (new.drives ? k) or jsonb_typeof(new.drives -> k) is distinct from 'number' then
      raise exception 'invalid_iris_drive_state';
    end if;
    new_value := (new.drives ->> k)::double precision;
    if new_value < 0.12 or new_value > 0.95 then
      raise exception 'iris_drive_out_of_bounds';
    end if;

    if tg_op = 'UPDATE' then
      if jsonb_typeof(old.drives -> k) is distinct from 'number' then
        raise exception 'invalid_previous_iris_drive_state';
      end if;
      old_value := (old.drives ->> k)::double precision;
      if abs(new_value - old_value) > 0.025001 then
        raise exception 'iris_drive_step_too_large';
      end if;
    end if;
  end loop;

  return new;
end;
$function$;
