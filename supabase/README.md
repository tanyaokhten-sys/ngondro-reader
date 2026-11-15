# Supabase setup — Ngondro Reader

Project: `ngondro_reader` (ref `himkikciqlogffqflaxc`, region eu-central-2, free plan)
API URL: https://himkikciqlogffqflaxc.supabase.co

## Database
- `migrations/20261115000000_counters.sql` and `20261115000001_counters_limits.sql` — applied
  2026-11-15 via the Management API and recorded in `supabase_migrations.schema_migrations`,
  so the GitHub integration will not re-run them.
- Tests: `tests/` (local Postgres stand-in for Supabase auth):
  `psql -f tests/supabase_stub.sql -f migrations/*.sql -f tests/counters_test.sql`
- Verified on the live project: signed-out (anon) requests cannot read, write or call
  `delete_my_counter_data`; only `rpc/ping` answers.

## Auth settings (applied)
- Site URL: https://ngondro-reader.netlify.app
- Redirect allow list: the site, its deploy previews (`https://*--ngondro-reader.netlify.app/**`),
  and `http://localhost:8770/**` for local testing
- Email OTP: 6 digits, valid 10 minutes

- Email/password provider: OFF (Google only for now). Re-enable together with SMTP when
  adding email sign-in.

- Google provider: ON. Google Cloud project `ngondro-reader-514818`, Web application client
  `936641404054-d29i8ejidk8md6o689bne5ce3prbesi0` with redirect URI
  https://himkikciqlogffqflaxc.supabase.co/auth/v1/callback (secret stored only in Supabase).

## Later: email sign-in
- Custom SMTP (Authentication → Emails → SMTP) is required before the email can show the
  6-digit code (template changes are blocked on the default sender) and to lift the
  2 emails/hour limit.

## Practice reminders (Web Push) — set up 2026-11-16
- Migrations `20261116000000_reminders.sql` (tables, RLS, `register_push_subscription`,
  `claim_due_reminders`) and `20261116000001_reminders_cron.sql` (pg_cron + pg_net jobs),
  applied via the Management API and recorded in the migration history.
- Edge Function `reminders` (`functions/reminders/index.ts`), deployed with
  `verify_jwt = false`; it checks the cron secret (`dispatch`) or the user's token (`test`).
  Redeploy: Management API `POST /v1/projects/<ref>/functions/deploy?slug=reminders`
  (or `supabase functions deploy reminders --no-verify-jwt`).
- Edge Function secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
  (`https://ngondro-reader.netlify.app`), `CRON_SECRET`. The VAPID public key is also in
  `tools/reminders-client.js`.
- Vault secret `reminders_cron_secret` = `CRON_SECRET` (read by the cron job).
- Cron: `ngondro-reminders` every minute; `ngondro-reminders-cleanup` daily.
- Rotating the cron secret: set a new `CRON_SECRET` function secret and
  `select vault.update_secret((select id from vault.secrets where name = 'reminders_cron_secret'), '<new>');`
- Rotating VAPID keys invalidates every device subscription: devices re-subscribe when the
  user next opens the app (`__ngPushMaintain`) — update the key in both places.
- Tests: `tests/reminders_test.sql` (time zones, DST, weekdays, duplicates, privacy) and
  `tests/e2e/reminders.js` (settings UI).
