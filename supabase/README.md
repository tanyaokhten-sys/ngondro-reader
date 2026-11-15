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

## Practice reminders — removed 2026-11-16
Web Push reminders were added and then removed. `20261116000002_remove_reminders.sql`
dropped their tables/functions and cron jobs; the `reminders` Edge Function, its secrets
and the Vault secret were deleted. The app cancels any leftover browser push subscription
on start. The two earlier reminder migrations stay in the folder because they are recorded
as applied.

## Counter corrections — 2026-11-17
- `20261117000000_counter_adjustments.sql` (applied): event kind `adjust` (signed delta,
  `client_total_before/after`, `note`), undo may cancel `add` or `adjust` and always takes
  the original's exact amount, and every reduction is limited so a total never goes below
  zero (`requested_delta` keeps what was asked). Existing rows unchanged.
- Tests: `tests/adjustments_test.sql`, `tests/e2e/corrections.js`.
- Local test chain skips the two reminder migrations (they need pg_cron and cancel out).
