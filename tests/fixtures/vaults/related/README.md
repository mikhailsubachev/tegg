# Fixture `related/` (slice REL, Related notes)

Synthetic vault for `docs/acceptance/related.md` (FR-LNK-15, NFR-PERF-13's correctness side, FR-NAV-05 AC-6, AC-7, FR-STO-07 AC-9, FR-SYN-06 AC-47, FR-FMT-07 AC-31, FR-FMT-12 AC-11, FR-SRC-04 AC-12, FR-UX-03 AC-48, AC-49, FR-UX-08 AC-23, FR-UX-05 AC-23, NFR-OTH-02 AC-20). D-1692. Hand-written (D-50): every name and sentence is invented, none comes from a real export or vault (D-62).

**Status: draft.** The expected lists below follow the proposals of AP-1455, AP-1459, AP-1462…AP-1468 and AP-1473. A decision that differs changes this README in the same commit as the criteria.

**How tests use it.** Each test copies this folder (without this README) into a temporary directory, then copies `tests/fixtures/vaults/new-empty/.tegg/` into it (this folder has no `.tegg/`; the Tag, Image and PDF types come from there). The Image and PDF objects point to attachments that don't exist (`ul-u-lesa.jpg`, `navod-ke-krmeni.pdf`). Related reads only the `.md` files, so the missing files are on purpose.

**Byte rules.** LF, UTF-8 without BOM, NFC everywhere, and every file ends with one `\n`. The NFD cases are made at runtime (below). Don't open and re-save these files in an editor.

## Why the vault looks like this: document frequency

R181 skips a stem found in more than 10 % of the `rel` rows. This vault has **39 `rel` rows**: every object outside `_templates/` and `.trash/`, Tag, Image and PDF included. Of those, **36 are candidates**. So the ceiling is 3.9 rows, or 3.6 if AP-1463's alternative counts candidates only.

**Every stem a criterion relies on is in at most 3 objects.** That is why the clusters are small and use separate vocabulary. The stems shared by all twelve Hvězda notes (`hvezd`, `pozorovan`, `zapis`, `hvezdarn`) are in 12 or 13 objects. They are deliberately skipped, so they never score.

Stems below are computed with the rule set of `tests/fixtures/format/stem/README.md` (Czech) and Snowball English (Porter2). Stop words and stems under 3 characters are left out.

## Objects

Key order: `id, type, title, <attributes>, created, modified` (Image and PDF objects as in `tests/fixtures/vaults/previews/`). Ids are `01JRE` followed by 19 zeros and a two-digit `nn`.

| Short | Path | `nn` | Type | Role | Used by (FR-LNK-15 unless named) |
| --- | --- | --- | --- | --- | --- |
| Souhvězdí | `Pages/Souhvězdí.md` | 01 | page | holds the 18 astronomy words, each once; body link `[[Hvězda 01]]` | AC-12, AC-14, AC-20, AC-25 |
| Hvězda 01…12 | `Pages/Hvězda 01.md` … `Pages/Hvězda 12.md` | 02…13 | page | each holds 3 of Souhvězdí's words in other forms, shared with its pair partner (table below), plus the same two filler sentences; Hvězda 02 also links `[[Souhvězdí]]` | AC-12, AC-20 |
| Rozpočet | `Pages/Rozpočet na offsite 2027.md` | 14 | page | the board's note (board A), Czech with diacritics | AC-14, AC-20…AC-22, AC-26…AC-29, FR-NAV-05 AC-6, AC-7 |
| Den 30. 9. | `Daily/2026-09-30.md` | 15 | daily-note | a **Daily Note** candidate, written **without diacritics** | AC-10, AC-19, AC-20, AC-22, AC-26 |
| Úkol | `Tasks/Poslat návrh rozpočtu financím.md` | 16 | task | a **Task** candidate: To do, High, due 2026-11-27; sentence with `27. 11.` | AC-10, AC-19, AC-20, AC-22, AC-28 |
| Termíny | `Pages/Důležité termíny školení.md` | 17 | page | twin A (DIA-6) | AC-16, AC-20, FR-FMT-12 AC-11 |
| Terminy | `Pages/Dulezite terminy skoleni.md` | 18 | page | twin B: Termíny's title and body with **every diacritic removed** | AC-16, AC-20 |
| Školení | `Quick Notes/Školení a dodavatel.md` | 19 | quick-note | the twins' neighbour; `review: unreviewed` (amber ring) | AC-10, AC-16, AC-19, AC-22 |
| Kniha | `Pages/Kniha vzpomínek.md` | 20 | page | nominative forms: `Praha`, `kniha`, `Domek`, `potok`, `Matka`, `ruka`, `Zelený`, `plot` | AC-15, AC-17, AC-20, FR-FMT-12 AC-11 |
| Poznamky | `Quick Notes/Poznamky ke knize.md` | 21 | quick-note | other forms, **no diacritics**: `Praze`, `domku`, `matce`, `knize`, `potoce`, `ruce`, `Plot`, the partly accented `zelenymí` | AC-15, AC-20, FR-SRC-04 AC-12 |
| Zahrada | `Pages/Zahrada na jaře.md` | 22 | page | links to Záhon (`[[Záhon s rajčaty]]`); linked from Semínka | AC-11, AC-20, AC-24 |
| Záhon | `Pages/Záhon s rajčaty.md` | 23 | page | linked from Zahrada | AC-11 |
| Semínka | `Quick Notes/Semínka na jaro.md` | 24 | quick-note | links to Zahrada (`[[Zahrada na jaře]]`) | AC-11, AC-20 |
| Včelstvo | `Pages/Včelstvo na zimu.md` | 25 | page | the exclusion cluster's open note | AC-10, AC-28, AC-31 |
| Prohlídka | `Pages/Jarní prohlídka úlu.md` | 26 | page | Včelstvo's only valid neighbour (5 shared stems) | AC-10, AC-28 |
| Včelaření | `Tags/Včelaření.md` | 27 | **tag** | a Tag object **with a body** holding 3 of Včelstvo's stems; never listed | AC-10 |
| Úl u lesa | `Images/Úl u lesa.md` | 28 | **image** | an Image object with a body holding 3 of Včelstvo's stems; never listed; as the open object, lists Včelstvo (AP-1459) | AC-10, AC-31 |
| Návod | `PDFs/Návod ke krmení.md` | 29 | **pdf** | a PDF object, the same | AC-10, AC-31 |
| Šablona | `_templates/Page/Včelí deník.md` | — | template | holds 3 of Včelstvo's stems; never listed, no `rel` row | AC-7, AC-10 |
| Starý úl | `.trash/Pages/Starý úl.md` | 30 | page, **trashed** | holds 4 of Včelstvo's stems; never listed, no `rel` row; restored at runtime in AC-10 | AC-7, AC-10 |
| Hiking | `Pages/Hiking in the mountains.md` | 31 | page | **English** | AC-6, AC-14, AC-20, AC-27 |
| Trail | `Pages/Trail notes.md` | 32 | page | English, Hiking's main neighbour | AC-6, AC-14, AC-20 |
| Túra | `Pages/Túra v horách.md` | 33 | page | Czech text on Hiking's topic: **no stem in common** with it (no meaning across languages, plan §4); no list | AC-6, AC-14, AC-24 |
| gear list | `Pages/gear list.md` | — | none (**no frontmatter**, a Page, D-103) | English; title = file name | AC-10, AC-14 |
| Mléko | `Quick Notes/Koupit mléko.md` | 34 | quick-note | 3 distinct stems: short | AC-4, AC-13, AC-24 |
| Buben | `Quick Notes/Buben.md` | 35 | quick-note | **exactly 4** distinct stems: short, although Kytara and Kroužek hold all 4 | AC-13, AC-24 |
| Kytara | `Quick Notes/Kytara.md` | 36 | quick-note | **exactly 5** distinct stems: gets a list | AC-13 |
| Kroužek | `Pages/Hudební kroužek.md` | 37 | page | holds all 5 of Kytara's stems | AC-13, AC-14 |
| Svatba | `Pages/Svatba Petra a Lucie.md` | 38 | page | the board's no-match note (board D); 9 distinct stems, none shared | AC-14, AC-17, AC-24, AC-28 |
| Prázdná | `Pages/Prázdná.md` | 39 | page | empty body: 1 distinct stem (`prazdn`): short | AC-13, AC-24 |

## Shared stems by cluster

**Souhvězdí and the Hvězda pairs** (AC-12). Each stem is in exactly 3 objects: Souhvězdí and one pair. Every Hvězda body is `Pozorování: <3 words>.` and `Zápis z hvězdárny.`, so all twelve have the same token counts. The only differences are Hvězda 02's link paragraph and the title numbers, which are dropped.

| Pair | Souhvězdí's words | First note's forms | Second note's forms | Stems |
| --- | --- | --- | --- | --- |
| Hvězda 01, 02 | teleskop, kometa, meteor | teleskopu, komety, meteoru | teleskopem, kometou, meteory | `teleskop`, `komt`, `meteor` |
| Hvězda 03, 04 | orbita, galaxie, mlhovina | orbity, galaxii, mlhoviny | orbitou, galaxií, mlhovinou | `orbit`, `galaxi`, `mlhov` |
| Hvězda 05, 06 | asteroid, planetka, dalekohled | asteroidu, planetky, dalekohledu | asteroidem, planetkou, dalekohledy | `asteroid`, `planetk`, `dalekohld` |
| Hvězda 07, 08 | zatmění, spektrum, kráter | zatměním, spektra, kráteru | zatmění, spektrem, krátery | `zatmn`, `spektr`, `kratr` |
| Hvězda 09, 10 | měsíc, rovník, obloha | měsíce, rovníku, obloze | měsícem, rovníkem, oblohou | `mesik`, `rovnik`, `obloh` |
| Hvězda 11, 12 | paprsek, vesmír, družice | paprsku, vesmíru, družice | paprsky, vesmírem, družicí | `paprsk`, `vesmir`, `druzik` |

Links:
- Souhvězdí → Hvězda 01 (body). The link's words `hvezd` and `01` are skipped or dropped, so Hvězda 01 scores like Hvězda 03…12.
- Hvězda 02 → Souhvězdí (body). It adds the stem `souhvezd`, in 2 objects and part of Souhvězdí's title. So Hvězda 02 scores higher than the rest.

**Rozpočet, Den 30. 9., Úkol** (offsite).

| Pair | Shared stems |
| --- | --- |
| Rozpočet – Den 30. 9. | `jan`, `naklad`, `offsit`, `ubytovan`, `lisabon`, `letenk`, and `rozpock` (proposal) or `rozpoct` (alternative; both notes have the nominative) |
| Rozpočet – Úkol | `navrh`, `offsit`, `jan`, `ubytovan`; plus `rozpock` only under AP-1468's proposal |
| Den 30. 9. – Úkol | `jan`, `posl`, `offsit`, `finank`, `ubytovan`, `projit`; plus `rozpock` only under the proposal |

`potrebuj` (Rozpočet, Zahrada, Záhon) is the only stem Rozpočet shares outside the cluster.

**Termíny, Terminy, Školení** (twins). Termíny and Terminy share all 12 stems: `dulezit`, `term`, `skoln`, `vedn`, `schval`, `patk`, `dodavatl`, `zasl`, `prihlask`, `schuzk`, `potvrd`, `ctvrtk`. Školení shares 8 of them with each: `skoln`, `vedn`, `dodavatl`, `zasl`, `prihlask`, `term`, `schuzk`, `ctvrtk`.

**Kniha, Poznamky** (inflection). They share 8 stems: `knih`, `prah`, `domk`, `matk`, `potok`, `ruk`, `zeln`, `plot`. Their folded non-stop words have exactly one word in common, `plot` (AC-15).

**Zahrada, Záhon, Semínka** (linked).

| Pair | Shared stems |
| --- | --- |
| Zahrada – Záhon | `zahon`, `rajk`, `paprik`, `komposk`, `potrebuj` |
| Zahrada – Semínka | `zahrad`, `jar`, `rajk`, `paprik`, `zahon`, `komposk` |
| Záhon – Semínka | `zahon`, `rajk`, `paprik`, `komposk` |

**Včelstvo and the excluded objects.** Prohlídka shares `vcelstv`, `ramk`, `plod`, `delnik` and `pyl`. Each excluded object holds a different 3 of Včelstvo's stems, so no stem is in more than 3 objects:

| Object | Stems shared with Včelstvo |
| --- | --- |
| Včelaření (Tag) | `vosk`, `propolis`, `plastv` |
| Úl u lesa (Image) | `medomt`, `nastavk`, `cesn` |
| Návod (PDF) | `krmn`, `cukr`, `zimovan` |
| Šablona (template) | `vosk`, `medomt`, `krmn` |
| Starý úl (trash) | `propolis`, `nastavk`, `cukr`, `zim` |

**Hiking, Trail, gear list.** Hiking and Trail share `hike`, `plan`, `mountain`, `trail`, `lake`, `boot`. gear list shares `boot`, `trail` and `hike` with each of them.

**Buben, Kytara, Kroužek.** Buben's stems are `bubn`, `kytar`, `harmonik`, `housl`. Kytara has those 4 plus `klavir`. Kroužek has all 5.

## Expected lists

Linked hidden / linked shown. **Ordered** lists are written `[a, b]` and checked in order. **Sets** are written `{a, b}`. `—` means no entries, with the `reason` given. `(L)` marks `linked: true`.

| Object | Linked hidden | Linked shown |
| --- | --- | --- |
| Souhvězdí | [Hvězda 03, 04, 05, 06, 07, 08, 09, 10, 11, 12] | [Hvězda 02 (L), Hvězda 01 (L), Hvězda 03, 04, 05, 06, 07, 08, 09, 10] |
| Hvězda 01…12 | not asserted | not asserted |
| Rozpočet | [Den 30. 9., Úkol] | the same |
| Den 30. 9. | {Rozpočet, Úkol} | the same |
| Úkol | {Rozpočet, Den 30. 9.} | the same |
| Termíny | [Terminy, Školení] | the same |
| Terminy | [Termíny, Školení] | the same |
| Školení | [Terminy, Termíny] (equal scores, by title, AP-1462) | the same |
| Kniha | [Poznamky] | the same |
| Poznamky | [Kniha] | the same |
| Zahrada | — (`reason: null`) | {Záhon (L), Semínka (L)} |
| Záhon | [Semínka] | {Zahrada (L), Semínka} |
| Semínka | [Záhon] | {Zahrada (L), Záhon} |
| Včelstvo | [Prohlídka] | the same |
| Prohlídka | [Včelstvo] | the same |
| Úl u lesa | [Včelstvo] (AP-1459) | the same |
| Návod | [Včelstvo] (AP-1459) | the same |
| Včelaření | not asserted (no panel on tag pages, D-1040) | not asserted |
| Hiking | [Trail, gear list] | the same |
| Trail | {Hiking, gear list} | the same |
| gear list | {Hiking, Trail} | the same |
| Túra | — (`reason: null`) | the same |
| Mléko | — (`reason: 'short'`) | the same |
| Buben | — (`reason: 'short'`) | the same |
| Kytara | {Kroužek, Buben} | the same |
| Kroužek | {Kytara, Buben} | the same |
| Svatba | — (`reason: null`) | the same |
| Prázdná | — (`reason: 'short'`) | the same |

The L5 fake core answers `index_related` from this table, with the excerpts below and the chip fields from each file's frontmatter.

## Expected excerpts (R182; FR-LNK-15 AC-20)

| In the list of | Entry | Excerpt |
| --- | --- | --- |
| Rozpočet | Den 30. 9. | `Zítra: projít rozpocet s Janou a poslat naklady na offsite financim.` |
| Rozpočet | Úkol | `Do pá 27. 11. musí návrh rozpočtu na offsite projít přes finance, Jana ho podepíše.` |
| Termíny | Terminy | `Dodavatel zasle prihlasky a termin schuzky s vedenim potvrdi ve ctvrtek.` |
| Termíny | Školení | `Školení pro vedení: dodavatel zašle přihlášky, termín schůzky ve čtvrtek.` |
| Terminy | Termíny | `Dodavatel zašle přihlášky a termín schůzky s vedením potvrdí ve čtvrtek.` |
| Poznamky | Kniha | `Praha je daleko, ale ta kniha je blízko.` (four sentences hold 2 stems each; the first wins) |
| Kniha | Poznamky | `V Praze, v malem domku, matce rikala o knize.` |
| Hiking | Trail | `Notes from the trail: the boots held up, the lake was cold, and the mountain hut was full.` |
| Hiking | gear list | `Pack the boots, a rain jacket, the map of the trail and water for the hike.` |
| Zahrada (linked shown) | Semínka | `Koupit semínka rajčat a paprik, na jaře do záhonu.` |
| Zahrada (linked shown) | Záhon | `Rajčata potřebují slunce a kompost.` |
| Souhvězdí | Hvězda 02 | `Pozorování: teleskopem, kometou, meteory.` |
| Včelstvo | Prohlídka | `Včelstva jsou silná, rámky plné plodu, dělnic přibývá a pylu je dost.` |

## Made at runtime by the tests (never committed)

- **NFD.**
  - Termíny's bytes rewritten in NFD by another program (AC-16, AC-20).
  - `Pages/Kniha vzpomínek.md` renamed to its NFD-named form (FR-FMT-12 AC-11).
  - Termíny opened through a route whose path is in NFD (FR-FMT-12 AC-11).
- **Link variants** of Semínka (AC-11): its body link replaced in turn by:
  - `souvisí: "[[Zahrada na jaře]]"` in the frontmatter;
  - `[[Zahrada na jaře#Jaro]]`;
  - `![[Zahrada na jaře]]`;
  - `[jaro](Zahrada%20na%20ja%C5%99e.md)`;
  - the plain words `Zahrada na jaře`.
- **Type and folder changes** (AC-10):
  - Prohlídka's `type` changed to `tag`;
  - Starý úl moved from `.trash/Pages/` to `Pages/`;
  - Prohlídka moved to `.trash/` and back (AC-28).
- **Tags** on Svatba (AC-17), in turn:
  - `tags: [kniha, praha, matka]`;
  - the paragraph `Kniha, Praha, matka.`;
  - the inline `#kniha #praha #matka`.
- **Edits** (AC-28):
  - the user types `Dárek: rámky, plod, pyl a dělnice pro včelstvo.` at the end of Svatba's body;
  - another program changes Úkol's `title:` to `Poslat rozpočet`;
  - ten external changes within 500 ms.
- **`Pages/Zdroje textu.md`** (AC-5), with:
  - title `Zdroje textu`, alias `Textové zdroje`, `tags: [kytara]`, `poznamka: harmonika buben`, `description: klavír`;
  - the heading `## Housle` and the paragraph `Sázím #rajče.`;
  - a fence holding `teleskop`;
  - the paragraph `Viz [[Kniha vzpomínek|kniha]] a https://example.com/kometa.`
- **L5 only, in the fake core's answers** (never on disk, so they don't change any stem's count):
  - an entry with a 600-character sentence (AC-23);
  - an entry whose title has 120 characters (AC-22);
  - an entry with `excerpt: null` (AC-23).
- **Index states** (AC-9):
  - an index whose schema version is set one lower;
  - SIGKILL during a 500-file burst. The burst is made of generated notes in a subfolder `Burst/`, removed afterwards.
- **Generated vaults:** `tools/gen-vault --seed 1` (5,000 notes) and `--notes 20000 --small-images`, for AC-3, AC-8 and NFR-PERF-13.
- **External changes** named in the criteria: by the helper process (L6) or the fake core (L5).
