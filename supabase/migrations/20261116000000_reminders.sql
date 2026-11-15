-- Practice reminders (Web Push).
--
-- reminder_settings  one row per user: on/off, local time, weekdays, IANA timezone
-- push_subscriptions one row per device (browser push endpoint)
-- reminder_deliveries one row per user per LOCAL date that a reminder was claimed;
--                    its primary key is what prevents duplicate reminders, even
--                    if two dispatch runs overlap.

create table public.reminder_settings (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  enabled    boolean not null default false,
  remind_at  time not null default '07:00',
  weekdays   smallint[] not null default '{1,2,3,4,5,6,7}'
             check (weekdays <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(weekdays) between 1 and 7),
  timezone   text not null default 'UTC' check (length(timezone) between 1 and 64),
  updated_at timestamptz not null default now()
);

-- Only real IANA names (so "now() at time zone" can never fail at send time).
create function public.reminder_settings_validate() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'unknown timezone %', new.timezone using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger reminder_settings_validate
  before insert or update on public.reminder_settings
  for each row execute function public.reminder_settings_validate();

create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  endpoint     text not null unique check (endpoint ~ '^https://' and length(endpoint) < 2048),
  p256dh       text not null check (length(p256dh) between 20 and 200),
  auth         text not null check (length(auth) between 8 and 100),
  user_agent   text check (length(user_agent) < 512),
  created_at   timestamptz not null default now(),
  last_ok_at   timestamptz,
  failures     int not null default 0
);
create index push_subscriptions_user on public.push_subscriptions (user_id);

create table public.reminder_deliveries (
  user_id    uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

-- Row-level security ---------------------------------------------------------
alter table public.reminder_settings  enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminder_deliveries enable row level security;

create policy "own settings: read"   on public.reminder_settings for select to authenticated using (user_id = (select auth.uid()));
create policy "own settings: create" on public.reminder_settings for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own settings: change" on public.reminder_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own devices: read"    on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy "own devices: remove"  on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));
-- Devices are added only through register_push_subscription(); deliveries are server-only.

revoke all on public.reminder_settings, public.push_subscriptions, public.reminder_deliveries from anon, authenticated;
grant select, insert, update (enabled, remind_at, weekdays, timezone) on public.reminder_settings to authenticated;
grant select, delete on public.push_subscriptions to authenticated;

-- A browser's push endpoint belongs to whoever is signed in on it now: if
-- another account used this browser before, its row is replaced.
create function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 500))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, failures = 0, created_at = now();
end $$;
revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

-- Who is due right now? Claims (user, local date) once and returns the
-- devices to notify. Called only by the Edge Function with the service role.
-- p_now is a parameter so tests can travel in time.
create function public.claim_due_reminders(p_now timestamptz default now(), p_window interval default '15 minutes')
returns table (user_id uuid, subscription_id uuid, endpoint text, p256dh text, auth text)
language sql security definer set search_path = '' as $$
  with local as (
    select s.user_id, s.remind_at, s.weekdays, s.timezone, (p_now at time zone s.timezone) as lt
    from public.reminder_settings s
    where s.enabled
      and exists (select 1 from public.push_subscriptions p where p.user_id = s.user_id)
  ),
  due as (
    -- due_at: today's reminder time in the user's zone, as a real instant.
    -- Measuring the window in elapsed time handles DST: a time inside the
    -- spring-forward gap is still sent (shortly after), never skipped.
    select l.user_id, l.lt::date as local_date,
           ((l.lt::date + l.remind_at) at time zone l.timezone) as due_at, l.weekdays
    from local l
  ),
  ready as (
    select d.user_id, d.local_date from due d
    where extract(isodow from d.local_date)::smallint = any (d.weekdays)
      and p_now >= d.due_at
      and p_now - d.due_at < p_window
  ),
  claimed as (
    insert into public.reminder_deliveries (user_id, local_date)
    select r.user_id, r.local_date from ready r
    on conflict do nothing
    returning reminder_deliveries.user_id
  )
  select c.user_id, p.id, p.endpoint, p.p256dh, p.auth
  from claimed c join public.push_subscriptions p on p.user_id = c.user_id;
$$;
revoke all on function public.claim_due_reminders(timestamptz, interval) from public, anon, authenticated;
revoke all on function public.reminder_settings_validate() from public, anon, authenticated;
grant execute on function public.claim_due_reminders(timestamptz, interval) to service_role;
