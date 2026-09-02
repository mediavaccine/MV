-- Public kiosk surface (spec v1 §5, §6, §8)
--
-- Two SECURITY DEFINER functions are the *only* things the anon role can call.
-- They own the read/write shape, which is what keeps admin-only columns
-- (extra_field_schema, csv_uploads, table_count, …) from ever reaching a screen
-- in the entrance hall.
--
-- NOTE ON EXPOSURE (confirmed decision, spec §11): the payload is the full
-- guest list for the event, addressed by a plain readable slug. Anyone who has
-- or guesses the slug can retrieve every name and table on it. That is the
-- accepted trade for the offline cache in §5.3, which needs the whole list
-- present on the device before the network drops.

-- ---------------------------------------------------------------------------
-- Helper: project a jsonb object down to an allow-list of keys
-- ---------------------------------------------------------------------------

create or replace function public.filter_jsonb_keys(p_data jsonb, p_keys text[])
returns jsonb
language sql
immutable
as $$
  select coalesce(
    (
      select jsonb_object_agg(k, p_data -> k)
      from unnest(coalesce(p_keys, '{}'::text[])) as k
      where p_data ? k
    ),
    '{}'::jsonb
  );
$$;

comment on function public.filter_jsonb_keys(jsonb, text[]) is
  'Returns p_data containing only the keys named in p_keys.';

-- ---------------------------------------------------------------------------
-- GET /api/public/events/:slug
-- ---------------------------------------------------------------------------

create or replace function public.event_public_payload(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_event  public.events;
  v_keys   text[];
  v_guests jsonb;
begin
  select * into v_event
  from public.events
  where slug = p_slug
    and status = 'active';

  -- Archived, tombstoned and unknown slugs are indistinguishable from here;
  -- the kiosk renders its "this event has ended" state for a null result.
  if not found then
    return null;
  end if;

  -- Which extra CSV columns has the admin explicitly marked visible? Anything
  -- not on this list stays in the database (spec §8).
  select coalesce(array_agg(f ->> 'key'), '{}'::text[])
  into v_keys
  from jsonb_array_elements(
         case
           when jsonb_typeof(v_event.extra_field_schema -> 'fields') = 'array'
             then v_event.extra_field_schema -> 'fields'
           else '[]'::jsonb
         end
       ) as f
  where coalesce((f ->> 'visible')::boolean, false)
    and nullif(f ->> 'key', '') is not null;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',    g.id,
        'name',  g.full_name,
        'table', g.table_number,
        'extra', public.filter_jsonb_keys(g.extra, v_keys)
      )
      order by lower(g.full_name), g.id
    ),
    '[]'::jsonb
  )
  into v_guests
  from public.guests g
  where g.event_id = v_event.id;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'slug', v_event.slug,
      'name', v_event.name
    ),
    'branding',  v_event.branding,
    'guests',    v_guests,
    'synced_at', now()
  );
end;
$$;

comment on function public.event_public_payload(text) is
  'Everything a kiosk screen needs for one event, and nothing else.';

-- ---------------------------------------------------------------------------
-- POST /api/public/events/:slug/track
-- ---------------------------------------------------------------------------

create or replace function public.track_usage_event(
  p_slug        text,
  p_type        public.usage_event_type,
  p_query_text  text default null,
  p_guest_id    uuid default null,
  p_kiosk_param text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_kiosk_id uuid;
  v_guest_id uuid;
begin
  select id into v_event_id
  from public.events
  where slug = p_slug
    and status = 'active';

  -- Analytics are fire-and-forget: an unknown slug is dropped rather than
  -- raised, because nothing here may ever surface an error on a guest's screen.
  if not found then
    return;
  end if;

  if p_kiosk_param is not null then
    select id into v_kiosk_id
    from public.kiosk_instances
    where event_id = v_event_id
      and url_param = p_kiosk_param;
  end if;

  -- Only accept a guest id that actually belongs to this event, so a caller
  -- cannot use the tracking endpoint to probe for ids from another one.
  if p_guest_id is not null then
    select id into v_guest_id
    from public.guests
    where id = p_guest_id
      and event_id = v_event_id;
  end if;

  insert into public.usage_events (event_id, kiosk_instance_id, type, query_text, guest_id)
  values (
    v_event_id,
    v_kiosk_id,
    p_type,
    left(nullif(btrim(p_query_text), ''), 200),
    v_guest_id
  );
end;
$$;

comment on function public.track_usage_event(text, public.usage_event_type, text, uuid, text) is
  'Records one kiosk interaction. Silently no-ops for unknown or inactive events.';

-- ---------------------------------------------------------------------------
-- Grants — the complete public surface
-- ---------------------------------------------------------------------------

revoke all on function public.event_public_payload(text) from public;
revoke all on function public.track_usage_event(text, public.usage_event_type, text, uuid, text) from public;

grant execute on function public.event_public_payload(text) to anon, authenticated;
grant execute on function public.track_usage_event(text, public.usage_event_type, text, uuid, text) to anon, authenticated;
