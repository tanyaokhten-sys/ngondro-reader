# Browser tests for sign-in and sync

The Supabase browser client is replaced by `fake-supabase.js`: auth is simulated,
but every database call runs against a local Postgres with the real migrations,
row-level security and triggers (`supabase/tests/supabase_stub.sql` + `supabase/migrations/*`).

    createdb e2e && psql -d e2e -f supabase/tests/supabase_stub.sql -f supabase/migrations/20261115000000_counters.sql -f supabase/migrations/20261115000001_counters_limits.sql
    psql -d e2e -c "insert into auth.users values ('aaaaaaaa-0000-0000-0000-000000000001'),('bbbbbbbb-0000-0000-0000-000000000002')"
    (cd public && python3 -m http.server 8771) &
    PGHOST=/path/to/socket PGPORT=5432 node tests/e2e/run.js      # needs: npm i pg playwright

`run.js`: guest → first sign-in import, second device conflict, simultaneous counting,
undo, offline + reconnect, repeated uploads, two users, sign-out/sign-in.
`offline.js` (serve a copy of public/ on :8772 with this fake as the vendor file):
reopen the installed app offline, count, reopen online.
