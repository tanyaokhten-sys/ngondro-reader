-- Run after supabase_stub.sql and all migrations.
\set ON_ERROR_STOP 1
insert into auth.users values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b2'), ('00000000-0000-0000-0000-0000000000c3');
create function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
create function pg_temp.expect_error(q text, label text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'ok  %: rejected (%)', label, sqlerrm; return; end;
  raise exception 'FAIL %: was allowed', label;
end $$;
create function pg_temp.expect(cond boolean, label text) returns void language plpgsql as $$
begin if not cond then raise exception 'FAIL %', label; end if; raise notice 'ok  %', label; end $$;
create function pg_temp.claim(t text) returns int language plpgsql as $$
declare n int; begin
  execute 'set role service_role';
  select count(*) into n from public.claim_due_reminders(t::timestamptz);
  execute 'reset role'; return n; end $$;

-- A (Kyiv, 07:00 every day, 2 devices), B (New York, 21:30 weekdays, 1 device), C (enabled, no device)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect((select count(*) from reminder_settings) = 0, 'no settings until saved (off by default)');
insert into reminder_settings (enabled, remind_at, timezone) values (true, '07:00', 'Europe/Kyiv');
select register_push_subscription('https://push.example/a-phone', repeat('p',40), repeat('a',16), 'phone');
select register_push_subscription('https://push.example/a-desk',  repeat('p',40), repeat('a',16), 'desk');
select pg_temp.expect_error($q$insert into reminder_settings (user_id, enabled, timezone) values ('00000000-0000-0000-0000-0000000000b2', true, 'UTC')$q$, 'A creates settings for B');
select pg_temp.expect_error($q$update reminder_settings set timezone = 'Mars/Olympus'$q$, 'unknown timezone');
select pg_temp.expect_error($q$update reminder_settings set weekdays = '{0,8}'$q$, 'bad weekdays');
select pg_temp.expect_error($q$insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (auth.uid(), 'https://x/y', repeat('p',40), repeat('a',16))$q$, 'insert device directly');
select pg_temp.expect_error($q$select * from reminder_deliveries$q$, 'read deliveries');
select pg_temp.expect_error($q$select * from claim_due_reminders()$q$, 'user calls the dispatcher');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
insert into reminder_settings (enabled, remind_at, weekdays, timezone) values (true, '21:30', '{1,2,3,4,5}', 'America/New_York');
select register_push_subscription('https://push.example/b-phone', repeat('p',40), repeat('a',16), 'phone');
select pg_temp.expect((select count(*) from reminder_settings) = 1, 'B sees only own settings');
select pg_temp.expect((select count(*) from push_subscriptions) = 1, 'B sees only own devices');
update reminder_settings set enabled = false where user_id = '00000000-0000-0000-0000-0000000000a1';
delete from push_subscriptions where endpoint = 'https://push.example/a-phone';
reset role;
select pg_temp.expect((select enabled from reminder_settings where user_id = '00000000-0000-0000-0000-0000000000a1'), 'B cannot switch off A''s reminders');
select pg_temp.expect((select count(*) from push_subscriptions where user_id = '00000000-0000-0000-0000-0000000000a1') = 2, 'B cannot remove A''s devices');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
insert into reminder_settings (enabled, timezone) values (true, 'UTC');
reset role;

-- Time travel. Winter: Kyiv = UTC+2. 2026-01-15 is a Thursday.
select pg_temp.expect(pg_temp.claim('2026-01-15 04:59:00+00') = 0, 'A: 06:59 Kyiv -> not yet');
select pg_temp.expect(pg_temp.claim('2026-01-15 05:00:30+00') = 2, 'A: 07:00 Kyiv -> both devices');
select pg_temp.expect(pg_temp.claim('2026-01-15 05:01:00+00') = 0, 'A: next minute -> no duplicate');
select pg_temp.expect(pg_temp.claim('2026-01-15 05:20:00+00') = 0, 'A: 07:20 -> outside window, nothing');
select pg_temp.expect((select count(*) from reminder_deliveries where user_id = '00000000-0000-0000-0000-0000000000c3') = 0, 'C (no device) is never claimed');
-- Summer: Kyiv = UTC+3 (DST). 2026-07-16 is a Thursday.
select pg_temp.expect(pg_temp.claim('2026-07-16 04:00:30+00') = 2, 'A: DST -> 07:00 Kyiv is 04:00 UTC');
-- B: 21:30 New York on Friday 2026-01-16 = 02:30 UTC Saturday
select pg_temp.expect(pg_temp.claim('2026-01-17 02:30:00+00') = 1, 'B: Friday evening in New York (already Saturday in UTC)');
select pg_temp.expect(pg_temp.claim('2026-01-18 02:30:00+00') = 0, 'B: Saturday evening -> not a chosen weekday');
-- Spring-forward gap: reminder at 03:30 Kyiv on 2026-03-29 (03:00 -> 04:00 does not exist)
update reminder_settings set remind_at = '03:30' where user_id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.expect(pg_temp.claim('2026-03-29 01:00:30+00') = 0, 'A: DST gap -> not before the (shifted) time');
select pg_temp.expect(pg_temp.claim('2026-03-29 01:30:30+00') = 2, 'A: DST gap -> sent (04:30 local) instead of skipped');
-- Overlapping runs at the same moment claim once
update reminder_settings set remind_at = '07:00' where user_id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.expect(pg_temp.claim('2026-02-02 05:00:00+00') + pg_temp.claim('2026-02-02 05:00:00+00') = 2, 'two simultaneous runs -> sent once');

-- Same browser, different account: the endpoint moves to the new owner
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select register_push_subscription('https://push.example/a-desk', repeat('q',40), repeat('b',16), 'desk');
reset role;
select pg_temp.expect((select user_id from push_subscriptions where endpoint = 'https://push.example/a-desk') = '00000000-0000-0000-0000-0000000000b2', 'shared browser now notifies only the signed-in account');

set role anon;
select pg_temp.expect_error($q$select * from reminder_settings$q$, 'signed-out reads settings');
select pg_temp.expect_error($q$select register_push_subscription('https://x/z', repeat('p',40), repeat('a',16))$q$, 'signed-out registers a device');
reset role;
\echo ALL REMINDER TESTS PASSED
