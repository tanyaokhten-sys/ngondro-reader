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

## Still to do (needs the owner)
- Google provider (Authentication → Sign In / Providers → Google) with a Google Cloud
  OAuth client. Redirect URI: https://himkikciqlogffqflaxc.supabase.co/auth/v1/callback

## Later: email sign-in
- Custom SMTP (Authentication → Emails → SMTP) is required before the email can show the
  6-digit code (template changes are blocked on the default sender) and to lift the
  2 emails/hour limit.
