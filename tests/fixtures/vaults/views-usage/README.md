# Overlay `views-usage/` (v1.0 slice Q2.1, per-usage sort, columns and widths)

Synthetic overlay for `docs/acceptance/views.md` **part two** (R194…R200; D-1835, D-1836). Hand-written (D-50); every name, title and text is invented (D-62). **Draft**: the shapes of the per-usage keys in the fence (`Knihy na cesty.md`) and in `views:` (`book.yml`) follow the proposals of AP-1519 and AP-1521 in `views.md`; the overlay changes if the owner decides otherwise.

**Why an overlay.** The base fixture `tests/fixtures/vaults/views/` can't take these files: slice Q2's tests assert `Used on` of `Přečtené 2026` (FR-QRY-06 AC-24), the usage notice `… and 1 note` (FR-QRY-01 AC-12) and a `views:` flow line on line 13 of `book.yml` (FR-QRY-07 AC-4…AC-12). Base files are never edited for Q2.1.

**How tests use it.** A part-two test that names the overlay copies `tests/fixtures/vaults/views/` (without its README), then this folder (without this README) over it, then `tests/fixtures/vaults/new-empty/.tegg/`. This folder **replaces** `.tegg/types/book.yml` and **adds** `Pages/Knihy na cesty.md`; nothing else. Part-two tests that don't name the overlay use the base fixture alone.

**Byte rules.** LF, UTF-8 without BOM, every file ends with one `\n`, NFC everywhere. Don't open and re-save these files in an editor. NFD, CRLF and no-final-newline variants are made at runtime.

## Files

| File | Differs from the base by | What it tests |
| --- | --- | --- |
| `.tegg/types/book.yml` | lines 13…20: `views:` as a block list; `Přečtené 2026` is a mapping item with its own two-level `sort` (rating ↑, title ↑, lines 16…18) and `columns: [author, rating, finished, genres]` (line 19); `Rozečtené` (line 14) and `Výborné knihy` (line 20) are plain names. `attributes:` moves from line 14 to line 21; every other byte equals the base | R196: a tab with its own settings next to tabs without; minimal writes inside a block-style `views:`; Trash and Undo keep the item's lines (FR-QRY-07 AC-20, AC-21) |
| `Pages/Knihy na cesty.md` | new note, id `01JB5V00000000000000000030`, created and modified `2026-11-05T09:00:00+01:00` | five reference fences (R195), below |

`Knihy na cesty.md`, its blocks by line:

| # | Lines | Fence body | What it tests |
| --- | --- | --- | --- |
| 1 | 10…14 | `saved: Přečtené 2026`, `sort: { by: title, order: asc }`, `columns: [author]` | a block with its own one-level sort and columns (narrow) |
| 2 | 18…20 | `saved: Přečtené 2026` | the second block of the same query in one note: the query's defaults, its own widths key (`#2`) |
| 3 | 24…29 | `saved: Rozečtené`, `# jen hodnocení`, `columns: [rating]`, `x-poznámka: úzký sloupec` | a board block with its own On cards (AP-1525); a comment line and an unknown key kept byte for byte |
| 4 | 33…38 | `saved: Výborné knihy`, a two-level `sort:` list whose second `by` is `neznámý` | a broken per-usage `sort`: the query's sort is used, with the notice, and nothing is rewritten |
| 5 | 41…43 | `> ```query`, `> saved: Výborné knihy`, `> ``` ` inside the callout `> [!note] Na cestu` (line 40) | a nested fence: a per-usage write adds its lines with the `> ` prefix |

Expected boards, tables and sorts at the test clock: `docs/acceptance/views.md` R200.

## Made at runtime by the tests (never committed)

- `views:` items with odd values (FR-QRY-07 AC-25): a mapping without `name`, `sort: sideways`, an unknown item key `x-barva: modrá`, a repeated name with different settings, a quoted name `"Čtu, až bude čas"`, NFD names and `by` values, a full-line comment between items; CRLF and no-final-newline copies of this `book.yml`.
- Fences: `columns: [neznámý, author]`, `sort: []`, an NFD `by`, a `~~~query` fence, a fence in a list item, a fence with the info string `query meta`, a CRLF copy of `Knihy na cesty.md`.
- A template `_templates/Page/Seznam knih.md` with a per-usage fence (FR-TPL-04 AC-3).
- A second type file listing `Výborné knihy` in `views:` (FR-QRY-07 AC-22).
- `ui-state.json` with Q2's (0.4.0) keys `queryColumnWidths["Přečtené 2026"]` and `boardFolded["Podle žánru"]` (FR-STO-07 AC-11).
- Expected bytes after writes (`tests/fixtures/queries-files/expected/views-usage/`) are written by the test author once AP-1519…AP-1532 are decided (as Q2 did after AP-1497…AP-1518).
