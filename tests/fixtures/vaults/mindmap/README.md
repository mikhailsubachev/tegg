# Fixture `mindmap/` (slice MM)

Synthetic vault for `docs/acceptance/mindmap.md` (FR-MMP-01, -02, -04; FR-FMT-05 AC-4…AC-6; FR-FMT-07 AC-24; FR-SYN-06 AC-33; FR-LNK-01 AC-27; FR-LNK-03 AC-21; FR-UX-03 AC-15; FR-UX-05 AC-10; NFR-OTH-02 AC-7). Hand-written from D-679…D-687 and the plan `docs/plans/mm-mindmap-as-list.md` (D-50); no real content.

**Status: draft, 2026-10-25,** pending the owner's decisions on AP-726…AP-740 (end of `mindmap.md`). Rows marked *AP-n* expect the recommended answer; if the owner decides otherwise, the row and the file change with a `Fixture-Change:` trailer. Don't open and re-save these files in an editor.

The tests copy `tests/fixtures/vaults/new-empty/.tegg/` into it (no file names clash; Task comes from there) next to the one type file below. This README is not a vault file and is never copied.

**Byte rules.** UTF-8 without BOM, NFC (file names and content), LF line endings, one final newline. **Except:** `Pages/Z Obsidianu.md` indents its nested items with **tabs** (`> \t- `, `> \t\t- `), as Obsidian writes them; `Pages/Holá mapa.md` has **no frontmatter**; `Pages/Neplatná mapa.md` has **invalid frontmatter** (unclosed quote on line 3). Ids are `01JB4M0000000000000000M0<nn>` (26 characters, ULID alphabet); `Holá mapa` and the template have none. Frontmatter key order `id, type, title, <attributes>, created, modified`; `created: 2026-10-01T09:00:00+02:00` and `modified: 2026-10-20T09:00:00+02:00` unless given. NFD names and bytes, CRLF copies and the large generated maps are created by the tests at runtime (git can't keep NFD names reliably).

## Type file (`.tegg/types/`)

| File | Content | Used by |
| --- | --- | --- |
| `projekt.yml` | `version: 1`, name `Projekt`, plural `Projekty`, folder `Projekty`, icon `folder`, colour `orange`, `review: false`, no attributes | FR-MMP-04 AC-1 (its default template holds a mindmap) |

## Notes

"Nodes" counts the drawn nodes including a synthesized root. Line numbers count from the first body line.

| Short | Path | id | Body | Expected (R90) | Used by |
| --- | --- | --- | --- | --- | --- |
| Výjezd | `Pages/Výjezd 2026.md` | M001 | paragraph `Plán výjezdu týmu.`; the plan's example as `> [!mindmap] Výjezd 2026` with one top-level item `Výjezd 2026`, children `Program` (`Přehled Q4`, `Plán 2027`), `Místo` (`[[Lisabon]]`), `Doprava`; paragraph `Poznámka pod mapou.` | mindmap, root = the item, 7 nodes | FR-MMP-02 AC-1, AC-2, AC-5…AC-8, AC-12, AC-15; FR-MMP-01 AC-5, AC-6; FR-LNK-01 AC-27; FR-LNK-03 AC-21; FR-FMT-07 AC-24; FR-SYN-06 AC-33 |
| Lisabon | `Pages/Lisabon.md` | M002 | `Město výjezdu.` | link target | FR-LNK-01 AC-27, FR-LNK-03 AC-21, FR-MMP-02 AC-10 |
| Uzly | `Pages/Uzly.md` | M003 | `> [!mindmap] Uzly`, root `Obsah uzlů` with 11 children: inline marks; `[[Lisabon]]` and `#cestování`; date link `[[2026-10-20]]` (no Daily Note); task embed `![[Zalít květiny]]`; image embed `![[fotka.png]]` (no file); a 59-character text that wraps; an item with a second paragraph; an item with a fenced code block; an item with a quote; `[[Neexistuje]]` (broken); a paragraph with a hard break `\` | mindmap, 12 nodes; the list is loose (blank `>` lines) | FR-MMP-02 AC-9, AC-10; FR-LNK-01 AC-27 (broken link excerpt); FR-LNK-03 AC-21 |
| Nákup | `Pages/Nákup.md` | M004 | `> [!mindmap]` (no title), checklist `- [ ] Nákup` with `[x] Mléko`, `[ ] Chléb`, `[X] Sýr` | mindmap, checklist, root = the item, 4 nodes | FR-MMP-02 AC-9 (read-only boxes) |
| Postup | `Pages/Postup.md` | M005 | `> [!MindMap] Postup`, numbered `1. Postup` with `1. Krok jedna`, `2. Krok dva` | mindmap (type case-insensitive), 3 nodes, no numbers drawn (*AP-735*) | FR-FMT-05 AC-4; FR-MMP-02 AC-9 |
| Více kořenů | `Pages/Více kořenů.md` | M006 | `> [!mindmap] Témata`, top-level `Rodina`, `Práce` (child `Porady`), `Zdraví` | mindmap, synthesized root `Témata`, 5 nodes | FR-MMP-02 AC-2, AC-12 |
| Bez titulku | `Pages/Bez titulku.md` | M007 | `> [!mindmap]`, top-level `Jaro`, `Léto` | mindmap, synthesized root = note title `Bez titulku`, 3 nodes | FR-MMP-02 AC-2; FR-MMP-01 AC-9 (title bytes) |
| Holá mapa | `Pages/Holá mapa.md` | — | **no frontmatter**; `> [!mindmap]`, `Sever`, `Jih` | mindmap, synthesized root = file stem `Holá mapa` (D-103), 3 nodes | FR-MMP-02 AC-2; FR-MMP-02 AC-18 (first edit writes `id`, `type`, `modified`) |
| Složené | `Pages/Složené.md` | M008 | `> [!mindmap]- Složená mapa` and `> [!MINDMAP]+ Rozbalená mapa`, each `Kořen` › `Větev` | two mindmaps, the first starts collapsed | FR-MMP-02 AC-7 (per-block view), AC-17 (fold); FR-MMP-01 AC-9 (fold marker kept) |
| Rozpoznání | `Pages/Rozpoznání.md` | M009 | ten callouts, in order: (1) `Odstavec`: a paragraph; (2) `Dva seznamy`: `- a`, `- b`, blank `>`, `* c`; (3) `Seznam a odstavec`: `- a`, blank `>`, a paragraph; (4) `Komentář`: `- a`, blank `>`, `%%poznámka%%`; (5) `Navazující text`: `> 2. druhý bod` right after the title line; (6) `Prázdná položka`: `> -` (empty first item) then `>   - dítě`; (7) `[!mind-map] Pomlčka`; (8) `[!mindmaps] Množné`; (9) `[!Mindmap] Velké písmeno`: `- a`; (10) `[!mindmap] Prázdná` with no body | (1)–(4) hint; (5) mindmap *AP-726* (a hint under plain CommonMark); (6) mindmap with an empty root and child `dítě` *AP-726*; (7), (8) ordinary unknown callouts; (9) mindmap; (10) empty state *AP-726* | FR-FMT-05 AC-4; FR-MMP-02 AC-3, AC-4 |
| Mermaid | `Pages/Mermaid.md` | M010 | paragraph, ```` ```mermaid ```` fence starting `mindmap`, ```` ```mermaid ```` `flowchart LR` fence, paragraph | raw fence (read-only source block, code in the read view); ordinary code block | FR-FMT-05 AC-5 |
| Převody | `Pages/Převody.md` | M011 | 1 `Úvodní odstavec.`; 2 a `*` list `Kořen` (nested `Větev s odsazením čtyř mezer`, indented 4 spaces) and `Druhý`; 3 a `1)` list; 4 `## Nadpis jedna`; 5 `Odstavec dva.`; 6 `Odstavec tři.`; 7 a quote; 8 a ```` ```text ```` fence | no mindmap; sources for `Turn into → Mindmap` | FR-MMP-01 AC-2, AC-3, AC-6, AC-7 |
| Rozbalení | `Pages/Rozbalení.md` | M012 | `> [!mindmap] Titulek mapy` holding a `*` list `Kořen` › `Větev` (4-space indent); `> [!mindmap]` holding `1. Jedna`, `2. Dvě` | two mindmaps; sources for unwrapping | FR-MMP-01 AC-4, AC-6 |
| Z Obsidianu | `Pages/Z Obsidianu.md` | M013 | `> [!mindmap] Z Obsidianu`, `- Kořen`, nested with **tabs**: `Větev s tabulátorem`, `List` | mindmap, 3 nodes, depth 3 | FR-MMP-02 AC-18 (*AP-727*); FR-FMT-07 AC-24 |
| Vložení | `Pages/Vložení.md` | M014 | a paragraph and the full embed `![[Výjezd 2026]]` | the embedded note's mindmap is drawn | FR-MMP-02 AC-16 |
| Zalít květiny | `Tasks/Zalít květiny.md` | M015 | Task, `status: To do`, `due: 2026-10-22`, empty body | the embed chip in Uzly shows `Today · To do` at the test clock | FR-MMP-02 AC-9 |
| Rozložení | `Pages/Rozložení.md` | M017 | `> [!mindmap] Strom` (`Kořen` › `Alfa` (`A1`, `A2`), `Beta` (`B1`), `Gama`); `> [!mindmap] Zalomení` (`Krátký` › the 59-character text); `> [!mindmap] Paleta` (`Barvy` › eight branches `Jedna`…`Osm`) | three mindmaps with the golden geometry of R92 | FR-MMP-02 AC-11, AC-12 |
| Prázdná | `Pages/Prázdná.md` | M018 | frontmatter only, empty body | where `/mindmap` is inserted | FR-MMP-01 AC-1, AC-6 |
| Neplatná mapa | `Pages/Neplatná mapa.md` | M019 | invalid frontmatter (line 3); `> [!mindmap] Jen ke čtení` with `[[Výjezd 2026]]` and `Druhá větev` | opens in the read view: Map only | FR-MMP-02 AC-8 |
| Šablona | `_templates/Projekt/Projekt.md` | — | body only: `> [!mindmap] Cíle projektu` with `Cíle projektu` › `Proč`, `Co`, `Kdy` | copied verbatim into a new Projekt (D-92) | FR-MMP-04 AC-1 |
| Stará mapa | `.trash/Pages/Stará mapa.md` | M016 | a mindmap linking `[[Lisabon]]` | never a backlink, never rewritten (D-102) | FR-LNK-01 AC-27, FR-LNK-03 AC-21 |

## Created at runtime by the tests

- An NFD copy of `[[Lisabon]]` in a test-written note, and an NFD-named copy of Lisabon (FR-FMT-12, FR-LNK-01 AC-27).
- A CRLF copy of Výjezd without a final newline (FR-FMT-07 AC-24).
- `Pages/Velká mapa.md`: a 500-node mindmap (root, 10 branches, each with 7 children, each with 6 leaves; the last child of the last branch has 5), for FR-MMP-02 AC-14.
- `Pages/Široká mapa.md`: a chain of 7 nested items of 40 characters each, wider than the centre pane, for FR-MMP-02 AC-13.
- Random mindmaps for the property criteria (FR-FMT-07 AC-24).
