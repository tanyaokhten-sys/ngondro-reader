-- Run after supabase_stub.sql and all migrations.
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
begin if not cond then raise exception 'FAIL %', label; end if; raise notice 'ok  %', label; end $$;
create function pg_temp.total(p text default 'refuge') returns bigint language sql as
  $$ select coalesce((select total from public.counter_totals where practice_id = p), 0) $$;
create function pg_temp.sum_events(p text default 'refuge') returns bigint language sql as
  $$ select coalesce(sum(delta), 0) from public.counter_events where practice_id = p $$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into counter_events (id, practice_id, kind, delta, device_id, client_at) values
  ('a0000000-0000-0000-0000-000000000001', 'refuge', 'import', 345, 'phone-aaaa', now());

-- Correct 345 -> 300
insert into counter_events (id, practice_id, kind, delta, client_total_before, client_total_after, note, device_id, client_at) values
  ('a0000000-0000-0000-0000-000000000002', 'refuge', 'adjust', -45, 345, 300, 'manual correction', 'phone-aaaa', now());
select pg_temp.expect(pg_temp.total() = 300, 'correction lowers the total (300)');
-- Retried twice: ignored
insert into counter_events (id, practice_id, kind, delta, client_total_before, client_total_after, device_id, client_at) values
  ('a0000000-0000-0000-0000-000000000002', 'refuge', 'adjust', -45, 345, 300, 'phone-aaaa', now()) on conflict (id) do nothing;
insert into counter_events (id, practice_id, kind, delta, client_total_before, client_total_after, device_id, client_at) values
  ('a0000000-0000-0000-0000-000000000002', 'refuge', 'adjust', -45, 345, 300, 'phone-aaaa', now()) on conflict (id) do nothing;
select pg_temp.expect(pg_temp.total() = 300, 'retried correction applied once');

-- Desktop, offline, still thought 345 and added 108; phone's correction came first.
insert into counter_events (id, practice_id, kind, delta, device_id, client_at) values
  ('b0000000-0000-0000-0000-000000000001', 'refuge', 'add', 108, 'desk-bbbb', now());
select pg_temp.expect(pg_temp.total() = 408, 'concurrent add kept (300 + 108)');

-- Undo the correction -> back up by 45
insert into counter_events (id, practice_id, kind, delta, undoes, device_id, client_at) values
  ('a0000000-0000-0000-0000-000000000003', 'refuge', 'undo', 45, 'a0000000-0000-0000-0000-000000000002', 'phone-aaaa', now());
select pg_temp.expect(pg_temp.total() = 453, 'undo of a correction (453)');
-- Undo amount always matches the original, whatever the device sent
insert into counter_events (id, practice_id, kind, delta, undoes, device_id, client_at) values
  ('b0000000-0000-0000-0000-000000000002', 'refuge', 'undo', -999, 'b0000000-0000-0000-0000-000000000001', 'desk-bbbb', now());
select pg_temp.expect(pg_temp.total() = 345, 'undo takes the exact amount of the original (-108)');
select pg_temp.expect((select requested_delta from counter_events where id = 'b0000000-0000-0000-0000-000000000002') = -999, 'mismatched undo amount kept for audit');
select pg_temp.expect_error($q$insert into counter_events (id, practice_id, kind, delta, undoes, device_id, client_at) values
  (gen_random_uuid(), 'refuge', 'undo', -1, 'a0000000-0000-0000-0000-000000000001', 'phone-aaaa', now())$q$, 'undo of an import');
select pg_temp.expect_error($q$insert into counter_events (id, practice_id, kind, delta, undoes, device_id, client_at) values
  (gen_random_uuid(), 'refuge', 'undo', 45, 'a0000000-0000-0000-0000-000000000002', 'phone-aaaa', now())$q$, 'second undo of the same correction');

-- Never below zero: correction to 0 from a stale view, then another device's reduction
insert into counter_events (id, practice_id, kind, delta, client_total_before, client_total_after, device_id, client_at) values
  (gen_random_uuid(), 'refuge', 'adjust', -500, 500, 0, 'desk-bbbb', now());
select pg_temp.expect(pg_temp.total() = 0, 'reduction larger than the total stops at 0');
select pg_temp.expect((select requested_delta = -500 and delta = -345 from counter_events where kind = 'adjust' and client_total_before = 500), 'requested vs applied amount recorded');
select pg_temp.expect(pg_temp.total() = pg_temp.sum_events(), 'total always equals the sum of events');

-- Inside one upload: add 100 then correct -150 -> applied -100, total 0
insert into counter_events (id, practice_id, kind, delta, device_id, client_at, client_total_before, client_total_after) values
  (gen_random_uuid(), 'refuge', 'add', 100, 'phone-aaaa', now(), null, null),
  (gen_random_uuid(), 'refuge', 'adjust', -150, 'phone-aaaa', now(), 150, 0);
select pg_temp.expect(pg_temp.total() = 0 and pg_temp.sum_events() = 0, 'limit works within a multi-row upload');
-- Positive correction
insert into counter_events (id, practice_id, kind, delta, client_total_before, client_total_after, device_id, client_at) values
  (gen_random_uuid(), 'refuge', 'adjust', 1000, 0, 1000, 'phone-aaaa', now());
select pg_temp.expect(pg_temp.total() = 1000, 'correction can also raise the total');

select pg_temp.expect_error($q$insert into counter_events (id, practice_id, kind, delta, device_id, client_at) values (gen_random_uuid(), 'refuge', 'adjust', 500000000, 'phone-aaaa', now())$q$, 'absurd increase');
select pg_temp.expect_error($q$insert into counter_events (id, practice_id, kind, delta, target, device_id, client_at) values (gen_random_uuid(), 'refuge', 'adjust', 5, 10, 'phone-aaaa', now())$q$, 'correction with a target');
select pg_temp.expect_error($q$update counter_events set delta = 0$q$, 'history cannot be edited');
reset role;

-- Other user can't correct or undo A's events
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select pg_temp.expect_error($q$insert into counter_events (id, practice_id, kind, delta, undoes, device_id, client_at) values
  (gen_random_uuid(), 'refuge', 'undo', 45, 'a0000000-0000-0000-0000-000000000002', 'evil-bbbb', now())$q$, 'B undoes A''s correction');
insert into counter_events (id, practice_id, kind, delta, device_id, client_at) values (gen_random_uuid(), 'refuge', 'adjust', -999, 'evil-bbbb', now());
select pg_temp.expect(pg_temp.total() = 0, 'B''s reduction only touches B (stays 0, not negative)');
reset role;
select pg_temp.expect((select total from counter_totals where user_id = '00000000-0000-0000-0000-0000000000a1' and practice_id = 'refuge') = 1000, 'A unaffected (1000)');
\echo ALL ADJUSTMENT TESTS PASSED
