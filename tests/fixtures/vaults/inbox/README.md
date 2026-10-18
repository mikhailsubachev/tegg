# Fixture `inbox/` (MS5 slice 5B) — DRAFT

Synthetic vault for `docs/acceptance/inbox.md` (FR-INB-01…04, FR-NAV-04, FR-DLY-05 AC-5, FR-FMT-07 AC-21, FR-SYN-06 AC-26…AC-28) and `docs/acceptance/capture.md` (FR-CAP-01, -03…-05, FR-TSK-10 AC-9…AC-12, FR-VLT-05, FR-SET-01, -05, NFR-SEC-03, NFR-PERF-10, FR-SYN-06 AC-24, AC-25). Hand-written from the fixture table of `inbox.md` (D-50); no real content. Interface: `docs/contracts/ms5-capture.md` (to be written, capture.md AP-480).

**Status: draft.** Only this README exists. The vault files are written byte-exact by a script in their own commit after the owner decides AP-467…AP-493 (the expected results below follow the recommendations). Don't create them with an editor.

The tests copy `tests/fixtures/vaults/new-empty/.tegg/` into it (`vault.yml` with `default-type: Quick Note`, `attachments: _attachments`, `daily-format: YYYY-MM-DD`; Quick Note and Daily Note `review: locked`; Page and Task `review: false`) next to the two type files below. No file names clash. This README is not a vault file and is never copied.

**Byte rules.** UTF-8 without BOM, NFC, LF line endings, one final newline, **except**: `Quick Notes/Divná hodnota.md` (CRLF on every line, frontmatter included, **no final newline**) and `Quick Notes/Žluťoučký kůň.md` (the `title` value in **NFD** bytes; the file name NFC). Ids are `01JB5B0000000000000000F0<nn>` (26 characters, ULID alphabet); templates, `Quick Notes/Holý text.md` and the trashed note have none. Every note is `---\n<frontmatter>\n---\n<body>` with the keys in the order `id, type, title, <schema keys>, tags, review, captured, created, modified` (keys it lacks are left out); `title` equals the file stem unless stated; `created` = `modified`; empty body (the file ends with `---\n`) unless a body is given; blocks separated by one blank line. Time stamps are Europe/Prague.

## Type files (`.tegg/types/`)

| File | Content |
| --- | --- |
| `nápad.yml` | `version: 1`, name `Nápad`, plural `Nápady`, `system: false`, folder `Nápady`, icon `lightbulb`, colour `yellow`, `review: true`, `template: _templates/Nápad/Nápad.md`, `preview: [hodnocení]`; attribute `hodnocení` (Number `Hodnocení`, `default: 1`) |
| `schůzka.yml` | `version: 1`, name `Schůzka`, plural `Schůzky`, `system: false`, folder `Schůzky`, icon `users`, colour `teal`, `review: false`, `preview: [datum]`; attribute `datum` (Date `Datum`) |

## Notes

| Short | Path | id | `type` | `review` | Time stamps | Other | Used by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Q1 | `Quick Notes/Koupit mléko.md` | F001 | quick-note | unreviewed | `captured`, `created`, `modified` 2026-10-14T08:15:00+02:00 | `tags: [nákup]`; body `Polotučné, 2 litry.` | Today; mark reviewed bytes; convert; link to; tags; capture stem collision (`Koupit mléko (2)`) |
| Q2 | `Quick Notes/Nápad na článek.md` | F002 | quick-note | unreviewed | 2026-10-13T21:40:00+02:00 | body `O synchronizaci přes Dropbox. Viz [[Plán webu]].` | Yesterday; footer `Created`; FR-INB-04 (linked from P2) |
| Q3 | `Quick Notes/Přečteno.md` | F003 | quick-note | reviewed | 2026-10-12T09:00:00+02:00 | | not listed |
| Q4 | `Quick Notes/Bez stavu.md` | F004 | quick-note | (no key) | 2026-10-10T10:00:00+02:00 | body `Viz [[Dvojník]] a [[Plán webu]].` | locked type, missing value = listed; append (link re-targeting); key appended |
| Q5 | `Quick Notes/Divná hodnota.md` | F005 | quick-note | `maybe` | 2026-10-09T16:45:00+02:00 | **CRLF, no final newline**; body `Řádek jedna.` / `Řádek dva.` (one paragraph) | unknown value = listed; CRLF kept |
| Q6 | `Quick Notes/Žluťoučký kůň.md` | F006 | quick-note | unreviewed | 2026-10-14T10:00:00+02:00 | `title` in **NFD**; body `Text s háčky.` | first in Today; NFD bytes kept |
| Q7 | `Quick Notes/Bez offsetu.md` | F007 | quick-note | unreviewed | `created`, `modified` `2026-10-14T06:30:00` (no offset) | | offset-less instant (D-365) |
| Q8 | `Quick Notes/Bez data.md` | F008 | quick-note | unreviewed | none | | no instant: last; no footer; `modified` appended |
| Holý | `Quick Notes/Holý text.md` | — | no frontmatter (Page, D-103) | — | — | text `Jen text.` | folder never makes a Quick Note; not listed |
| D1 | `Daily/2026-10-13.md` | F009 | daily-note | unreviewed | 2026-10-13T07:30:00+02:00 | `title: "2026-10-13"`, `date: 2026-10-13`; body `Ranní poznámky.` | Yesterday; FR-DLY-05 AC-5; no convert |
| D2 | `Daily/2026-10-12.md` | F010 | daily-note | reviewed | 2026-10-12T08:00:00+02:00 | `title: "2026-10-12"`, `date: 2026-10-12` | not listed |
| D3 | `Daily/2026-10-07.md` | F011 | daily-note | unreviewed | 2026-10-07T08:00:00+02:00 | `title: "2026-10-07"`, `date: 2026-10-07`; body `Zápis týden zpět.` | Older |
| N1 | `Nápady/Aplikace na čaj.md` | F012 | nápad | `"unreviewed"` (double-quoted) | 2026-10-14T09:00:00+02:00 | `hodnocení: 2` | review-on type; quote style kept; 00:00 in Los Angeles |
| N2 | `Nápady/Starý nápad.md` | F013 | nápad | (no key) | 2026-09-30T09:00:00+02:00 | `hodnocení: 1` | review-on type without a value: not listed |
| P1 | `Pages/Zachycená stránka.md` | F014 | page | unreviewed | `captured`, `created`, `modified` 2026-10-11T18:20:00+02:00 | body `Odkaz: https://example.org/clanek` | captured Page (workflow off) listed; week boundary (W) |
| P2 | `Pages/Plán webu.md` | F015 | page | (no key) | 2026-10-01T09:00:00+02:00 | body `## Cíle` / `Rychlý web.` / `Souvisí: [[Nápad na článek]] a [[Dvojník]].` | append and link target; capture link target |
| T1 | `Tasks/Zavolat instalatérovi.md` | F016 | task | unreviewed | `captured`, `created`, `modified` 2026-10-14T07:50:00+02:00 | `status: To do`, `priority: High`, `due: 2026-10-15` | a captured task in the Inbox |
| S1 | `Schůzky/Porada týmu.md` | F017 | schůzka | unreviewed | 2026-10-12T14:00:00+02:00 | `datum: 2026-10-12`; the line `# poznámka: ručně psaná hlavička` directly after `title`, and `místnost: A2` after `datum` | explicit value on a review-off type; comment and unknown key kept |
| DQ | `Quick Notes/Dvojník.md` | F018 | quick-note | reviewed | 2026-10-01T09:00:00+02:00 | | stem shared with DP (link re-targeting) |
| DP | `Pages/Dvojník.md` | F019 | page | (no key) | 2026-10-01T09:00:00+02:00 | | stem shared with DQ |
| Šablona QN | `_templates/Quick Note/Quick Note.md` | — | quick-note | unreviewed | | not the type's default template | never listed |
| Šablona N | `_templates/Nápad/Nápad.md` | — | (none) | | | frontmatter `hodnocení: 3`, `oblast: osobní` only; body `## Proč na tom záleží` | Nápad's default template: capture bytes (template frontmatter, not body) |
| Smazaná | `.trash/Quick Notes/Smazaná.md` | — | quick-note | unreviewed | 2026-10-14T11:00:00+02:00 | | never listed |

## Expected results (summary; the criteria and R61 are authoritative)

Test clock `2026-10-14T12:00:00+02:00` (Wednesday), Europe/Prague, region `cs` (week Monday–Sunday) unless stated.

- **Inbox** (13 items, sidebar count `13`): Today Q6, N1, Q1, T1, Q7; Yesterday Q2, D1; Earlier this week S1; Older P1, Q4, Q5, D3, Q8.
- **Region `en-US`:** Earlier this week S1, P1; Older Q4, Q5, D3, Q8 (Today and Yesterday unchanged).
- **Los Angeles** (03:00 on 14 Oct), region `cs`: Today Q7, Q6, N1; Yesterday Q1, T1, Q2; Earlier this week D1, S1; Older P1, Q4, Q5, D3, Q8.
- **Type filter:** All 13, Pages 1, Tasks 1, Quick Notes 7, Daily Notes 2, Nápady 1, Schůzky 1.
- **Never listed:** Q3, Holý, D2, N2, P2, DQ, DP, both templates, Smazaná.
- **Link resolution used by the append criterion:** from `Quick Notes/` `[[Dvojník]]` resolves to DQ; from `Pages/` to DP (same folder first, D-291).
