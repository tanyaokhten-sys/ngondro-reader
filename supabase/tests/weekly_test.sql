-- Run after supabase_stub.sql and the counter migrations.
\set ON_ERROR_STOP 1
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b2');
create function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
create function pg_temp.expect_error(q text, label text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'ok  %: rejected (%)', label, sqlerrm; return; end;
  raise exception 'FAIL %: was allowed', label;
end $$;
create function pg_temp.expect(cond boolean, label text) returns void language plpgsql as $$
begin if not cond then raise exception 'FAIL % (got %)', label, cond; end if; raise notice 'ok  %', label; end $$;
create function pg_temp.week(p text default 'refuge', tz text default 'Europe/Kyiv') returns bigint language sql as
  $$ select coalesce((select done from public.weekly_progress(tz) where practice_id = p), 0) $$;
-- Monday 00:00 of this week in Kyiv, as an instant
create function pg_temp.ws() returns timestamptz language sql as
  $$ select date_trunc('week', now() at time zone 'Europe/Kyiv') at time zone 'Europe/Kyiv' $$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into counter_events (id, practice_id, kind, delta, device_id, client_at) values
  ('c0000000-0000-0000-0000-000000000001', 'refuge', 'import', 10000, 'phone-aaaa', now() - interval '2 minutes'),
  ('c0000000-0000-0000-0000-000000000002', 'refuge', 'add', 108, 'phone-aaaa', pg_temp.ws() - interval '1 hour'),  -- last Sunday 23:00
  ('c0000000-0000-0000-0000-000000000003', 'refuge', 'add', 108, 'phone-aaaa', now() - interval '1 minute'),
  ('c0000000-0000-0000-0000-000000000004', 'refuge', 'add', 21,  'desk-bbbb',  now() - interval '1 minute');
select pg_temp.expect(pg_temp.week() = 129, 'this week = adds since Monday 00:00 (108 + 21), not imports or last week');
select pg_temp.expect((select total from counter_totals where practice_id='refuge') = 10237, 'lifetime total untouched (10 237)');

-- Undo this week's +21 -> week 108
insert into counter_events (id, practice_id, kind, delta, undoes, device_id, client_at) values
  (gen_random_uuid(), 'refuge', 'undo', -21, 'c0000000-0000-0000-0000-000000000004', 'desk-bbbb', now());
select pg_temp.expect(pg_temp.week() = 108, 'undo removes the add from the week');
-- Undo LAST week's +108 today -> this week unchanged
insert into counter_events (id, practice_id, kind, delta, undoes, device_id, client_at) values
  (gen_random_uuid(), 'refuge', 'undo', -108, 'c0000000-0000-0000-0000-000000000002', 'phone-aaaa', now());
select pg_temp.expect(pg_temp.week() = 108, 'undoing last week''s add does not reduce this week');
-- Corrections change the lifetime total only
insert into counter_events (id, practice_id, kind, delta, client_total_before, client_total_after, device_id, client_at) values
  ('c0000000-0000-0000-0000-000000000005', 'refuge', 'adjust', -5000, 10108, 5108, 'phone-aaaa', now()),
  (gen_random_uuid(), 'refuge', 'adjust', 300, 5108, 5408, 'phone-aaaa', now());
select pg_temp.expect(pg_temp.week() = 108, 'corrections do not change weekly progress');
select pg_temp.expect((select total from counter_totals where practice_id='refuge') = 5408, 'corrections do change the lifetime total');

-- Another practice is separate
insert into counter_events (id, practice_id, kind, delta, device_id, client_at) values (gen_random_uuid(), 'mandala', 'add', 500, 'phone-aaaa', now());
select pg_temp.expect(pg_temp.week('mandala') = 500 and pg_temp.week() = 108, 'per practice');

-- Week boundary follows the timezone: an add at Kyiv Monday 00:10 is still Sunday in New York
insert into counter_events (id, practice_id, kind, delta, device_id, client_at) values (gen_random_uuid(), 'guru', 'add', 7, 'phone-aaaa', pg_temp.ws() + interval '10 minutes');
select pg_temp.expect(pg_temp.week('guru') = 7, 'Kyiv: Monday 00:10 is this week');
select pg_temp.expect(
  pg_temp.week('guru', 'America/New_York') = case when now() >= (date_trunc('week', now() at time zone 'America/New_York') at time zone 'America/New_York')
                                                    and pg_temp.ws() + interval '10 minutes' >= (date_trunc('week', now() at time zone 'America/New_York') at time zone 'America/New_York') then 7 else 0 end,
  'New York uses its own Monday');
select pg_temp.expect_error($q$select * from weekly_progress('Mars/Olympus')$q$, 'unknown timezone');

-- Weekly goals: newest wins, 0 turns off, lifetime target unaffected
insert into counter_events (id, practice_id, kind, target, device_id, client_at) values (gen_random_uuid(), 'refuge', 'set_weekly_goal', 500, 'phone-aaaa', now());
insert into counter_events (id, practice_id, kind, target, device_id, client_at) values (gen_random_uuid(), 'refuge', 'set_weekly_goal', 108, 'desk-bbbb', now() - interval '1 hour');
select pg_temp.expect((select weekly_goal from counter_totals where practice_id='refuge') = 500, 'newer weekly goal wins over an older one arriving later');
select pg_temp.expect((select target from counter_totals where practice_id='refuge') = 111111 and (select total from counter_totals where practice_id='refuge') = 5408, 'lifetime target and total untouched by weekly goal');
insert into counter_events (id, practice_id, kind, target, device_id, client_at) values (gen_random_uuid(), 'refuge', 'set_weekly_goal', 0, 'phone-aaaa', now());
select pg_temp.expect((select weekly_goal is null from counter_totals where practice_id='refuge'), '0 turns the weekly goal off');
insert into counter_events (id, practice_id, kind, target, device_id, client_at) values (gen_random_uuid(), 'bodhicitta', 'set_weekly_goal', 1000, 'phone-aaaa', now());
select pg_temp.expect((select weekly_goal = 1000 and target = 111111 and total = 0 from counter_totals where practice_id='bodhicitta'), 'first event for a practice can be a weekly goal');
select pg_temp.expect_error($q$insert into counter_events (id, practice_id, kind, target, device_id, client_at) values (gen_random_uuid(), 'refuge', 'set_weekly_goal', -1, 'phone-aaaa', now())$q$, 'negative weekly goal');
select pg_temp.expect_error($q$insert into counter_events (id, practice_id, kind, delta, target, device_id, client_at) values (gen_random_uuid(), 'refuge', 'set_weekly_goal', 5, 100, 'phone-aaaa', now())$q$, 'weekly goal with an amount');
-- Lifetime goal still works as before
insert into counter_events (id, practice_id, kind, target, device_id, client_at) values (gen_random_uuid(), 'refuge', 'set_target', 100000, 'phone-aaaa', now());
select pg_temp.expect((select target from counter_totals where practice_id='refuge') = 100000, 'lifetime target 100 000 still works');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.expect((select count(*) from weekly_progress('Europe/Kyiv')) = 0, 'other user sees none of A''s weekly progress');
reset role;
set role anon;
select pg_temp.expect_error($q$select * from weekly_progress('UTC')$q$, 'signed-out call');
reset role;
\echo ALL WEEKLY TESTS PASSED
