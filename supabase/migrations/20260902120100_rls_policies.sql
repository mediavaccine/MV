-- Row Level Security (spec v1 §8)
--
-- Posture: every table is deny-by-default. The admin app authenticates with
-- Supabase Auth and reaches the tables directly under these policies. The
-- public kiosk has no login and NO table policies at all — it reaches data
-- only through the SECURITY DEFINER functions in the next migration, which
-- decide exactly which columns leave the database.

alter table public.admin_users     enable row level security;
alter table public.events          enable row level security;
alter table public.guests          enable row level security;
alter table public.csv_uploads     enable row level security;
alter table public.kiosk_instances enable row level security;
alter table public.usage_events    enable row level security;

-- ---------------------------------------------------------------------------
-- Admin predicate
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so the lookup itself is not subject to admin_users' own RLS
-- policy, which would otherwise recurse. search_path is pinned so the function
-- body cannot be redirected by a caller-controlled search_path.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admin_users au where au.id = auth.uid()
  );
$$;

comment on function public.is_admin() is
  'True when the current Supabase Auth user is on the admin allow-list.';

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- Admins may read the allow-list, but membership is managed out of band
-- (Supabase dashboard / service role) so the app cannot grant itself peers.
create policy admin_users_select on public.admin_users
  for select to authenticated
  using (public.is_admin());

create policy events_admin_all on public.events
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy guests_admin_all on public.guests
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy csv_uploads_admin_all on public.csv_uploads
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy kiosk_instances_admin_all on public.kiosk_instances
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Analytics are written by the public track function (definer-owned) and only
-- ever read back by an admin; no client-side INSERT path is exposed.
create policy usage_events_admin_read on public.usage_events
  for select to authenticated
  using (public.is_admin());

create policy usage_events_admin_delete on public.usage_events
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Baseline grants
-- ---------------------------------------------------------------------------
-- RLS filters rows; these grants decide who may attempt a statement at all.
-- anon is given nothing: the kiosk's entire surface is the two RPCs.

revoke all on all tables in schema public from anon;

grant select, insert, update, delete
  on public.events, public.guests, public.csv_uploads, public.kiosk_instances
  to authenticated;
grant select on public.admin_users to authenticated;
grant select, delete on public.usage_events to authenticated;
