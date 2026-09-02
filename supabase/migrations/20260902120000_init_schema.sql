-- Media Vaccine Seating Kiosk — core schema (spec v1 §3)
--
-- Conventions used throughout:
--   * uuid primary keys via gen_random_uuid() (core in Postgres 13+, no extension)
--   * timestamptz everywhere; updated_at maintained by trigger, not by the app
--   * child rows cascade from their event, so deleting an event leaves nothing orphaned
--   * jsonb columns are constrained to objects, so callers never have to defend
--     against a bare string or array turning up where a map is expected

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------

create type public.event_status as enum ('active', 'archived', 'deleted');

create type public.assignment_strategy as enum (
  'manual',
  'provided-in-csv',
  'auto-balanced',
  'auto-random'
);

create type public.guest_source as enum ('csv', 'manual');

create type public.csv_upload_mode as enum ('replace', 'merge');

create type public.usage_event_type as enum ('search', 'reveal', 'no_match');

-- ---------------------------------------------------------------------------
-- Shared trigger function
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger helper: stamps updated_at on every UPDATE.';

-- ---------------------------------------------------------------------------
-- admin_users
-- ---------------------------------------------------------------------------
-- Single admin today, but modelled as a table so adding a second is an INSERT
-- rather than a code change. The id is the Supabase Auth user id.

create table public.admin_users (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now(),
  constraint admin_users_email_not_blank check (btrim(email) <> '')
);

create unique index admin_users_email_key on public.admin_users (lower(email));

comment on table public.admin_users is
  'Allow-list of Supabase Auth users permitted to use the Control Center.';

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------

create table public.events (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  name                text not null,
  status              public.event_status not null default 'active',
  table_count         integer,
  assignment_strategy public.assignment_strategy not null default 'manual',
  branding            jsonb not null default '{}'::jsonb,
  extra_field_schema  jsonb not null default '{"fields": []}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Slug is a URL segment: lowercase words joined by single hyphens.
  constraint events_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint events_slug_length check (char_length(slug) between 3 and 80),
  constraint events_name_not_blank check (btrim(name) <> ''),
  constraint events_table_count_positive check (table_count is null or table_count > 0),
  constraint events_branding_is_object check (jsonb_typeof(branding) = 'object'),
  constraint events_extra_field_schema_is_object
    check (jsonb_typeof(extra_field_schema) = 'object')
);

create index events_status_idx on public.events (status);

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

comment on column public.events.status is
  'active = live; archived = soft-deleted, kiosk URL stops resolving but data is kept; '
  'deleted = tombstoned pending hard delete.';
comment on column public.events.extra_field_schema is
  'Shape: {"fields":[{"key":"meal","label":"Meal choice","visible":true}]}. '
  'Only entries with visible=true are ever served to the public kiosk.';

-- ---------------------------------------------------------------------------
-- guests
-- ---------------------------------------------------------------------------

create table public.guests (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events (id) on delete cascade,
  full_name    text not null,
  -- Text, not integer, so "Table 5", "VIP-A" and "Head Table" are all valid.
  table_number text,
  extra        jsonb not null default '{}'::jsonb,
  source       public.guest_source not null default 'csv',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint guests_full_name_not_blank check (btrim(full_name) <> ''),
  constraint guests_extra_is_object check (jsonb_typeof(extra) = 'object')
);

create index guests_event_id_idx on public.guests (event_id);

-- Supports the alphabetical ordering the kiosk payload is built with.
create index guests_event_name_idx on public.guests (event_id, lower(full_name));

-- Prefix search in the admin guest editor is served by the index above. Fuzzy
-- ("did you mean") matching would want pg_trgm, deliberately not installed
-- until something actually needs it — on Supabase an extension in the public
-- schema raises a security advisory.

create trigger guests_set_updated_at
  before update on public.guests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- csv_uploads  (audit trail — every upload is logged, not just applied)
-- ---------------------------------------------------------------------------

create table public.csv_uploads (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events (id) on delete cascade,
  filename       text not null,
  column_mapping jsonb not null default '{}'::jsonb,
  row_count      integer not null default 0,
  mode           public.csv_upload_mode not null,
  uploaded_at    timestamptz not null default now(),

  constraint csv_uploads_filename_not_blank check (btrim(filename) <> ''),
  constraint csv_uploads_row_count_non_negative check (row_count >= 0),
  constraint csv_uploads_column_mapping_is_object
    check (jsonb_typeof(column_mapping) = 'object')
);

create index csv_uploads_event_uploaded_idx
  on public.csv_uploads (event_id, uploaded_at desc);

-- ---------------------------------------------------------------------------
-- kiosk_instances
-- ---------------------------------------------------------------------------
-- Same URL and same data on every screen; url_param only tags analytics.

create table public.kiosk_instances (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  label      text not null,
  url_param  text not null,
  created_at timestamptz not null default now(),

  constraint kiosk_instances_label_not_blank check (btrim(label) <> ''),
  constraint kiosk_instances_url_param_format check (url_param ~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$'),
  constraint kiosk_instances_unique_param unique (event_id, url_param)
);

-- ---------------------------------------------------------------------------
-- usage_events
-- ---------------------------------------------------------------------------

create table public.usage_events (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.events (id) on delete cascade,
  kiosk_instance_id uuid references public.kiosk_instances (id) on delete set null,
  type              public.usage_event_type not null,
  query_text        text,
  -- Deliberately ON DELETE SET NULL, not CASCADE: removing a guest must not
  -- silently rewrite past attendance analytics. Note this also means a 'reveal'
  -- row can legitimately carry a null guest_id, so no NOT NULL check here.
  guest_id          uuid references public.guests (id) on delete set null,
  created_at        timestamptz not null default now(),

  constraint usage_events_query_text_length
    check (query_text is null or char_length(query_text) <= 200)
);

create index usage_events_event_created_idx
  on public.usage_events (event_id, created_at desc);

-- The "what did people type that found nothing" report, which is the one worth
-- watching before doors open.
create index usage_events_no_match_idx
  on public.usage_events (event_id, created_at desc)
  where type = 'no_match';
