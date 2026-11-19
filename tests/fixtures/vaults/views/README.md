# Fixture `views/` (v1.0 slice Q2, views on type pages)

Synthetic vault for `docs/acceptance/views.md` (FR-QRY-07, FR-QRY-05 Board, FR-QRY-01 multi-level sort and group by, FR-QRY-06 AC-23…AC-25, FR-QRY-08 AC-2, FR-QRY-09 AC-6, AC-7, FR-TYP-09 AC-35, AR-07 AC-9, FR-LNK-03 AC-24, FR-SYN-02 AC-11, FR-SYN-03 AC-30, FR-SYN-06 AC-48, FR-FMT-07 AC-32, AC-33, FR-FMT-12 AC-12, FR-STO-07 AC-10, NFR-POR-01 AC-6, NFR-PERF-07 AC-3, AC-4, FR-UX-03 AC-50, AC-51, FR-UX-08 AC-24, FR-UX-05 AC-24, NFR-OTH-02 AC-21). Hand-written (D-50); every name, title and text is invented (D-62). **Draft**: the placement of `views:` in `book.yml` and the shapes of the Q2 keys in the query files follow the proposals of AP-1498 and AP-1499 in `views.md`; the fixture changes if the owner decides otherwise.

**How tests use it.** Each test copies this folder (without this README) into a temporary directory, then copies `tests/fixtures/vaults/new-empty/.tegg/` into it (no file names clash: this folder's `.tegg/types/` holds only `book.yml` and `autor.yml`). There is no `.tegg/pinned.yml` and no `ui-state.json`; tests that need them write them at runtime.

**Byte rules.** LF, UTF-8 without BOM, every file ends with one `\n`, NFC everywhere (file names and content). Don't open and re-save these files in an editor. NFD, CRLF and no-final-newline variants are made at runtime.

**Test clock.** `2026-11-19T10:00:00+01:00` (a Thursday), Europe/Prague, region `cs`.

## Types

| File | Type | Attributes (schema order) | Notes |
| --- | --- | --- | --- |
| `book.yml` | Book / Books, folder `Books`, `book`, purple, description `Knihy, které jsem četl, čtu nebo chci číst.` | `author` relation to `autor` (single); `status` select To read / Reading / Read (default To read); `rating` select Excellent / Good / Bad; `genres` multi-select Román / Detektivka / Poezie / Eseje / Cestopis; `finished` date | `preview: [author, status]`, `columns: [author, rating, status, modified]` (line 12), **`views: [Rozečtené, Přečtené 2026, Výborné knihy]` (line 13, AP-1498's place)** |
| `autor.yml` | Autor / Autoři, folder `Autoři`, `user`, blue | `poznámka` text | `preview: [poznámka]` (line 10); **no `views`** and no `columns`: its page has only `All Autoři` |

## Objects

Key order: `id, type, title, <attributes>, tags, created, modified`. Ids are `01JB5V000000000000000000nn`.

| nn | Path | author | status | rating | genres | finished | tags | modified | Why |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01…05 | `Autoři/Eva Lindová.md`, `Tomáš Rybář.md`, `Marek Sova.md`, `Lucie Horká.md`, `Jana Brázdová.md` | | | | | | | 2026-08-01 | relation targets, lanes of `Podle autora` |
| 11 | `Books/Mapa bez severu.md` | Eva | Read | Excellent | `[Román]` | 2026-10-12 | `[doporučené]` | 2026-10-12T21:00+02:00 | linked from Čtení 2026 |
| 12 | `Books/Sto zimních dní.md` | Tomáš | Read | Good | `[Román, Eseje]` (flow) | 2026-09-28 | | 2026-09-28T22:00+02:00 | two genres: two lanes, both pills |
| 13 | `Books/Cizí přístavy.md` | Eva | Read | Excellent | `[Cestopis]` | 2026-08-02 | | 2026-08-02T20:00+02:00 | tie on finished and rating with 14; `cs` C before Č |
| 14 | `Books/Čarovná mapa.md` | Lucie | Read | Excellent | block list `Cestopis`, `Román` | 2026-08-02 | | 2026-08-03T09:00+02:00 | tie with 13; block-list drag bytes |
| 15 | `Books/Kniha o čaji.md` | Marek | Read | Bad | `[Eseje]` | 2026-06-19 | | 2026-06-19T21:00+02:00 | tie on finished with 16, rating decides |
| 16 | `Books/Šest cest k moři.md` | Jana | Read | Good | `[Cestopis]` | 2026-06-19 | | 2026-06-20T10:00+02:00 | tie with 15 |
| 17 | `Books/Tiché město.md` | Tomáš | Read | Good | `[Detektivka]` | 2026-03-11 | | 2026-03-11T22:00+01:00 | |
| 18 | `Books/Zahrada v dešti.md` | Lucie | Read | Bad | `[Poezie]` | 2026-01-20 | | 2026-01-20T21:00+01:00 | |
| 19 | `Books/Čtvrtá zima.md` | Marek | Read | Good | `[Detektivka]` | **2025-12-02** | | 2025-12-02T21:00+01:00 | outside `Přečtené 2026` |
| 20 | `Books/Noční vlak.md` | Tomáš | Reading | Good | `[Román]` | | | 2026-11-18T22:00+01:00 | linked from Čtení 2026 |
| 21 | `Books/Světla přístavu.md` | Eva | Reading | Bad | `[Eseje]` | | **inline `#večerní`** in the body | 2026-11-14T20:00+01:00 | inline tag stays on a tag drag |
| 22 | `Books/Účetní ze Žižkova.md` | Jana | Reading | — (no key) | `[Detektivka, Román]` | | | 2026-11-16T19:00+01:00 | empty Rating pill |
| 23 | `Books/Dům u řeky.md` | Lucie | To read | — | `[Román]` | | `[doporučené]` | 2026-11-16T08:00+01:00 | |
| 24 | `Books/Kniha o horách.md` | Marek | To read | — | `[Cestopis]` | | | 2026-11-03T18:00+01:00 | the card dragged in FR-QRY-05 AC-13 |
| 25 | `Books/Ostrov bez jména.md` | — (no key) | To read | — | — (no key) | | `[odloženo]` | 2026-10-30T18:00+01:00 | excluded by `has_none_of [odloženo]`; `No Author`, `No Genres` lanes |
| 26 | `Books/Písně z dálky.md` | Eva | **— (no key)** | Good | `[Poezie]` | | | 2026-10-01T18:00+02:00 | `No Status` |
| 27 | `Books/Zápisník z Tater.md` | Jana | **`Rozečteno`** (not an option) | — | `[Cestopis]` | | | 2026-11-10T18:00+01:00 | unknown-value lane (AP-1507) |
| 28 | `.trash/Books/Smazaná kniha.md` | Tomáš | Reading | Good | `[Román]` | | | 2026-11-01T18:00+01:00 | never a card or row (D-102) |
| 29 | `Pages/Čtení 2026.md` | | | | | | | 2026-11-01T09:00+01:00 | board G: links 11 and 20; blocks `saved: Přečtené 2026` (table), `saved: Rozečtené` (board, D-1773), `saved: Knihy odkazované odsud` (`this`) |

17 live books. `All Books` (Modified ↓): Noční vlak, Účetní ze Žižkova, Dům u řeky, Světla přístavu, Zápisník z Tater, Kniha o horách, Ostrov bez jména, Mapa bez severu, Písně z dálky, Sto zimních dní, Čarovná mapa, Cizí přístavy, Šest cest k moři, Kniha o čaji, Tiché město, Zahrada v dešti, Čtvrtá zima.

## Queries (`.tegg/queries/`)

| File | Created → modified | Tab on Books | What it tests |
| --- | --- | --- | --- |
| `Rozečtené.yml` | 2026-11-02 → 2026-11-15 | 1st | board F word for word: `view: board`, `group_by: status`, `lanes: vertical`, `lane_order: [Reading, To read, Read]`, a two-level `sort` list, `columns` = On cards; `is_any_of` excludes `Read` (hatched lane) |
| `Přečtené 2026.yml` | 2026-10-20 → 2026-11-12 | 2nd | board A: Table with a **three-level** `sort` list (finished ↓, rating ↑, title ↑); used in Čtení 2026 (widths shared, D-1767) |
| `Výborné knihy.yml` | 2026-10-05 | 3rd | Table with the **single-mapping** `sort` (R138); ⇧-click turns it into a list, removing the level turns it back (D-1768) |
| `Podle žánru.yml` | 2026-10-10 | — | board by **multi-select** `genres`, `lanes: horizontal`, no `lane_order`; comments (top, trailing on `sort:` and `lanes:`, between keys) and the unknown key `x-barva` for FR-FMT-07 AC-32 |
| `Podle autora.yml` | 2026-10-12 | — | board by **relation** `author`, **no `lanes` key** (reads vertical) |
| `Seskupeno podle data.yml` | 2026-10-14 | — | `group_by: finished` (a date): broken key, shown as List with a notice (D-1770) |
| `Autoři.yml` | 2026-09-15 | — | `types: [autor]`: greyed on Books (`Shows Autor, not Book`), offered on Autoři |
| `Knihy a autoři.yml` | 2026-09-20 | — | two types: greyed everywhere (D-1763) |
| `Knihy odkazované odsud.yml` | 2026-09-25 | — | `linked_from: this`: greyed (`Needs the note it is used on`); in Čtení 2026 lists Mapa bez severu, Noční vlak |
| `.trash/.tegg/queries/Odložené.yml` | 2026-09-10 | — (runtime: added to `views:`) | a trashed query as a tab (FR-QRY-07 AC-11) |

Queries page (Created ↓): Rozečtené (11-02), Přečtené 2026 (10-20), Seskupeno podle data (10-14), Podle autora (10-12), Podle žánru (10-10), Výborné knihy (10-05), Knihy odkazované odsud (09-25), Knihy a autoři (09-20), Autoři (09-15); count 9 (`Odložené` is in the trash). The three Books views carry the `Books page` mark (D-1764).

Expected boards, tables and sorts at the test clock are in `docs/acceptance/views.md` R193.

## Made at runtime by the tests (never committed)

- `views:` variants of `book.yml`: with `Odložené` (trashed), `Ztracený pohled` (no such query), a repeated or NFD-spelled name, other case (`rozečtené`), a block list, a scalar (`views: Rozečtené`), `views: []`; a `book.yml` without `views`; a CRLF copy and one without a final newline.
- `autor.yml` with a first view (FR-QRY-07 AC-4); a vault without `.tegg/types/page.yml` (missing system file, D-90).
- Query files: `Podle štítku.yml` (`group_by: tags`), a board copy of `Výborné knihy` grouped by `status` (pre-fill with `rating: Excellent`), `lanes: diagonal`, `lane_order` with an unknown value, a `sort:` list with a missing `order`, a list item that is not a mapping, a newer `version: 2` view, a view whose `types` becomes `[book, autor]`, a name with a comma (`Čtu, až bude čas`), NFD names, CRLF and no-final-newline copies of `Podle žánru.yml`.
- Book edits by the helper process (L6), the fake core (L5) or plain writes (L4): status, genres and author changes, new books, deletes, a new option `Abandoned` in `book.yml`.
- The 500-card board of NFR-PERF-07 AC-3 (`karta.yml`, 5 options, 500 objects) generated from the spec in that criterion; the 5,000-note reference vault.
- Expected bytes after writes (`tests/fixtures/queries-files/expected/views/`) are written by the test author once AP-1497…AP-1518 are decided (as slice Q did after AP-1293).
