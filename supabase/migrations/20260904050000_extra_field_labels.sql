-- The Control Center lets an organiser name each extra CSV column — "meal"
-- becomes "Dietary requirement" — and the kiosk already looks those names up
-- in branding.extra_labels. Nothing ever put them there, so every reveal
-- screen showed the raw column key instead and the label box did nothing.
--
-- The labels are derived here rather than stored on the event, so a column
-- that is not marked visible cannot leak its name to a kiosk along with them.

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
  v_labels jsonb;
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
  -- not on this list stays in the database (spec §8), and so does its label.
  select
    coalesce(array_agg(f ->> 'key'), '{}'::text[]),
    coalesce(jsonb_object_agg(f ->> 'key',
                              coalesce(nullif(f ->> 'label', ''), f ->> 'key')),
             '{}'::jsonb)
  into v_keys, v_labels
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
    -- The derived labels win over anything of that name stored on the event,
    -- so a stale or hand-edited branding value cannot resurrect a hidden key.
    'branding',  v_event.branding || jsonb_build_object('extra_labels', v_labels),
    'guests',    v_guests,
    'synced_at', now()
  );
end;
$$;

comment on function public.event_public_payload(text) is
  'Everything a kiosk screen needs for one event, and nothing else.';

revoke execute on function public.event_public_payload(text) from public;
grant execute on function public.event_public_payload(text) to anon, authenticated;
