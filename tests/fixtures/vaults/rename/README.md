# Fixture `rename/` (MS4 slice 4C)

Synthetic vault for `docs/acceptance/rename.md` (FR-FMT-08 AC-5…AC-10, FR-LNK-03 AC-7…AC-20, FR-HIS-04 AC-4, AC-5, FR-UX-07 AC-8…AC-11, FR-SYN-06 AC-10, AC-11, and the links.md FR-FMT-08 / FR-LNK-03 AC-1…AC-6 this slice verifies). Hand-written from the fixture table of `rename.md` (D-50); no real content. Interface: `docs/contracts/ms4-jobs.md`.

The tests copy `tests/fixtures/vaults/new-empty/.tegg/` into it (default type Quick Note; no file names clash) next to the one type file below. This README is not a vault file and is never copied.

**Byte rules.** UTF-8 without BOM, NFC everywhere, LF line endings, one final newline, **except**: `Pages/NFD odkaz.md` holds `Čaj o páté` in **NFD bytes** in its link (`C` U+030C, `a` U+0301, `e` U+0301); `Pages/Windows.md` has **CRLF** line endings and **no final newline**. Don't open and re-save these files in an editor; they were written by a script. All ids are `01JB4C0000000000000000R<nnn>` (26 characters, ULID alphabet); the template has no frontmatter. Time stamps are Europe/Prague.

Every note except the template is `---\n<frontmatter>\n---\n<body>`, with frontmatter keys in the order `id, type, title, <attributes>, created, modified` (`created: 2026-10-01T08:00:00+02:00`, `modified: 2026-10-01T09:00:00+02:00` unless stated).

## Type file (`.tegg/types/`)

| File | Content |
| --- | --- |
| `book.yml` | `version: 1`, name `Book`, plural `Books`, folder `Books`, icon `book`, colour `orange`; attributes `autor` (Relation, `Autor`), `zdroje` (Relation, `Zdroje`, `multiple: true`), `poznámka` (Text, `Poznámka`); `preview: [autor]` |

## Objects

| Short name | Path | Content | Used by |
| --- | --- | --- | --- |
| Alfa | `Pages/Alfa.md` | `id …R001`, `type: page`, `title: Alfa`; body `## Úvod`, a paragraph ending in block id `^b1`, and the self-link paragraph `Odkaz sám na sebe: [[Alfa#Úvod]]` | the note renamed in most criteria; FR-SYN-06 AC-11 (self-link in the same write) |
| Odkazy | `Pages/Odkazy.md` | `…R002`, `title: Odkazy`; body: one paragraph per line, separated by blank lines, in this order: `[[Alfa]]`, `[[Alfa\|vlastní text]]`, `[[Alfa#Úvod]]`, `[[Alfa#^b1]]`, `![[Alfa]]`, `![[Alfa#Úvod]]`, `[[Pages/Alfa]]`, `[[Alfa.md]]`, `[Alfa](Alfa.md)`, `[jinak](../Pages/Alfa.md)`, then the near misses `[[Alfabet]]`, `[[Alfa (2)]]`, `#Alfa` (a tag), `Alfa` (plain text) | FR-LNK-03 AC-7, AC-9, AC-13…AC-16; FR-UX-07 AC-8 counts |
| Kód | `Pages/Kód.md` | `…R003`, `title: Kód`; `[[Alfa]]` only in a code span, a ```` ```text ```` fence and an indented block | links.md AC-3; FR-LNK-03 AC-12; FR-SYN-06 AC-10 |
| Vlastnosti | `Books/Vlastnosti.md` | `…R004`, `type: book`, `title: Vlastnosti`, `autor: "[[Alfa]]"`, `zdroje: ["[[Alfa]]", "[[Beta]]"]` (flow list), `poznámka: viz [[Alfa]]` (plain scalar), `x-extra: [[Alfa]]` (unknown key, unquoted as in the AC), then `created`, `modified`; body `Kniha s odkazy jen ve vlastnostech.` | FR-LNK-03 AC-8 |
| NFD odkaz | `Pages/NFD odkaz.md` | `…R005`, `title: NFD odkaz`; body `Odkaz v NFD: [[Čaj o páté]]` with the target in **NFD bytes**; otherwise ASCII | FR-LNK-03 AC-11 |
| Čaj o páté | `Pages/Čaj o páté.md` | `…R006`, NFC file name, `title: Čaj o páté` | FR-LNK-03 AC-11 |
| Výplň ×40 | `Pages/Výplň 01.md` … `Pages/Výplň 40.md` | `…R101` … `…R140`, `title: Výplň <nn>`, body `Výplňová stránka číslo <nn> bez odkazu.`; no link anywhere | FR-LNK-03 AC-13 (untouched), FR-SYN-06 AC-3 |
| Dvojník | `Pages/Alfa (2).md` | `…R007`, `title: Alfa` (duplicate title, D-290) | FR-LNK-03 AC-10; near miss `[[Alfa (2)]]` |
| Jinde | `Projekty/Alfa.md` | `…R008`, `type: page`, `title: Alfa`, outside `Pages/` | FR-LNK-03 AC-10 |
| Místní | `Projekty/Místní.md` | `…R009`, `title: Místní`; body `Místní odkaz: [[Alfa]]` (resolves to `Projekty/Alfa.md`, same-folder rule, D-291) | FR-LNK-03 AC-10 |
| Šablona | `_templates/Page/Page.md` | no frontmatter; body `Nová stránka. Viz [[Alfa]].` | FR-LNK-03 AC-12 (rewritten, D-391); FR-FMT-08 AC-9 |
| Koš | `.trash/Pages/Starý.md` | `…R010`, `title: Starý`; body `Smazaný odkaz: [[Alfa]]` | FR-LNK-03 AC-12 (never touched); FR-FMT-08 AC-9 |
| Den | `Daily/2026-10-14.md` | `…R011`, `type: daily-note`, `title: 2026-10-14`, `date: 2026-10-14`, `created: 2026-10-14T08:00:00+02:00`, `modified: 2026-10-14T09:00:00+02:00`; body `Dnes jsem upravil [[Alfa]].` | FR-LNK-03 AC-12; FR-FMT-08 AC-9 (title read-only) |
| CRLF | `Pages/Windows.md` | `…R012`, `title: Windows`; **CRLF**, body `Řádky s CRLF.`, blank line, `Odkaz: [[Alfa]]` with **no final newline** | FR-LNK-03 AC-11 |
| Beta | `Pages/Beta.md` | `…R013`, `title: Beta`; body `Cíl kolizí.` | target of the collision cases (FR-FMT-08 AC-10 style, FR-LNK-03 AC-19) |

## Expected results (summary; the criteria are authoritative)

- Renaming Alfa → `Gama` (FR-LNK-03 AC-7, AC-13): the changed paths are exactly `Pages/Alfa.md` (gone) and `Pages/Gama.md` (new, same `id`, `title: Gama`, self-link `[[Gama#Úvod]]`), `Pages/Odkazy.md`, `Books/Vlastnosti.md`, `Daily/2026-10-14.md`, `_templates/Page/Page.md`, `Pages/Windows.md`. Untouched: Kód, the 40 Výplň files, Dvojník, `Projekty/*`, NFD odkaz, Čaj o páté, Beta, the trashed note, `.tegg/`.
- `[[Alfa]]` in `Projekty/Místní.md` resolves to `Projekty/Alfa.md`; renaming `Projekty/Alfa.md` rewrites only that link (FR-LNK-03 AC-10).
- Created at runtime by the tests: the generated 5,000-note vault (`tools/gen-vault --seed 1 --small-images`), random vaults of the property test, a 500-backlink hub note, NFD-named copies, external edits named in the criteria.
