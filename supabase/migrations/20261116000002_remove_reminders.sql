-- Practice reminders (Web Push) were removed from the app.
-- Stop the cron jobs, then drop everything the reminder migrations created.
select cron.unschedule(jobname) from cron.job
where jobname in ('ngondro-reminders', 'ngondro-reminders-cleanup');

delete from vault.secrets where name = 'reminders_cron_secret';

drop function if exists public.claim_due_reminders(timestamptz, interval);
drop function if exists public.register_push_subscription(text, text, text, text);
drop table if exists public.reminder_deliveries;
drop table if exists public.push_subscriptions;
drop table if exists public.reminder_settings;
drop function if exists public.reminder_settings_validate();
