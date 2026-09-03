-- Analytics read model and logo storage (spec v1 §4.5, §4.6)
--
-- The admin dashboard needs aggregates, not rows: a season of usage_events for
-- a busy event is thousands of records, and shipping them to a browser to be
-- counted there would be slow and would expose more than the dashboard shows.
-- This function does the counting in the database and returns only totals.

create or replace function public.event_analytics(
  p_slug text,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_result   jsonb;
begin
  -- SECURITY DEFINER means this runs with the owner's rights, so the admin
  -- check has to be explicit — RLS will not do it for us here.
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select id into v_event_id from public.events where slug = p_slug;
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'searches',  count(*) filter (where type = 'search'),
        'reveals',   count(*) filter (where type = 'reveal'),
        'no_matches', count(*) filter (where type = 'no_match'),
        'total',     count(*)
      )
      from public.usage_events where event_id = v_event_id
    ),

    -- The report worth reading before doors open: what people typed that found
    -- nothing. Each row is either a typo or a guest missing from the list.
    'no_match_terms', coalesce((
      select jsonb_agg(t)
      from (
        select query_text as query, count(*) as count, max(created_at) as last_seen
        from public.usage_events
        where event_id = v_event_id and type = 'no_match' and query_text is not null
        group by query_text
        order by count(*) desc, max(created_at) desc
        limit p_limit
      ) t
    ), '[]'::jsonb),

    'by_hour', coalesce((
      select jsonb_agg(t order by t.hour)
      from (
        select date_trunc('hour', created_at) as hour, count(*) as count
        from public.usage_events
        where event_id = v_event_id
        group by 1
      ) t
    ), '[]'::jsonb),

    'by_kiosk', coalesce((
      select jsonb_agg(t)
      from (
        select coalesce(k.label, 'Untagged') as label, count(*) as count
        from public.usage_events u
        left join public.kiosk_instances k on k.id = u.kiosk_instance_id
        where u.event_id = v_event_id
        group by 1
        order by count(*) desc
      ) t
    ), '[]'::jsonb),

    'busiest_guests', coalesce((
      select jsonb_agg(t)
      from (
        select g.full_name as name, count(*) as count
        from public.usage_events u
        join public.guests g on g.id = u.guest_id
        where u.event_id = v_event_id and u.type = 'reveal'
        group by g.full_name
        order by count(*) desc
        limit p_limit
      ) t
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.event_analytics(text, integer) is
  'Aggregated kiosk usage for one event. Admin only.';

revoke all on function public.event_analytics(text, integer) from public, anon;
grant execute on function public.event_analytics(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Logo storage (spec §4.5)
-- ---------------------------------------------------------------------------
-- Public read: a logo is rendered on a screen that has no login, so the object
-- has to be fetchable anonymously. Writes stay admin-only.

insert into storage.buckets (id, name, public)
values ('event-logos', 'event-logos', true)
on conflict (id) do nothing;

create policy event_logos_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'event-logos');

create policy event_logos_admin_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'event-logos' and public.is_admin());

create policy event_logos_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'event-logos' and public.is_admin())
  with check (bucket_id = 'event-logos' and public.is_admin());

create policy event_logos_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'event-logos' and public.is_admin());
