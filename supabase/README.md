# Supabase — schema, policies and public API

Phase 1 of the Seating Kiosk spec: the database the Admin Control Center writes
to and the Kiosk reads from. No application code yet.

## Layout

```
supabase/
├── migrations/
│   ├── 20260902120000_init_schema.sql   tables, enums, indexes, triggers
│   ├── 20260902120100_rls_policies.sql  RLS + the is_admin() predicate
│   └── 20260902120200_public_api.sql    the two functions the kiosk may call
├── seed.sql                             one demo event, for local use
└── tests/
    ├── local_supabase_stub.sql          local stand-in for auth.* and the roles
    ├── verify.sql                       behavioural checks (asserts, not output)
    └── run-local.sh                     throwaway cluster → migrate → seed → verify
```

## Running the checks

```bash
supabase/tests/run-local.sh
```

Creates a temporary Postgres cluster, applies everything in order, runs
`verify.sql`, and tears the cluster down. Nothing touches a hosted project.
Needs the Postgres server binaries (`initdb`, `pg_ctl`) and `psql`, and must run
as a non-root user — Postgres refuses to start as root.

## Applying to a hosted project

Migrations are plain SQL, applied in filename order. Either
`supabase db push` with the CLI linked to the project, or paste each file into
the SQL editor in order. `seed.sql` is **not** a migration — apply it only if
you want the demo event present.

## The access model

Two entirely separate paths into the data:

**Admin** authenticates through Supabase Auth and queries the tables directly.
Every table has RLS on and a policy demanding `public.is_admin()`, which checks
the caller's `auth.uid()` against `admin_users`. A user who authenticates but is
not on that allow-list sees zero rows everywhere — not an error, just nothing.

**Kiosk** has no login and is deliberately granted nothing on any table. Its
entire surface is two `SECURITY DEFINER` functions:

| Function | Purpose |
| --- | --- |
| `event_public_payload(slug)` | Branding plus the guest list for one active event, or null |
| `track_usage_event(slug, type, query, guest_id, kiosk_param)` | Records one interaction |

Putting the boundary in functions rather than table policies is what lets the
database decide *which columns* leave it. RLS filters rows, never columns — so a
`select` grant on `guests` would hand out the whole `extra` blob, phone numbers
included. The payload function projects `extra` down to just the keys the admin
marked `visible` in `events.extra_field_schema`.

## Decisions worth knowing

**The full guest list is public to anyone holding the slug.** Confirmed
deliberately: the kiosk caches the whole list so it keeps working when the
network drops (spec §5.3), and slugs are plain readable strings. Anyone with the
URL can retrieve every name and table on it. Hidden extra fields stay hidden,
but the names do not.

**Analytics outlive the guests they reference.** `usage_events.guest_id` is
`ON DELETE SET NULL`, so removing a guest leaves the history intact with an
unlinked row. This is also why there is no "a reveal must have a guest"
constraint — such a check would make deleting any guest fail.

**Archived is invisible, not gone.** `event_public_payload` only resolves
`status = 'active'`. Archiving an event makes the kiosk URL stop working
immediately while the data and its analytics stay put.

**`track_usage_event` never raises for a bad slug.** It returns quietly. Nothing
on a screen in front of a guest may surface an error. It does still reject an
invalid event type, which is a client bug worth hearing about.

**A guest id is validated against its event.** Passing a guest from another
event records the interaction with a null `guest_id` rather than a cross-event
link, so the public endpoint cannot be used to probe for ids.

## Still open

- `table_count` and `assignment_strategy` are stored but nothing consumes them
  yet; the assignment strategies land with the CSV wizard (spec §4.3).
- Rate limiting on `track_usage_event` (spec §8) is not implemented here —
  Postgres is the wrong layer for it. It belongs at the edge.
- Merge-by-name in CSV upload is still the fragile spot the spec flags; nothing
  in the schema makes it safer yet.
