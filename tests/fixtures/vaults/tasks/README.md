# Fixture `tasks/` (MS5 slice 5A-1)

Synthetic vault for `docs/acceptance/tasks.md` (FR-TSK-01…05, -08…11, FR-DLY-04 AC-8…AC-14, FR-SYN-06 AC-20…AC-22). Hand-written from the fixture tables of `tasks.md` (D-50); no real content. Interface: `docs/contracts/ms5-tasks.md`.

The tests copy `tests/fixtures/vaults/new-empty/.tegg/` into it (Task type file as shipped: statuses To do / In progress / Waiting / Done / Cancelled with the states open / in-progress / open / done / cancelled, priorities High / Medium / Low / None, no `default`; default type Quick Note) next to the one type file below. No file names clash. This README is not a vault file and is never copied.

**Byte rules.** UTF-8 without BOM, NFC everywhere, LF line endings, one final newline, **except** `Tasks/Nákup.md`, whose `title` value `Nákup` and `tags` entry `doma` are in **NFD bytes** (`a` U+0301); its file name is NFC. Don't open and re-save these files in an editor; they were written by a script. All ids are `01JB5A0000000000000000E0<nn>` (26 characters, ULID alphabet); the template and `Tasks/Bez hlavičky.md` have none. Time stamps are Europe/Prague.

Every task file is `---\n<frontmatter>\n---\n<body>` with the keys in the order `id, type, title, status, priority, due, completed, tags, source, created, modified` (keys it lacks are left out), `created: 2026-10-01T09:00:00+02:00` and `modified: 2026-10-01T09:00:00+02:00` unless stated, and an empty body (the file ends with `---\n`) unless a body is given. `title` equals the file stem. The other notes use `id, type, title, <keys>, created, modified` with the same default stamps.

## Type file (`.tegg/types/`)

| File | Content |
| --- | --- |
| `projekt.yml` | `version: 1`, name `Projekt`, plural `Projekty`, folder `Projekty`, icon `folder`, colour `orange`, `preview: [status, due]`; attributes `status` (Select `Status`: `To do` gray, `Done` green, no `state`) and `due` (Date `Due date`). Task-like keys on a type that isn't Task (FR-TSK-11, R44) |

## Tasks

| Short | Path | id | `status` | `priority` | `due` | Other | Used by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T01 | `Tasks/Zavolat Janě.md` | E001 | To do | High | 2026-10-09 | `tags: [práce]`, `source: "[[Porada]]"`; body `Domluvit schůzku na příští týden.` | overdue 5 days; source chip (FR-TSK-08); panel (FR-TSK-01 AC-2); FR-TSK-02 AC-5 count |
| T02 | `Tasks/Poslat rozpočet.md` | E002 | In progress | Medium | 2026-10-13 | `tags: [práce, finance]` | overdue `Yesterday`; two tag columns; FR-TSK-05 AC-4 (already has the target) |
| T03 | `Tasks/Zalít květiny.md` | E003 | To do | Low | 2026-10-14 | `tags: [doma]` | due today; checkbox and drag bytes (FR-TSK-02 AC-10, FR-TSK-05 AC-2, AC-13); conflicts (AC-11, FR-TSK-05 AC-10); TZ edge (FR-TSK-01 AC-5) |
| T04 | `Tasks/Koupit dárek.md` | E004 | Waiting | — | 2026-10-15 | `tags: [doma]`; body `Něco k narozeninám.` | open with a non-first Open status (FR-TSK-02 AC-1, AC-4, AC-6); tag drag (FR-TSK-05 AC-4) |
| T05 | `Tasks/Úklid garáže.md` | E005 | To do | Medium | 2026-10-18 | `tags: [Doma]` | last day of the `cs` week (Sunday), Later in `en-US`; tag spelling (D-185) |
| T06 | `Tasks/Příprava prezentace.md` | E006 | To do | High | 2026-10-19 | `tags: [práce]` | Later |
| T07 | `Tasks/Obnovit pas.md` | E007 | To do | None | 2026-12-01 | — | Later; `None` is the last priority (no chip) |
| T08 | `Tasks/Přečíst knihu.md` | E008 | To do | Medium | — | `tags: [čtení]` | Not scheduled |
| T09 | `Tasks/Opravit kolo.md` | E009 | In progress | — | — | — | Not scheduled; no priority |
| T10 | `Tasks/Zaplatit fakturu.md` | E010 | Done | High | 2026-10-14 | `completed: 2026-10-14T09:30:00+02:00`, `tags: [finance]`, `modified: 2026-10-14T09:30:00+02:00` | Done, completed today; Daily group (3); D-328 exclusion (FR-DLY-04 AC-11) |
| T11 | `Tasks/Objednat lístky.md` | E011 | Done | — | 2026-10-06 | `completed: 2026-10-05T18:00:00+02:00` | Done (older than 7 days: not on the Kanban); `daily/2026-10-05` |
| T12 | `Tasks/Vrátit knihy.md` | E012 | Done | — | — | no `completed`; `modified: 2026-10-10T08:00:00+02:00` | Done sorted by `modified` (D-472) |
| T13 | `Tasks/Zrušená cesta.md` | E013 | Cancelled | — | 2026-10-10 | — | never shown (D-475) |
| T14 | `Tasks/Bez stavu.md` | E014 | (no key) | — | 2026-10-14 | — | missing status = Open, `No status` column (D-471) |
| T15 | `Tasks/Cizí stav.md` | E015 | Rozpracováno | — | 2026-10-16 | — | not an option: Open, `Not a status` |
| T16 | `Tasks/Špatné datum.md` | E016 | To do | — | `2026-02-30` | — | impossible date: Not scheduled, `Invalid due date` (D-484) |
| T17 | `Tasks/S časem.md` | E017 | To do | — | `2026-10-15T09:00:00+02:00` | — | a date-time is not a due date (D-484) |
| T18 | `Tasks/Štítek v textu.md` | E018 | To do | — | — | `tags: [práce]`; body `Zeptat se #rodina na termín.` | inline tag (D-185, D-478) |
| T19 | `Tasks/Nákup.md` | E019 | To do | — | 2026-10-15 | `title: Nákup` and `tags: [doma]` in **NFD** bytes | NFC matching of tags (FR-TSK-05 AC-4) |

## Other notes

| Short | Path | id | Content | Used by |
| --- | --- | --- | --- | --- |
| Porada | `Pages/Porada.md` | E020 | `type: page`, `title: Porada`; body: `Zápis z porady.`, `## Úkoly`, the checklist `- [ ] Zavolat dodavateli` / `- [x] Poslat zápis` / `- [ ] Objednat projektor`, the paragraph `![[Zavolat Janě]]`, then `Konec zápisu.` (blocks separated by one blank line) | T01's source; the embed the source chip selects (FR-TSK-08 AC-2); checklist items aren't tasks (FR-TSK-11) |
| Web | `Projekty/Web.md` | E021 | `type: projekt`, `title: Web`, `status: To do`, `due: 2026-10-14` | Task-like keys, not a task; relation target (FR-TSK-01 AC-6) |
| Se stavem | `Pages/Se stavem.md` | E022 | `type: page`, `title: Se stavem`, `status: To do`, `due: 2026-10-14` | not a task |
| Bez hlavičky | `Tasks/Bez hlavičky.md` | — | no frontmatter (a Page by D-103); text `- [ ] Něco udělat` | folder never makes a task |
| Šablona | `_templates/Task/Task.md` | — | `type: task`, `status: To do`, `due: 2026-10-14`, empty body; not the Task type's default template (`task.yml` has no `template` key) | templates are never tasks (FR-TPL-07) |
| Smazaný | `.trash/Tasks/Smazaný úkol.md` | E023 | `type: task`, `title: Smazaný úkol`, `status: To do`, `due: 2026-10-14` | trash is never indexed (D-102) |
| 9 Oct | `Daily/2026-10-09.md` | E024 | `type: daily-note`, `title: "2026-10-09"`, `date: 2026-10-09`, `created` and `modified` `2026-10-09T08:00:00+02:00`; body `Zápis dne.` | a written past Daily Note (FR-DLY-04 AC-9, AC-12) |

## Expected results (summary; the criteria and R41, R42 are authoritative)

Test clock `2026-10-14T12:00:00+02:00` (Wednesday), Europe/Prague, region `cs` (week Monday–Sunday) unless stated.

- **Tasks** (R44): exactly T01…T19. Semantic state: T02, T09 In progress; T10, T11, T12 Done; T13 Cancelled; every other task Open (T14 missing, T15 unknown value).
- **Schedule** (R41): Overdue T01, T02; Today T03, T14; This week Thu 15: T04, T19, Fri 16: T15, Sun 18: T05 (`en-US`, week Sunday–Saturday: Thu 15: T04, T19, Fri 16: T15); Later T06, T07 (`en-US`: T05, T06, T07); Not scheduled T08, T09, T17, T16, T18; Done T10, T12, T11 (collapsed). Summary `15 open · 2 overdue · 2 due today`; sidebar count `4`.
- **Kanban by status** (R42): To do T01, T03, T19, T05, T06, T07, T08, T17, T16, T18; In progress T02, T09; Waiting T04; Done T10, T12; No status T14, T15; no Cancelled column.
- **Kanban by tag** (R42): čtení T08; doma T03, T04, T19, T05; finance T02; práce T01, T02, T06, T18; rodina T18; No tag T14, T15, T07, T09, T17, T16. Tag filter `#čtení 1`, `#doma 4`, `#finance 1`, `#práce 4`, `#rodina 1`.
- **Overdue** (FR-TSK-09 AC-1): exactly T01 and T02. At `2026-10-14T22:30:00Z` also T03 and T14 in Europe/Prague, not in America/Los_Angeles.
- **Daily `Tasks due`** (FR-DLY-04 AC-9): 14 Oct: T01, T02, T03, T14, then T10; 9 Oct: T01; 15 Oct: T04, T19; 5 Oct: T11.
- **Usage**: `To do` is used by 10 tasks (T01, T03, T05, T06, T07, T08, T16, T17, T18, T19); `Waiting` by 1 (T04); `Cancelled` by 1 (T13).
