-- Correct the quota result so a request at the limit is denied instead of reported as allowed.

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
  v_incremented boolean := false;
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

    v_incremented := found;

    if not v_incremented then
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

    v_incremented := found;

    if not v_incremented then
      select image_count into v_used
      from public.api_usage_daily
      where user_id = p_user_id and usage_date = v_day;
    end if;
  end if;

  return query
  select
    v_incremented,
    coalesce(v_used, 0),
    v_limit,
    ((v_day + 1)::timestamp at time zone 'UTC');
end;
$$;

revoke all on function public.consume_daily_usage(uuid, text, integer) from public;
revoke all on function public.consume_daily_usage(uuid, text, integer) from anon;
grant execute on function public.consume_daily_usage(uuid, text, integer) to authenticated;
grant execute on function public.consume_daily_usage(uuid, text, integer) to service_role;
