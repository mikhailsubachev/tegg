# Fixture `outline/` (v1.0 slice OL, the Outline)

Synthetic vault for `docs/acceptance/outline.md` (FR-EDT-11, FR-EDT-16 as proposed by AP-1400, FR-NAV-03 AC-15, AC-16, FR-NAV-05 AC-4, AC-5, FR-STO-07 AC-7, AC-8, FR-SYN-06 AC-46, FR-UX-03 AC-45…AC-47, FR-UX-08 AC-21, AC-22, FR-UX-05 AC-22, NFR-OTH-02 AC-19, NFR-PERF-06 AC-6, FR-FMT-12 AC-10, FR-SET-02 AC-10). Hand-written (D-50); no real content. **Draft**: the expected rows below follow the proposals of AP-1400…AP-1427; a decision that differs changes this README in the same commit as the criteria.

**How tests use it.** Each test copies this folder (without this README) into a temporary directory, then copies `tests/fixtures/vaults/new-empty/.tegg/` into it (this folder has no `.tegg/`). The daily template is `_templates/Daily Note/Daily Note.md` (as `tests/fixtures/vaults/daily/`).

**Byte rules.** LF, UTF-8 without BOM, every file ends with one `\n`, NFC everywhere (the NFD cases are made at runtime, below). Don't open and re-save these files in an editor.

## Objects

Key order: `id, type, title, <attributes>, created, modified`. Ids are `01JC5N000000000000000000nn`.

| Short | Path | id `nn` | What it is | Used by |
| --- | --- | --- | --- | --- |
| Plán | `Pages/Plán offsitu 2026.md` | 01 | page; an intro paragraph, then 11 headings H1–H3 (board `Outline` B), each followed by two 3-sentence filler paragraphs, so the note scrolls at 1,440 × 900 | FR-EDT-11 AC-1, AC-5, AC-8, AC-9, AC-12, AC-14, AC-18; FR-EDT-16 AC-1…AC-4, AC-7, AC-9…AC-11; FR-NAV-05 AC-4, AC-5; FR-STO-07 AC-7, AC-8 |
| Architektura | `Pages/Architektura.md` | 02 | page; 18 headings H1–H6 (board C, V4), one short paragraph each | FR-EDT-11 AC-4, AC-5, AC-13, AC-14; FR-EDT-16 AC-3, AC-5, AC-6, AC-8; FR-FMT-12 AC-10 |
| Čtenářské | `Pages/Čtenářské poznámky.md` | 03 | page; 51 headings: 12 H1, each with 3 H2; `Replikace` has H3s (`Vedoucí a následovníci` › `Příklady`, `Kompromisy`; `Zpoždění replikace` › `Příklady`); one filler paragraph each (board D, V7, V8, V10, V11) | FR-EDT-11 AC-10, AC-16; FR-EDT-16 AC-5, AC-8, AC-11; FR-NAV-03 AC-15, AC-16 |
| Okraje | `Pages/Okraje.md` | 04 | page; every heading edge case of R171 (setext, inline marks and a link, closing `##`, block id, empty `#` and `##`, `#tag`, code, indented code, callouts, a folded callout, a quote, a list item, a mindmap callout, a query block, a `%%` comment, HTML, math, a note embed, three `Poznámky` headings); a YAML comment `# …` in the frontmatter | FR-EDT-11 AC-2, AC-3, AC-11; FR-STO-07 AC-7 |
| Přeskočené | `Pages/Přeskočené úrovně.md` | 05 | page; skipped levels: H3, H1, H3, H2, H6 | FR-EDT-11 AC-4 |
| Jeden | `Pages/Jeden nadpis.md` | 06 | page; one heading `## Další kroky`; too short to scroll | FR-EDT-11 AC-6, AC-9; FR-EDT-16 AC-1, AC-12 |
| Bez nadpisů | `Pages/Bez nadpisů.md` | 07 | page; no heading, a line starting `#štítek` | FR-EDT-11 AC-6, AC-7; FR-EDT-16 AC-1, AC-11 |
| Dlouhé | `Pages/Dlouhé nadpisy.md` | 08 | page; an H1 of more than 100 characters and a long H6, nested six deep | FR-EDT-11 AC-15 |
| Odkazy | `Pages/Odkazy na oddíly.md` | 09 | page; `[[Čtenářské poznámky#Zpoždění replikace]]` | FR-EDT-11 AC-19 |
| Den | `Daily/2026-11-12.md` | 10 | daily-note; `# Čtvrtek`, `## Ráno`, `## Večer` | FR-EDT-11 AC-17 |
| Šablona | `_templates/Daily Note/Daily Note.md` | — | template; `# Deník {{date:D. M. YYYY}}`, `## Úkoly`, `## Poznámky` (the virtual `daily/2026-11-13`) | FR-EDT-11 AC-17 |
| Rozbitá | `Pages/Rozbitá hlavička.md` | — | invalid frontmatter (`title: [neuzavřená`): opens in the source view (NFR-REL-03); `# První v rozbité`, `## Druhý v rozbité` | FR-EDT-11 AC-12 |
| Bez hlavičky | `Pages/Bez hlavičky.md` | — | **no frontmatter**, no `id` (D-103); `# Jedna`, `## Dvě`, `## Tři` | FR-STO-07 AC-7 (path key, re-key on the first edit), FR-FMT-12 AC-10 |

## Expected outlines (rows in order: text · heading level · tree depth, AP-1406)

- **Plán** (11): Cíle 1·1, Co od toho chceme 2·2, Kdo jede 2·2, Program 1·1, Den 1 2·2, Ráno: strategie 3·3, Odpoledne: plán 3·3, Den 2 2·2, Logistika 1·1, Cesta 2·2, Rozpočet 2·2. With children: Cíle, Program, Den 1, Logistika.
- **Architektura** (18; depth = level): Úložiště 1, Rozvržení trezoru 2, Složky podle typu 3, Denní poznámky 4, Názvy souborů 5, Časová pásma 6, Přejmenování 6, Přílohy 4, Hlavička 3, Povinné klíče 4, Neznámé klíče 4, Indexování 2, Fulltextový index 3, Index odkazů 3, Synchronizace 1, Konflikty 2, Stejný řádek upraven 3, Složky iCloudu 2. With children (9): Úložiště (13 descendants), Rozvržení trezoru (9), Složky podle typu (5), Denní poznámky (3), Názvy souborů (2), Hlavička (2), Indexování (2), Synchronizace (3), Konflikty (1). Rail line widths in order (R173): 18, 13, 9, 7, 5, 4, 4, 7, 9, 7, 7, 13, 9, 9, 18, 13, 9, 13.
- **Čtenářské** (51): the 12 H1 `Úvod`, `Spolehlivé systémy`, `Datové modely`, `Ukládání a vyhledávání`, `Kódování`, `Replikace`, `Dělení dat`, `Transakce`, `Konzistence`, `Dávkové zpracování`, `Proudy`, `Závěr`, each followed by its 3 H2 as in the file; under `Replikace`: `Vedoucí a následovníci` (H3 `Příklady`, `Kompromisy`), `Zpoždění replikace` (H3 `Příklady`), `Bez vedoucího`. With children (14): the 12 H1, `Vedoucí a následovníci`, `Zpoždění replikace`. The last heading is `Další čtení` (H2 under `Závěr`).
- **Okraje** (11, AP-1404, AP-1405): Nadpis podtržený 1·1, Podnadpis podtržený 2·2, `Tučný začátek, odkaz a kód` 2·2, Oddíl s blokem 2·2, Nadpis v calloutu 2·2, Skrytý nadpis 3·3 (in the folded callout), Nadpis v citaci 2·2, Nadpis v seznamu 2·2, Poznámky 2·2, Poznámky 3·3, Poznámky 2·2. **Not** listed: the YAML comment, `#štítek není nadpis`, the empty `#` and `##`, `# Komentář v kódu`, `# odsazený kód`, `## Kořen mapy` (mindmap), `# komentář v dotazu`, `# Nadpis v komentáři`, `<h2>HTML nadpis</h2>`, `# x` (math), and the 11 headings of the embedded Plán. Fold keys of the three `Poznámky` (R176): `2:Poznámky#1`, `3:Poznámky#1`, `2:Poznámky#2`.
- **Přeskočené** (5): Začátek ve třetí 3·1, Hlavní 1·1, Přeskok 3·2, Zpět na dvojku 2·2, Hluboko 6·3.
- **Jeden** (1): Další kroky 2·1. **Bez nadpisů**: none. **Den**: Čtvrtek 1·1, Ráno 2·2, Večer 2·2. **Virtual `daily/2026-11-13`**: Deník 13. 11. 2026 1·1, Úkoly 2·2, Poznámky 2·2. **Rozbitá**: První v rozbité 1·1, Druhý v rozbité 2·2. **Bez hlavičky**: Jedna 1·1, Dvě 2·2, Tři 2·2.

## Expected rail rows in Čtenářské (FR-EDT-16 AC-5, AP-1415)

X = 1 (12 depth-1 headings fit in 20 lines; 48 headings of depth ≤ 2 don't). Rows by current section:

| Current | Lines | Rows besides the 12 H1 |
| --- | --- | --- |
| none (scrollTop 0) | 12 | — |
| `Replikace` | 15 | its 3 H2 |
| `Zpoždění replikace` | 16 | `Replikace`'s 3 H2, and `Příklady` under `Zpoždění replikace` |
| `Kompromisy` | 17 | `Replikace`'s 3 H2, `Příklady` and `Kompromisy` under `Vedoucí a následovníci` |
| `Další čtení` (end of the note) | 15 | `Závěr`'s 3 H2 |

Architektura (18) and Plán (11) show every heading on the rail.

## Made at runtime by the tests (never committed)

- **NFD.** Architektura's line `### Složky podle typu` rewritten in NFD (FR-FMT-12 AC-10); Bez hlavičky opened through a route whose path is in NFD (`'Pages/Bez hlavičky.md'.normalize('NFD')`).
- **Small notes.** `Pages/Dva nadpisy.md` (page, `## A`, `## B`, FR-EDT-16 AC-1); `Pages/Prázdné nadpisy.md` (page, body `#` and `##` lines only; FR-EDT-11 AC-6 was removed by D-1675).
- **Many headings.** `Pages/Šedesát kapitol.md` (60 H1 `Kapitola 01`…`Kapitola 60`, each with a one-line paragraph) and `Pages/Tři sta kapitol.md` (300 H1, D-1634), FR-EDT-16 AC-13; `Pages/Pět set nadpisů.md`: 100 H1 `Kapitola 001`…`Kapitola 100`, each with 4 H2 `Oddíl 001.1`…, every heading followed by a 30-word filler paragraph (500 headings), FR-EDT-11 AC-20 and NFR-PERF-06 AC-6. The benchmark copies it into the reference vault (`tools/gen-vault --seed 1`).
- **External edits** named in the criteria: by the helper process (L6) or the fake core (L5).
