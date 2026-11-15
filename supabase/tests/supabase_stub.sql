-- Minimal stand-in for Supabase's auth schema and roles, for local tests only.
create role anon nologin;
create role authenticated nologin;
create schema auth;
grant usage on schema auth, public to anon, authenticated;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
