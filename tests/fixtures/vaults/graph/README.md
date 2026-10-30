# Fixture `graph/` (v1.0 slice G1, local graph core and full view)

Synthetic vault for `docs/acceptance/graph.md` (FR-GRP-01, -02 without presets, -03, -05…08, FR-TAG-05 AC-9, NFR-PERF-11, FR-SYN-06 AC-38). Hand-written (D-50); no real content. **Status: approved, 2026-10-29** with the criteria (D-970…D-993 → D-970…D-993, AP-n → D-(n+143)). The graph never writes, so the criteria also check that every file keeps its bytes, mtime and inode.

The tests copy `tests/fixtures/vaults/new-empty/.tegg/` into it (default type Quick Note; no file names clash) next to the four type files below. This README is not a vault file and is never copied.

**Byte rules.** LF line endings, UTF-8 without BOM, every file ends with exactly one `\n`, NFC everywhere (file names and content). Ids are `01JBGR0000000000000000R0nn` (26 characters, ULID alphabet), one per file; `R009` is unused (Bez hlavičky has no frontmatter) and the template has no `id`. Time stamps are Europe/Prague (`+02:00`, all before 25 October 2026). Don't open and re-save these files in an editor. Git can't store NFD names reliably, so NFD copies are made at runtime.

## Type files (`.tegg/types/`)

| File | Type | Attributes | Preview |
| --- | --- | --- | --- |
| `projekt.yml` | Projekt / Projekty, folder `Projekty`, icon `folder`, orange | `vlastník` Relation to `osoba`; `podklady` Relation (any type); `termín` Date; `poznámka` Text | `[vlastník, termín]` |
| `osoba.yml` | Osoba / Osoby, folder `Osoby`, icon `user`, purple | `firma` Text | `[firma]` |
| `schůzka.yml` | Schůzka / Schůzky, folder `Schůzky`, icon `users`, teal | `datum` Date; `účastníci` Relation to `osoba`, multiple; `projekt` Relation to `projekt` | `[datum, účastníci]` |
| `cesta.yml` | Cesta / Cesty, folder `Cesty`, icon `plane`, yellow | none | `[]`; **no objects** (a type with count 0 in the filter, D-977) |

System types come from `new-empty` (Page `file-text` gray, Task `check-square` blue, Quick Note `zap` yellow, Daily Note `calendar` purple, Tag `hash` green, Image `image` teal, PDF `file` red). `recept` (on Recept) has no definition (D-121).

## Objects

`→` lists what the file itself refers to; the edges below combine both directions.

| Short | Path | id | Type | Holds (→) |
| --- | --- | --- | --- | --- |
| Plán | `Pages/Plán čtvrtletí.md` | R001 | page, `tags: [účty]` | link → Rozpočet; links `[[Zápis z porady#Závěry]]`, `[[Zápis z porady#^klic]]` → Zápis; embed `![[Shrnutí]]`; attachment embed `![[graf.png]]` → Graf; embed `![[Zaplatit fakturu]]` → Úkol; date link `[[2026-10-07]]` → Den; `[[2026-10-30]]` (no Daily Note); unresolved `[[Neexistující poznámka]]`; self-link `[[Plán čtvrtletí]]`; inline `#nápad` (virtual) |
| Rozpočet | `Projekty/Rozpočet 2027.md` | R002 | projekt, `tags: [účty, finance]` | `vlastník` → Jana; `podklady` → Plán; `termín: 2026-12-31` (plain date); `poznámka: "Viz [[Výdaje 2026]]"` (a link in a Text value, D-971) |
| Zápis | `Schůzky/Zápis z porady.md` | R003 | schůzka | `datum: 2026-10-07` (plain date, D-972); `účastníci` → Jana, Petr; `projekt` → Rozpočet; body `## Závěry`, a paragraph with ` ^klic`, embed `![[Rozpočet 2027]]`, attachment embed `![[Smlouva.pdf]]` → Smlouva, inline `#cestování` |
| Jana | `Osoby/Jana Nováková.md` | R004 | osoba, `firma: Alfa s.r.o.` | link → Beta |
| Petr | `Osoby/Petr Dvořák.md` | R005 | osoba, `firma: Beta a.s.`, `tags: [zdraví]` | — |
| Beta | `Projekty/Projekt Beta.md` | R006 | projekt | `vlastník` → Jana |
| Shrnutí | `Pages/Shrnutí.md` | R007 | page, `tags: [archiv]` | link → Plán |
| Výdaje | `Pages/Výdaje 2026.md` | R008 | page | — |
| Bez hlavičky | `Pages/Bez hlavičky.md` | — | no frontmatter (Page, D-103) | link → Shrnutí |
| Úkol | `Tasks/Zaplatit fakturu.md` | R010 | task, To do | `source: "[[Plán čtvrtletí]]"` (reserved key, D-971) |
| Den | `Daily/2026-10-07.md` | R011 | daily-note, `date: 2026-10-07` | link → Nákup |
| Nákup | `Pages/Nákupní seznam.md` | R012 | page | — |
| Graf | `Images/Graf výdajů.md` | R013 | image, `file: "[[graf.png]]"` (itself: no edge), 64 × 48 | — |
| Smlouva | `PDFs/Smlouva.md` | R014 | pdf, `file: "[[Smlouva.pdf]]"`, 2 pages | — |
| Faktury | `Pages/Faktury.md` | R015 | page, `tags: [účty]` | link `[[Účty]]` → the Tag file of `účty` |
| Výlet | `Quick Notes/Nápad na výlet.md` | R016 | quick-note, `review: unreviewed` | link → Petr; inline `#nápad` |
| Recept | `Pages/Recept na koláč.md` | R017 | `recept` (no definition) | link → Plán |
| Osamělá | `Pages/Osamělá.md` | R018 | page | self-link, unresolved `[[Nikde]]`, `[[2026-10-30]]`: **no edges** |
| Chybná | `Pages/Chybná hlavička.md` | R024 | invalid YAML (unclosed quote on line 3): Page, title = stem (D-103) | link → Shrnutí |
| #Účty | `Tags/Účty.md` | R019 | tag, `color: blue` | — |
| #Finance | `Tags/Finance.md` | R020 | tag, `color: orange` | — |
| #Zdraví | `Tags/Zdraví.md` | R021 | tag, `color: green` | — |
| #Archiv | `Tags/Archiv.md` | R022 | tag, no `color` (`None`) | — |
| #Cestování | `Tags/Cestování.md` | R023 | tag, `color: magenta` (unknown → neutral, D-707) | — |
| #nápad | — | — | virtual tag (no Tag file, D-694) | — |
| Šablona | `_templates/Page/Šablona.md` | — | template (`tags: [účty]`) | links → Plán, Osamělá: **never counted** (FR-TPL-07) |
| Smazaná | `.trash/Pages/Smazaná.md` | R025 | trashed (`tags: [účty]`) | links → Plán, Osamělá, embed → Shrnutí: **never counted** (D-102) |

## Edges (with every type and kind visible)

| # | Pair | Kinds and direction | Style (D-902) |
| --- | --- | --- | --- |
| E1 | Plán – Rozpočet | link Plán→Rozpočet; relation Rozpočet→Plán (`podklady`) | relation |
| E2 | Plán – Zápis | link Plán→Zápis (`#Závěry` and `#^klic`, one kind) | link |
| E3 | Plán – Shrnutí | embed Plán→Shrnutí; link Shrnutí→Plán | embed |
| E4 | Plán – Graf | embed Plán→Graf (`![[graf.png]]`) | embed |
| E5 | Plán – Úkol | embed Plán→Úkol; relation Úkol→Plán (`source`, D-971) | embed |
| E6 | Plán – Den | link Plán→Den (date mention) | link |
| E7 | Plán – #účty | tag | tag |
| E8 | Plán – #nápad | tag | tag |
| E9 | Recept – Plán | link Recept→Plán | link |
| E10 | Rozpočet – Jana | relation Rozpočet→Jana (`vlastník`) | relation |
| E11 | Rozpočet – Výdaje | relation Rozpočet→Výdaje (`poznámka`, D-971; a link under the alternative) | relation |
| E12 | Rozpočet – #účty | tag | tag |
| E13 | Rozpočet – #finance | tag | tag |
| E14 | Zápis – Jana | relation Zápis→Jana (`účastníci`) | relation |
| E15 | Zápis – Petr | relation Zápis→Petr (`účastníci`) | relation |
| E16 | Zápis – Rozpočet | relation Zápis→Rozpočet (`projekt`); embed Zápis→Rozpočet | embed |
| E17 | Zápis – Smlouva | embed Zápis→Smlouva (`![[Smlouva.pdf]]`) | embed |
| E18 | Zápis – #cestování | tag | tag |
| E19 | Jana – Beta | link Jana→Beta; relation Beta→Jana (`vlastník`) | relation |
| E20 | Petr – #zdraví | tag | tag |
| E21 | Shrnutí – #archiv | tag | tag |
| E22 | Bez hlavičky – Shrnutí | link Bez hlavičky→Shrnutí | link |
| E23 | Den – Nákup | link Den→Nákup | link |
| E24 | Faktury – #účty | tag; link Faktury→Účty (`[[Účty]]`) | link |
| E25 | Výlet – Petr | link Výlet→Petr | link |
| E26 | Výlet – #nápad | tag | tag |
| E27 | Chybná – Shrnutí | link Chybná→Shrnutí | link |

27 edges in the vault. Not edges: Zápis's `datum` (D-972), the `[[2026-10-30]]` links, `[[Neexistující poznámka]]`, `[[Nikde]]`, self-links, Graf's and Smlouva's `file:`, everything in Šablona and Smazaná.

**Vault-wide degree** (distinct neighbours, D-975; sum 54 = 2 × 27): Plán 9; Rozpočet 6; Zápis 6; Shrnutí 4; Jana 3; Petr 3; `#účty` 3; Den 2; Výlet 2; `#nápad` 2; Beta, Výdaje, Bez hlavičky, Chybná, Úkol, Nákup, Graf, Smlouva, Faktury, Recept, `#finance`, `#zdraví`, `#archiv`, `#cestování` 1; Osamělá 0. Size steps (D-975): Plán, Rozpočet, Zápis `medium`; all others `small`.

## Expected walks (every type and kind visible)

Nodes include the centre. Tag nodes and Daily Notes are leaves (D-903); the centre is walked whatever its type (D-974).

| Centre | Depth 1 | Depth 2 | Depth 3 |
| --- | --- | --- | --- |
| Plán | **10 nodes, 11 edges** (E1–E9, E12, E16): Rozpočet, Zápis, Shrnutí, Graf, Úkol, Den, #účty, #nápad, Recept | **19 nodes, 21 edges** (+ Jana, Výdaje, #finance, Petr, Smlouva, #cestování, #archiv, Bez hlavičky, Chybná; + E10, E11, E13, E14, E15, E17, E18, E21, E22, E27) | **22 nodes, 25 edges** (+ Beta, #zdraví, Výlet; + E19, E20, E25, E26). Never reached: Nákup (only through Den), Faktury (only through #účty), Osamělá |
| #účty (`Tags/Účty.md`) | 4 nodes, 4 edges (E1, E7, E12, E24): Plán, Rozpočet, Faktury | 14 nodes, 16 edges (+ Zápis, Shrnutí, Graf, Úkol, Den, #nápad, Recept, Jana, Výdaje, #finance; edges E1–E14, E16, E24) | — |
| Den | 3 nodes, 2 edges (E6, E23): Plán, Nákup | 11 nodes, 12 edges (+ Rozpočet, Zápis, Shrnutí, Graf, Úkol, #účty, #nápad, Recept; E1–E9, E12, E16, E23) | — |
| Faktury | 2 nodes (#účty), 1 edge (E24, style link) | 2 nodes, 1 edge (#účty is a leaf) | 2 nodes |
| Graf | 2 nodes (Plán), 1 edge (E4) | — | — |
| Jana | 4 nodes, 4 edges (E10, E14, E16, E19): Rozpočet, Zápis, Beta | — | — |
| Rozpočet | 7 nodes (Plán, Jana, Výdaje, #účty, #finance, Zápis) | — | — |
| Výlet | 3 nodes, 2 edges (E25, E26): Petr, #nápad | 5 nodes, 4 edges (+ Zápis, #zdraví; + E15, E20) | — |
| Osamělá | 1 node, 0 edges: **No links yet** | 1 | 1 |

**Depth of each node from Plán:** 1: Rozpočet, Zápis, Shrnutí, Graf, Úkol, Den, #účty, #nápad, Recept; 2: Jana, Výdaje, #finance, Petr, Smlouva, #cestování, #archiv, Bez hlavičky, Chybná; 3: Beta, #zdraví, Výlet.

**Type counts from Plán** (legend, unfiltered, centre included; order of D-977: Pages, Tasks, Quick Notes, Daily Notes, Cesty, Osoby, Projekty, Schůzky, Images, PDFs, Tags, recept):

| Depth | Counts | Sum |
| --- | --- | --- |
| 1 | 2, 1, 0, 1, 0, 0, 1, 1, 1, 0, 2, 1 | 10 |
| 2 | 5, 1, 0, 1, 0, 2, 1, 1, 1, 1, 5, 1 | 19 |
| 3 | 5, 1, 1, 1, 0, 2, 2, 1, 1, 1, 6, 1 | 22 |

## Filter scenarios from Plán (D-904; `hidden` per D-976)

| # | Filter | Depth | Drawn | Edges | Hidden |
| --- | --- | --- | --- | --- | --- |
| a | Tags type off | 1 | 8: Plán, Rozpočet, Zápis, Shrnutí, Graf, Úkol, Den, Recept | 8 (E1–E6, E9, E16) | 2 |
| b | Tags type off | 2 | 14: (a) + Jana, Výdaje, Petr, Smlouva, Bez hlavičky, Chybná | 15 (E1–E6, E9, E10, E11, E14, E15, E16, E17, E22, E27) | 5 |
| c | Projekty off | 2 | 16: Plán, Zápis, Shrnutí, Graf, Úkol, Den, #účty, #nápad, Recept, Jana, Petr, Smlouva, #cestování, #archiv, Bez hlavičky, Chybná (Výdaje and #finance are cut off behind Rozpočet) | 15 (E2–E9, E14, E15, E17, E18, E21, E22, E27) | 3 |
| d | `Relations` off | 2 | 16: Plán, Rozpočet, Zápis, Shrnutí, Graf, Úkol, Den, #účty, #nápad, Recept, #finance, Smlouva, #cestování, #archiv, Bez hlavičky, Chybná | 17 (E1 as link, E2–E4, E5 as embed, E6–E9, E12, E13, E16 as embed, E17, E18, E21, E22, E27) | 3 (Jana, Petr, Výdaje) |
| e | `Tags` kind off | 1 | 8: as (a) | 8 | 2 |
| f | `Links` kind off | 1 | 7: Plán, Rozpočet, Shrnutí, Graf, Úkol, #účty, #nápad | 7 (E1 as relation, E3 as embed, E4, E5, E7, E8, E12) | 3 (Zápis, Den, Recept) |
| g | Pages off | 1 | 9: all of depth 1 but Shrnutí (Plán stays: the centre is always drawn) | 10 (E1, E2, E4–E9, E12, E16) | 1 |
| h | Types `None` | 1 / 2 | 1: Plán | 0 | 9 / 18 |

(Historical: the rejected alternatives of D-971 and D-973 would have drawn Výdaje in scenario d, or dropped E1 there.)

## Hub (generated at runtime, never committed)

The cap criteria (FR-GRP-01 AC-9, AC-15…AC-18, FR-GRP-07 AC-2, NFR-PERF-11 AC-2, FR-SYN-06 AC-38) need more than 150 nodes. Following the previews fixture's `Pages/Dlouhá.md`, the tests that need it write these 1,362 files into the temporary copy before indexing; the rest of the fixture doesn't link to them, so no other count changes. Every file is

```
---
id: 01JBGR000000000000000H<nnnn>
type: page
title: <title>
created: 2026-10-01T09:00:00+02:00
modified: 2026-10-01T09:00:00+02:00
---
<body>
```

(LF, NFC, one final newline; `<nnnn>` four digits; `NN` = `01`…`40`, `x` = `a`, `b`, `c`, `MM` = `01`…`15`; links in a body are separated by one space):

| File | `<nnnn>` | Title | Body |
| --- | --- | --- | --- |
| `Pages/Hub/Rozcestník.md` | 0001 | `Rozcestník` | `[[Paprsek 01]] … [[Paprsek 40]]` (40 links) |
| `Pages/Hub/Paprsek NN.md` | 0001 + NN (0002…0041) | `Paprsek NN` | `[[Uzel NN-a]] [[Uzel NN-b]] [[Uzel NN-c]]` |
| `Pages/Hub/Uzel NN-x.md` | 0041 + 3·(NN−1) + {a: 1, b: 2, c: 3} (0042…0161) | `Uzel NN-x` | a, b: `[[List NN-x-01]] … [[List NN-x-15]]`; c: `Konec.` |
| `Pages/Hub/List NN-x-MM.md` (x = a, b) | 0161 + 15·(2·(NN−1) + {a: 0, b: 1}) + MM (0162…1361) | `List NN-x-MM` | `List.` |
| `Pages/Hub/Široký rozcestník.md` | 1362 | `Široký rozcestník` | for NN = 01…40: `[[List NN-a-01]] [[List NN-a-02]] [[List NN-b-01]] [[List NN-b-02]]` (160 links) |

**Degrees:** Rozcestník 40; Paprsek 4; Uzel NN-a / NN-b 16; Uzel NN-c 1; List NN-a-01, -a-02, -b-01, -b-02 2 (Uzel and Široký); other Lists 1; Široký 160.

**Expected (R111, D-978):**

| Centre | Depth | Total | Drawn | Edges drawn | Notes |
| --- | --- | --- | --- | --- | --- |
| Rozcestník | 1 | 41 | 41 | 40 | labels shown (≤ 60) |
| Rozcestník | 2 | 161 | 150: centre, 40 Paprsek, 80 Uzel a/b, Uzel 01-c…29-c | 149 | dropped: Uzel 30-c…40-c (11); `Show all` → 161 nodes, 160 edges |
| Rozcestník | 3 | 1,361 | 150 (the same set as depth 2) | 149 | above 1,000: no `Show all`; `Depth 2 · 161` |
| Široký | 1 | 161 | 161 (depth 1 is never cut) | 160 | no banner, labels hidden |
| Široký | 2 | 241 (+ 80 Uzel a/b) | 161 | 160 | banner, `Depth 1 · 161`, `Show all` → 241 |
| Paprsek 01 | 1 | 5 | 5: Rozcestník (large), Uzel 01-a, 01-b (medium), Uzel 01-c (small) | 4 | size steps |
| List 01-a-01 | 1 | 3 | 3: Uzel 01-a (medium), Široký (large) | 2 | size steps |

Široký is at depth 4 from Rozcestník, so it is never in Rozcestník's results.

## Panel (G2, `docs/acceptance/graph-panel.md`)

No new file: the panel uses the objects, edges, filter scenarios and hub above. Its own expectations (cap 60, R116;
the lower depth is the deepest one whose total is ≤ 60, D-1033; totals include the centre):

| Centre | Totals at depth 1 / 2 / 3 | Panel shows |
| --- | --- | --- |
| Plán | 10 / 19 / 22 | the graph at every depth (labels shown) |
| Rozcestník | 41 / 161 / 1,361 | depth 1: 41 nodes, 40 edges; depth 2 and 3: Too many, `Depth 1 · 41` |
| Uzel 01-a | 17 / 21 / 231 | depth 1: 17 nodes (Paprsek 01, List 01-a-01…15); depth 2: 21 nodes, 21 edges (+ Rozcestník, Uzel 01-b, Uzel 01-c, Široký); depth 3: Too many, `Depth 2 · 21` |
| Paprsek 01 | 5 / 74 / 192 | depth 1: 5 nodes; depth 2 (+ Paprsek 02…40, List 01-a-*, List 01-b-*): Too many, `Depth 1 · 5`; depth 3 (+ Uzel 02…40-a/b/c, Široký): Too many, `Depth 1 · 5` |
| Široký | 161 / 241 / — | depth 1: Too many, no lower depth, only `Open full view` |

Uzel 01-a at depth 3: 39 Paprsek (through Rozcestník) + 15 List 01-b-* (through Uzel 01-b) + 158 Lists through Široký
(160 minus List 01-a-01, -02), of which List 01-b-01, -02 are already counted: 21 + 39 + 15 + 156 = 231.

## Created at runtime by the tests (never committed)

- `_attachments/graf.png`: a copy of `tests/fixtures/vaults/trash-media/_attachments/záhon.png` (64 × 48 PNG, 1,234 bytes); `_attachments/Smlouva.pdf`: a copy of `tests/fixtures/vaults/trash-media/_attachments/Rozpočet.pdf` (2 pages, 844 bytes), so Graf's and Smlouva's metadata are true and their previews show the files.
- The hub above.
- `Pages/NFD odkaz.md` (id `01JBGR0000000000000000R030`, page) whose body is `[[Plán čtvrtletí]]` in **NFD** bytes; `Pages/Shrnutí.md` renamed to its NFD name (APFS keeps one file; FR-GRP-01 AC-26).
- A file with invalid UTF-8 bytes linking `[[Shrnutí]]` (FR-GRP-01 AC-25); `Tags/Účty (2).md` (`title: účty`, `created: 2026-10-15T09:00:00+02:00`, a losing duplicate) and a note with inline `#ÚČTY` (FR-GRP-08 AC-4); `.tegg/types/kniha.yml` (FR-GRP-02 AC-5); `icon:` / `cover:` added to Rozpočet (FR-GRP-05 AC-1).
- The external edits, renames, trash moves, deletes and restores named in the criteria, by the helper process of ms3-shell §13.6 in L6 and by the fake core in L5.
- The reference vault (`tools/gen-vault --seed 1`) for NFR-PERF-11.
