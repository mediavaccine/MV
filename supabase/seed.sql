-- One test event, for local development and for smoke-testing a fresh database.
--
-- Applied automatically by `supabase db reset` against a LOCAL stack. It is not
-- a migration and is not applied to a hosted project unless you run it there
-- deliberately.
--
-- Written to be re-runnable: the event is deleted first, and guests/kiosks
-- cascade with it.

delete from public.events where slug = 'demo-gala-2026';

with new_event as (
  insert into public.events (slug, name, status, table_count, assignment_strategy, branding, extra_field_schema)
  values (
    'demo-gala-2026',
    'Demo Gala 2026',
    'active',
    8,
    'provided-in-csv',
    jsonb_build_object(
      'primary_color',      '#1f6feb',
      'accent_color',       '#f0b429',
      'background_color',   '#0b0d12',
      'font',               'inter',
      'header_text',        'Demo Gala 2026',
      'subtitle_text',      'Find your table',
      'search_placeholder', 'Start typing your name',
      'no_match_text',      'We could not find that name — please see a host.',
      'reveal_tagline',     'We cannot wait to celebrate with you!'
    ),
    -- meal is shown on the reveal screen; phone is stored but never served.
    jsonb_build_object('fields', jsonb_build_array(
      jsonb_build_object('key', 'meal',  'label', 'Meal choice', 'visible', true),
      jsonb_build_object('key', 'phone', 'label', 'Phone',       'visible', false)
    ))
  )
  returning id
),
seeded_guests as (
  insert into public.guests (event_id, full_name, table_number, extra, source)
  select
    new_event.id,
    g.full_name,
    g.table_number,
    g.extra,
    'csv'::public.guest_source
  from new_event,
       (values
         ('Adaeze Okonkwo',   'Table 1', '{"meal":"Vegetarian","phone":"+234 800 000 0001"}'::jsonb),
         ('Bukki Solanke',    'Head Table', '{"meal":"Fish","phone":"+234 800 000 0002"}'::jsonb),
         ('Chidi Nwosu',      'Table 2', '{"meal":"Beef","phone":"+234 800 000 0003"}'::jsonb),
         ('Damilola Adeyemi', 'Table 2', '{"meal":"Vegetarian"}'::jsonb),
         ('Emeka Obi',        'VIP-A',   '{"meal":"Fish"}'::jsonb),
         ('Folake Balogun',   'Table 3', '{}'::jsonb),
         ('Grace Mensah',     'Table 3', '{"meal":"Beef"}'::jsonb),
         ('Hakeem Yusuf',     null,      '{}'::jsonb)
       ) as g(full_name, table_number, extra)
  returning event_id
)
insert into public.kiosk_instances (event_id, label, url_param)
select distinct new_event.id, k.label, k.url_param
from new_event,
     (values
       ('Main Entrance', 'main'),
       ('Side Door',     'side'),
       ('VIP Entrance',  'vip')
     ) as k(label, url_param);
