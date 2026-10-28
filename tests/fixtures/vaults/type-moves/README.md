# Fixture `type-moves/` (slice 4E)

Synthetic vault for `docs/acceptance/type-moves.md` (FR-STO-04 AC-4…AC-14, FR-INB-02 AC-17, FR-STO-01 AC-8…AC-14, FR-HIS-04 AC-11, FR-SYN-06 AC-36, FR-FMT-07 AC-26, FR-UX-03 AC-18, NFR-OTH-02 AC-10, FR-UX-05 AC-13; the 4E-2 criteria FR-TYP-04 AC-6…AC-10, FR-TYP-05 AC-6…AC-10, FR-TYP-03 AC-14 use it too). Hand-written from the fixture tables of `type-moves.md` (D-50); no real content. Interface: `docs/contracts/ms4-jobs.md` §14 (D-803…D-818).

**Status: written, 2026-10-27,** byte-exact by a script, following D-803…D-818. Don't open and re-save these files in an editor.

The tests copy `tests/fixtures/vaults/new-empty/.tegg/` into it (the seven system types; no file names clash) next to the three type files below. This README is not a vault file and is never copied.

**Byte rules.** UTF-8 without BOM, NFC (file names and content), LF line endings, one final newline, **except**: `Knihy/Babička.md` has **CRLF** line endings and **no final newline**; `Quick Notes/Nápad.md` holds its `title` value `Nápad` in **NFD** bytes (`a` U+0301); `Knihy/seznam.docx` is not text. Git can't store NFD file names reliably, so the file is committed with an NFC name and the tests rename it to its **NFD** name (`Na` U+0301 `pad.md`) at runtime ("Nápad NFD"). Ids are `01JB4E0000000000000000E0<nn>` (26 characters, ULID alphabet); templates and Volná have none. Every note is `---\n<frontmatter>\n---\n<body>`; Jana has no body (the file ends with `---\n`). Frontmatter keys in the order `id, type, title, <attributes>, tags, review, created, modified` (keys a note lacks left out); every object has `created: 2026-09-01T09:00:00+02:00` and `modified: 2026-10-01T09:00:00+02:00`. Body blocks are separated by one blank line.

## Type files (`.tegg/types/`)

All start with the comment line `# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.`, then `version: 1`, `system: false`, `review: false`.

| File | Name, plural, folder | Icon, colour | `preview` | Attributes in order (key: type) | Used by |
| --- | --- | --- | --- | --- | --- |
| `kniha.yml` | Kniha, Knihy, `Knihy` | `book`, `blue` | `[autor, stav]` | `autor` Autor: text; `vydáno` Vydáno: date; `stav` Stav: select, options `Rozečtená` (blue), `Dočtená` (green); `hodnocení` Hodnocení: number; `související` Související: relation `to: [kniha]`, `multiple: true`; `poznámka` Poznámka: text; `isbn` ISBN: text | R101 source (FR-STO-04 AC-5, AC-6); folder save (FR-STO-01 AC-8); 4E-2 delete property (`poznámka`, `isbn`), widen-only menu (`hodnocení`) |
| `schůzka.yml` | Schůzka, Schůzky, `Schůzky` | `users`, `teal` | `[datum]` | `datum` Datum: date; `stav` Stav: select, options `Plánovaná` (gray), `Proběhla` (green); `místo` Místo: text; `účastníci` Účastníci: relation `to: [osoba]`, `multiple: true` | R101 target (FR-STO-04 AC-5, AC-6); tidy (FR-STO-01 AC-9); 4E-2 delete type |
| `osoba.yml` | Osoba, Osoby, `Osoby` | `user`, `purple` | `[]` | `e-mail` E-mail: email | FR-STO-04 AC-10 (target) |

## Templates

| Path | Content | Used by |
| --- | --- | --- |
| `_templates/Kniha/Kniha.md` | `type: kniha`, `autor:` (empty), `stav: Rozečtená`, `poznámka:` (empty); body `## Dojmy` | FR-STO-04 AC-10 (a template changing type writes only `type:`, never moves); FR-STO-01 AC-9 (never tidied); 4E-2 AP-769 |
| `_templates/Kniha/Recenze.md` | `type: kniha`, `hodnocení: 3`; body `Recenze knihy.` | the second Kniha template (4E-2 counts) |
| `_templates/Schůzka/Schůzka.md` | `type: schůzka`, `místo:` (empty); body `## Zápis` | FR-STO-01 AC-9 (never tidied); 4E-2 delete type |

## Objects

| Short | Path | id | Frontmatter (after `id, type, title`) | Body | Used by |
| --- | --- | --- | --- | --- | --- |
| Duna | `Knihy/Duna.md` | E001 | `type: kniha`; `autor: Frank Herbert`, `vydáno: 1965-08-01`, `stav: Dočtená`, `hodnocení: 5`, `související: ["[[Babička]]"]`, the comment line `# od koho`, `poznámka: Půjčená od Petra`, `nálada: dobrá` (not in the schema), `tags: [čtení]` | `Skvělá kniha.` / `## Dojmy` / `Písek.` | FR-STO-04 AC-5, AC-6, AC-11 (Kniha → Schůzka); FR-STO-01 AC-8 (moved to `Četba/`) |
| Babička | `Knihy/Babička.md` | E002 | `type: kniha`; `autor: 'Božena Němcová'` (single-quoted), `stav: Rozečtená`; **CRLF**, no final newline | `Babička a vnoučata.` | FR-STO-01 AC-8 (CRLF kept on a move); a Latin-1 copy is made at runtime (FR-STO-04 AC-12 `NotMovable`); FR-FMT-07 AC-26 seed shapes |
| Starý zápis | `Knihy/2025/Starý zápis.md` | E003 | `type: kniha`; `autor: Neznámý` | `Poznámky z loňska.` | FR-STO-04 AC-10 (› Osoba to `Osoby/` root); FR-STO-01 AC-8 (to `Četba/` root), AC-9 (never tidied: a subfolder of its type's folder) |
| Bez autora | `Knihy/Bez autora.md` | E004 | `type: kniha`; `autor:` (empty), `poznámka:` (empty) | `Bez údajů.` | FR-STO-01 AC-8; R101 empty rows; 4E-2 AP-769 |
| Kniha jinde | `Pages/Kniha jinde.md` | E005 | `type: kniha`; `autor: Karel Čapek` | `Válka s mloky.` | the Kniha stray: FR-STO-01 AC-9, AC-11, AC-12 (tidy), AC-8 (folder save); FR-STO-04 AC-10 (› Osoba) |
| Sešit (K) | `Knihy/Sešit.md` | E006 | `type: kniha` (no properties) | `Prázdný sešit.` | FR-STO-04 AC-9 (its stem is taken; never written) |
| Docx | `Knihy/seznam.docx` | — | — | bytes `50 4B 03 04` then the 60 bytes `00 01 02 … 3B` (64 bytes) | never moved (data-safety AC-6; FR-STO-01 AC-8, AC-9) |
| Článek | `Pages/Článek.md` | E007 | `type: page`; `autor: Někdo`, `poznámka: cizí` | `Cizí článek.` | same keys, other type: never touched by Kniha jobs (FR-SYN-06 AC-36) |
| Plán | `Quick Notes/Plán.md` | E008 | `type: quick-note`; `review: unreviewed` | `Viz [[Plán cesty]].` / `[Rozpis](<Plán cesty.md>)` / `[[Duna]]` / `## Cíl` / `Dojet do Brna.` | FR-STO-04 AC-4, AC-7, AC-8, AC-14 (› Kniha); FR-INB-02 AC-17 (Inbox convert) |
| Plán cesty (QN) | `Quick Notes/Plán cesty.md` | E009 | `type: quick-note` | `Trasa A.` | Plán's `[[Plán cesty]]` target (same folder first, D-291): FR-STO-04 AC-8 |
| Plán cesty (P) | `Pages/Plán cesty.md` | E010 | `type: page` | `Trasa B.` | the same stem elsewhere: FR-STO-04 AC-8 |
| Sešit (QN) | `Quick Notes/Sešit.md` | E011 | `type: quick-note` | `Sešit z rychlých poznámek.` | FR-STO-04 AC-9 (› Kniha becomes `Knihy/Sešit (2).md`) |
| Odkaz na sešit | `Quick Notes/Odkaz na sešit.md` | E012 | `type: quick-note` | `[[Sešit]]` | FR-STO-04 AC-9 (`[[Sešit (2)\|Sešit]]`) |
| Odkazy | `Pages/Odkazy.md` | E013 | `type: page`; `viz: "[[Quick Notes/Plán]]"` | `[[Plán]]` / `[[Plán#Cíl]]` / `[[Plán\|můj plán]]` / `![[Plán]]` / `[[Quick Notes/Plán]]` / `[text](../Quick%20Notes/Plán.md)` / `` `[[Quick Notes/Plán]]` `` (code span) / `[[Porada]]` / `[[Retro]]` / `[[Duna]]` (one paragraph each) | FR-STO-04 AC-7, AC-14 (the linking note); 4E-2 trashed chips |
| Porada | `Schůzky/Porada.md` | E014 | `type: schůzka`; `datum: 2026-10-20`, `místo: Brno` | `Zápis z porady.` | 4E-2 delete type and restore |
| Retro | `Schůzky/Retro.md` | E015 | `type: schůzka` | `[[Porada]]` | 4E-2 delete type (skip) |
| Schůzka jinde | `Pages/Schůzka jinde.md` | E016 | `type: schůzka` | `Mimo složku.` | the Schůzka stray: FR-STO-01 AC-9, AC-12 |
| Jana | `Osoby/Jana.md` | E017 | `type: osoba` | — | an Osoba (relation target) |
| Volná | `Volné/Volná poznámka.md` | — | no frontmatter | `Jen text bez hlavičky.` | never moved (FR-TYP-10, AP-766): FR-STO-01 AC-9 |
| Neznámý typ | `Volné/Recept.md` | E018 | `type: recept` (no definition) | `Mouka a vejce.` | never moved (D-121, AP-766): FR-STO-01 AC-9 |
| Nápad NFD | `Quick Notes/Nápad.md` (renamed to its NFD name by the tests) | E019 | `type: quick-note`; `title` in **NFD** bytes | `Nápad na víkend.` | FR-STO-04 AC-13 (written with an NFC name, `title` bytes kept) |
| Výplň ×10 | `Pages/Výplň 01.md` … `Pages/Výplň 10.md` | E031…E040 | `type: page`, `title: Výplň <nn>` | `Výplňová stránka <nn>.` | no link to any object above: untouched by every job (FR-STO-04 AC-7; FR-SYN-06 AC-36) |

No `Četba/` folder, no `.trash/` folder, no `Knihy/Plán.md`. Made at runtime by the tests: the NFD-named copy of Nápad, a Latin-1 (not UTF-8) copy of Babička, `Pages/Nová kniha.md` (FR-STO-01 AC-10), and the reference vault from `tools/gen-vault` with a type of 500 objects and 500 linking notes (FR-STO-01 AC-13, AC-14; FR-UX-07 AC-12).
