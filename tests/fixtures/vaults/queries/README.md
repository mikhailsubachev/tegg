# Fixture `queries/` (v1.0 slice Q, saved queries and the query block)

Synthetic vault for `docs/acceptance/queries.md` (FR-QRY-01…03, -05, -06, -08, -09, FR-FMT-06 AC-4…AC-6, FR-TPL-04 AC-1, AC-2, FR-EDT-02 AC-24, AC-25, FR-STO-06 AC-3, FR-NAV-04 AC-12, FR-HOM-02 AC-28…AC-31, FR-LNK-03 AC-23, FR-SYN-02 AC-10, FR-SYN-03 AC-28, AC-29, FR-SYN-06 AC-44, FR-FMT-07 AC-29, AC-30, FR-FMT-12 AC-9, NFR-POR-01 AC-5, NFR-PERF-05 AC-5, NFR-PERF-07 AC-2, NFR-PERF-08 AC-2, FR-UX-03 AC-41, AC-42, FR-UX-08 AC-18, FR-UX-05 AC-20, NFR-OTH-02 AC-17). Hand-written (D-50); no real content. **Draft**: it follows the recommended option A of AP-1290 (queries saved in `.tegg/queries/`, blocks refer to them with `saved:`) and AP-1291…AP-1304's proposals; it changes if the owner decides otherwise.

**How tests use it.** Each test copies this folder (without this README) into a temporary directory, then copies `tests/fixtures/vaults/new-empty/.tegg/` into it (no file names clash: this folder's `.tegg/types/` holds only `schůzka.yml`, `projekt.yml`, `osoba.yml`, `kniha.yml`). Task's `status`, `priority`, `due`, `completed` come from new-empty's `task.yml`. There is no `.tegg/pinned.yml`; tests that pin write one at runtime.

**Byte rules.** LF, UTF-8 without BOM, every file ends with one `\n`, NFC everywhere (file names and content). Don't open and re-save these files in an editor. NFD, CRLF and no-final-newline variants are made at runtime.

**Test clock.** `2026-11-10T10:00:00+01:00` (a Tuesday), Europe/Prague, region `cs`. The dates below are chosen around it: T7 is overdue, T1/T2/T6 are this week, T3 is outside 14 days but High, T4 has no due date, T5 is Done; T7, Krakatit, Dotaz and Den were created on 10 Nov in Prague, while T7 and Krakatit fall on 9 Nov in New York.

## Objects

Key order: `id, type, title, <attributes>, source, tags, created, modified`. Ids are `01JB5Q000000000000000000nn`.

| Short | Path | id `nn` | Type, content | Used by |
| --- | --- | --- | --- | --- |
| Porada 7 | `Schůzky/2026-10-07 Týdenní porada.md` | 01 | schůzka, `datum: 2026-10-07`, `účastníci: ["[[Jana Nováková]]"]`, created 2026-10-07 09:00, modified 2026-10-07 11:00; body links Lisabon and Porada 14; blocks `saved: Otevřené úkoly z této schůzky`, `saved: Úkoly z této schůzky` | FR-QRY-03 AC-1, AC-5, FR-QRY-05 AC-1…AC-3, AC-6, FR-QRY-09, FR-EDT-02 AC-24 |
| Porada 14 | `Schůzky/2026-10-14 Týdenní porada.md` | 02 | schůzka, `datum: 2026-10-14`; block `saved: Otevřené úkoly z této schůzky` | FR-QRY-03 AC-1, FR-QRY-06 AC-5 |
| T1 | `Tasks/Poslat návrh rozpočtu Janě.md` | 03 | task, To do, High, due 2026-11-12, source Porada 7, `tags: [finance, q4]`; body links Jana | R146, FR-QRY-02 AC-3, AC-4 |
| T2 | `Tasks/Zarezervovat místo v Lisabonu.md` | 04 | task, In progress, Medium, due 2026-11-14, no source, `tags: [offsite]`, modified 2026-11-08; body links Porada 7 and Lisabon | R146, FR-QRY-02 AC-6 (link in the body, not in `source`) |
| T3 | `Tasks/Připravit program výjezdu.md` | 05 | task, In progress, High, due 2026-11-30, source Porada 7, `tags: [offsite]` | R146 (in through High) |
| T4 | `Tasks/Zeptat se Jany na limit cest.md` | 06 | task, To do, Low, **no due**, source Porada 7 | R146 (out), FR-QRY-02 AC-3 (`is empty`) |
| T5 | `Tasks/Uzavřít zápis z porady.md` | 07 | task, **Done**, Medium, due 2026-11-05, completed, source Porada 7 | R146 (out), overdue doesn't count Done |
| T6 | `Tasks/Úkol z druhé porady.md` | 08 | task, To do, Medium, due 2026-11-11, source Porada 14 | FR-QRY-03 AC-1 |
| T7 | `Tasks/Zaplatit zálohu.md` | 09 | task, Waiting, High, due 2026-11-09 (overdue), `tags: [finance]`, created 2026-11-10T00:30+01:00 | `Úkoly po termínu`, `Vytvořeno v tento den` (zones) |
| Smazaný | `.trash/Tasks/Smazaný úkol.md` | 10 | task in the trash, To do, High, due 2026-11-12, source Porada 7 | FR-QRY-02 AC-7 (never a result) |
| Lisabon | `Projekty/Výjezd Lisabon 2026.md` | 11 | projekt, Aktivní, 120000, vlastník Jana, `tags: [offsite, q4]`; block `saved: Vše, co sem odkazuje` | FR-QRY-05 AC-4, FR-QRY-02 AC-6 |
| Rozpočet | `Projekty/Rozpočet Q4.md` | 12 | projekt, Hotovo, 5000, `tags: [finance, q4]` | FR-QRY-02 AC-2, AC-4, AC-5 |
| Čajovna | `Projekty/Čajovna na nábřeží.md` | 13 | projekt, Aktivní, 8000 | collation (Č after C in `cs`) |
| Cesta | `Projekty/Cesta do Brna.md` | 14 | projekt, Aktivní, 3000 | collation |
| Malý | `Projekty/Malý projekt.md` | 15 | projekt, `stav: aktivni` (not an option label) | AP-1302 (folded match) |
| Jana | `Osoby/Jana Nováková.md` | 16 | osoba, `firma: Účetní s.r.o.` | FR-QRY-02 AC-2, AC-6 |
| Mloci | `Knihy/Válka s mloky.md` | 17 | kniha, Karel Čapek, `přečteno: false`, orphan key `hodnocení: 5` | `Knihy s hodnocením` (broken filter), FR-QRY-06 AC-11 |
| Krakatit | `Knihy/Krakatit.md` | 18 | kniha, Karel Čapek, `přečteno: true`, created 2026-11-09T23:30-05:00 | broken filter result, inline `Ruční dotaz`, zones |
| Dotaz | `Quick Notes/Dotaz na rozpočet.md` | 19 | quick-note, `tags: [finance]`, created/modified 2026-11-10 08:15; body links Lisabon and Jana | mixed table, `Vytvořeno v tento den` |
| Den | `Daily/2026-11-10.md` | 20 | daily-note, `date: 2026-11-10`, created 07:00; block `saved: Vytvořeno v tento den` | FR-QRY-03 AC-3 (AP-1298) |
| Přehled | `Pages/Přehled dotazů.md` | 21 | page; nine fences in this order: `saved: Projekty v běhu`, `saved: Knihy s hodnocením`, `saved: Zrušené úkoly`, `saved: Neexistující dotaz` (no such query), `saved: Starý dotaz` (in the trash), inline `Ruční dotaz` (with a comment line), inline invalid YAML `title: [rozbitý`, `saved: Úkoly po termínu`, `saved: Nečitelný` | FR-QRY-06 AC-11…AC-14, R141 states |
| Bez hlavičky | `Pages/Bez hlavičky.md` | — | no frontmatter (Page, no dates, D-103); body links Lisabon | mixed table (sorted last by modified) |
| Šablona | `_templates/Schůzka/Schůzka.md` | — | template body (D-232) with `saved: Otevřené úkoly z této schůzky` | FR-TPL-04 AC-1, AC-2 |

## Types

`schůzka.yml` (Schůzka / Schůzky, `users`, teal; default template `_templates/Schůzka/Schůzka.md` (D-232, FR-TPL-04 AC-1); `datum` date, `účastníci` relation to `osoba`, multiple), `projekt.yml` (Projekt / Projekty, `folder`, orange; `stav` select Aktivní / Pozastaveno / Hotovo, `rozpočet` number, `vlastník` relation to `osoba`), `osoba.yml` (Osoba / Osoby, `user`, purple; `firma` text), `kniha.yml` (Kniha / Knihy, `book`, yellow; `autor` text, `přečteno` checkbox; **no** `hodnocení`).

## Queries (`.tegg/queries/`)

| File | Created → modified | What it tests |
| --- | --- | --- |
| `Otevřené úkoly z této schůzky.yml` | 2026-10-19 → 2026-11-02 | board E word for word (Czech values): `this`, `is_not`, a group with `any`, `within_next_days`; used by Porada 7, Porada 14, Šablona |
| `Úkoly z této schůzky.yml` | 2026-10-07 | Table of one type, `columns: [status, priority, due, modified]`, sort by due with an empty value |
| `Vše, co sem odkazuje.yml` | 2026-10-02 → 2026-10-19 | all types (`types: []`), mixed Table `columns: [type, tags, modified]`, sort modified ↓ |
| `Projekty v běhu.yml` | 2026-09-30 → 2026-10-15 | no `this` (results on the query page), select `is`, sort by title (collation) |
| `Knihy s hodnocením.yml` | 2026-09-03 → 2026-10-02 | broken filter: `hodnocení` isn't a Kniha attribute |
| `Zrušené úkoly.yml` | 2026-08-28 → 2026-10-09 | no results |
| `Úkoly po termínu.yml` | 2026-08-12 | `overdue` (T7 in, Done T5 out) |
| `Vytvořeno v tento den.yml` | 2026-11-01 | `created: { is: this }` in a Daily Note (AP-1298), time zones |
| `Komentáře a neznámé klíče.yml` | 2026-08-01 | comments (top, between keys, inside `filters`, trailing on `match:` and `view:`), unknown top-level `x-barva`, unknown item key `x-poznámka`: FR-FMT-07 AC-29 |
| `Nečitelný.yml` | 2026-07-15 | YAML error on **line 5** (`match: all: any`): never rewritten |
| `Novější verze.yml` | 2026-07-01 | `version: 2` (read-only) and an unknown key `x-budoucí` |
| `.trash/.tegg/queries/Starý dotaz.yml` | 2026-06-01 | a trashed query (AP-1292), referenced by Přehled |

Expected results at the test clock are in `docs/acceptance/queries.md` R146. All queries ordered Created ↓: Vytvořeno v tento den, Otevřené úkoly z této schůzky, Úkoly z této schůzky, Vše, co sem odkazuje, Projekty v běhu, Knihy s hodnocením, Zrušené úkoly, Úkoly po termínu, Komentáře a neznámé klíče, Novější verze, then Nečitelný (`Can't be read`); count 11.

## Made at runtime by the tests (never committed)

- NFD file names and `saved:` values (FR-FMT-12 AC-9); CRLF and no-final-newline copies of `Komentáře a neznámé klíče.yml` (FR-FMT-07 AC-29).
- Sync conflict copies `.tegg/queries/Projekty v běhu 2.yml` and `Projekty v běhu (conflicted copy 2026-11-10).yml` (FR-QRY-06 AC-17).
- `.tegg/pinned.yml` with `query:` items (FR-HOM-02 AC-28…AC-31, FR-QRY-06 AC-6).
- Query files with `limit: 5`, `types: [kniha, neexistuje]`, `group_by`, `view: board`, `links_to: "[[Výjezd Lisabon 2026]]"` and relation values (FR-QRY-01 AC-7, FR-QRY-05 AC-8, FR-QRY-06 AC-11, AC-13, FR-LNK-03 AC-23).
- New notes from Šablona, extra tasks, self-links, `#Finance` in T4, `Daily/2026-11-09.md`, embeds of Porada 7, a `hodnocení` attribute added to `kniha.yml` (as named in the criteria).
- External edits, renames, deletes and re-creates: by the helper process (L6), the fake core (L5) or plain file writes (L4).
- Random vaults and queries for the L2 criteria; the 5,000-note generated vault for NFR-PERF.
- The expected bytes in `tests/fixtures/queries-files/` are written by the test author after the APs are decided (AP-1293).
