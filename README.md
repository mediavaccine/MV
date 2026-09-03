# Seating Kiosk

Guests find their table on a touchscreen at the door; Media Vaccine manages
events, guest lists and branding from a browser. Guest data lives in a database
and is fetched at runtime, so updating a list never means editing code or
regenerating a URL.

## What's here

```
apps/kiosk/        the public screen guests use          → /
apps/admin/        the Control Center (single login)     → /admin
packages/shared/   CSV parsing and table assignment
supabase/          schema, RLS policies, public API, tests
scripts/build.sh   assembles both apps into dist/
tests/             browser suites for both apps
```

Both apps are plain HTML, CSS and JavaScript — no framework and no bundler. The
only build step copies files into `dist/`, because a publish directory cannot
import from outside itself and both apps share the CSV and assignment modules.

## Running it

```bash
bash scripts/build.sh        # assemble dist/
bash tests/run.sh            # browser suites for both apps
bash supabase/tests/run-local.sh   # migrations + database guarantees
(cd packages/shared && npm test)   # CSV and assignment unit tests
```

`tests/run.sh` needs Node 18+, Python 3 and Playwright's Chromium;
`supabase/tests/run-local.sh` needs the PostgreSQL server binaries and must run
as a non-root user.

## The access model

Two entirely separate paths into the same database.

**The kiosk has no login** and is granted nothing on any table. Its whole
surface is two `SECURITY DEFINER` functions: one returns the branding and guest
list for an active event, the other records an interaction. Putting the boundary
in functions rather than table policies is what lets the database choose *which
columns* leave it — RLS filters rows, never columns, so a plain `select` grant
on `guests` would hand out every extra field, phone numbers included.

**The Control Center** authenticates through Supabase Auth and queries tables
directly. Every table has RLS demanding `public.is_admin()`, which checks the
caller against an allow-list. A user who signs in but is not on that list is
refused at the door rather than shown an empty dashboard.

Both apps ship a Supabase publishable key in plain sight. That is safe by
design: the key identifies the project and authorises nothing on its own.

## URLs

| URL | What it is |
| --- | --- |
| `/e/{event-slug}` | The kiosk for one event |
| `/e/{event-slug}?k=main` | Same page and data; the tag only separates entrances in analytics |
| `/admin` | The Control Center |

## Documentation

- [`apps/kiosk/README.md`](apps/kiosk/README.md) — how the kiosk behaves, and the traps worth knowing before editing it
- [`apps/admin/README.md`](apps/admin/README.md) — the Control Center, screen by screen
- [`supabase/README.md`](supabase/README.md) — schema, policies, advisories and Supabase defaults that work against a deny-by-default posture

## Known limits

- **The full guest list is public to anyone holding the slug.** A deliberate
  trade: the kiosk caches the whole list so it survives a network drop. Hidden
  extra fields stay hidden; the names do not.
- **CSV merge matches on exact names.** "Bob" and "Robert" are different people
  as far as it is concerned. Replace mode is the safer default.
- **Excel files are not supported** — export the sheet as CSV first.
- **No rate limiting** on the public tracking endpoint yet; that belongs at the
  edge rather than in Postgres.
- **Any table added later needs an explicit `revoke ... from anon`**, or
  Supabase's default privileges hand the kiosk role access to it.
