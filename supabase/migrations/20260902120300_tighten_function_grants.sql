-- Tighten function grants (follow-up to 20260902120200_public_api.sql)
--
-- Supabase ships default privileges that grant EXECUTE on every new function in
-- `public` to anon, authenticated and service_role. `revoke ... from public`
-- does not remove those role grants, so the previous migration's intent — that
-- the kiosk's entire surface is two RPCs — was not actually enforced: the anon
-- role could call the internal helpers too.
--
-- Nothing leaked as a result. is_admin() returns false for an anonymous caller,
-- set_updated_at() only works inside a trigger, and filter_jsonb_keys() is a
-- pure function over arguments the caller already holds. But least privilege
-- should be the enforced reality rather than a comment describing an intention.

-- Two sources of the grant have to go: the role grant Supabase's default
-- privileges hand to anon, and PostgreSQL's own EXECUTE-to-PUBLIC default,
-- which anon inherits as a member of PUBLIC. Revoking one leaves the other.
revoke execute on function public.set_updated_at() from public, anon;
revoke execute on function public.filter_jsonb_keys(jsonb, text[]) from public, anon;
revoke execute on function public.is_admin() from anon;

-- The admin app keeps what it needs. set_updated_at is reached through a
-- trigger rather than called directly, but the grant costs nothing and keeps
-- the admin path independent of when PostgreSQL checks trigger privileges.
grant execute on function public.set_updated_at() to authenticated;
grant execute on function public.filter_jsonb_keys(jsonb, text[]) to authenticated;

-- Restated so this file describes the full public surface on its own.
grant execute on function public.event_public_payload(text) to anon;
grant execute on function public.track_usage_event(
  text, public.usage_event_type, text, uuid, text
) to anon;
