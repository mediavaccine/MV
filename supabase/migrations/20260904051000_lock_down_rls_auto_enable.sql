-- Supabase's own rls_auto_enable() is granted EXECUTE to anon and authenticated
-- by default, which the database linter flags: a SECURITY DEFINER function
-- reachable without signing in. It returns event_trigger and does nothing
-- outside a DDL event, so the exposure is theoretical rather than exploitable —
-- but there is no reason for a kiosk's anonymous key to reach it at all.
--
-- Event triggers are invoked by the server as the trigger's owner and do not
-- consult EXECUTE grants, so revoking here does not stop new tables getting
-- RLS. Verified against a throwaway cluster: a table created after the revoke
-- still comes up with rowsecurity set.
--
-- The function belongs to the hosted platform, not to this schema, so this is
-- written to be a no-op anywhere it does not exist.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public;
    revoke execute on function public.rls_auto_enable() from anon;
    revoke execute on function public.rls_auto_enable() from authenticated;
  end if;
end $$;
