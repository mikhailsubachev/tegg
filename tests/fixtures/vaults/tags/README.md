# Fixture `tags/` (MS4 slice 4D-lite)

Synthetic vault for `docs/acceptance/tags.md` (FR-TAG-01…08, -10; FR-SRC-02 AC-10…AC-12; FR-EDT-15 AC-5, AC-6; FR-HIS-04 AC-7…AC-10; FR-LNK-14 AC-11…AC-14; FR-NAV-04 AC-8; FR-FMT-07 AC-23; FR-SYN-06 AC-31, AC-32) and the earlier criteria it changes (D-729). Hand-written from the fixture tables of `tags.md` (D-50); no real content. Interface: `docs/contracts/ms4-tags.md` (D-690…D-732).

**Status: written, 2026-10-22,** byte-exact by a script, following D-690…D-732. Don't open and re-save these files in an editor.

The tests copy `tests/fixtures/vaults/new-empty/.tegg/` into it (no file names clash; the Tag type's folder is `Tags`, `tag.yml` declares `color` with `preview: [color]`) next to the one type file below. This README is not a vault file and is never copied.

**Byte rules.** UTF-8 without BOM, NFC (file names and content), LF line endings, one final newline, **except**: `Quick Notes/Faktura.md` holds `účty` in **NFD bytes** in its body tag (`u` U+0301, `c` U+030C; the rest of the file is NFC); `Tasks/Zavolat bance.md` has **CRLF** line endings and **no final newline**. Ids are `01JB4D0000000000000000G0<nn>` (26 characters, ULID alphabet); the template has none. Every note is `---\n<frontmatter>\n---\n<body>`; a note without a body ends with `---\n`. Frontmatter keys in the order `id, type, title, <attributes>, tags, review, created, modified` (keys a note lacks left out); `created: 2026-09-01T09:00:00+02:00` unless given; Tag files have `modified` equal to their `created`. Time stamps are Europe/Prague (`+02:00`).

## Type file (`.tegg/types/`)

| File | Content |
| --- | --- |
| `projekt.yml` | `version: 1`, name `Projekt`, plural `Projekty`, folder `Projekty`, icon `folder`, colour `orange`, `review: false`, `attributes: []` (no attributes) |

## Objects

| Short | Path | id | Frontmatter (after `id, type, title`) | Body | `modified` | Used by |
| --- | --- | --- | --- | --- | --- | --- |
| Rozpočet | `Pages/Rozpočet.md` | G001 | `tags: [účty, finance]` (flow) | `Plán výdajů na říjen.` | 2026-10-21T09:00 | R80 (`účty`, `finance`); FR-TAG-04 AC-4, AC-8 (sync simulator target); FR-TAG-08 AC-2, AC-4; FR-TAG-07 AC-5 (trash); FR-SRC-02 AC-11 (`plán`); FR-TAG-05 AC-6 (panel chips) |
| Nájem | `Tasks/Zaplatit nájem.md` | G002 | `type: task`, `status: Done`, `completed: 2026-10-20T18:00:00+02:00`, block list `tags:` / `  - Účty` | empty | 2026-10-20T18:00 | R80 (done task counts, D-701); FR-TAG-04 AC-4 (block list), AC-5 (`unchanged`); FR-TAG-06 AC-2 (Done row) |
| Banka | `Tasks/Zavolat bance.md` | G003 | `type: task`, `status: To do`, `due: 2026-10-21`, `tags: [účty]`; **CRLF**, no final newline | `Zeptat se na poplatky.` | 2026-10-12T08:00 | FR-TAG-04 AC-4 (CRLF kept); FR-TAG-06 AC-2 (overdue row), AC-4 (`zavolat`); FR-TAG-07 AC-5 (Done) |
| Faktura | `Quick Notes/Faktura.md` | G004 | `type: quick-note`, `review: unreviewed` | `Poslat #účty dnes.` (`účty` in **NFD**) | 2026-10-22T08:00 | R80 (NFD key, Last used); FR-TAG-04 AC-4 (written NFC); FR-TAG-08 AC-2 (following space); FR-TAG-05 AC-6 (read view, editor, Inbox card) |
| Den | `Daily/2026-10-20.md` | G005 | `type: daily-note`, `title: "2026-10-20"`, `date: 2026-10-20` | `Ranní zápis.` / `#ÚČTY` / `Odpolední zápis.` (one paragraph) | 2026-10-20T21:00 | R80 (`ÚČTY` is `účty`); FR-TAG-04 AC-4, AC-5 (`#ÚČTY` → `#Účty`); FR-TAG-08 AC-2 (tag-only line, D-716); FR-TAG-06 AC-7 (`daily/2026-10-20`) |
| Dvakrát | `Pages/Dvakrát.md` | G006 | `tags: [účty]` | `#Účty a znovu #účty.` / blank / `Archiv: #účty/archiv` | 2026-10-15T12:00 | R80 (three occurrences count once; `účty/archiv`); FR-TAG-04 AC-4, AC-5; FR-TAG-08 AC-2; FR-TAG-10 AC-1 |
| Kód | `Pages/Kód.md` | G007 | — | `Kód` + code span `` `#účty` ``; a ```` ```text ```` fence holding `#účty`; `Vzorec $#účty$ v textu.`; a `$$` block holding `#účty`; `Odkaz [#účty](Rozpočet.md) a adresa <https://site.cz/#účty>.`; `Wikiodkaz [[Rozpočet#účty]].`; the line `Rok #účty-2026` (paragraphs separated by blank lines) | 2026-10-01T09:00 | R80 (only `účty-2026`, D-64); FR-TAG-04 AC-4, FR-TAG-08 AC-2 (untouched); FR-TAG-02 AC-3 (code-span edit) |
| Web | `Projekty/Web.md` | G008 | `type: projekt`, `tags: [finance, dvojí]` | empty | 2026-10-19T12:00 | R80 (`finance`, `dvojí`); FR-TAG-08 AC-4; FR-TAG-07 AC-5 (Last used after the trash) |
| Lomítko | `Pages/Lomítko.md` | G009 | — | `Cesta #a/b tam.` | 2026-10-18T09:00 | R80 (`a/b`); FR-TAG-10 AC-1 |
| Kniha | `Pages/Kniha.md` | G010 | `tags: [čtení, neznámá]` | empty | 2026-09-10T09:00 | R80 (`čtení`, `neznámá`) |
| Odkaz | `Pages/Odkaz na štítek.md` | G011 | — | `[[Účty]]` / blank / `[[a b]]` (links to Tag files) | 2026-09-02T09:00 | FR-TAG-06 AC-1 (links open the tag page); FR-TAG-04 AC-9 (link retarget, D-714); FR-SYN-06 AC-31 |
| Schůzka | `Pages/Schůzka.md` | G012 | `x-místo: Brno` | `Zápis A.` | 2026-09-05T09:00 | FR-LNK-14 AC-11…AC-13 (kept object, the oldest `created`) |
| Schůzka 2 | `Pages/schůzka (2).md` | G013 | `title: SCHŮZKA`, `x-místo: Praha`, `aliases: [porada]`, `tags: [čtení]`, `created: 2026-09-06T09:00:00+02:00` | `Zápis B.` | 2026-09-06T09:00 | R80 (`čtení`); FR-LNK-14 AC-11…AC-13 (merged object) |
| Na schůzku | `Pages/Odkaz na schůzku.md` | G014 | — | `[[schůzka (2)]]` / blank / `[[Schůzka]]` | 2026-09-07T09:00 | FR-LNK-14 AC-12 (retarget), AC-13 (sync simulator) |
| Výplň ×20 | `Pages/Výplň 01.md` … `Pages/Výplň 20.md` | G031…G050 | `title: Výplň <nn>`, no tag | `Výplňová stránka <nn>.` | 2026-09-01T09:00:00 | untouched by every job; FR-TAG-02 AC-3 (01), AC-4 (02); FR-TAG-07 AC-4 (03), AC-5 (04) |
| Šablona | `_templates/Page/Page.md` | — | only `type: page`, `tags: [účty]` (no `id`, `title`, `created`, `modified`) | `#účty` | — | never counted (D-701); rewritten by tag jobs (D-714): FR-TAG-04 AC-4, FR-TAG-08 AC-2 |
| Koš | `.trash/Pages/Starý.md` | G023 | `tags: [účty, starý]` | `#účty` | 2026-10-21T20:00 | never counted or touched (D-102): R80 (`starý` is no tag) |

## Tag files

All `type: tag`, no body (the file ends with `---\n`).

| Short | Path | id | Frontmatter (after `id, type`) | Used by |
| --- | --- | --- | --- | --- |
| F-účty | `Tags/Účty.md` | G015 | `title: Účty`, `color: blue`, `created` = `modified` = `2026-09-01T09:00:00+02:00` | R80 (blue); FR-TAG-04 AC-4 (renamed with `title: Výdaje`), FR-TAG-05 AC-1, AC-2, AC-5, FR-TAG-08 AC-2, AC-3 (trashed) |
| F-ab | `Tags/a b.md` | G016 | `title: a/b` (no `color`) | FR-TAG-02 AC-1 (title key, not the stem), AC-3 (deleted); FR-TAG-05 AC-2, AC-6 (neutral); FR-TAG-10 AC-1 |
| F-prázdný | `Tags/prázdný.md` | G017 | **no `title`**, `color: teal` | R80 (count 0, stem key, D-694); FR-EDT-15 AC-6 |
| F-dvojí | `Tags/dvojí.md` | G018 | `title: dvojí`, `color: red`, `created` = `modified` = `2026-05-01T09:00:00+02:00` | FR-TAG-02 AC-1 (winner, older `created`); FR-LNK-14 AC-14 (kept) |
| F-Dvojí2 | `Tags/Dvojí (2).md` | G019 | `title: Dvojí`, `color: green`, `created` = `modified` = `2026-06-01T09:00:00+02:00` | FR-TAG-02 AC-1 (loser, Duplicate titles, D-718); FR-LNK-14 AC-14 (merged) |
| F-neznámá | `Tags/neznámá.md` | G020 | `title: neznámá`, `color: magenta` (unknown), `description: Stará poznámka.`, `x-extra: 1` | FR-TAG-01 AC-2, AC-4; FR-TAG-05 AC-4 |
| F-cizí | `Pages/Cizí štítek.md` | G021 | `title: cizí`; outside `Tags/` | R80: a Tag file all the same (D-719), count 0 |
| F-koš | `.trash/Tags/starý.md` | G022 | `title: starý`, `color: red` | in the trash: no Tag file (D-102) |

## Expected results (summary; R79…R83 and the criteria are authoritative)

Test clock `2026-10-22T10:00:00+02:00` (Thursday), Europe/Prague.

- **R80, 10 tags** (key, display name, Tag file, colour, count, Last used): `účty` `Účty` F-účty blue 6 (Rozpočet, Nájem, Banka, Faktura, Den, Dvakrát) 2026-10-22T08:00; `finance` `finance` virtual None 2 (Rozpočet, Web) 2026-10-21T09:00; `dvojí` `dvojí` F-dvojí red 1 (Web) 2026-10-19T12:00; `a/b` `a/b` F-ab None 1 (Lomítko) 2026-10-18T09:00; `účty/archiv` virtual None 1 (Dvakrát) 2026-10-15T12:00; `účty-2026` virtual None 1 (Kód) 2026-10-01T09:00; `čtení` virtual None 2 (Kniha, Schůzka 2) 2026-09-10T09:00; `neznámá` F-neznámá None (raw `magenta`) 1 (Kniha) 2026-09-10T09:00; `prázdný` F-prázdný teal 0; `cizí` F-cizí None 0. Not tags: `starý`, anything else in Kód.
- **All tags summary:** `10 tags · 11 tagged objects` (distinct objects: Rozpočet, Nájem, Banka, Faktura, Den, Dvakrát, Web, Lomítko, Kód, Kniha, Schůzka 2).
- **Sidebar's five** (R83): `#Účty 6`, `#finance 2`, `#dvojí 1`, `#a/b 1`, `#účty/archiv 1`.
- **`tag/účty`** (Modified ↓): Faktura (Quick Note), Rozpočet (Page, `#finance`), Den `2026-10-20` (Daily Note), Zaplatit nájem (Task, Done), Dvakrát (Page, `#účty/archiv`), Zavolat bance (Task, overdue); `6 objects of 4 types`.
- **Duplicate titles:** `Schůzka` (Schůzka, Schůzka 2) and `dvojí` (F-dvojí, F-Dvojí2).
- **Created at runtime by the tests:** copies with an extra attribute in `.tegg/types/tag.yml` and Tag files holding `x-poznámka: a`; the external edits, creates and deletes named in the criteria (Výplň 01…04, `Tags/finance.md`, `Pages/Nová.md`, …); random vaults for the L2 criteria; the reference vault (`tools/gen-vault --seed 1 --small-images`) for the benchmark and the nightly crash test.
