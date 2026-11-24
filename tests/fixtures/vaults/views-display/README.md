# Overlay `views-display/` (v1.0 slice Q3, display and grouping per usage)

Synthetic overlay for `docs/acceptance/views.md` **part five** (slice Q3, R220…R228; D-2172…D-2187). Hand-written (D-50); every name, title and text is invented (D-62). The place and style of the new usage keys follow plan §3.3, R221 and contract part four (decided: D-2188…D-2203).

**Why an overlay.** The base fixture `tests/fixtures/vaults/views/` can't take these files: parts one to three assert the flow `views:` line 13 of `book.yml`, `9 queries` on the Queries page and the `Used on` lists of the base queries. Base files are never edited for Q3.

**How tests use it.** A part-five test that names this overlay copies `tests/fixtures/vaults/views/` (without its README), then this folder (without this README) over it, then `tests/fixtures/vaults/new-empty/.tegg/`. This folder **replaces** `.tegg/types/book.yml` and **adds** `.tegg/queries/Celá zeď.yml` and `Pages/Zobrazení knih.md`; nothing else. It is not combined with `views-usage/`. Part-five tests that don't name the overlay use the base fixture alone (most byte criteria do, so they start from the base's flow `views:` line).

**Byte rules.** LF, UTF-8 without BOM, every file ends with one `\n`, NFC everywhere (file names and content; the red-test commit checks it). Don't open and re-save these files in an editor. NFD, CRLF and no-final-newline variants are made at runtime.

**Test clock.** As part one: `2026-11-19T10:00:00+01:00` (a Thursday), Europe/Prague, region `cs` (week Monday 16 – Sunday 22 November). **(C)** criteria also run with `en-US`.

## Files

| File | Differs from the base by | What it tests |
| --- | --- | --- |
| `.tegg/types/book.yml` | lines 13…28: `views:` as a block list of six items (below); `attributes:` moves from line 14 to line 29; every other byte equals the base | own `view`, `group_by`, `lanes`, `lane_order`, `widths` in `views:` items (R220, R221); old words in an item (D-2179) |
| `.tegg/queries/Celá zeď.yml` | new query, `view: board` with **no `group_by`**, `lanes: horizontal` (old word), `limit: 10`, `has_none_of [odloženo]`, `sort: { by: title, order: asc }`, `columns: [author, status]`, created and modified `2026-11-18T20:00:00+01:00` | a wall needs no `group_by` (D-2179; it was a broken `group_by` in Q2, D-1807); the query's `lanes` applies once a usage groups; `limit` on a wall (AP-2051) |
| `Pages/Zobrazení knih.md` | new note, id `01JB5V00000000000000000031`, created and modified `2026-11-18T09:00:00+01:00` | six reference fences with own display and grouping (R221), below |

`book.yml`, its `views:` items:

| Line(s) | Item | Own values | Query file's values | What it tests |
| --- | --- | --- | --- | --- |
| 14…15 | `Rozečtené` | `group_by: none` | `view: board`, `group_by: status`, `lanes: vertical`, `lane_order: [Reading, To read, Read]` | `none` over a grouped default: an ungrouped wall (R220) |
| 16…17 | `Přečtené 2026` | `view: wall` | `view: table`, no grouping | an own display over the query's; a Table query drawn as cards |
| 18…21 | `Výborné knihy` | `group_by: author`, `lane_order: ["[[Lucie Horká]]"]`, `widths: { title: 260, author: 180 }` | `view: table`, no grouping | a grouped Table by a relation (chip headers), an own group order, widths in the vault (D-2177) |
| 22…24 | `Podle žánru` | `view: list`, `lanes: vertical` (old word) | `view: board`, `group_by: genres`, `lanes: horizontal` | a grouped List by a multi-select (a row under each value, D-1769); `lanes` kept and ignored outside a wall, back on a wall as columns |
| 25…27 | `Podle autora` | `view: board`, `lanes: horizontal` (both old words) | `view: board`, `group_by: author`, no `lanes` | old words in a usage read as `wall` and `rows` (D-2179) and are never rewritten unless that key changes |
| 28 | `Celá zeď` | — (plain name) | as the file above | an ungrouped wall from a `view: board` file without `group_by` |

`Zobrazení knih.md`, its blocks by line:

| # | Lines | Fence body (after `saved:`) | What it tests |
| --- | --- | --- | --- |
| 1 | 10…14 | `saved: Přečtené 2026`, `view: wall`, `group_by: none` | plan §3.3's example: an own display; `none` equal to an ungrouped default stays own |
| 2 | 18…23 | `saved: Rozečtené`, `view: table`, `lane_order: [To read]`, `widths: { title: 240 }` | a grouped Table from the query's grouping, an own group order (only groups with rows: no `Read`, D-2184), own widths in a fence |
| 3 | 27…31 | `saved: Seskupeno podle data`, `view: list`, `group_by: { finished: period }` | a period grouping in a List (flat groups, D-2181); the query's own broken `group_by: finished` is not used, so no notice |
| 4 | 35…38 | `saved: Celá zeď`, `group_by: status` | a usage groups an ungrouped wall; the query's `lanes: horizontal` then applies (rows) |
| 5 | 42…49 | `saved: Výborné knihy`, `# ruční pokus`, `view: kanban`, `group_by: finished`, `lanes: diagonal`, `widths: široké` | the Broken shape of R194 for the new keys: the query's value, a notice per used key, nothing rewritten; the comment kept |
| 6 | 52…54 | `> ```query`, `> saved: Výborné knihy`, `> ``` ` inside the callout `> [!tip] Na zeď` (line 51) | a nested fence: new keys get the `> ` prefix |

Expected walls, tables, lists and groups at the test clock: `docs/acceptance/views.md` R228.

## Made at runtime by the tests (never committed)

- `views:` items with odd values: `view: Wall` (other case), an NFD item name, an NFD `group_by` key, `group_by: { due: month }` (D-2180: broken), `lane_order: Reading` (not a list), `widths: { title: 90 }` (below R130's minimum), `widths: { neznámý: 200 }` (an unknown column, kept), an unknown item key `x-barva: modrá` next to the new keys; CRLF and no-final-newline copies of this `book.yml`.
- Fences: a `~~~query` fence and a fence in a list item with the new keys; a CRLF copy of `Zobrazení knih.md`; an NFD `group_by` key.
- A `version: 2` copy of `Celá zeď.yml` and of `book.yml` (read-only usages).
- `ui-state.json` with 0.6.0's machine-local widths for usages (`usageColumnWidths["tab:book/přečtené 2026"]`, `usageColumnWidths["block:id:01JB5V00000000000000000029/přečtené 2026#1"]`) for the legacy-widths criterion, and with an `All Books` display and grouping.
- A Book `Nová kniha` with `finished` in this week (2026-11-21) and one later (2026-12-05) for the period groups `This week` and `Later` in a Table.
- The ungrouped-wall benchmark: the reference vault (`tools/gen-vault --seed 1 --small-images`) plus a view `Zeď` over its largest type (NFR-PERF-07 AC-7); a 1,000-row grouped Table (NFR-PERF-07 AC-8).
- Expected bytes after writes go to `tests/fixtures/queries-files/expected/views-display/` (README there), written by the test author with the red tests (contract part four §43.4).
