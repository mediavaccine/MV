# Example guest lists

Three CSVs for exercising the upload wizard, each aimed at a different path
through it. Same 30 guests in the first two; the third is a 12-row subset.

| File | What it exercises |
| --- | --- |
| `gala-guests.csv` | Tables already in the file. Names are written `"Surname, First"`, so the quoted comma has to survive parsing. Two guests have no table, which the wizard reports before importing. |
| `gala-guests-by-party.csv` | No table column, but a `Party` column. Import with **Balance groups across tables** and 8 tables: the result is 4,4,4,4,4,4,3,3 with no family split across two tables. |
| `gala-guests-messy.csv` | The awkward export: semicolon delimited, names split across `First Name` and `Surname`, an Excel byte-order mark, a blank row in the middle, and padded whitespace. Nothing needs configuring — detection handles all of it. |

## Things they are built to catch

- **The BOM.** Left in place it becomes part of the first header, so `First Name`
  never maps and the import silently loses every name.
- **Quoted commas.** `"Solanke, Bukki"` is one field, not two.
- **Accents and apostrophes.** Zoë Ardèche, N'Golo Diallo and Siobhán O'Brien
  are there deliberately: searching the kiosk for `zoe` should find Zoë, since
  search folds accents.
- **Hidden fields.** `Phone` maps to extra data and stays unticked in Branding,
  so it is stored but never served to a kiosk. Tick `Meal Choice` to see the
  difference on the reveal screen.

Every file is checked by the parser and assignment code in `packages/shared`,
which has its own unit tests.
