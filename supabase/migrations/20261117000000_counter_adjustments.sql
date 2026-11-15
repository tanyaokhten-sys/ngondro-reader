-- Manual counter corrections, stored as auditable 'adjust' events.
--
-- A correction is never "set total = X": it is a signed delta (X − what the
-- device saw), so a concurrent +108 from another device is kept. The device's
-- view is recorded for the audit trail.
--
-- Totals can never go negative: any reduction (adjust or undo) is limited to
-- the current total at the moment it is applied — under a per-user/practice
-- lock, computed from the events themselves so it is also correct inside a
-- multi-row upload. If limited, the requested amount is kept in requested_delta.

alter table public.counter_events
  add column requested_delta     bigint,
  add column note                text check (length(note) <= 200),
  add column client_total_before bigint check (client_total_before >= 0),
  add column client_total_after  bigint check (client_total_after >= 0);

alter table public.counter_events
  drop constraint counter_events_kind_check,
  add constraint counter_events_kind_check check (kind in ('add', 'undo', 'import', 'set_target', 'adjust')),
  drop constraint undo_delta,
  -- undo amounts are taken from the event being undone (see trigger), may be 0 after limiting
  add constraint undo_delta   check (kind <> 'undo'   or (delta between -100000000 and 100000000 and undoes is not null and target is null)),
  add constraint adjust_delta check (kind <> 'adjust' or (delta between -100000000 and 100000000 and target is null and undoes is null));

create index counter_events_user_practice on public.counter_events (user_id, practice_id);

-- Undo: must cancel one of the user's own 'add' or 'adjust' events of the same
-- practice, at most once (unique index counter_events_one_undo). The amount is
-- the exact opposite of what that event actually applied.
create or replace function public.counter_events_check_undo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare orig_delta bigint;
begin
  if new.kind = 'undo' then
    select e.delta into orig_delta from public.counter_events e
    where e.id = new.undoes and e.user_id = new.user_id and e.practice_id = new.practice_id
      and e.kind in ('add', 'adjust');
    if not found then
      raise exception 'undo must reference an add or adjust of the same practice' using errcode = '23514';
    end if;
    if new.delta <> -orig_delta then new.requested_delta := new.delta; end if;
    new.delta := -orig_delta;
  end if;
  return new;
end $$;

-- Never below zero. Runs after counter_events_check_undo (triggers fire in name order).
create function public.counter_events_clamp_negative() returns trigger
language plpgsql security definer set search_path = '' as $$
declare current_total bigint;
begin
  if new.delta < 0 then
    -- Serialize reductions for this user+practice across concurrent uploads.
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || '/' || new.practice_id, 0));
    -- Sum of events (sees rows inserted earlier in the same statement; totals
    -- are only updated after the statement).
    select coalesce(sum(e.delta), 0) into current_total from public.counter_events e
    where e.user_id = new.user_id and e.practice_id = new.practice_id;
    if current_total + new.delta < 0 then
      new.requested_delta := coalesce(new.requested_delta, new.delta);
      new.delta := -greatest(current_total, 0);
    end if;
  end if;
  return new;
end $$;

create trigger counter_events_clamp_negative
  before insert on public.counter_events
  for each row execute function public.counter_events_clamp_negative();

revoke all on function public.counter_events_clamp_negative() from public, anon, authenticated;
