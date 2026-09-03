# Control Center

The private dashboard for creating events, managing guest lists, branding the
kiosk and reading usage. Plain HTML, CSS and ES modules — no framework, no
build step beyond the copy in `scripts/build.sh`.

Served at `/admin`. It routes on the hash, so every screen is one document and
no server rewrites are needed beyond a single catch-all.

## Screens

| Screen | What it does |
| --- | --- |
| **Events** | Create events, see status and guest counts, archive or restore |
| **Guests** | Search, inline-edit names and tables, add and remove guests, bulk-reassign tables |
| **Upload CSV** | The four-step import wizard |
| **Branding** | Colours, font, logo, every visible string, with a live kiosk preview |
| **Screens** | The kiosk URL, and optional per-entrance tags for analytics |
| **Usage** | Totals, the no-match report, activity by hour and by entrance |

## The upload wizard

Four steps, all reversible until the last. **Nothing is written until Import.**

1. **File** — any CSV. The delimiter is detected, so semicolon and tab files work.
2. **Columns** — the app guesses which column is the name, the table, the group,
   and shows a preview so the guess can be corrected. A role can only belong to
   one column at a time.
3. **Tables** — use the CSV's own column, balance groups across N tables, spread
   guests evenly, or leave them unassigned. The resulting table sizes are shown
   before anything is committed.
4. **Replace or merge** — replace wipes the current list; merge updates matching
   names and adds the rest.

Balanced assignment places whole groups largest-first onto the emptiest table,
so a party that booked together is never split.

## Things worth knowing before changing this

- **Merge matches on exact names**, after trimming and case folding. It is the
  weak point the spec flags, and the wizard says so on screen rather than
  hiding it.
- **Deleting an event permanently requires typing its slug.** Archiving is
  offered right beside it and is almost always what someone means.
- **Signing in is not the same as being allowed in.** `signIn` checks the
  allow-list immediately and signs the user back out if they are not on it,
  because RLS would otherwise present an empty dashboard that looks like data
  loss.
- **`h()` refuses raw HTML.** Everything goes through `textContent`; guest names
  come from spreadsheets and must never be treated as markup.
