# Expected bytes of slice Q2 writes (`expected/views/`)

Expected bytes of the writes of `docs/acceptance/views.md` (R184, R185 write style, the card move of R187) and
`docs/contracts/v1-views.md` §1.3, §1.4, §1.9, §6.2. Synthetic (D-50), written by the test author with the red tests from
the ACs and the contract only (D-61). The inputs are the files of `tests/fixtures/vaults/views/` (and their CRLF /
no-final-newline copies, made at runtime); the clock of every write is the Q2 test clock `2026-11-19T10:00:00+01:00`.

**Byte rules.** UTF-8 without BOM, NFC. LF and one final `\n`, except the `-crlf` files (CRLF on every line, final CRLF)
and the `-no-newline` files (LF, no final newline). Don't open and re-save these files in an editor.

**Steps in sequence.** Where a criterion lists steps (a), (b), … the file of a step is the result of every step before
it, starting from the fixture: FR-QRY-01 AC-9 (`prectene-2026-sort-*`: rating desc → title first → remove two levels →
`+ Add sort` → `Clear`), AC-11 (`prectene-2026-click-*`, `-shift-finished`: click Rating → click Rating → ⇧-click
Finished → click Author), AC-12 (`rozectene-group-by-genres` → `rozectene-view-table`). `types/book-views-block-to-flow.yml`
is the runtime block-list variant of `book.yml` (line 13 as `views:` plus the three names as `  - ` items) after
`Remove from Books page` on `Přečtené 2026` (FR-QRY-07 AC-12 (c)). `podle-autora-lane-order-marek-sovak.yml` starts from
`Podle autora.yml` with the runtime line `lane_order: ["[[Marek Sova]]", "[[Eva Lindová]]"]` inserted right after
`group_by: author` (FR-LNK-03 AC-24 (b); the 4C job leaves `modified:` alone, D-1467).

**Where the steps run (slice Q2.1, D-1842, D-1851).** Sort and columns are per usage since Q2.1: on a view tab they
write the tab's `views:` item, in a block its fence. The query-file steps of FR-QRY-01 AC-9, AC-10, AC-11 and FR-QRY-07
AC-3, AC-18 (`prectene-2026-sort-*`, `vyborne-knihy-sort-*`, `podle-zanru-sort-add-level`, `prectene-2026-click-*`,
`-shift-finished`, `prectene-2026-columns-*`) therefore run on the query page `query/<name>`, which sets the defaults;
the expected files keep their bytes.

| File | Input → action | Criteria |
| --- | --- | --- |
| `new-view-autor.yml` | `New view` › Table on `type/autor`, `Done` (slice Q3: › Wall on `type/book` is `../views-display/queries/new-view-wall-book.yml`; `new-view-board-book.yml` removed, D-2196) | FR-QRY-07 AC-4 (b), (c) |
| `types/autor-views-new-view.yml`, `types/book-views-new-view.yml` | the type file after New view | AC-4 (b), (c) |
| `types/book-views-podle-zanru.yml` | Show a saved query `Podle žánru` | AC-5 |
| `types/book-views-dragged.yml` (+ `-crlf-`, `-no-newline-`), `types/book-views-move-right.yml` | `Výborné knihy` dragged before `Rozečtené`; `Move view right` on `Rozečtené` | AC-6, FR-FMT-07 AC-33 |
| `types/book-views-renamed.yml`, `prectene-letos-renamed.yml`, `cteni-2026-renamed.md` | rename `Přečtené 2026` → `Přečtené letos` | AC-8 |
| `types/book-views-duplicate.yml` | Duplicate `Výborné knihy` | AC-9 |
| `types/book-views-removed.yml`, `types/book-views-empty.yml` | Remove `Přečtené 2026`; then the other two | AC-10 |
| `types/book-views-block-to-flow.yml` | the block-list variant, Remove `Přečtené 2026` | AC-12 (c) |
| `prectene-2026-columns-genres.yml`, `prectene-2026-columns-reordered.yml` | `Columns` › Genres; the `Finished` header dragged before `Author` | AC-3, AC-18 |
| `rozectene-lanes-horizontal.yml`, `podle-autora-lanes-horizontal.yml`, `podle-zanru-lanes-vertical.yml` (+ `-crlf`, `-no-newline`) | lanes switch on `query/<name>` (slice Q3, D-2179, D-2196: the files keep their names; the changed line is written in the new words `lanes: rows` / `lanes: columns`) | FR-QRY-05 AC-17, FR-FMT-07 AC-32 |
| `rozectene-lane-order-to-read-first.yml`, `podle-zanru-lane-order-cestopis.yml`, `podle-autora-lane-order-tomas.yml`, `rozectene-lane-order-reset.yml` | lane drags; Reset lane order | FR-QRY-05 AC-19 |
| `podle-zanru-sort-add-level.yml`, `podle-zanru-lane-order-reset-after-drag.yml` | `+ Add sort`; lane drag then Reset lane order | FR-QRY-01 AC-10 (c), FR-FMT-07 AC-32 |
| `vyborne-knihy-sort-two-levels.yml`, `vyborne-knihy-sort-back-to-one.yml` | ⇧-click Finished; Remove that level | FR-QRY-01 AC-10 (a), (b) |
| `prectene-2026-sort-rating-desc.yml`, `-sort-title-first.yml`, `-sort-one-level.yml`, `-sort-add-created.yml`, `-sort-cleared.yml` | the popover steps (a)…(e) | FR-QRY-01 AC-9 |
| `prectene-2026-click-rating.yml`, `-click-rating-desc.yml`, `-shift-finished.yml`, `-click-author.yml` | header click steps (a)…(d) | FR-QRY-01 AC-11 |
| `rozectene-group-by-genres.yml`, `rozectene-view-table.yml` | the editor commits | FR-QRY-01 AC-12 |
| `podle-autora-lane-order-marek-sovak.yml` | 4C rename of Marek Sova on the runtime `lane_order` variant | FR-LNK-03 AC-24 (b) |
| `books/kniha-o-horach-reading.md` | card drag To read → Reading | FR-QRY-05 AC-13 |
| `books/sto-zimnich-dni-poezie.md`, `books/sto-zimnich-dni-eseje-only.md`, `books/carovna-mapa-eseje.md`, `books/mapa-bez-severu-alt-poezie.md`, `books/ostrov-bez-jmena-poezie.md`, `books/dum-u-reky-marek-sova.md`, `books/svetla-pristavu-doporucene.md` | AC-14 (a)…(e), the relation drag, the tag drag | FR-QRY-05 AC-14 |
| `books/nocni-vlak-read.md` | drop on the excluded `Read` | FR-QRY-05 AC-16 |

`../../expected-views.json` (L3 for slice Q2): `reads` of every query file of `tests/fixtures/vaults/views/` as the
contract §2 `QueryDefDto` (`sort` a list of levels), `groups` (R193's boards: lane `id`, `label`, `excluded`,
`dropTarget`, card `paths` in order) and `results` (R193's orders, `cs` and `en-US`). It stays a separate file (D-1814), so
slice Q's readers of `expected.json` and its twelve `reads` are unchanged. The step order above is approved (D-1822).
