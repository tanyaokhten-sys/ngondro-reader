-- Optional weekly goals per practice.
--
-- * The goal is an event (kind 'set_weekly_goal', target = goal, 0 = off), so it
--   syncs through the same outbox and the newest change wins, like set_target.
-- * Weekly progress is NOT stored: weekly_progress() derives it from events —
--   'add' events in the current Monday–Sunday week of the caller's timezone that
--   have not been undone. Corrections ('adjust') and imports change the lifetime
--   total only. An undo removes its add from the week the add happened in.

alter table public.counter_events
  drop constraint counter_events_kind_check,
  add constraint counter_events_kind_check
    check (kind in ('add', 'undo', 'import', 'set_target', 'adjust', 'set_weekly_goal')),
  add constraint weekly_goal_value
    check (kind <> 'set_weekly_goal' or (delta = 0 and target between 0 and 1000000 and undoes is null));

alter table public.counter_totals
  add column weekly_goal    bigint check (weekly_goal > 0),
  add column weekly_goal_at timestamptz;

create index counter_events_user_kind_time on public.counter_events (user_id, kind, client_at);

-- Totals trigger, now aware of weekly goals (lifetime target logic unchanged).
create or replace function public.counter_events_apply() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  is_target boolean := new.kind = 'set_target';
  is_weekly boolean := new.kind = 'set_weekly_goal';
begin
  insert into public.counter_totals as t
    (user_id, practice_id, total, target, target_at, weekly_goal, weekly_goal_at, updated_at)
  values (
    new.user_id, new.practice_id,
    case when is_target or is_weekly then 0 else greatest(new.delta, 0) end,
    case when is_target then new.target else 111111 end,
    case when is_target then new.client_at end,
    case when is_weekly then nullif(new.target, 0) end,
    case when is_weekly then new.client_at end,
    now()
  )
  on conflict (user_id, practice_id) do update set
    total = greatest(t.total + new.delta, 0),
    target = case when is_target and (t.target_at is null or new.client_at >= t.target_at) then new.target else t.target end,
    target_at = case when is_target and (t.target_at is null or new.client_at >= t.target_at) then new.client_at else t.target_at end,
    weekly_goal = case when is_weekly and (t.weekly_goal_at is null or new.client_at >= t.weekly_goal_at) then nullif(new.target, 0) else t.weekly_goal end,
    weekly_goal_at = case when is_weekly and (t.weekly_goal_at is null or new.client_at >= t.weekly_goal_at) then new.client_at else t.weekly_goal_at end,
    updated_at = now();
  return new;
end $$;

-- This week's progress for the signed-in user, per practice.
-- Runs with the caller's rights, so row-level security applies.
create function public.weekly_progress(p_tz text)
returns table (practice_id text, week_start date, done bigint)
language plpgsql stable set search_path = '' as $$
declare ws timestamp;
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz) then
    raise exception 'unknown timezone %', p_tz using errcode = '22023';
  end if;
  ws := date_trunc('week', now() at time zone p_tz); -- Monday 00:00 local
  return query
    select e.practice_id, ws::date, sum(e.delta)::bigint
    from public.counter_events e
    where e.user_id = auth.uid()
      and e.kind = 'add'
      and e.client_at >= (ws at time zone p_tz)
      and e.client_at <  ((ws + interval '7 days') at time zone p_tz)
      and not exists (
        select 1 from public.counter_events u
        where u.user_id = e.user_id and u.kind = 'undo' and u.undoes = e.id)
    group by e.practice_id;
end $$;

revoke all on function public.weekly_progress(text) from public, anon;
grant execute on function public.weekly_progress(text) to authenticated;
