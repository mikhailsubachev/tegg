# Expected bytes for slice Q2.1 (per-usage sort and columns, trash from a view menu)

Synthetic (D-50, D-62), written by the test author with the red tests from `docs/acceptance/views.md` part two
(R194…R200) and `docs/contracts/v1-views.md` §21.3; each file is the whole file after the action. Byte rules as
`../views/`: LF, UTF-8 without BOM, one final newline (the `-crlf` file uses CRLF), NFC except where a name says `nfd`.
Don't open and re-save these files in an editor.

Clock `2026-11-19T10:00:00+01:00`. Inputs: **base** = `tests/fixtures/vaults/views/`, **overlay** = the base with
`tests/fixtures/vaults/views-usage/` copied over it (its README). `notes/` hold the note after the editor's autosave
(`modified:` set to the clock, D-55); `fences/` hold `applyFenceUsage` results (no `modified:` change) next to their
`-input.md`.

## `types/` (`.tegg/types/book.yml` after the action)

| File | Input → action | Criteria |
| --- | --- | --- |
| `book-vyborne-shift-finished.yml` | base; ⇧-click `Finished` on the `Výborné knihy` tab (effective sort `title ↑`) | FR-QRY-07 AC-23 (a) |
| `book-vyborne-sort-title-only.yml` | then the popover's `Remove` on `Finished` | AC-23 (b) |
| (the base `book.yml`) | then `Use the query's sort` | AC-23 (c) |
| `book-overlay-prectene-click-finished.yml`, `-crlf.yml` | overlay (or its CRLF copy); a click on `Finished` on `Přečtené 2026`: lines 16…18 → `    sort: { by: finished, order: asc }` | AC-23, FR-FMT-07 AC-34 |
| `book-rozectene-sort-add.yml` | base; `+ Add sort` on the `Rozečtené` tab: the query's `status ↑`, `modified ↓` plus `title ↑` (the first unused key of `title, created, modified, attributes…`) | AC-23 (D-1864) |
| `book-new-property-stran-1.yml` | base; `New property…` Number `Stran` (key `stran`) on the `Přečtené 2026` tab: the attribute appended | AC-24 (D-1864) |
| `book-new-property-stran-2.yml` | then the item's `columns`: the query's `author, rating, finished` plus `stran` | AC-24 |
| `book-prectene-columns-genres.yml` | base; `Columns` › `Genres` on `Přečtené 2026` | AC-24 |
| `book-prectene-columns-reordered.yml` | then the `Finished` header dragged before `Author` | AC-24 |
| `book-overlay-prectene-no-genres.yml` | overlay; `Columns` › uncheck `Genres` on `Přečtené 2026`: line 19 only | AC-24 |
| `book-trash-vyborne.yml` | base; `Move to trash` on `Výborné knihy` (view menu): line 13 only | AC-20 |
| `book-overlay-without-prectene.yml` | overlay; `Move to trash` or `Remove from Books page` on `Přečtené 2026`: lines 13…20 → one flow line | AC-20, AC-26 (c) |
| `book-overlay-readded-prectene.yml` | then `Add view` › `Show a saved query` › `Přečtené 2026` (a plain name at the end) | AC-26 (c) |
| `book-overlay-renamed.yml` | overlay; the rename `Přečtené 2026` → `Přečtené letos`: line 15 only | AC-26 (a), FR-LNK-03 AC-25 |
| `book-overlay-duplicate.yml` | overlay; `Duplicate` on `Přečtené 2026`: lines 15…19 with the name `Přečtené 2026 (2)` inserted after line 19 | AC-26 (b) |
| `book-overlay-xbarva-input.yml` | the runtime variant (c): the overlay with `    x-barva: modrá` and `    # barva štítku pro tisk` after line 15 | AC-25 (c) |
| `book-overlay-xbarva-after-vyborne.yml` | then ⇧-click `Finished` on `Výborné knihy`: the `Přečtené 2026` item keeps its lines, comment included | AC-25 (c) |
| `book-overlay-xbarva-after-prectene.yml` | then a click on `Finished` on `Přečtené 2026`: its item re-emitted, `x-barva` after the known keys, the comment gone | AC-25 (c) |
| `book-overlay-quoted-name-input.yml` | the runtime variant (e): the overlay with `  - "Čtu, až bude čas"` after line 20 | AC-25 (e) |
| `book-overlay-quoted-name.yml` | then `title ↑` as that item's own sort (`SetViewSort`): `  - name: "Čtu, až bude čas"` quoted (D-230) | AC-25 (e) |
| `book-overlay-nfd-input.yml` | the runtime variant (f): the overlay with line 15's name in NFD | AC-25 (f), FR-FMT-12 AC-13 |
| `book-overlay-nfd-after-change.yml` | then a click on `Finished` on its tab: the item re-emitted NFC (equal to `book-overlay-prectene-click-finished.yml`) | AC-25 (f), FR-FMT-12 AC-13 |

## `notes/`

| File | Input → action | Criteria |
| --- | --- | --- |
| `cteni-2026-click-rating.md` | base Čtení; a click on `Rating` in its `Přečtené 2026` block: a line after line 11 | FR-QRY-01 AC-14 (a) |
| `cteni-2026-shift-finished.md` | then ⇧-click `Finished` | AC-14 (c) |
| `knihy-na-cesty-b1-click-author.md` | overlay Cesty; a click on `Author` in block 1: line 12 | AC-14 |
| `knihy-na-cesty-b5-click-finished.md` | overlay Cesty (not after the previous row); a click on `Finished` in block 5: `> sort: …` after line 42 | AC-14 |
| `knihy-na-cesty-b4-click-title.md` | overlay Cesty; a click on `Title` in block 4: lines 35…37 | FR-QRY-01 AC-16 |
| `cteni-2026-columns-genres.md` | base Čtení; `Columns` › `Genres`: a line after line 11 | FR-QRY-05 AC-24 |
| `cteni-2026-columns-reordered.md` | base Čtení (from the fixture); the `Finished` header dragged before `Author` | AC-24 |
| `knihy-na-cesty-b1-columns-rating.md` | overlay Cesty; block 1 `Columns` › `Rating`: line 13 | AC-24 |
| `knihy-na-cesty-b1-columns-reset.md` | then `Use the query's columns`: line 13 removed | AC-24 |
| `knihy-na-cesty-b3-on-cards-author.md` | overlay Cesty; block 3 `Edit query` › `On cards` › `Change…` › `Author`: line 27 | FR-QRY-05 AC-26 |
| `knihy-na-cesty-renamed.md` | overlay Cesty; the query rename job: lines 11 and 19 (no `modified:` change) | FR-QRY-07 AC-26 (a) |
| `seznam-knih-new.md` | a new Page made from `templates/seznam-knih.md`: the new note's **body** (the text after its frontmatter's closing `---` line); its frontmatter (generated `id`, title, dates) follows FR-VLT-05 and isn't part of this slice | FR-TPL-04 AC-3 |

## `templates/`

| File | What | Criteria |
| --- | --- | --- |
| `seznam-knih.md` | the runtime template `_templates/Page/Seznam knih.md` (`page.yml` gets `template: _templates/Page/Seznam knih.md` after `preview:`) | FR-TPL-04 AC-3 |

## `fences/` (`applyFenceUsage(input, range of fence n, change)`, FR-FMT-06 AC-7)

| Case | Fence (1-based, document order) | Change |
| --- | --- | --- |
| `insert-plain` | 1 | `{ sort: [rating ↑], columns: [author, rating] }` into a fence with only `saved:` |
| `one-to-list` | 1 | `{ sort: [title ↑, finished ↓] }`: one line → `sort:` and two lines |
| `list-to-one` | 1 | `{ sort: [rating ↓] }`: the list → one line |
| `remove` | 1 | `{ sort: null }`: the `sort:` block removed, `columns:` kept |
| `tilde` | 1 | `{ columns: [author, genres] }` in a `~~~query` fence |
| `info-meta` | 1 | `{ sort: [title ↓] }` in a ```` ```query meta ```` fence: inserted after `saved:`, before `columns:` |
| `list-item` | 1 | `{ sort: [author ↑], columns: [author] }` in a fence inside a list item (two spaces kept) |
| `callout` | 5 (Cesty's block 5) | `{ sort: [finished ↑] }`: `> ` on the new line |
| `comment-kept` | 3 (Cesty's block 3) | `{ sort: [title ↑], columns: [rating, author] }`: `sort` after `saved:`, the comment and `x-poznámka` kept |
| `crlf` | 2 (a CRLF copy of Cesty) | `{ sort: [title ↑] }` inserted with CRLF |
| `nfd-saved` | 1 | `{ columns: [author] }`: the NFD `saved:` line keeps its bytes |

The `fences` part of `../../expected-views-usage.json` lists every reference fence of these files (and of the overlay's
notes) with the `saved`, `sort` and `columns` a reader gives (`null` absent, `"broken"`, or the value).
