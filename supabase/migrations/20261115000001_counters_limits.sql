-- Never reject a real count because of size or a wrong device clock:
-- the app drops rows the server refuses, so refusals must be reserved for
-- rows that are genuinely invalid (e.g. a second undo of the same tap).

alter table public.counter_events
  drop constraint add_delta,
  drop constraint undo_delta,
  drop constraint sane_time,
  add constraint add_delta  check (kind <> 'add'  or (delta between 1 and 100000000 and target is null and undoes is null)),
  add constraint undo_delta check (kind <> 'undo' or (delta between -100000000 and -1 and undoes is not null and target is null));

-- Clamp the device time into a sane range instead of refusing the row.
create function public.counter_events_clamp_time() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.client_at is null or new.client_at > now() + interval '10 minutes' then
    new.client_at := now();
  elsif new.client_at < timestamptz '2020-01-01' then
    new.client_at := timestamptz '2020-01-01';
  end if;
  return new;
end $$;

-- Runs before counter_events_check_undo (triggers fire in name order).
create trigger counter_events_a_clamp_time
  before insert on public.counter_events
  for each row execute function public.counter_events_clamp_time();

revoke all on function public.counter_events_clamp_time() from public, anon, authenticated;
