-- Run after supabase_stub.sql and the migration. Any failure raises an error.
\set ON_ERROR_STOP 1
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');

create function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
create function pg_temp.expect_error(q text, label text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'ok  %: rejected (%)', label, sqlerrm; return; end;
  raise exception 'FAIL %: was allowed', label;
end $$;
create function pg_temp.expect(cond boolean, label text) returns void language plpgsql as $$
begin if not cond then raise exception 'FAIL %', label; end if; raise notice 'ok  %', label; end $$;

-- User A counts 108 + 21, the second upload is retried twice
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into counter_events (id, practice_id, kind, delta, device_id, client_at) values
  ('10000000-0000-0000-0000-000000000001', 'refuge', 'add', 108, 'phone-aaaa', now()),
  ('10000000-0000-0000-0000-000000000002', 'refuge', 'add', 21,  'phone-aaaa', now());
insert into counter_events (id, practice_id, kind, delta, device_id, client_at) values
  ('10000000-0000-0000-0000-000000000002', 'refuge', 'add', 21, 'phone-aaaa', now()) on conflict (id) do nothing;
insert into counter_events (id, practice_id, kind, delta, device_id, client_at) values
  ('10000000-0000-0000-0000-000000000002', 'refuge', 'add', 21, 'phone-aaaa', now()) on conflict (id) do nothing;
select pg_temp.expect((select total from counter_totals where practice_id='refuge') = 129, 'retried upload is counted once (129)');

-- Second device adds at the same time
insert into counter_events (id, practice_id, kind, delta, device_id, client_at) values
  ('20000000-0000-0000-0000-000000000001', 'refuge', 'add', 108, 'desk-bbbb', now());
select pg_temp.expect((select total from counter_totals where practice_id='refuge') = 237, 'second device adds (237)');

-- Undo the 21 from two devices: only one may succeed
insert into counter_events (id, practice_id, kind, delta, undoes, device_id, client_at) values
  ('10000000-0000-0000-0000-000000000003', 'refuge', 'undo', -21, '10000000-0000-0000-0000-000000000002', 'phone-aaaa', now());
select pg_temp.expect_error($q$insert into counter_events (id, practice_id, kind, delta, undoes, device_id, client_at) values
  ('20000000-0000-0000-0000-000000000002', 'refuge', 'undo', -21, '10000000-0000-0000-0000-000000000002', 'desk-bbbb', now())$q$, 'second undo of the same tap');
select pg_temp.expect((select total from counter_totals where practice_id='refuge') = 216, 'undo applied once (216)');
select pg_temp.expect_error($q$insert into counter_events (id, practice_id, kind, delta, undoes, device_id, client_at) values
  (gen_random_uuid(), 'refuge', 'undo', -500, '20000000-0000-0000-0000-000000000001', 'desk-bbbb', now())$q$, 'undo of a different size');

-- Goals: the most recent change wins, even if it arrives first
insert into counter_events (id, practice_id, kind, target, device_id, client_at) values
  (gen_random_uuid(), 'refuge', 'set_target', 100000, 'desk-bbbb', now());
insert into counter_events (id, practice_id, kind, target, device_id, client_at) values
  (gen_random_uuid(), 'refuge', 'set_target', 50000, 'phone-aaaa', now() - interval '1 hour');
select pg_temp.expect((select target from counter_totals where practice_id='refuge') = 100000, 'newer goal wins over older one arriving later');

-- Import of an existing local total
insert into counter_events (id, practice_id, kind, delta, device_id, client_at) values
  (gen_random_uuid(), 'bodhicitta', 'import', 5000, 'phone-aaaa', now());
select pg_temp.expect((select total from counter_totals where practice_id='bodhicitta') = 5000, 'import');

-- Bad values
select pg_temp.expect_error($q$insert into counter_events (id, practice_id, kind, delta, device_id, client_at) values (gen_random_uuid(), 'refuge', 'add', -5, 'phone-aaaa', now())$q$, 'negative add');
select pg_temp.expect_error($q$insert into counter_events (id, practice_id, kind, delta, device_id, client_at) values (gen_random_uuid(), 'refuge', 'add', 5000000, 'phone-aaaa', now())$q$, 'huge add');
select pg_temp.expect_error($q$insert into counter_events (id, practice_id, kind, delta, device_id, client_at) values (gen_random_uuid(), 'Bad Id!', 'add', 1, 'phone-aaaa', now())$q$, 'bad practice id');
select pg_temp.expect_error($q$insert into counter_events (id, practice_id, kind, delta, device_id, client_at) values (gen_random_uuid(), 'refuge', 'add', 1, 'phone-aaaa', now() + interval '3 days')$q$, 'time far in future');

-- Users can't touch totals or rewrite history
select pg_temp.expect_error($q$update counter_totals set total = 999999$q$, 'write totals directly');
select pg_temp.expect_error($q$update counter_events set delta = 999 where id = '10000000-0000-0000-0000-000000000001'$q$, 'edit an event');
select pg_temp.expect_error($q$delete from counter_events$q$, 'delete events directly');

-- Privacy: user B
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) from counter_events) = 0, 'B sees none of A''s events');
select pg_temp.expect((select count(*) from counter_totals) = 0, 'B sees none of A''s totals');
select pg_temp.expect_error($q$insert into counter_events (id, user_id, practice_id, kind, delta, device_id, client_at) values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', 'refuge', 'add', 1000, 'evil-bbbb', now())$q$, 'B writes into A''s account');
select pg_temp.expect_error($q$insert into counter_events (id, practice_id, kind, delta, undoes, device_id, client_at) values (gen_random_uuid(), 'refuge', 'undo', -108, '20000000-0000-0000-0000-000000000001', 'evil-bbbb', now())$q$, 'B undoes A''s tap');
-- B reusing A's event id is ignored, not overwritten
insert into counter_events (id, practice_id, kind, delta, device_id, client_at) values
  ('10000000-0000-0000-0000-000000000001', 'refuge', 'add', 1, 'evil-bbbb', now()) on conflict (id) do nothing;
reset role;
select pg_temp.expect((select delta from counter_events where id='10000000-0000-0000-0000-000000000001') = 108, 'A''s event untouched by B');
select pg_temp.expect((select total from counter_totals where user_id='00000000-0000-0000-0000-00000000000a' and practice_id='refuge') = 216, 'A''s total untouched by B');

-- Signed-out visitors see nothing
set role anon;
select pg_temp.expect_error($q$select * from counter_events$q$, 'anon reads events');
select pg_temp.expect_error($q$select * from counter_totals$q$, 'anon reads totals');
select pg_temp.expect((select public.ping()) = 'ok', 'anon keep-alive ping');
reset role;

-- Delete my data (A)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.delete_my_counter_data();
reset role;
select pg_temp.expect((select count(*) from counter_events where user_id='00000000-0000-0000-0000-00000000000a') = 0, 'delete my data removes own events');
select pg_temp.expect((select count(*) from counter_totals where user_id='00000000-0000-0000-0000-00000000000a') = 0, 'delete my data removes own totals');
\echo ALL TESTS PASSED
