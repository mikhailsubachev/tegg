# Fixture `pinned/` (v1.0 slice PIN, Pinned items in the left sidebar)

Synthetic vault for `docs/acceptance/pinned.md` (FR-HOM-02 AC-1…AC-26, FR-NAV-04 AC-9, AC-10, FR-LNK-03 AC-22, FR-SYN-02 AC-9, FR-SYN-03 AC-26, AC-27, FR-SYN-06 AC-43, FR-FMT-07 AC-28, FR-FMT-12 AC-8, NFR-POR-01 AC-4, FR-STO-06 AC-2, FR-UX-03 AC-39, AC-40, FR-UX-08 AC-16, AC-17, FR-UX-05 AC-19, NFR-OTH-02 AC-16) and the contract `docs/contracts/v1-pinned.md`. Hand-written (D-50); no real content. Decisions: D-1370…D-1391.

**How tests use it.** Each test copies this folder (without this README) into a temporary directory, then copies `tests/fixtures/vaults/new-empty/.tegg/` into it (no file names clash: this folder's `.tegg/` holds only `types/projekt.yml` and `types/schůzka.yml`). The vault has **no** `.tegg/pinned.yml`; a test that needs one copies a file of `tests/fixtures/pinned-files/` to `.tegg/pinned.yml` before the app opens the vault ("with `valid`" means `pinned-files/valid.yml`, and so on). In the fake core (L5) `_attachments/graf.png` is a binary file (`bin`), not text.

**Byte rules.** LF, UTF-8 without BOM, every file ends with one `\n`, NFC everywhere. Don't open and re-save these files in an editor.

**NFD file name made at runtime.** pinned.md asks for Čajovna's file name in NFD. Git (`core.precomposeunicode`) can't keep an NFD name, so the file is committed as `Pages/Čajovna.md` in NFC, and every test renames it in its temporary copy to the NFD name (`'Pages/Čajovna.md'.normalize('NFD')`, the `shell/` fixture's way). Its `title: Čajovna` stays NFC. In the fake core (L5), whose paths are NFC, the NFD case is the fake's own name-normalization rule.

## Objects

Key order: `id, type, title, <attributes>, tags, created, modified`; `created` and `modified` are `2026-10-01T09:00:00+02:00`. Ids are `01JB5P000000000000000000nn`.

| Short | Path | id `nn` | Type, content | Used by |
| --- | --- | --- | --- | --- |
| Rozpočet | `Projekty/Rozpočet 2027.md` | 01 | projekt; `tags: [účty]`; body `Plán výdajů.` | AC-1…AC-5, AC-7, AC-16, FR-LNK-03 AC-22, every write |
| Lisabon | `Projekty/Výjezd Lisabon 2026.md` | 02 | projekt; `tags: [offsite]`; body `Cesta týmu do Lisabonu.` | AC-9…AC-11, AC-17, AC-18, FR-SYN-02 AC-9 |
| Porada | `Schůzky/2026-10-07 Týdenní porada.md` | 03 | schůzka; body `Zápis z porady.` | AC-2, AC-8, AC-17, AC-18 |
| Čajovna | `Pages/Čajovna.md` (NFD at runtime, above) | 04 | page; body `Čaj a klid.` | AC-6, AC-7, AC-12, AC-14, AC-24, FR-FMT-12 AC-8 |
| Úkol | `Tasks/Poslat návrh rozpočtu.md` | 05 | task, `status: To do`, `due: 2026-11-09` (on the Kanban and the Schedule of the test clock's week); body `Do pondělí.` | AC-6, AC-12 |
| Den | `Daily/2026-10-07.md` | 06 | daily-note, `date: 2026-10-07`; body `Den porady.` | AC-3, AC-19 |
| Graf | `Images/Graf.md` | 07 | image, `file: "[[graf.png]]"`; `_attachments/graf.png` is a 1 × 1 PNG (69 bytes) | AC-3, AC-19 |
| Koš | `.trash/Pages/Starý plán.md` | 08 | page, in the trash (D-102); body `Zahozený plán.` | AC-16 (`stale`), FR-UX-08 AC-16 |
| Odkazy | `Pages/Odkazy.md` | 09 | page; body, one per line: `[[Rozpočet 2027]]`, `[[Čajovna]]`, `[[Plán (2)]]`, `Štítek #offsite.`, `[[Neexistuje]]` (broken) | AC-12, AC-13 (Backlinks entry of Rozpočet; chips) |
| Plán | `Pages/Plán.md` | 10 | page, `title: Plán`; body `První plán.` | AC-4, AC-16 (`stale`: its path is held by another id) |
| Plán 2 | `Pages/Plán (2).md` | 11 | page, `title: Plán` (duplicate title, FR-LNK-14); body `Druhý plán.` | AC-4, AC-13 |
| Štítek | `Tags/Offsite.md` | 12 | tag, `title: offsite`, `color: teal` | AC-2, AC-21 |
| Bez hlavičky | `Pages/Bez hlavičky.md` | — | **no frontmatter** (no `id`, AP-4); body `Jen text.` | AC-5, AC-16, FR-LNK-03 AC-22 |
| Výplň ×10 | `Pages/Výplň 01.md` … `Výplň 10.md` | 20…29 | page, `title: Výplň nn`; body `Výplň číslo n.`; never pinned, must stay untouched | FR-SYN-06 AC-43, AC-8 |

## Types

`.tegg/types/projekt.yml` (Projekt / Projekty, folder `Projekty`, `icon: folder`, `color: orange`, no attributes) and `.tegg/types/schůzka.yml` (Schůzka / Schůzky, folder `Schůzky`, `icon: users`, `color: teal`, no attributes); the system types come from `new-empty/.tegg/types/`.

Tags: `účty` is a **virtual** tag (Rozpočet's `tags:`, no Tag file); `offsite` has the Tag file Štítek (teal) and occurs on Lisabon and in Odkazy's body. `zrušený` and the type `kniha` exist nowhere (the `stale` sample).

## Expected rows

| Pins file | Rows (label · state · R133 description) |
| --- | --- |
| `valid` | `Rozpočet 2027` · ok · Projekt; `Výjezd Lisabon 2026` · ok · Projekt; `2026-10-07 Týdenní porada` · ok · Schůzka; `#offsite` · ok · Tag; `Projekty` · ok · Type page (count 5; the `query:` item isn't drawn) |
| `stale` | `Rozpočet 2027` · ok (by `id`, stale path); `Bez hlavičky` · ok (by path); `Starý plán` · trashed; `Smazaný` · missing; `Plán` · missing (`…ZY`'s path is held by Plán, id 10: never adopted); `#zrušený` · no objects; `kniha` · missing |
| `entries` | `Rozpočet 2027`, `#offsite`, `Schůzky` (count 3) |
| `nfd` | as `valid` |
| `newer-version` | as `valid`, read-only |
| `invalid-yaml` | none; the notice `The pins file can't be read (line 5).` |

## Made at runtime by the tests (never committed)

- Čajovna's NFD file name (above).
- The runtime variants of FR-HOM-02 AC-22: `valid.yml` with `version: 0`, `version: "1"`, `version: 1.5`; with the byte `0xFF` in line 5's path (invalid UTF-8); a top-level list (`- tag: offsite`); `pins: offsite` (not a list).
- `valid.yml` without its `version` line (FR-HOM-02 AC-23); `valid.yml` plus `  - tag: účty` as line 13 (FR-HOM-02 AC-21).
- The sync conflict copies `.tegg/pinned (conflicted copy 2026-11-07).yml` and `.tegg/pinned 2.yml`, each `valid.yml` plus `  - tag: účty` (FR-SYN-03 AC-27).
- External edits, renames, deletes and re-creates named in the criteria: by the helper process (L6), the fake core (L5) or plain file writes (L4).
- Random pins files for the L2 criteria; the 200-pin file on the generated 5,000-note vault (FR-HOM-02 AC-25).
