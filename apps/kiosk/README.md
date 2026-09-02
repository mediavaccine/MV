# Kiosk app

The public screen guests use to find their table. Plain HTML, CSS and one JS
file — no framework, no build step, no dependencies. It is loaded identically on
every entrance screen for an event.

## URLs

| URL | Meaning |
| --- | --- |
| `/e/{event-slug}` | The event to display |
| `/e/{event-slug}?k=main` | Same page and same data; `k` only tags analytics with which screen |

`netlify.toml` rewrites `/e/*` to `index.html` with a 200, so the address bar
keeps the real URL and every screen can be bookmarked.

## How it works

On load it calls `event_public_payload(slug)` on Supabase, which returns the
branding and the guest list — and nothing else. Searching, filtering and
highlighting all happen in the browser against that one payload, so typing never
waits on the network. The list is re-fetched every two minutes so a late edit
reaches the screens without anyone touching them.

Every search and reveal is reported through `track_usage_event`, fire and
forget. Searches are debounced to one row per completed query rather than one
per keystroke — the useful signal is what someone finished typing, especially
when it found nothing.

## Offline behaviour

The payload is cached in `localStorage` after each successful fetch. If the API
is unreachable the kiosk falls back to that copy and shows a small dot in the
corner rather than an error. This is a stopgap: a first load on a device still
needs connectivity, and the service worker from the offline phase of the spec is
not built yet.

## Branding

Everything visible is driven by `events.branding`, so rebranding an event never
touches this code: colours, font, header, subtitle, search placeholder, no-match
message and reveal tagline. Colours are applied as CSS custom properties.

## Configuration

`config.js` holds the Supabase URL and publishable key. The key is meant to be
public — it identifies the project and authorises nothing on its own. What it
can reach is decided entirely in the database: the `anon` role holds no table
privileges and can execute exactly two functions. Never put a `service_role` key
here; that one bypasses row level security.

## Things worth knowing before changing this

- **`hidden` needs `[hidden] { display: none !important }`.** Author `display`
  rules outrank the browser's own `[hidden]` rule. Without that line the
  full-viewport overlays stay on screen while "hidden" and swallow every tap,
  which makes the kiosk look frozen.
- **Buttons keep focus after a tap, and space activates a focused button.** Keys
  blur themselves and the physical-keyboard handler calls `preventDefault()`,
  otherwise a space after tapping Clear silently wipes a half-typed name.
- **Input can arrive with no guest list.** If the API is unreachable the error
  screen stays up while taps still reach the handlers, so `renderResults` returns
  early when there is no payload.

## Tests

The browser suite is not in this repo yet — it currently runs against a local
mock of the two RPCs, seeded with real output from `event_public_payload`. Worth
committing alongside a CI job that can run Chromium.
