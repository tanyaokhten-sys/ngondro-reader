-- Every minute, ask the Edge Function to send due reminders.
-- The secret is read from Supabase Vault (name: reminders_cron_secret), so it
-- is never stored in this repository. Create it once with:
--   select vault.create_secret('<same value as the CRON_SECRET function secret>', 'reminders_cron_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'ngondro-reminders',
  '* * * * *',
  $job$
    select net.http_post(
      url     := 'https://himkikciqlogffqflaxc.supabase.co/functions/v1/reminders',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_cron_secret')
      ),
      body    := '{"action":"dispatch"}'::jsonb,
      timeout_milliseconds := 20000
    );
  $job$
);

-- Keep the delivery log short (needed only to prevent same-day duplicates).
select cron.schedule('ngondro-reminders-cleanup', '13 3 * * *',
  $job$ delete from public.reminder_deliveries where claimed_at < now() - interval '14 days' $job$);
