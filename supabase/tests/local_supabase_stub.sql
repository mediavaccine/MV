-- Local stand-in for the parts of a hosted Supabase project that the
-- migrations depend on. A real project already provides all of this; it exists
-- only so the migrations can be exercised against a throwaway Postgres.
--
-- Never applied to a hosted project.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema if not exists auth;
create table auth.users (id uuid primary key);

-- Supabase derives auth.uid() from the request JWT. Locally we read the same
-- setting directly, so a test can act as a chosen user with a plain SET.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
