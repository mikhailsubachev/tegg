# Fixture `previews/` (v1.0 slice P, object previews)

Synthetic vault for `docs/acceptance/previews.md` (FR-LNK-08…13, FR-NAV-08, FR-SET-07, FR-TSK-08 AC-4…AC-6, FR-SYN-06 AC-37). Hand-written (D-50); no real content. **Status: draft**, written with the criteria; AP-803…AP-826 may still change what a criterion expects from these files, not the files themselves. Previews never write, so the criteria check that every file keeps its bytes, mtime and inode.

The tests copy `tests/fixtures/vaults/new-empty/.tegg/` into it (default type Quick Note; no file names clash) and add the two type files below. This README is not a vault file and is never copied.

**Byte rules.** LF line endings, UTF-8 without BOM, every file ends with exactly one `\n`, NFC everywhere. Ids are `01JBPV0000000000000000P0nn` (26 characters, ULID alphabet), one per file; `P021` (the template has no `id`) is unused. Time stamps carry the Europe/Prague offset of their date (`+02:00` until 25 October 2026, `+01:00` after). The files in this folder are the exact contents; don't open and re-save them in an editor. Git can't store NFD file names reliably, so NFD copies are made at runtime.

**Created at runtime by the tests** (never committed):

- `_attachments/graf.png`: a copy of `tests/fixtures/vaults/trash-media/_attachments/záhon.png` (64 × 48 PNG, 1,234 bytes), so `Images/Graf.md`'s `size: 1234`, `width: 64`, `height: 48` are true.
- `_attachments/Smlouva.pdf`: a copy of `tests/fixtures/vaults/trash-media/_attachments/Rozpočet.pdf` (2 pages, 844 bytes).
- `Pages/Dlouhá.md` (previews.md FR-LNK-10 AC-14): `id: 01JBPV0000000000000000P030`, `type: page`, `title: Dlouhá`, then 3,000 paragraphs `Odstavec <n>.` (n = 1…3000), with a heading `## Kapitola <k>` before paragraphs 1, 101, 201, … (k = 1…30), blocks separated by one blank line.
- An NFD copy of `[[Rozpočet 2027]]` typed into a runtime note, and an NFD-named copy of `Pages/Rozpočet 2027.md` (FR-LNK-08 AC-10).
- External edits, renames and deletes named in the criteria (FR-LNK-11 AC-11), done by the helper process of ms3-shell §13.6 in L6 and by the fake core in L5.

## Type files (`.tegg/types/`)

| File | Type | Attributes | Preview |
| --- | --- | --- | --- |
| `osoba.yml` | Osoba / Osoby, folder `Osoby`, icon `user`, purple | `firma` Text, `role` Text, `e-mail` Email | `[firma, role]` |
| `projekt.yml` | Projekt / Projekty, folder `Projekty`, icon `folder`, orange | `stav` Select (Aktivní green, Pozastavený gray), `vlastník` Relation to `osoba`, `termín` Date, `rozpočet` Number, `poznámka` Text | `[stav, vlastník, termín, rozpočet]` (4, the maximum, FR-TYP-11) |

System types come from `new-empty` (Page: no preview attributes; Task: `[status, priority, due]`; Daily Note: `[date]`, review locked; Tag: `[color]`; Image: `[width, height]`; PDF: `[pages]`).

## Objects

| Short name | Path | Type | What it holds | Used by (previews.md) |
| --- | --- | --- | --- | --- |
| Rozpočet | `Pages/Rozpočet 2027.md` (P001) | page, `tags: [účty]` | the main target: intro paragraph, `## Rozsah` (a link to Jana, the image embed `![[graf.png]]`), `### Podrobnosti` (with a `%%comment%%`), `## Otevřené otázky` with a paragraph ending ` ^otazka1`, the card embed `![[Projekt Alfa]]`, a last paragraph | FR-LNK-08 AC-1…AC-11, FR-LNK-10 AC-1, AC-3, AC-4, AC-7, FR-LNK-11 AC-1…AC-13, FR-LNK-13 |
| Jana | `Osoby/Jana Nováková.md` (P002) | osoba | `firma`, `role`, `e-mail`; **empty body** | FR-LNK-10 AC-5 (empty body → all attributes), FR-LNK-09 AC-1 (card) |
| Petr | `Osoby/Petr Dvořák.md` (P003) | osoba, `modified` on the test day | `Vede tým nákupu.` | FR-LNK-09 AC-2 (link mode), FR-LNK-08 AC-6, AC-8 (type page, Daily context row) |
| Alfa | `Projekty/Projekt Alfa.md` (P004) | projekt | `icon: rocket` and `cover: "[[graf.png]]"` (preserved, never shown, D-217), `stav`, `vlastník` relation to Jana, `termín`, no `rozpočet` (an empty preview attribute), `poznámka` (not a preview attribute); body links back to Rozpočet | FR-LNK-10 AC-1, AC-2, FR-LNK-08 AC-3 (relation chip) |
| Odkazy | `Pages/Odkazy.md` (P005) | page | the host: one paragraph per case, in this order: `[[Rozpočet 2027]]`; alias `\|rozpočet`; `#Rozsah`; `#^otazka1`; `#Neexistující nadpis`; Jana and Petr; Projekt Alfa; Zavolat Janě; dates `[[2026-10-07]]` (exists) and `[[2026-10-30]]` (no note); tags `#účty` (Tag file) and `#nápad` (virtual), `[[Účty]]`; `[[Graf]]`, `[[graf.png]]` (the file resolves to the Image object), `[[Smlouva]]`; duplicates `[[Plán]]` and `[[Quick Notes/Plán]]`; broken `[[Neexistuje]]`, `[[Šablona]]` (template), `[[Smazaná]]` (trash); `[[Prázdná]]`, `[[Neplatná hlavička]]`; `[[Kruh A]]`; a Markdown link `(Rozpo%C4%8Det%202027.md)`; an external `https://example.com/rozpocet`; `[[Nápad na podcast]]`; `[[Mapa]]` | most criteria (R105 rows) |
| Vložení | `Pages/Vložení.md` (P006) | page | embeds: `![[Rozpočet 2027]]` (full, Page default), `![[Jana Nováková]]` (card), `![[Petr Dvořák\|link]]` (link mode), `![[Rozpočet 2027#Rozsah]]` (full, section), `![[graf.png]]` (image figure) | FR-LNK-09 |
| Kruh A, Kruh B | `Pages/Kruh A.md`, `Pages/Kruh B.md` (P007, P008) | page | each embeds the other | FR-LNK-10 AC-4 (no recursion in a preview) |
| Úkol | `Tasks/Zavolat Janě.md` (P009) | task, To do, High, due 2026-10-30 (two days after the test clock), `source: "[[Porada 2026-10-27]]"` | `Domluvit termín schůzky k rozpočtu.` | FR-LNK-10 AC-8, FR-TSK-08 AC-4…AC-6, FR-LNK-08 AC-7 |
| Porada | `Pages/Porada 2026-10-27.md` (P010) | page | 12 short paragraphs, `## Úkoly`, the embed `![[Zavolat Janě]]` (so the scroll target is below the first screen), `Konec zápisu.` | FR-TSK-08 AC-4, AC-5 |
| Denní | `Daily/2026-10-07.md` (P011) | daily-note, `review: reviewed` | `Zápis dne. Viz [[Rozpočet 2027]].` | FR-LNK-10 AC-9 |
| Účty | `Tags/Účty.md` (P012) | tag, colour blue | on Rozpočet (`tags:`) and Odkazy (inline `#účty`): 2 objects | FR-LNK-10 AC-10 |
| Graf | `Images/Graf.md` (P013) | image, `file: "[[graf.png]]"`, 64 × 48 | empty body | FR-LNK-10 AC-11 |
| Smlouva | `PDFs/Smlouva.md` (P014) | pdf, `file: "[[Smlouva.pdf]]"`, 2 pages | `Podepsaná verze smlouvy.` | FR-LNK-10 AC-11 |
| Plán ×2 | `Pages/Plán.md` (P015), `Quick Notes/Plán.md` (P016) | page; quick-note (reviewed) | same title `Plán`, different bodies | FR-LNK-08 AC-10, FR-LNK-10 AC-15 |
| Prázdná | `Pages/Prázdná.md` (P017) | page | no attributes besides `id`, `type`, `title`; empty body | FR-LNK-10 AC-6 |
| Neplatná | `Pages/Neplatná hlavička.md` (P018) | invalid YAML (unclosed quote on line 3) | `Tělo s odkazem na [[Rozpočet 2027]].` | FR-LNK-10 AC-12 |
| Nápad | `Quick Notes/Nápad na podcast.md` (P019) | quick-note without `review` (an Inbox member, D-600) | `Podcast o rozpočtech domácností.` | FR-LNK-10 AC-13, FR-LNK-08 AC-8 (Inbox card) |
| Mapa | `Pages/Mapa.md` (P020) | page | a `> [!mindmap]` callout whose nodes link Rozpočet and Jana | FR-LNK-13 AC-9 |
| Šablona | `_templates/Page/Šablona.md` | template | never a link target (FR-TPL-07) | FR-LNK-08 AC-9 |
| Smazaná | `.trash/Pages/Smazaná.md` (P022) | trashed | never a link target (D-102) | FR-LNK-08 AC-9 |

**Expected derived values** (from the existing rules, for the criteria): Rozpočet's backlinks are Odkazy, Projekt Alfa, Denní, Neplatná hlavička (body link only), Vložení and Mapa (6; not Šablona or Smazaná); `tag/účty` lists Rozpočet and Odkazy; `#nápad` is a virtual tag with 1 object; `daily/2026-10-28` (the test day) lists Petr Dvořák under `Modified`; the Inbox lists Nápad na podcast; the Tasks page shows Zavolat Janě with the source chip `Porada 2026-10-27`; from Odkazy (in `Pages/`), `[[Plán]]` resolves to `Pages/Plán.md` (same folder first) and `[[Quick Notes/Plán]]` to `Quick Notes/Plán.md`.
