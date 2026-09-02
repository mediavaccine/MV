-- Pin search_path on the two remaining functions (Supabase linter 0011)
--
-- is_admin, event_public_payload and track_usage_event were created with a
-- pinned search_path because they are SECURITY DEFINER. These two were not,
-- which was an oversight rather than a decision: set_updated_at runs on every
-- insert and update in the schema, and a function whose search_path the caller
-- controls can be pointed at a shadowed operator or function.
--
-- ALTER rather than a rewrite: the migrations that created these functions have
-- already been applied, and migrations are append-only.
--
-- pg_catalog is enough for both bodies — they use only built-ins — and pg_temp
-- comes last so a temporary object can never shadow one of them.

alter function public.set_updated_at()
  set search_path = pg_catalog, pg_temp;

alter function public.filter_jsonb_keys(jsonb, text[])
  set search_path = pg_catalog, pg_temp;
