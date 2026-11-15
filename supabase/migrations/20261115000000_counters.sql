-- Ngondro Reader: private, append-only practice counters.
--
-- Every counting action is one row in counter_events with an id generated on
-- the device. Rows are never updated or deleted by clients, so:
--   * a retried upload has the same id and is ignored (no duplicates);
--   * two devices counting at once both insert rows (no overwrites).
-- counter_totals is maintained by a trigger in the same transaction.

create table public.counter_events (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  practice_id text not null check (practice_id ~ '^[a-z0-9_-]{1,40}$'),
  kind        text not null check (kind in ('add', 'undo', 'import', 'set_target')),
  delta       bigint not null default 0,
  target      bigint,
  undoes      uuid,
  device_id   text not null check (length(device_id) between 8 and 64),
  client_at   timestamptz not null,
  server_seq  bigint generated always as identity,
  created_at  timestamptz not null default now(),
  constraint add_delta     check (kind <> 'add'        or (delta between 1 and 1000000 and target is null and undoes is null)),
  constraint undo_delta    check (kind <> 'undo'       or (delta between -1000000 and -1 and undoes is not null and target is null)),
  constraint import_delta  check (kind <> 'import'     or (delta between 0 and 100000000 and target is null and undoes is null)),
  constraint target_value  check (kind <> 'set_target' or (delta = 0 and target between 1 and 100000000 and undoes is null)),
  constraint sane_time     check (client_at > '2020-01-01' and client_at < created_at + interval '1 day')
);

-- The same tap can be undone only once, even from two devices.
create unique index counter_events_one_undo on public.counter_events (user_id, undoes) where undoes is not null;
create index counter_events_user_time on public.counter_events (user_id, client_at);
create index counter_events_user_seq on public.counter_events (user_id, server_seq);

create table public.counter_totals (
  user_id     uuid not null references auth.users (id) on delete cascade,
  practice_id text not null,
  total       bigint not null default 0,
  target      bigint not null default 111111,
  target_at   timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (user_id, practice_id)
);

-- An undo must cancel one of the user's own 'add' rows of the same size.
create function public.counter_events_check_undo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'undo' and not exists (
    select 1 from public.counter_events e
    where e.id = new.undoes and e.user_id = new.user_id and e.kind = 'add'
      and e.practice_id = new.practice_id and e.delta = -new.delta
  ) then
    raise exception 'undo must reference a matching add' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger counter_events_check_undo
  before insert on public.counter_events
  for each row execute function public.counter_events_check_undo();

-- Keep totals in step with events (runs in the inserting transaction).
create function public.counter_events_apply() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.counter_totals as t (user_id, practice_id, total, target, target_at, updated_at)
  values (
    new.user_id, new.practice_id,
    greatest(new.delta, 0),
    coalesce(new.target, 111111),
    case when new.kind = 'set_target' then new.client_at end,
    now()
  )
  on conflict (user_id, practice_id) do update set
    total = greatest(t.total + new.delta, 0),
    target = case
      when new.kind = 'set_target' and (t.target_at is null or new.client_at >= t.target_at) then new.target
      else t.target end,
    target_at = case
      when new.kind = 'set_target' and (t.target_at is null or new.client_at >= t.target_at) then new.client_at
      else t.target_at end,
    updated_at = now();
  return new;
end $$;

create trigger counter_events_apply
  after insert on public.counter_events
  for each row execute function public.counter_events_apply();

-- Row-level security: each user sees and adds only their own data.
alter table public.counter_events enable row level security;
alter table public.counter_totals enable row level security;

create policy "read own events" on public.counter_events
  for select to authenticated using (user_id = (select auth.uid()));
create policy "add own events" on public.counter_events
  for insert to authenticated with check (user_id = (select auth.uid()));
-- No update/delete policies: events are append-only.

create policy "read own totals" on public.counter_totals
  for select to authenticated using (user_id = (select auth.uid()));
-- No write policies: totals are written only by the trigger.

revoke all on public.counter_events, public.counter_totals from anon;
revoke all on public.counter_events, public.counter_totals from authenticated;
grant select, insert on public.counter_events to authenticated;
grant select on public.counter_totals to authenticated;

-- "Delete my data": removes only the caller's own rows.
create function public.delete_my_counter_data() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.counter_events where user_id = auth.uid();
  delete from public.counter_totals where user_id = auth.uid();
end $$;

revoke all on function public.delete_my_counter_data() from public, anon;
grant execute on function public.delete_my_counter_data() to authenticated;
revoke all on function public.counter_events_apply() from public, anon, authenticated;
revoke all on function public.counter_events_check_undo() from public, anon, authenticated;

-- Tiny public endpoint for the daily keep-alive ping (free plan pauses after
-- a week without activity). Touches no user data.
create function public.ping() returns text language sql stable as $$ select 'ok' $$;
grant execute on function public.ping() to anon, authenticated;
