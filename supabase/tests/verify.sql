-- Behavioural checks for the schema, RLS policies and public API.
--
-- Run against a database that has had the migrations and seed.sql applied.
-- Every check raises on failure, so the script exits non-zero the moment a
-- guarantee stops holding. Run it with supabase/tests/run-local.sh.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111')
  on conflict do nothing;
insert into public.admin_users (id, email)
  values ('11111111-1111-1111-1111-111111111111', 'admin@mediavaccine.test')
  on conflict do nothing;

-- A second event, used to prove ids cannot be carried across events.
insert into public.events (slug, name) values ('verify-other-event', 'Verify Other Event')
  on conflict (slug) do nothing;
insert into public.guests (event_id, full_name, table_number)
select id, 'Outsider Person', 'Table 9' from public.events where slug = 'verify-other-event'
  on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Public payload
-- ---------------------------------------------------------------------------

do $$
declare
  v_payload jsonb;
begin
  v_payload := public.event_public_payload('demo-gala-2026');

  assert v_payload is not null,
    'an active event must return a payload';
  assert jsonb_array_length(v_payload -> 'guests') = 8,
    'seed event should expose 8 guests';

  -- extra_field_schema marks meal visible and phone hidden.
  assert v_payload::text like '%meal%',
    'a field marked visible must be served';
  assert v_payload::text not like '%phone%',
    'SECURITY: a field not marked visible must never be served';
  assert v_payload::text not like '%800 000%',
    'SECURITY: hidden field values must never be served';

  -- Admin-only columns must not ride along in the public payload.
  assert not (v_payload ? 'extra_field_schema'), 'extra_field_schema is admin-only';
  assert not (v_payload ? 'table_count'),        'table_count is admin-only';

  assert public.event_public_payload('no-such-event-slug') is null,
    'unknown slugs must return null';
end;
$$;

-- Archived events stop resolving, then come back when reactivated.
update public.events set status = 'archived' where slug = 'demo-gala-2026';
do $$
begin
  assert public.event_public_payload('demo-gala-2026') is null,
    'an archived event must stop resolving for the kiosk';
end;
$$;
update public.events set status = 'active' where slug = 'demo-gala-2026';

-- ---------------------------------------------------------------------------
-- RLS boundary
-- ---------------------------------------------------------------------------

do $$
declare
  v_denied boolean := false;
begin
  set local role anon;
  begin
    perform count(*) from public.guests;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  reset role;

  assert v_denied, 'SECURITY: the anon role must not read public.guests directly';
end;
$$;

do $$
declare
  v_count integer;
begin
  -- Authenticated, but not on the admin allow-list: RLS yields zero rows.
  set local role authenticated;
  set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ff';
  select count(*) into v_count from public.guests;
  reset role;
  assert v_count = 0, 'SECURITY: a non-admin user must see no guests';

  -- On the allow-list: full visibility.
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  select count(*) into v_count from public.guests;
  reset role;
  assert v_count > 0, 'an allow-listed admin must see guests';
end;
$$;

-- ---------------------------------------------------------------------------
-- Every function pins its search_path
-- ---------------------------------------------------------------------------

do $$
declare
  v_unpinned text;
begin
  select string_agg(p.proname, ', ' order by p.proname)
  into v_unpinned
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (
      -- proconfig entries look like 'search_path=pg_catalog, pg_temp'; compare
      -- the key exactly rather than with LIKE, where _ is a wildcard.
      select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) as cfg
      where split_part(cfg, '=', 1) = 'search_path'
    );

  assert v_unpinned is null,
    'SECURITY: every function in public must pin search_path; unpinned: ' || coalesce(v_unpinned, '');
end;
$$;

-- ---------------------------------------------------------------------------
-- The public surface is exactly two functions
-- ---------------------------------------------------------------------------

do $$
begin
  assert has_function_privilege('anon', 'public.event_public_payload(text)', 'execute'),
    'the kiosk must be able to read its event';
  assert has_function_privilege('anon',
    'public.track_usage_event(text, public.usage_event_type, text, uuid, text)', 'execute'),
    'the kiosk must be able to record interactions';

  assert not has_function_privilege('anon', 'public.is_admin()', 'execute'),
    'SECURITY: anon must not reach the admin predicate';
  assert not has_function_privilege('anon', 'public.set_updated_at()', 'execute'),
    'SECURITY: anon must not reach the trigger helper';
  assert not has_function_privilege('anon', 'public.filter_jsonb_keys(jsonb, text[])', 'execute'),
    'SECURITY: anon must not reach the projection helper';
end;
$$;

-- ---------------------------------------------------------------------------
-- Usage tracking
-- ---------------------------------------------------------------------------

do $$
declare
  v_before   bigint;
  v_outsider uuid;
  v_row      public.usage_events;
begin
  -- created_at defaults to now(), which is the TRANSACTION timestamp: every row
  -- inserted inside this block shares one value. So rows are identified by what
  -- makes them unique, never by "the most recent one".
  delete from public.usage_events;

  select count(*) into v_before from public.usage_events;
  select id into v_outsider from public.guests where full_name = 'Outsider Person';

  -- Unknown slug is dropped rather than raised: nothing may error on a screen
  -- in front of a guest.
  perform public.track_usage_event('no-such-event-slug', 'search', 'hello', null, null);
  assert (select count(*) from public.usage_events) = v_before,
    'tracking an unknown event must be a silent no-op';

  -- A guest id from another event must not be recorded against this one.
  perform public.track_usage_event('demo-gala-2026', 'reveal', null, v_outsider, 'main');
  select * into strict v_row from public.usage_events where type = 'reveal';
  assert v_row.guest_id is null,
    'SECURITY: a guest id from another event must be discarded';
  assert v_row.kiosk_instance_id is not null,
    'a known kiosk url_param must be resolved to its instance';

  -- An unrecognised kiosk tag is tolerated, just untagged.
  perform public.track_usage_event('demo-gala-2026', 'no_match', 'zzz', null, 'not-a-kiosk');
  select * into strict v_row from public.usage_events
    where type = 'no_match' and query_text = 'zzz';
  assert v_row.kiosk_instance_id is null,
    'an unknown kiosk param must leave the instance null';

  -- Query text is bounded and normalised.
  perform public.track_usage_event('demo-gala-2026', 'search', repeat('x', 500), null, null);
  select * into strict v_row from public.usage_events
    where type = 'search' and query_text like 'xxx%';
  assert char_length(v_row.query_text) = 200,
    'query_text must be truncated to 200 characters';

  perform public.track_usage_event('demo-gala-2026', 'search', '    ', null, null);
  select * into strict v_row from public.usage_events
    where type = 'search' and query_text is null;
  assert v_row.query_text is null,
    'a whitespace-only query must normalise to null';
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention and cascade
-- ---------------------------------------------------------------------------

do $$
declare
  v_guest  uuid;
  v_before bigint;
begin
  select id into v_guest from public.guests where full_name = 'Grace Mensah';
  perform public.track_usage_event('demo-gala-2026', 'reveal', null, v_guest, 'vip');
  select count(*) into v_before from public.usage_events;

  delete from public.guests where id = v_guest;

  -- Removing a guest must not rewrite history: the row survives, unlinked.
  assert (select count(*) from public.usage_events) = v_before,
    'deleting a guest must not delete past analytics';
  assert (select count(*) from public.usage_events
          where type = 'reveal' and guest_id is null) >= 1,
    'a reveal for a deleted guest should remain, with a null guest_id';
end;
$$;

do $$
declare
  v_event uuid;
begin
  select id into v_event from public.events where slug = 'verify-other-event';

  -- Give the event something in every child table, so the cascade is actually
  -- proven rather than trivially true.
  insert into public.kiosk_instances (event_id, label, url_param)
    values (v_event, 'Verify Door', 'verify');
  insert into public.csv_uploads (event_id, filename, row_count, mode)
    values (v_event, 'verify.csv', 1, 'replace');
  perform public.track_usage_event('verify-other-event', 'search', 'anybody', null, 'verify');

  assert (select count(*) from public.guests where event_id = v_event) > 0,
    'fixture should have a guest to cascade';
  assert (select count(*) from public.usage_events where event_id = v_event) > 0,
    'fixture should have a usage event to cascade';

  delete from public.events where id = v_event;

  assert (select count(*) from public.guests where event_id = v_event) = 0,
    'guests must cascade with their event';
  assert (select count(*) from public.usage_events where event_id = v_event) = 0,
    'usage events must cascade with their event';
  assert (select count(*) from public.csv_uploads where event_id = v_event) = 0,
    'csv upload history must cascade with its event';
  assert (select count(*) from public.kiosk_instances where event_id = v_event) = 0,
    'kiosk instances must cascade with their event';
end;
$$;

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------

do $$
declare
  v_event uuid;
  v_ok    boolean;
begin
  select id into v_event from public.events where slug = 'demo-gala-2026';

  v_ok := false;
  begin
    insert into public.events (slug, name) values ('Not A Slug!', 'x');
  exception when check_violation then v_ok := true;
  end;
  assert v_ok, 'slug format must be enforced';

  v_ok := false;
  begin
    insert into public.events (slug, name, table_count) values ('zero-tables', 'x', 0);
  exception when check_violation then v_ok := true;
  end;
  assert v_ok, 'table_count must be positive when set';

  v_ok := false;
  begin
    insert into public.guests (event_id, full_name) values (v_event, '   ');
  exception when check_violation then v_ok := true;
  end;
  assert v_ok, 'a blank guest name must be rejected';

  v_ok := false;
  begin
    insert into public.kiosk_instances (event_id, label, url_param)
    values (v_event, 'Duplicate', 'main');
  exception when unique_violation then v_ok := true;
  end;
  assert v_ok, 'url_param must be unique per event';
end;
$$;

-- updated_at is maintained by trigger, not by the application. Checked as the
-- admin role, since that is the only path that actually updates rows and the
-- trigger helper is no longer executable by everyone.
do $$
declare
  v_before timestamptz;
  v_after  timestamptz;
begin
  select updated_at into v_before from public.events where slug = 'demo-gala-2026';
  perform pg_sleep(0.05);

  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  update public.events set name = name || '.' where slug = 'demo-gala-2026';
  reset role;

  select updated_at into v_after from public.events where slug = 'demo-gala-2026';
  assert v_after > v_before, 'updated_at must advance on an admin UPDATE';
end;
$$;

\echo ''
\echo 'All checks passed.'
