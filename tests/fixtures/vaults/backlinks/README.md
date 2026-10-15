# Fixture `backlinks/` (MS4 slice 4A)

Synthetic vault for `docs/acceptance/backlinks.md` (FR-LNK-01, -02, -04, -07, -14, FR-SYN-06 AC-9). Hand-written (D-50); no real content. **Status: description only, draft.** The files are written by the test author from this description, in their own commit, and reviewed with AP-204…AP-223.

The test copies `tests/fixtures/vaults/new-empty/.tegg/` into it (default type Quick Note; no file names clash) and adds the two type files below.

Byte rules: LF line endings, UTF-8 without BOM, NFC everywhere **except** the two places marked NFD. Write the files with a tool that keeps bytes (no editor re-save; `printf` or a small script). Git can't store NFD file names reliably, so NFD-named copies are made at runtime by the tests. All ids are `01JB4A…` (26 characters, ULID alphabet), one per file except the conflict pair. Time stamps are Europe/Prague.

## Type files (`.tegg/types/`)

| File | Content |
| --- | --- |
| `osoba.yml` | `version: 1`, name `Osoba`, plural `Osoby`, folder `Osoby`, icon `user`, colour `purple`; attributes `firma` (Text, Name `Firma`), `role` (Text, Name `Role`); `preview: [firma, role]` |
| `schůzka.yml` | `version: 1`, name `Schůzka`, plural `Schůzky`, folder `Schůzky`, icon `users`, colour `teal`; attributes in this order: `datum` (Date, `Datum`), `účastníci` (Relation, `Účastníci`, `to: [osoba]`, `multiple: true`), `téma` (Relation, `Téma`, no `to`), `poznámka` (Text, `Poznámka`); `preview: [datum, účastníci]` |

## Objects

`fm` = frontmatter keys in file order (always starting `id`, `type`, `title` unless stated). One paragraph per bullet in "Body" unless stated.

| Path | fm | Body | Used by |
| --- | --- | --- | --- |
| `Pages/Cíl.md` | `type: page`, `title: Cíl`, `aliases: [Reading list]`, `created`, `modified: 2026-10-01T09:00:00+02:00` | `## Úvod`; `Tento text odkazuje sám na sebe: [[Cíl]] a [[#Úvod]].`; `Odkaz ven: [[Jana Nováková]]` | main target; self-links excluded (AP-206) |
| `Pages/Odkazy v textu.md` | `type: page`, `title: Odkazy v textu`, `modified: 2026-10-10T09:00:00+02:00` | see "Odkazy v textu" below | FR-LNK-01 AC-4, AC-5, AC-6 |
| `Pages/Rozbité odkazy.md` | `type: page`, `title: Rozbité odkazy`, `modified: 2026-10-05T09:00:00+02:00` | see "Rozbité odkazy" below | FR-LNK-04 AC-4…AC-10 |
| `Pages/Markdown odkaz.md` | **no frontmatter** | `Markdownový odkaz [první](Cíl.md).`; `Kódovaný odkaz [druhý](C%C3%ADl.md).` | D-103, D-155 |
| `Pages/Neplatná hlavička.md` | invalid: line 3 is `title: "Neplatná` (unclosed quote); a later line `zdroj: "[[Cíl]]"` | `Text s [[Cíl]].` | NFR-REL-03; only the body link counts |
| `Quick Notes/Rychlá poznámka.md` | `type: quick-note`, `title: Rychlá poznámka`, `review: unreviewed`, `created`, `modified` | `Malými písmeny: [[cíl]].`; `V NFD: [[Cíl]]` with `Cíl` in **NFD bytes** (`C`, `i`, U+0301, `l`); `![[Cíl]]` | FR-LNK-01 AC-11, FR-LNK-02 AC-5 |
| `Daily/2026-10-07.md` | `type: daily-note`, `title: 2026-10-07`, `date: 2026-10-07` | `Dnes jsem četl [[Cíl]].` | Daily Notes group; date resolution (D-162) |
| `Schůzky/2026-10-08 Porada.md` | `type: schůzka`, `title: 2026-10-08 Porada`, `datum: 2026-10-08`, `účastníci:` block list with `- "[[Jana Nováková]]"`, `téma: "[[Cíl]]"`, `poznámka: "Připravit [[Cíl]] předem"`, `description: "Souvisí s [[Cíl]]"`, `source: "[[Cíl]]"`, `created`, `modified: 2026-10-12T09:00:00+02:00` | `Probrali jsme [[Cíl]].` | FR-LNK-02 AC-4 (five occurrences, file order) |
| `Schůzky/Starší porada.md` | `type: schůzka`, `title: Starší porada`, `účastníci:` block list `- "[[Jana Nováková]]"`, `- "[[Cíl]]"`, `created`, `modified: 2026-09-01T09:00:00+02:00` | `Zápis bez odkazů.` | multiple relation; Cíl isn't an allowed type there (still a link) |
| `Schůzky/Porada s chybou.md` | `type: schůzka`, `title: Porada s chybou`, `účastníci:` block list `- "[[Chybějící osoba]]"` | empty | broken relation; Create uses Osoba (D-243) |
| `Pages/Bez typu s vlastností.md` | `type: neznámý` (no type file), `title: Bez typu s vlastností`, `související: "[[Cíl]]"`, `modified: 2026-10-02T09:00:00+02:00` | empty | undefined-type group (D-121), raw key label |
| `Osoby/Jana Nováková.md` | `type: osoba`, `title: Jana Nováková`, `firma: Beta a.s.`, `role: Analytička` | empty | FR-LNK-02 AC-6; FR-LNK-14 AC-10 |
| `Pages/Osamělá.md` | `type: page`, `title: Osamělá` | `Na tuto stránku nic neodkazuje.` | empty state; live-update target |
| `Pages/Dvojník.md`, `Quick Notes/Dvojník.md` | `type: page` / `type: quick-note`, `title: Dvojník` / `title: Rychlý dvojník` (different titles, so they aren't duplicates, D-296) | `Stránky.` / `Rychlé.` | same stem in two folders |
| `Quick Notes/Z rychlých.md` | `type: quick-note`, `title: Z rychlých` | `[[Dvojník]]` | same-folder rule |
| `Pages/Ze stránek.md` | `type: page`, `title: Ze stránek` | `[[Dvojník]]`; `[[2026-10-07]]` | same-folder rule; date backlink |
| `Z kořene.md` (vault root) | `type: page`, `title: Z kořene` | `[[Dvojník]]`; `[[Quick Notes/Dvojník]]` | shortest-path rule (`Pages/Dvojník.md`) and path link |
| `Pages/Senior Product Manager.md` | `type: page`, `title: Senior Product Manager`, `created: 2026-09-01T10:00:00+02:00` | `První.` | FR-LNK-14 |
| `Pages/Senior Product Manager (2).md` | `type: page`, `title: Senior Product Manager`, `created: 2026-10-02T00:30:00+02:00` (22:30 UTC on 1 Oct: shows 1 Oct in Los Angeles) | `Druhá.` | time-zone edge of the created date |
| `Osoby/SPM Alfa.md` | `type: osoba`, `title: Senior Product Manager`, `firma: Alfa s.r.o.`, `role: Nábor`, `created: 2026-10-03T09:00:00+02:00` | empty | cross-type duplicate with preview values and a stem ≠ title |
| `Quick Notes/SPM velkými.md` | `type: quick-note`, `title: SENIOR PRODUCT MANAGER`, `review: unreviewed` (no `created`) | empty | case-only duplicate, missing `created` |
| `Pages/Odkaz na SPM.md` | `type: page`, `title: Odkaz na SPM` | `[[Senior Product Manager]]`; `[[Senior Product Manager (2)\|Senior Product Manager]]` (inside a paragraph, so the pipe is a plain `|`) | never by title (FR-LNK-14) |
| `Pages/Čtení.md` | `type: page`, `title: Čtení`, `created: 2026-08-01T08:00:00+02:00` | empty | duplicate key, NFC |
| `Pages/Čtení podruhé.md` | `type: page`, `title: Čtení` with the value in **NFD bytes** | empty | NFC comparison of titles |
| `Pages/Cteni.md` | `type: page`, `title: Cteni` | empty | no diacritic folding |
| `Pages/Plán.md`, `Pages/Plán (conflicted copy 2026-10-07).md` | the **same `id`**, `type: page`, `title: Plán`; bodies differ in one line | | conflict pair, not duplicates (FR-SYN-04) |
| `Quick Notes/Další rozbitý.md` | `type: quick-note`, `title: Další rozbitý` | `[[Neexistuje]]` | second source of a broken target |
| `_templates/Page/Šablona.md` | `title: Senior Product Manager` | `[[Cíl]]`; `[[Šablonový cíl]]` | templates are never sources, targets or duplicates |
| `.trash/Pages/Smazaná.md` | `type: page`, `title: Senior Product Manager` | `[[Cíl]]`; `[[Z koše]]` | trash is never a source, target or duplicate |

### Odkazy v textu (body, in this order)

1. Paragraph: `Viz [[Cíl]] a také [[Cíl|jiný text]] ve stejném odstavci.`
2. List: `- Bod s odkazem [[Cíl#Úvod]]` with one nested item `  - Vnořený bod bez odkazu`.
3. Heading: `## Nadpis s [[Cíl]]`
4. Table: header `| Sloupec | Odkaz |`, alignment `| --- | --- |`, one row `| řádek | [[Cíl\|v tabulce]] |`.
5. A paragraph of exactly 320 characters (NFC code points, Czech words, single spaces, no other links or markup) whose `[[Cíl]]` starts at character 171 (1-based), so the excerpt must be cut on both sides.
6. Paragraph with non-links only: `` `[[Cíl]]` v kódu, $[[Cíl]]$ v matematice, %%[[Cíl]]%% v komentáři. ``
7. A fenced block ```` ```text ```` containing the line `[[Cíl]]`.

Occurrences of Cíl: blocks 1–5 (5 excerpts); blocks 6 and 7 have none.

### Rozbité odkazy (body, one paragraph each, in this order)

`[[Neexistuje]]` · `Znovu [[neexistuje]] malými.` · `Kapitola: [[Neexistuje#Kapitola]]` · `S popisem: [[Neexistuje|jiný popis]]` · `[[Q3: plán?]]` · `[[Projekty/Alfa]]` · `[[Osoby/Eva Malá]]` · `[[Šablona]] a [[Smazaná]]` · `![[Chybí]]` · `![[chybí.png]]` · `[[2026-10-09]]` · `[[Cíl#Neexistující nadpis]]` · `` `[[Nikde]]` ``

Broken (10 here, plus Další rozbitý's 1 and Porada s chybou's 1 = 12 in 3 objects): the four `Neexistuje` spellings, `Q3: plán?`, `Projekty/Alfa`, `Osoby/Eva Malá`, `Šablona`, `Smazaná`, `Chybí`. Not broken: `2026-10-09` (date), `chybí.png` (attachment, MS6), `Cíl#Neexistující nadpis` (resolves to Cíl), `Nikde` (code). No folder `Projekty/` exists. No file `Neexistuje.md`, `Chybí.md`, `Q3 plán.md` or `Eva Malá.md` exists anywhere.

## Expected results (summary; the criteria are authoritative)

- Cíl's backlinks: 9 objects. Groups: Pages 4 (Odkazy v textu, Rozbité odkazy, Markdown odkaz, Neplatná hlavička), Quick Notes 1, Daily Notes 1, Schůzky 2 (Porada, Starší porada), neznámý 1.
- Jana's backlinks: 3 (Cíl; Porada, Starší porada).
- Duplicate titles: `Senior Product Manager` 4, `Čtení` 2.
- Broken links: 12 occurrences in 3 objects; groups `Neexistuje` 5 and seven groups of 1.
