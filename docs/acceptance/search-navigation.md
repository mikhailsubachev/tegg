# Acceptance Criteria: Search, Quick Switcher, Progress

See [README](README.md) for conventions. Milestone MS2 (BRD §11.2).

Fixture: `tests/fixtures/vaults/search/` (synthetic, D-50; the test copies `tests/fixtures/vaults/new-empty/.tegg/` next to it). Unless stated otherwise, criteria are checked at the Rust core through the `index.search` / `index.switcher` commands (architecture §5.8, §6), with `TZ=Europe/Prague`. "Results" means the set of object paths returned; order is checked only where stated. Open points AP-46…AP-58 were decided as D-101…D-113 (2026-10-12).

Fixture objects (paths relative to the vault):

| Short name | Path |
| --- | --- |
| Čtení | `Pages/Čtení knih.md` (alias `Reading list`, tag `knihy`) |
| Rozpočet | `Pages/Rozpočet 2026.md` (tag `finance`, body contains `rozpočet projektu` and `výlet`) |
| Projekt | `Pages/Projekt a rozpočet.md` (body contains `projektu` and `rozpočet`, not adjacent) |
| Tomáš | `Tasks/Zavolat Tomášovi.md` (`priority: High`, body contains `rozpočet projektu`) |
| Nápad | `Quick Notes/Nápad na výlet.md` (`review: unreviewed`, tag `cestování`, `created: 2026-10-06T00:30:00+02:00`, body contains `Krkonoš`) |
| Obyčejná | `Pages/Obyčejná poznámka.md` (no frontmatter) |
| Template | `_templates/Page/Šablona stránky.md` |
| Trashed | `.trash/Pages/Smazaný rozpočet.md` |

---

### FR-SRC-01 Full-text search

- **AC-1** Searching `rozpočet` returns exactly {Rozpočet, Projekt, Tomáš, Nápad, Obyčejná}: matches in the title and in body text are both found, and an untyped file without frontmatter is searched by its body (D-103).
- **AC-2** Searching `Tomášovi` returns {Tomáš} (match in the title only).
- **AC-3** Searching `High` returns {Tomáš} (match in an attribute value only, not in title or body).
- **AC-4** Searching `Reading` returns {Čtení} (match in an alias).
- **AC-5** Template files and trashed files are never returned: searching `meruňkách` returns exactly {Čtení}, and no query on the fixture returns Template (FR-TPL-07) or Trashed (D-102).
- **AC-6** Frontmatter keys and YAML syntax are not searchable text: searching `modified` or `aliases` returns no result.
- **AC-7** Search is NFC-insensitive (FR-FMT-12): a query typed in NFD (`rozpočet`) returns the same set as AC-1; a fixture file rewritten in NFD by the test is found by an NFC query.
- **AC-8** After the index is rebuilt (index directory deleted, vault reopened), AC-1…AC-7 return identical results (AR-01).
- **AC-9** After an external edit adds `rozpočet` to `Pages/Čtení knih.md`, a search started 2 s after the write includes Čtení (NFR-PERF-08); after an external delete of `Pages/Rozpočet 2026.md`, it is no longer returned within 2 s.
- **AC-10** Searching causes zero writes to the vault (FR-SYN-06 AC-1).
- **AC-11** On the reference vault (5,000 notes), search results with snippets for the first 50 hits return within the NFR-PERF-04 target (see [performance.md](performance.md), core-level timing; the rendered-UI timing is NFR-PERF-04/AC-1).

The criteria AC-12…AC-17 come from the MS3 3D preview feedback (D-246, `docs/feedback/ms3-3d.md` F1, F2) and use the fixture `tests/fixtures/vaults/search-ranking/` (with `new-empty/.tegg/`). They follow the proposals of AP-185 and AP-186 ([types.md](types.md), end) until the owner decides them. Layers as in [types.md](types.md): L4 = core `index.search` on a temporary copy, L5 = the `search` route with the fake core.

- **AC-12** [MS3] **File names are searched (D-246).** Searching `lipno` returns exactly {`Pages/Lipno víkend.md`}, whose title (`Dům u vody`) and body don't contain the word; `LIPNO`, `lípno` and `vikend` return the same set (folded case and diacritics, FR-SRC-04 AC-4). The trashed `Lipno účet chaty.md` and the template `Lipno šablona.md` are never returned (FR-SRC-01 AC-5). Only the file stem is matched: `md` and `Pages` return no result (AP-186). *(L4)*
- **AC-13** [MS3] **NFC and renames.** After the test renames `Pages/Lipno víkend.md` to an NFD-encoded `Pages/Lípno víkend.md`, an NFC query `lípno` returns it within 2 s (FR-FMT-12, NFR-PERF-08); after an external rename to `Pages/Chata.md` (same `id`), `lipno` no longer returns it and `chata` does, within 2 s. Searching writes nothing (FR-SRC-01 AC-10). After deleting the index and reopening, AC-12 gives the same results (AR-01). *(L4)*
- **AC-14** [MS3] **File-name hits are shown (AP-186).** In the `search` route, the `lipno` result shows the title `Dům u vody` and the line `File name: Lipno víkend` (catalog label, user content) with `Lipno` highlighted by offsets (FR-SRC-03 AC-2); its snippet is the start of the body without a highlight. A result whose title also matches shows no file-name line. *(L5; L4 for the offsets)*
- **AC-15** [MS3] **Ranking tiers (D-246).** For the unquoted query `účet chaty`, the result order is: tier 1, the exact phrase (the words adjacent and in order, folded): `Účet chaty` (title), then `Přesná fráze` (body), because a title match ranks above a body match inside a tier (D-107, AP-185); tier 2, all words but not as the phrase: `Obě slova`; tier 3, any word: `Jedno slovo` and `Druhé slovo` (their mutual order is not checked). Every tier-1 result ranks above every tier-2 result, every tier-2 above every tier-3. The folded query `ucet chaty`, the query typed in NFD and `ÚČET CHATY` give the same order. *(L4; L5 checks the rendered order once)*
- **AC-16** [MS3] **Operators keep their meaning (D-108, AP-185).** The quoted `"účet chaty"` returns exactly {`Účet chaty`, `Přesná fráze`}, in that order; `účet chaty -opravy` returns the AC-15 order without `Druhé slovo`; a single-word query (`účet`) has one tier and keeps the D-107 order (title, then attribute, then body). The MS2 criteria AC-1…AC-9 and FR-SRC-04 AC-1…AC-7 still pass on `search/` (their single-word and quoted queries return the same sets). *(L4)*
- ~~**AC-17** [MS3] **Typo matches stay below (D-101, AP-185).** For `účet chatty` (one letter more than `chaty`), a typo-matched word counts as a matched word for the tiers: the results are the AC-15 set in the AC-15 tiers. With a runtime note `Pages/Překlep.md` whose body is `Účet chatty.`, that note is first in tier 1 (exact words) and `Účet chaty` and `Přesná fráze` (typo-matched) follow it in tier 1. *(L4)*~~ Superseded by D-1341 (v0.109): see AC-24.

### FR-SRC-02 Search filters

- **AC-1** **Type:** `rozpočet` filtered to type Task returns {Tomáš}; filtered to Page returns {Rozpočet, Projekt, Obyčejná} (untyped files count as Page, D-103).
- **AC-2** **Tag:** `rozpočet` with tag `finance` returns {Rozpočet}; tag `knihy` with an empty query returns {Čtení} (a filter alone, without text, is a valid search).
- **AC-3** **Created date:** with `TZ=Europe/Prague`, `rozpočet` with created on `2026-10-06` returns {Nápad}; created on `2026-10-05` returns no result; created from `2026-08-01` to `2026-10-31` returns {Rozpočet, Tomáš, Nápad}.
- **AC-4** **Created date, other time zone (D-104):** with `TZ=America/New_York`, created on `2026-10-06` returns no result and created on `2026-10-05` returns {Nápad}, because dates are compared in the machine's time zone.
- **AC-5** **Modified date:** modified from `2026-09-01` to `2026-09-30` with an empty query returns {Rozpočet}. Files without a `modified` key follow D-103.
- **AC-6** **Attribute value:** `priority` = `High` returns {Tomáš}; `priority` = `Low` returns no result (D-109).
- **AC-7** **Review status:** review = `unreviewed` returns {Nápad}; objects without a `review` key never match a review filter.
- **AC-8** Filters combine with AND: type Quick Note + tag `cestování` + `rozpočet` returns {Nápad}; adding tag `finance` returns no result.
- **AC-9** Tag filter values compare NFC-normalized and case-insensitively per FR-TAG (tag `Cestování` and `cestování` select the same objects).

### FR-SRC-03 Result presentation

- **AC-1** Each result carries the object's type (resolving to the type's icon from `.tegg/types/`), its title (from `title:`, else the file name without `.md`) and a snippet. For `rozpočet`, the Tomáš result has type `task`, title `Zavolat Tomášovi`.
- **AC-2** The snippet contains the matched text with each match marked by start and end offsets (not by HTML in the text). Snippet text comes from the body and never contains frontmatter or block markers (`## `, `- `). Snippet length and result granularity follow D-107.
- **AC-3** A diacritic-insensitive match is highlighted on the original text: searching `zlutoucky` returns Čtení with the highlight covering `žluťoučký` exactly.
- **AC-4** Each result carries the location of the first body match: for `meruňkách` the Čtení result points to line 24 of the file (1-based) and the byte offset of `meruňkách` in that line.
- **AC-5** [MS3] [manual] Opening a result opens the note in the editor scrolled so that the match from AC-4 is visible and highlighted.
- **AC-6** [MS3] [manual] The search UI shows the type icon, title and highlighted snippet for each result, in light and dark themes.
- **AC-7** **Type icons (D-236, D-519; v0.52 feedback).** Search results and quick switcher rows show the result's type icon as an SVG (`data-icon` = the type's icon), the same as the sidebar row of that type: a user type with `icon: lightbulb` shows the lightbulb; a Page the page icon. No emoji glyphs (`📄`, `◆`) are shown. *(L5; regression `bug_v052_fr_src_03_type_icons_in_search`)*

### FR-SRC-04 Search operators, diacritics, typos

- **AC-1** **Phrase:** `"rozpočet projektu"` returns exactly {Rozpočet, Tomáš}; Projekt (both words, not adjacent) is not returned.
- **AC-2** **Exclusion:** `rozpočet -krkonoš` returns {Rozpočet, Projekt, Tomáš, Obyčejná} (Nápad excluded); exclusion is diacritic-insensitive (`-krkonos` gives the same set).
- **AC-3** **Phrase and exclusion together:** `"rozpočet projektu" -tomášovi` returns {Rozpočet}.
- **AC-4** **Diacritics:** `rozpocet` returns the same set as `rozpočet` (FR-SRC-01 AC-1); `CTENI` returns {Čtení} (case-insensitive); a test-added note whose body is `cteni bez hacku` is returned by the query `čtení` (folding applies to both query and text).
- **AC-5** **Typos (D-101):** `rozpcoet` (two letters swapped) and `rozpočt` (one letter missing) each return the FR-SRC-01 AC-1 set, ranked after any exact match; words of four letters or fewer are never typo-matched: `kus` returns no result although it is one letter from `kůň`.
- **AC-6** A lone `-` or a `-` inside a word is not an operator: `2026-10` searches the text `2026-10`, and `-` alone returns no error (D-108).
- **AC-7** An unclosed quote (`"rozpočet projektu`) is treated as a phrase to the end of the query and never raises an error to the user.

### FR-NAV-01 Quick switcher

- **AC-1** **Titles and aliases:** `cteni` ranks Čtení first; `reading` returns Čtení (via its alias) and shows the alias it matched.
- **AC-2** **Fuzzy:** `ztom` (letters in order) returns Tomáš; `tomasovi` returns Tomáš (diacritic-insensitive, FR-FMT-12 AC-4).
- **AC-3** **Match quality order** (S4 tiers, D-105): for the query `rozpo`, Rozpočet (title prefix) ranks above Projekt (word prefix inside the title); objects whose title doesn't match are not returned (body text is not searched by the switcher).
- **AC-4** **Recency (D-105):** given two objects in the same match tier, the one opened more recently in Tegg ranks first; opening the other one (recorded via the core command that opens a note) swaps their order on the next query. Recency data lives in Application Support, never in the vault (FR-STO-07), and opening causes no vault write.
- **AC-5** **Shown data:** each result carries type (for the icon) and the folder relative to the vault (`Tasks` for Tomáš, `Pages` for Obyčejná).
- **AC-6** Template and trashed files never appear (FR-TPL-07, D-102).
- **AC-7** **Create when nothing matches (D-106):** for the query `Nová myšlenka` (no match), the switcher offers a single "create" item; confirming it creates `Nová myšlenka.md` in the default type's folder (FR-VLT-05: `Quick Notes/` in a new vault, D-24; `Pages/` when the default is Page; file name per FR-FMT-08) with `title: Nová myšlenka` in NFC, writes exactly one file, and the new object is returned by the next switcher query within 2 s.
- **AC-8** NFC: a query typed in NFD returns the same results as the NFC query.
- **AC-9** **Latency:** on the reference vault, every keystroke of the queries `c`, `ct`, `cteni`, `rozpočet 2026` and `zzzzzzzzzz` returns results from the core in < 100 ms × 75% (NFR-PERF-03, D-59); the rendered timing is NFR-PERF-03/AC-1.
- **AC-10** After an external rename of `Pages/Čtení knih.md` to `Pages/Knihy.md` (same `id`), within 2 s `knihy` returns the object under its new path and folder, and `cteni` still returns it (title unchanged).
- ~~**AC-11** [manual] ⌘O opens the switcher from anywhere in the main window with the cursor in its field; ↑/↓ and ⏎ select and open a result without the mouse (FR-UX-03).~~ Superseded by D-760: see AC-15…AC-18.

### FR-NAV-01 The Search page's `Go to` list (D-760; preview v0.68 feedback F9)

Fixture `search/` in the fake core (L5). ⌘O and the `Quick switcher` dialog are gone; the core's `index.switcher` (AC-1…AC-10) answers the Search page's `Go to` list.

- ~~**AC-15** **`Go to` rows.** On `search`, typing `cteni` in `Search query` shows, above `Search results`, a `listbox` `Go to` whose first `option` is Čtení, selected (`aria-selected="true"`, the field's `aria-activedescendant`), with its type icon (`data-icon`) and the folder `Pages`; `reading` shows Čtení with `alias: Reading list`; `rozpo` lists Rozpočet before Projekt (AC-3). At most 8 options; an empty query shows no `Go to` list. The full-text `Search results` below are unchanged (FR-SRC-01, FR-SRC-03). *(L5)*~~ Superseded by D-1340 (v0.109): see AC-20.
- ~~**AC-16** **Keyboard.** The caret stays in `Search query`: ↓/↑ move the selection through `Go to` (wrapping), ⏎ opens the selected object's route (`note/<path>`, `daily/<date>`, `tag/<key>` per D-692); the jump replaces the `search` entry in the history, so Back returns to the page Search was opened from, as the ⌘O switcher did (FR-NAV-03 AC-1 unchanged), while a full-text result keeps `search` in the history; Tab moves to the next control and then into the full-text results; Esc in the field returns to the page Search was opened from (it clears the query when there is none). *(L5)*~~ Superseded by D-1340 (v0.109): see AC-21.
- ~~**AC-17** **Create.** `Nová myšlenka` (no match) shows the create option `Create "Nová myšlenka"` (plus its `as…` row, D-550) and no object; ⏎ creates it through the one creation path (D-232) as AC-7 (`Quick Notes/Nová myšlenka.md`, one write) and opens it with the caret at the end of its title (editor.md AC-13, D-367); the option's Type menu (D-550, FR-VLT-05 AC-3) chooses another type before creating. *(L5)*~~ Superseded by D-1343 (v0.109): see AC-22.
- **AC-18** **No ⌘O.** On every built route of R1, ⌘O opens no dialog, changes no route and writes nothing; no element named `Quick switcher` or `Switcher query` exists; the palette lists no `Search or jump to` / `Quick switcher` command; R4 has no ⌘O row; ⇧⌘F (and the sidebar `Search` button, app-shell FR-NAV-01 AC-14) opens `search` with the caret in `Search query` and its text selected. *(L5; L1 for R4)*

### FR-UX-07 Non-blocking progress

- **AC-1** **Indexing progress:** opening the reference vault with no index emits `index:progress` events with `done` and `total` counts; `done` never decreases, `total` is fixed once known, the last event has `done == total`, and at least one event is emitted per 500 ms while indexing runs (D-110).
- **AC-2** **Non-blocking:** while the full index of AC-1 runs, `index.switcher` and `note.read` calls return in < 100 ms (p95), and the switcher returns results for the files indexed so far.
- **AC-3** **Cancel (D-110):** cancelling an operation marked cancellable stops it within 1 s, emits a final progress event with a `cancelled` state, and leaves the vault byte-identical to before (for indexing: no vault write ever; for jobs: cancel is offered only before the write phase, architecture §5.6).
- **AC-4** [MS4] Bulk jobs (rename, tag rename, attribute rename, bulk type change) report `job:progress` with the same rules as AC-1 and AC-3.
- **AC-5** [MS7] The Capacities import reports progress and can be cancelled (FR-IMP-07) with the same rules as AC-1 and AC-3. *(v1.0, slice I1, by D-801 and D-1535; verified by import-capacities.md FR-UX-07 AC-13. The `[MS7]` marker stays for now: the gate has no v1.0 marker, and without one this criterion would be checked by the MS2 gate, tools/qa/CONTRACT.md §9.4)*
- **AC-6** [MS3] [manual] Progress is shown in the UI without a modal dialog; the user can keep typing in an open note while it runs.

---

## Search page redesign (preview v0.94 feedback; board `Search`)

**Status: approved (owner, 2026-10-30; AP-1100…AP-1122 → D-1200…D-1222, BRD v1.120).** Owner feedback on preview v0.94: "redesign search according to artboard `Search`" and "allow filtering results by type and tag". Board: `design/edit-note-page/Search.dc.html` (states `results`, `tag filter only`, `no results`, `no match`, `empty`; light and dark). The criteria below follow the proposals of AP-1100…AP-1122 (table at the end of this section), each decided as proposed. They add to FR-SRC-01 AC-1…AC-17, FR-SRC-02 AC-1…AC-12 (incl. tags.md AC-10…AC-12), FR-SRC-03 AC-1…AC-7 and FR-NAV-01 AC-15…AC-18; none of those changes. The board's sidebar `⌘O` button is stale (D-760) and is not a requirement.

**Layers.** L4 = core `index.search` on a temporary vault, `TZ=Europe/Prague` unless stated. L5 = the `search` route in WebKit with the fake core, UI language English, region `cs-CZ` (`__TEGG_REGION__`), Date & time › `Date format` = `ISO` unless stated (D-566), `TZ=Europe/Prague`. L1 = unit tests of tokens and the catalog.

**Fixture.** The shared `search/` fixture can't take new objects: `fr_src_02_ac5_*` asserts the exact set of objects with a `modified` date, and `fr_src_02_ac9_*` the exact set tagged `cestování` (AP-1122). The new criteria use `search/` **plus an overlay** `tests/fixtures/vaults/search-page/` (new, synthetic, D-50; written byte-exact by the red-test author: LF, UTF-8 without BOM, NFC): the test copies `search/`, then `search-page/`, then `new-empty/.tegg/` into one temporary vault. The overlay holds exactly these three files:

`search-page/Pages/Chata na horách.md` (short name **Chata**; frontmatter tags plus an inline tag, an attribute the Page type doesn't define):

```
---
id: 01JA0S0000000000000000S006
type: page
title: Chata na horách
tags:
  - hory
  - zima
místo: Špindlerův Mlýn
created: 2026-10-10T09:00:00+02:00
modified: 2026-10-12T08:15:00+02:00
---
Seznam věcí na chatu: lyže, čaj, deky.

Platí se ze společné pokladny. #účty
```

`search-page/Quick Notes/Pozdní zápis.md` (**Pozdní**; `modified` in UTC: 2026-10-05 23:00 UTC, i.e. 2026-10-06 01:00 in Prague):

```
---
id: 01JA0S0000000000000000S007
type: quick-note
title: Pozdní zápis
tags:
  - hory
created: 2026-10-04T10:00:00+02:00
modified: 2026-10-05T23:00:00Z
---
Zapsáno v noci, čas je v UTC.
```

`search-page/Pages/Horská bouda.md` (**Bouda**; `modified` 2026-10-05 22:30 UTC: 30 minutes *before* Pozdní, although its text sorts *after* Pozdní's):

```
---
id: 01JA0S0000000000000000S008
type: page
title: Horská bouda
tags:
  - hory
created: 2026-10-03T10:00:00+02:00
modified: 2026-10-06T00:30:00+02:00
---
Bouda pod hřebenem, bez elektřiny.
```

With the overlay the vault has 9 objects: Page 6 (Čtení, Rozpočet, Projekt, Obyčejná, Chata, Bouda), Quick Note 2 (Nápad, Pozdní), Task 1 (Tomáš). None of the three files contains a word of the MS2 queries, so FR-SRC-01 AC-1…AC-7 and FR-SRC-04 return the same sets on the combined vault. Runtime notes (paging, NFD) are written by the tests and named where used.

### Page elements (board `Search`; AP-1100, AP-1103, AP-1115, AP-1119)

Top to bottom in the centre pane:

| Element | Role | Accessible name / content |
| --- | --- | --- |
| Heading | `heading` level 1 | `Search` (no `Back` link above it, AP-1115) |
| Search region | `search` landmark | holds the field, `Clear search` and the shortcut hint |
| Field | `searchbox` | name `Search query` (unchanged), placeholder `Search for a phrase` |
| Clear search | `button` | `Clear search`; present only while the field is not empty |
| Shortcut hint | text, `aria-hidden` | `⇧⌘F` |
| Filters | `group` `Filters` | `Type` filter, `Filter by tag` (tags.md AC-10), `Clear filters` |
| Type filter | `button`, `aria-haspopup="menu"` | `Type: all` or `Type: <Name>` (R82's control); visually the board's pill (label `Type`, the value bold and the pill filled when on); menu `Type` with `menuitemradio`s `All types`, then `<Name> <count>` |
| Clear filters | `button` | `Clear filters`; present only while a type or a tag is selected |
| ~~Go to~~ | — | Removed by D-1340 (v0.109): nothing between `Filters` and the count line (FR-NAV-01 AC-20) |
| Count | `status` | the count line (FR-SRC-03 AC-9) |
| Results | `list` `Search results` | one `listitem` per object |
| Row | `listitem` holding a `link` (the row) and the row's tag chip `button`s | link name = the title; description = `<Type name>` and the date |
| Show next | `button` | `Show next <k>` (FR-SRC-03 AC-12) |
| Empty state | `region` named by its title | icon (decorative), title, body, optional `Clear filters` button (FR-SRC-03 AC-14…AC-16) |

### FR-SRC-01 Full-text search: row data from the core (board `Search`)

- **AC-18** **Modified and tags in every result (AP-1106, AP-1111).** Each result also carries the object's `modified` value as written in its frontmatter (ISO 8601 with offset; none when the key is missing or isn't a valid date-time, D-103: never a file-system date) and its tag keys (frontmatter and inline, NFC, lower case, de-duplicated; FR-SRC-02 AC-9). On the combined vault: `mlyn` returns Chata with `modified` `2026-10-12T08:15:00+02:00` and tags {`hory`, `účty`, `zima`}; `rozpočet` returns Rozpočet with {`finance`}, Nápad with {`cestování`}, Tomáš and Obyčejná with no tags, and Obyčejná with no `modified`. A runtime note `Pages/Špatné datum.md` (`modified: včera`, body `jeřabina`) returns no `modified` for `jeřabina`. After the test rewrites Chata's inline tag as NFD bytes (`#účty`), the tag key is still `účty` (NFC) within 2 s. *(L4)*
- **AC-19** **Highlights in the title, alias and attribute (AP-1108, AP-1109, AP-1110).** Each result carries highlight ranges (`[start, end)` in UTF-16 code units, as snippets, FR-SRC-03 AC-2) for its title, and the matched alias or attribute when the match is there:
  - Title: `rozpočet` gives Rozpočet `Rozpočet 2026` [0, 8) and Projekt `Projekt a rozpočet` [10, 18); `rozpocet`, `ROZPOČET` and the NFD query give the same ranges; the typo query `rozpcoet` (D-101) gives Rozpočet [0, 8) with `typo` set. A result matched only in its body or file name has no title ranges.
  - Alias: `reading` gives Čtení the alias `Reading list` with [0, 7) (matched in `alias`).
  - Attribute: `High` gives Tomáš the attribute key `priority`, text `High`, [0, 4); `mlyn` gives Chata the key `místo`, text `Špindlerův Mlýn`, [11, 15) (folded match, highlight on the original text, FR-SRC-03 AC-3). The text is the matched value as written in the file: for a list, only the matched item; a value longer than 160 characters is cut to ≤ 160 characters around the first match, like a snippet (D-107). When several attributes match, the first in frontmatter order is returned. Values of `id`, `type`, `title`, `aliases`, `tags`, `created`, `modified` are never an attribute match (FR-SRC-01 AC-6). *(L4)*
- **AC-20** **Snippet or the body's lead (AP-1107).** When the body contains a match, the snippet is as FR-SRC-03 AC-2. When it doesn't (match in the title, alias, attribute or file name, or a search with filters and no text), the snippet is the start of the body (≤ 160 characters, no frontmatter, no block markers) with **no** highlight ranges, as D-254's file-name hits (FR-SRC-01 AC-14): `High` → Tomáš's snippet starts `Probrat rozpočet projektu a termín výletu.` with no ranges; `mlyn` → Chata's starts `Seznam věcí na chatu: lyže, čaj, deky.` with no ranges; `Tomášovi` → Tomáš, the same lead. A runtime note with frontmatter only (`Pages/Jen hlavička.md`, `title: Jen hlavička borůvka`) searched by `borůvka` has no snippet. *(L4)*
- **AC-21** **The new fields follow the files (AR-01, NFR-PERF-08).** After an external edit adds `- zima` to Bouda's `tags:` and sets its `modified` to `2026-10-13T07:00:00+02:00`, the filter `#zima` returns {Chata, Bouda} with Bouda first and its new tags and `modified`, within 2 s. After the index is deleted and the vault reopened, AC-18…AC-20 and FR-SRC-02 AC-15 return identical results. Searching writes nothing to the vault (FR-SRC-01 AC-10). *(L4)*
- **AC-22** **Speed with the new fields (NFR-PERF-04).** On the reference vault (5,000 notes), the first page (50 results) with every field of AC-18…AC-20 returns within the NFR-PERF-04 core target for the text query of FR-SRC-01 AC-11 and for a filter-only search (`Type: Page`, no text, ordered as FR-SRC-02 AC-15). *(L4, perf)*

### FR-SRC-02 Search filters: Type filter and filter-only search (board `Search`)

- **AC-13** **The Type filter control (AP-1103).** The `Filters` group shows `Type: all` first, then `Filter by tag`. Activating `Type: all` opens the menu `Type` with the `menuitemradio`s `All types` (checked), `Page 6`, `Quick Note 2`, `Task 1`: every type with at least one object (templates and `.trash/` don't count, D-102, FR-TPL-07), by singular name in D-122 order (`cs` and `en`), with the vault-wide count of the sidebar Types list (`index_type_counts`); untyped files count as Page (D-103). Choosing `Task` closes the menu, the button reads `Type: Task` and is shown filled with the value in bold, and focus returns to the button. A runtime note `Recepty/Svíčková.md` with `type: recept` (no type definition) adds the option `recept 1` after the defined types (D-121). Tag, Image and PDF are listed when they have objects. Single select only. *(L5)*
- **AC-14** **Type results (AP-1103).** With `Type: Page` and no text, the results are exactly {Chata, Bouda, Čtení, Rozpočet, Projekt, Obyčejná}; `Type: Task` → {Tomáš}; `rozpočet` with `Type: Page` → {Rozpočet, Projekt, Obyčejná} in the order `rozpočet` alone gives them (D-253 unchanged by filters); `Type: Quick Note` + `#hory` → {Pozdní}; `Type: Task` + `#hory` → nothing (all filters AND, FR-SRC-02 AC-8). The UI sends the chosen type as the only entry of the query's `types`; `Type: all` sends none. *(L4 for the sets; L5 for the rendered rows)*
- **AC-15** **Filter-only order: newest modified first (AP-1105).** A search with a filter and no text returns results ordered by the `modified` instant, newest first, compared as instants (not as text, not by the written offset); results without a valid `modified` come last; ties by path. `#hory` → Chata, Pozdní, Bouda (Pozdní's `2026-10-05T23:00:00Z` is newer than Bouda's `2026-10-06T00:30:00+02:00`); the same order with `TZ=America/New_York`. `Type: Page` → Chata, Bouda, Čtení, Rozpočet, Projekt, Obyčejná. With text, the order is D-253's whatever the filters. *(L4; L5 checks the rendered order once)*
- **AC-16** **Clear filters (AP-1113).** `Clear filters` is absent with `Type: all` and no tag; it appears when a type or a tag is selected. Activating it sets `Type: all`, removes every tag chip, keeps the query text, re-runs the search, removes itself and moves focus to `Search query`. With `rozpočet`, `Type: Task` and `#finance` (no results), `Clear filters` shows the 5 results of FR-SRC-01 AC-1. *(L5)*
- **AC-17** **Filter state lives with the Search page, not in the vault (AP-1117).** The query, the Type filter, the tag filter and the loaded pages belong to the `search` history entry: after opening a result with ⏎ and going Back, `search` shows the same text, `Type: Quick Note`, `#hory`, the same rows and the row that was opened focused. They aren't stored anywhere else: after a relaunch `search` opens empty with `Type: all` (unlike the tag page's D-703 state); no file in the vault and nothing in `ui-state` changes when filters change. A `Go to` jump replaces the entry (FR-NAV-01 AC-16), so its state is gone, as today. *(L5; L6 once for the relaunch)* **v0.109 (D-1340):** with `Go to` gone, every jump from Search is a result opened as a new history entry, so Back always restores the `search` state (FR-NAV-01 AC-21).
- **AC-18** **Tag chips in rows add the filter (D-706, FR-SRC-02 AC-12; AP-1111).** Each tag chip in a result row is a `button` named `Filter by #<display name>` (outside the row's link, so it doesn't open or preview the row, previews.md AP-819). Activating `#zima` on Chata's row (query `mlyn`) adds `#zima` to `Filter by tag`, re-runs the search and keeps the text; activating a chip whose tag is already selected changes nothing. The chip never opens `tag/<key>` here (D-703 is for chips elsewhere). *(L5)*

### FR-SRC-03 Result presentation: the redesigned page (board `Search`)

- **AC-8** **Layout (board `Search`; AP-1100, AP-1115, AP-1119).** `search` shows the elements of the table "Page elements" in that order: heading `Search`; the `search` region with `Search query` (placeholder `Search for a phrase`), `Clear search` only while there is text, and the hint `⇧⌘F`; the `Filters` group; the `Go to` list (only with text); the count line; `Search results`; `Show next <k>` when more results exist. No `Back` link inside the page. ⇧⌘F still focuses `Search query` with its text selected (FR-NAV-01 AC-18). *(L5)* **v0.109 (D-1340):** there is no `Go to` list between the `Filters` group and the count line; the count line ends with the create buttons (FR-NAV-01 AC-22).
- **AC-9** **Count line (AP-1104; D-133 plural forms).** The `status` shows the total number of results (not the loaded rows): with text, `<n> results` / `1 result` whatever the filters (`rozpočet` → `5 results`; `High` → `1 result`); without text, by the filters: tags only `<n> objects with #hory` (`3 objects with #hory`; several tags as their display names in the filter's order separated by spaces, `1 object with #hory #zima`); type only `<n> objects of type Page` (`6 objects of type Page`); both `1 object of type Quick Note with #hory`. The tag filter's hint `Objects with all selected tags` (tags.md AC-11) is unchanged. No count line in the empty states (AC-14…AC-16). *(L5; L1 for the plural forms)*
- **AC-10** **Row contents (board `Search`; AP-1106…AP-1111).** Each row shows, top to bottom: the type icon (FR-SRC-03 AC-7); the title with its matches highlighted (FR-SRC-01 AC-19), then the typo mark `similar spelling` when `typo` is set, then the type's singular name (`Page`, `Task`, `Quick Note`; an undefined type's raw value; untyped → `Page`), and right-aligned the modified date (AC-11; nothing when there is none); a line `File name: <stem>` (FR-SRC-01 AC-14, unchanged), `Alias: <alias>` or `<attribute label>: <value>` when the match is there, with the highlight; the snippet (highlighted) or the body's lead (not highlighted, FR-SRC-01 AC-20); the object's tags as chips `#<display name>` (D-711) in D-122 order, coloured as FR-TAG-05 AC-6 (neutral on this fixture, which has no Tag files). The attribute label is the label the attribute panel shows for that key: `Priority: High` for Tomáš (`High`), `místo: Špindlerův Mlýn` for Chata (`mlyn`; Page doesn't define `místo`). Examples on the combined vault: `rozpočet` → first row `Rozpočet 2026` (`Rozpočet` highlighted) · `Page` · `2026-09-20`, highlighted snippet, chip `#finance`; Obyčejná's row has `Page`, no date and no chips; `reading` → Čtení with `Alias: Reading list` (`Reading` highlighted); `mlyn` → Chata with chips `#hory`, `#účty`, `#zima` in that order (`cs` and `en`). Title, values, snippets and tags are user content (`data-user-content`), never parsed as HTML. *(L5)*
- **AC-11** **Modified date per the Date & time setting (D-566, D-781; AP-1106).** The date is the local calendar date of the `modified` instant in the machine's zone (D-104), date only, in the `Date format` setting: with `ISO`, under `#hory`: Chata `2026-10-12`, Pozdní `2026-10-06`, Bouda `2026-10-06`; with `TZ=America/New_York`: `2026-10-12`, `2026-10-05`, `2026-10-05`. With `Region` (`cs-CZ`): Chata `12. 10. 2026`; with `Long`: `12 October 2026`. After the `Date format` is changed in Settings › Date & time, Back to `search` shows the rows in the new format within 1 s, with the page's state restored (D-1226). No relative labels (`Today`, `Yesterday`, weekday names). *(L5)*
- **AC-12** **Paging: `Show next` (D-107; AP-1112).** With 60 runtime notes `Pages/Hromada 01.md`…`Hromada 60.md` (`type: page`, `tags: [hromada]`, `modified` `2026-08-01T10:00:00+02:00` plus `<i>` minutes, body `Poznámka číslo <i>: ostružiník.`): `ostružiník` shows `60 results`, 50 rows and `Show next 10` (k = the smaller of 50 and the rows not yet loaded); activating it appends rows 51–60 below the first 50 (no row repeated or missing, the order is the order of one query with limit 100), keeps the scroll position, moves focus to row 51, and removes the button. `#hromada` without text pages the same way in AC-15 order (`Hromada 60` first). At L4: offset 0 / limit 50 followed by offset 50 / limit 50 gives the same 60 paths in the same order as offset 0 / limit 100, for both queries. *(L4; L5)*
- **AC-13** **Clear search (AP-1113).** With `rozpočet` and `#finance`, `Clear search` empties the field, keeps `#finance` and the type, re-runs the search as filter-only (`1 object with #finance`), hides the `Go to` list and itself, and moves focus to `Search query`. Esc keeps FR-NAV-01 AC-16's meaning. *(L5)* **v0.109 (D-1340):** there is no `Go to` list to hide.
- **AC-14** **Empty state: nothing to search (AP-1114).** With no text, `Type: all` and no tag, the page shows below the filters an icon, the title `Search all your objects` and the body `Type a phrase to search titles, text, file names and attribute values, or pick a type or tag. A filter alone is a search too.`; no count line, no `listitem` in `Search results`, no `Show next`. This is what `search` shows when it opens. *(L5)*
- **AC-15** **Empty state: no results with filters (AP-1114).** With text: `rozpočet`, `Type: Task`, `#hory` shows the title `No results for “rozpočet”`, the body `Nothing matches “rozpočet” with Type Task and #hory. Clear the filters to search everything.` and a `Clear filters` button (same action as AC-16; afterwards `5 results`). The filter list is the UI language's conjunction list (`Intl.ListFormat`) of `Type <Name>` and each `#<tag>` in the filter's order: with `#hory` and `#finance` and no type, `… with #hory and #finance.`. Without text: `Type: Task` + `#hory` shows the title `No objects with Type Task and #hory`, the body `Clear the filters to search everything.` and `Clear filters`. The query in the copy is shown as typed, trimmed, in typographic quotes, as user content. *(L5)*
- ~~**AC-16** **Empty state: no match without filters (AP-1101, AP-1102, AP-1114).** `borůvkový koláč` with no filters shows the title `No results for “borůvkový koláč”` and the body `Nothing in this vault matches “borůvkový koláč”. Use Create “borůvkový koláč” above to make it.`; there is no separate create button and ⌘↩ does nothing here. The `Go to` list above shows `Create "borůvkový koláč"` (selected, D-106) with its `as…` row (D-550); ⏎ in the field creates `Quick Notes/borůvkový koláč.md` with one write through the one creation path (FR-NAV-01 AC-17, D-232). The copy never says "exact phrase" (D-253 tiers). *(L5)*~~ Superseded by D-1343 (v0.109): see FR-NAV-01 AC-22.
- **AC-17** **Keyboard and names (FR-UX-03; AP-1118).** Tab order from `Search query`: `Clear search` (when shown), `Type: …`, `Filter by tag`, `Clear filters` (when shown), then each row's link followed by its tag chip buttons, then `Show next <k>`; ↓/↑/⏎ in the field keep driving `Go to` (FR-NAV-01 AC-16). The Type menu opens with ⏎, Space or ↓ on its button with focus on the checked item; ↑/↓ move, ⏎ or Space chooses and closes, Esc closes without a change; focus returns to the button either way. With focus on a row link, ↓/↑ move to the next/previous row link (chips skipped), ⏎ opens the object (`note/<path>`, `daily/<date>`, `tag/<key>`), a click previews (D-930). Every control has the accessible name in the "Page elements" table; the row link's name is the title and its description contains the type name and the date. The palette gets no new commands (`Search` and ⇧⌘F stay the way in). *(L5)* **v0.109 (D-1340):** ↓/⏎ in the field follow FR-NAV-01 AC-21 instead of driving `Go to`; Tab order gains `Create “<q>”` and `as…` after `Clear filters` while the count line shows them (AC-22).
- **AC-18** **Strings (NFR-OTH-02, D-133).** Every string of AC-8…AC-17 comes from the catalog (no literal UI text in the components): `Search for a phrase`, `Clear search`, `Filters`, `Type: all`, `Type: {type}`, `All types`, `Clear filters`, `Alias: {alias}`, `Show next {count}`, `Filter by #{tag}`, the four count messages, and the empty-state titles and bodies. Count messages and `Show next {count}` use `Intl.PluralRules` categories; with the Czech test catalog `1`, `3` and `6` objects pick three different forms, and no message concatenates a number with a word. `File name: {stem}` and `similar spelling` are unchanged. *(L1; L5)*
- **AC-19** **Light and dark (FR-UX-05, D-129).** The highlight uses the `sel-hl` token (light `#FFE7A3`, dark `#5A4718`): text on it, and every text token used on the page (`text`, `muted` for the type name, date, labels and lead), has a contrast of at least 4.5:1 in both themes; tag chips use FR-TAG-05's tokens. Switching the theme while `search` shows results changes no row, filter or focus. [manual] The five board states (`results`, `tag filter only`, `no results`, `no match`, `empty`) look as on the board in light and dark (except the deviations listed in AP-1100…AP-1122). *(L1 for the tokens; L5; manual for the look)*
- **AC-20** **Zero writes (FR-SYN-06 AC-1, FR-STO-07).** Typing, choosing a type, adding and removing tags (combobox and row chips), `Clear search`, `Clear filters`, `Show next`, opening and closing the Type menu and every empty state leave the vault byte-identical (content hash and mtime of every file) and write nothing under Application Support besides what opening a note already records (D-138); SQLite's `*-shm` file is excluded (D-1227). The only write the page can make is the `Go to` create (FR-NAV-01 AC-17). *(L4 for the core calls; L5)* **v0.109 (D-1343):** the only writes the page can make are the create buttons and ⌥⏎ (FR-NAV-01 AC-22).
- **AC-21** **Live updates keep the loaded rows (NFR-PERF-08; AP-1112).** With the 60 runtime notes of AC-12 and both pages loaded and the 55th row focused, an external edit that adds `ostružiník` to Čtení makes the list show 61 rows (count `61 results`) within 2 s without dropping the loaded rows (the refresh asks for the loaded count plus the new matches, D-1225), with the same row focused and the scroll position kept; an external delete of `Hromada 01.md` removes its row within 2 s. *(L5)*

### FR-NAV-01 The `Go to` list on the redesigned page (D-760)

- ~~**AC-19** **`Go to` keeps working (AP-1100, AP-1120).** On the redesigned page the `Go to` list sits between the `Filters` group and the count line; FR-NAV-01 AC-15…AC-18 pass unchanged (their test files are not modified; the field keeps the name `Search query`, the results list `Search results`). The Type and tag filters don't narrow `Go to`: with `Type: Task`, `cteni` still offers Čtení first. With an empty query there is no `Go to` list (AC-15) and the empty state of FR-SRC-03 AC-14 or the filter-only results show instead. *(L5)*~~ Superseded by D-1340 (v0.109): see AC-20.

### Open points for the redesign (AP-1100…AP-1122 → D-1200…D-1222, decided as proposed; red-test points AP-1123…AP-1130 → D-1223…D-1230, contract `docs/contracts/v1-search.md` §6)

| # | Issue | Proposal | Alternatives | Affects |
| --- | --- | --- | --- | --- |
| AP-1100 → D-1200 | **`Go to` list (D-760) vs. the board.** The board has no `Go to` list. | Keep it (FR-NAV-01 is M, D-760 is recent); it sits between the filters and the count line, only while there is text. The board shows only the full-text part. | (b) Below the results. (c) Drop `Go to` (reverts D-760). | FR-SRC-03 AC-8, FR-NAV-01 AC-19 |
| AP-1101 → D-1201 | **No-match `Create page "<q>"` button.** It duplicates the `Go to` create option (default type, Type menu, D-106, D-550) and creates a *Page*, while every create path uses the default type (FR-VLT-05; Quick Note in a new vault). Its `⌘↩` hint has no binding. | No separate button; the body points to `Create "<q>"` in `Go to` above; ⌘↩ is not bound. | (b) A button `Create “<q>”` with the default type through the same path (D-232), no ⌘↩. (c) As the board: `Create page` (always Page). | FR-SRC-03 AC-16 |
| AP-1102 → D-1202 | **"exact phrase" copy vs. D-253.** Unquoted words are ranked in tiers (phrase, all words, any word), so "Nothing contains this exact phrase" is wrong for most queries. | Copy says "matches": `Nothing in this vault matches “<q>”.` / `Nothing matches “<q>” with …`. Search behaviour unchanged. | (b) Make unquoted queries exact phrases (reverts D-253). | FR-SRC-03 AC-15, AC-16 |
| AP-1103 → D-1203 | **The Type filter.** Single or multi; options, order, counts; control. The board draws a `listbox` pill `Type All`; the tag page's Type filter is a menu button `Type: all` with `menuitemradio`s (R82, D-722). | Single select (as D-722); R82's control and names with the board's look; options = every type with ≥ 1 object (incl. Tag, Image, PDF; undefined types by raw value after the rest, D-121), singular names in D-122 order, vault-wide counts (`index_type_counts`); untyped = Page (D-103). | (b) Multi-select. (c) Counts of the current results per type (needs a facet query). (d) Sidebar order (D-121) instead of D-122. | FR-SRC-02 AC-13, AC-14 |
| AP-1104 → D-1204 | **Count line wording.** The board shows `5 results` and `14 objects with #finance`; no wording for a type, or for both. | With text `<n> results` (filters not repeated); without text `<n> objects with #a #b`, `<n> objects of type <Name>`, `<n> objects of type <Name> with #a`. Plural forms by D-133 (no plural type names). | (b) Always `<n> results`. | FR-SRC-03 AC-9, AC-18 |
| AP-1105 → D-1205 | **Filter-only order.** Today the core orders filter-only results by path. The board shows newest modified first. | `modified` instant, newest first; missing or invalid `modified` last; ties by path (a tie-break, not a name sort). With text, D-253 unchanged. | (b) Title in D-122 order. (c) Keep path order. | FR-SRC-02 AC-15, FR-SRC-01 AC-22 |
| AP-1106 → D-1206 | **The date on a row.** The board shows relative dates (`Today`, `Yesterday`, `Tue`, `19 Oct`); D-781 keeps the Date & time setting everywhere. The brief suggested "file mtime when there is no `modified`", which contradicts D-103 (no file-system dates). | Frontmatter `modified` only; date only, local date in the machine's zone, in the `Date format` setting (D-566); no date when `modified` is missing or invalid; no relative labels. | (b) Relative labels as the board (an exception to D-781). (c) Fall back to the file's mtime (changes D-103). | FR-SRC-01 AC-18, FR-SRC-03 AC-10, AC-11 |
| AP-1107 → D-1207 | **Snippet when the body has no match.** Today the snippet is empty (except D-254 file-name hits); the board shows the body's lead for file-name and filter-only rows and nothing for its attribute-match task. AP-52 said "title or attribute when the body doesn't match", D-107 only "around the first body match". | The body's lead (≤ 160 characters) without highlight whenever the body has no match (title, alias, attribute, file name, filter only); nothing when the body is empty. The attribute and alias get their own line (AP-1108, AP-1109). | (b) No snippet unless the body matches (the board's task row). | FR-SRC-01 AC-20, FR-SRC-03 AC-10 |
| AP-1108 → D-1208 | **The attribute line.** Which attribute when several match; its label; how a list, a long value or a date is shown. D-781 formats dates by the setting, but the highlight is on the matched text. | The first matching attribute in frontmatter order; label = the attribute panel's label (schema name, else the key as written); the value as written in the file (a list: the matched item; > 160 characters: a window around the match); dates shown as written, because the line shows the matched text. | (b) Dates by the setting and the whole value highlighted. (c) One line per matched attribute. | FR-SRC-01 AC-19, FR-SRC-03 AC-10 |
| AP-1109 → D-1209 | **Alias matches.** The core knows a match is in an alias (`matched_in: alias`, FR-SRC-01 AC-4) but the board shows no alias line, so the row doesn't say why it matched. | A line `Alias: <alias>` with the highlight, like `File name:` (D-254). | (b) No line (as the board). | FR-SRC-01 AC-19, FR-SRC-03 AC-10, AC-18 |
| AP-1110 → D-1210 | **Title highlights and the typo mark.** The board highlights matches in titles (the core gives no title ranges today) and has no typo mark. | Title ranges from the core, incl. typo-matched words (D-101); keep the `similar spelling` mark after the title. | (b) Drop the typo mark. | FR-SRC-01 AC-19, FR-SRC-03 AC-10 |
| AP-1111 → D-1211 | **Tag chips on rows.** The board's chips are plain text; D-706 and tags.md AC-12 say a `#tag` activated in Search adds it to the filter. A button inside the row link isn't valid. | All the object's tags (frontmatter and inline), display names (D-711), D-122 order, coloured; each a `button` `Filter by #<tag>` outside the row link that adds the tag (no-op when already selected). | (b) Decorative chips (as the board; tags.md AC-12 then has no row chips to test). (c) Frontmatter tags only. | FR-SRC-01 AC-18, FR-SRC-02 AC-18, FR-SRC-03 AC-10, AC-17 |
| AP-1112 → D-1212 | **Paging.** The board shows `Show next 50`; AP-52 said "more on scroll"; nothing says what happens to loaded pages on a live update. | A button `Show next <k>` (k = min(50, remaining)) appends the next page, keeps the scroll, focuses the first new row; a live refresh re-queries from offset 0 with the loaded count, keeping the focused row. | (b) Always `Show next 50`. (c) Infinite scroll. (d) A refresh drops back to the first 50. | FR-SRC-03 AC-12, AC-21 |
| AP-1113 → D-1213 | **`Clear search` and `Clear filters`.** Scope and focus aren't on the board. | `Clear search` clears the text only (filters stay, the search becomes filter-only); `Clear filters` clears type and tags only (text stays); both move focus to `Search query`. The empty state's `Clear filters` is the same action. | (b) `Clear search` clears everything. | FR-SRC-02 AC-16, FR-SRC-03 AC-13, AC-15 |
| AP-1114 → D-1214 | **Empty-state copy.** The board covers three states; a filter-only search without results has none, and its `no results` body lists "Type Task and tag #q4" (wording for several tags undefined). | AC-14…AC-16's copy: filters listed with `Intl.ListFormat` as `Type <Name>` and `#<tag>`; filter-only: title `No objects with <filters>`, body `Clear the filters to search everything.`; the query in typographic quotes, as typed and trimmed. | (b) One generic `No results` body for all cases. | FR-SRC-03 AC-14…AC-16, AC-18 |
| AP-1115 → D-1215 | **`Back` link above the heading.** Only the Search board has one; the title bar has Back/Forward and Esc leaves Search (FR-NAV-01 AC-16). | Leave it out. | (b) Add it here only. (c) Add it to every page (a separate change). | FR-SRC-03 AC-8 |
| AP-1116 → D-1216 | **The other FR-SRC-02 filters** (created, modified, attribute value, review). The core has them (FR-SRC-02 AC-3…AC-7); D-706 kept them out of the UI for 4D-lite; the feedback asks for type and tag only. | Still out of the UI; no criterion added. | (b) Add a `Modified` and a `Review` filter now. | FR-SRC-02 (scope) |
| AP-1117 → D-1217 | **Where the filter state lives.** The tag page remembers its Type filter per machine (D-703); Search's tag filter isn't remembered (tags.md AC-12). | Query, filters, loaded pages and focus belong to the `search` history entry (Back restores them); nothing is remembered across relaunch, nothing in `ui-state` or the vault. | (b) Remember the Type filter in `ui-state` like the tag page. | FR-SRC-02 AC-17, FR-SRC-03 AC-20 |
| AP-1118 → D-1218 | **Keyboard and the palette.** The working conventions say every new action is reachable from the palette (FR-UX-03); these are page-local controls. Rows have no arrow-key navigation today. | Tab order and the menu keys of FR-SRC-03 AC-17; ↓/↑ between row links (as tag page rows, FR-TAG-06 AC-7); no new palette commands. | (b) Palette commands `Search: Filter by type…` and `Search: Clear filters`. | FR-SRC-03 AC-17 |
| AP-1119 → D-1219 | **Names, placeholder and shortcut hint on the board.** The board names the field `Search all objects` (existing AC tests use `Search query`), its placeholder is `Search for a phrase` (today `Search notes`), and the hint reads `⌘⇧F` (D-126 writes Apple's order, `⇧⌘F`). | Keep the name `Search query`; take the board's placeholder; show `⇧⌘F` (decorative). | (b) Rename the field as the board (needs `AC-Test-Change` on FR-NAV-01 AC-15…AC-18 and FR-SRC-01 AC-15 tests). | FR-SRC-03 AC-8, FR-NAV-01 AC-19 |
| AP-1120 → D-1220 | **Do filters narrow `Go to`?** D-760 defines `Go to` as the switcher's answer (titles and aliases). | No: `Go to` ignores the Type and tag filters (it's a jump list). | (b) The Type filter applies to `Go to` too. | FR-NAV-01 AC-19 |
| AP-1121 → D-1221 | **Housekeeping found on the way.** D-781 says "the vault's Date & time setting", but D-566 makes it per machine; the board's sidebar still has the ⌘O `Search or jump to` button (removed by D-760). | Fix D-781's wording to "the Date & time setting (per machine, D-566)"; update the board's sidebar to the `Search` button (app-shell FR-NAV-01 AC-14). No criterion changes. | — | D-781, board `Search` |
| AP-1122 → D-1222 | **Fixture.** Adding objects to `search/` breaks `fr_src_02_ac5_*` (exact set with a `modified` date) and `fr_src_02_ac9_*` (exact set tagged `cestování`). | A new overlay `tests/fixtures/vaults/search-page/` with the three files above (tag `hory`, an inline `#účty`, an undefined attribute `místo`, a UTC `modified` that sorts differently as text and as instant), copied on top of `search/` by the new tests only; written byte-exact by the red-test author, plus a row in `tests/fixtures/vaults/README.md`. | (b) Add the files to `search/` and change the two tests (`Fixture-Change` and `AC-Test-Change`). | all ACs of this section |

---

## Search without `Go to` (preview v0.109 feedback; D-1340…D-1343)

Source: `docs/feedback/ms6-v0109-search.md` (F1 remove `Go to`, F2 title matches first), AP-1200…AP-1203 → D-1340…D-1343, decided as proposed. Layers as above: L4 = core `index.search` on a temporary copy, L5 = the `search` route in WebKit with the fake core, L6 = the built app.

Fixture `search-title/` (runtime notes, written by the tests into a temporary copy of `search-ranking/` with `new-empty/.tegg/`; every note has `type: page`, an `id` and `modified: 2026-10-01T09:00:00+02:00`):

| Short name | Path | Title | Aliases | Body |
| --- | --- | --- | --- | --- |
| Rovno | `Pages/Rovno.md` | `Summer Ångström` | | `Plain text.` |
| Fráze | `Pages/Fráze.md` | `Summer Ångström old by` | | `Nothing here.` |
| Slova | `Pages/Slova.md` | `Ångström notes for summer` | | `Other words.` |
| Alias | `Pages/Alias.md` | `Výlet` | `Summer Ångström trip` | `Plain text.` |
| Tělo | `Pages/Tělo.md` | `Goal Ångström budget` | | `Zürich summer Ångström. Summer Ångström again, summer Ångström.` |
| Řeka | `Pages/Řeka.md` | `River summer quarter` | | `Later ångström appears.` |
| Deník | `Pages/Summer Ångström log.md` | `Deník` | | `Plain text.` |

### FR-SRC-01 Title first (D-1341)

- **AC-23** **Title, then alias, then the rest.** On `search-title/`, `summer angstrom` returns, in this order: Rovno (the title equals the query, folded); then Fráze and Deník (the words as a phrase in the title or, for Deník, in the file name; their mutual order is not checked); then Slova (all words in the title, not as a phrase); then Alias (an alias contains every word); then Tělo (both words in the body as a phrase, only one in the title); then Řeka (both words, not as a phrase, one in the title). Tělo ranks below every note of groups 1 and 2 although its body repeats the phrase (its bm25 is the best). For the reversed `ANGSTROM SUMMER` no title equals the query and none holds it as a phrase, so Rovno, Fráze, Deník and Slova form one step (all words in the title or file name, ordered by bm25 then path; their mutual order is not checked), then Alias, then Tělo, then Řeka. The query typed in NFD gives the same order as NFC. *(L4; L5 checks the rendered order once)*
- **AC-24** **Typo matches inside the groups (D-1341, D-101; replaces AC-17).** On `search-ranking/` with the runtime note `Pages/Překlep.md` (body `Účet chatty.`), `účet chatty` returns `Účet chaty` first (its title holds both words, `chaty` by a typo: group 1), then `Překlep` (both words exact, as a phrase, in the body), then `Přesná fráze` (body phrase, typo), then `Obě slova`, then `Jedno slovo` and `Druhé slovo` (mutual order not checked). Without `Překlep`, the order is AC-15's. *(L4)*
- **AC-25** **The MS3 order still holds where no title has every word.** FR-SRC-01 AC-15 and AC-16 pass unchanged (`Účet chaty` equals the query and is the only title with both words); FR-SRC-02 AC-14's `rozpočet` with `Type: Page` keeps the order `rozpočet` alone gives; D-1205's filter-only order (FR-SRC-02 AC-15) is unchanged. *(L4)*

### FR-SRC-04 The last word as a prefix (D-1342)

- **AC-8** **Prefix of the last word.** On `search/`, `rozpo` returns exactly {Rozpočet, Projekt, Tomáš, Nápad, Obyčejná} (the FR-SRC-01 AC-1 set), with Rozpočet and Projekt (title words starting `rozpo`) before the other three; `cten` returns {Čtení}; `CTEN` and `čten` return the same; `rozpočet pro` returns Projekt first (its title `Projekt a rozpočet` holds both words, `pro` as the prefix of `Projekt`), then Rozpočet and Tomáš (the body phrase `rozpočet projektu`; mutual order not checked), then Nápad and Obyčejná (`rozpočet` only). *(L4)*
- **AC-9** **When the prefix rule doesn't apply.** `rozpo ` (a trailing space) returns no result (no word `rozpo`); a one-letter last word doesn't match as a prefix (`r` returns no result); a quoted word never does (`"rozpo"` returns no result); only the last word does (`rozpo výlet` returns exactly {Rozpočet, Tomáš, Nápad}: `výlet` matches `výlet` and, as a prefix, Tomáš's `výletu`, while `rozpo` is not the last word and matches nothing, so Projekt and Obyčejná are not returned); an excluded word is whole-word (`rozpočet -kr` excludes nothing). `kus` still returns no result (FR-SRC-04 AC-5: no word in the fixture starts with `kus`). *(L4)*
- **AC-10** **Rank and highlight.** In one group step, an exact word match ranks before a prefix-only match: with the runtime notes `Pages/Sůl.md` (title `Sůl`) and `Pages/Sůlová lázeň.md` (title `Sůlová lázeň`), `sůl` lists Sůl before Sůlová lázeň. A prefix-only match is not a typo: the result has no `typo` flag, and the row shows no `similar spelling` mark. The title highlight covers the matched prefix only: `cten` gives Čtení `Čtení knih` the range [0, 4). *(L4; L5 for the mark)*
- **AC-11** **Speed (NFR-PERF-04).** On the reference vault (5,000 notes), each keystroke query `s`, `su`, `sum`, `summ`, `summe`, `summer`, `summer a`, `summer an` returns its first page (50 results with every field of FR-SRC-01 AC-18…AC-20) within the NFR-PERF-04 core target. *(L4, perf)*

### FR-NAV-01 Quick switching on the Search page (D-1340, D-1343)

- **AC-20** **No `Go to`.** On `search` with `cteni`, `rozpo` or `Nová myšlenka` in `Search query`, there is no element named `Go to` and no `option` on the page; `Search query` has no `aria-activedescendant` and no `aria-controls`; the elements between the `Filters` group and `Search results` are the count line and the create buttons (AC-22) only. With `cteni`, the first row of `Search results` is Čtení. The pickers that use `index.switcher` (`[[`, `@`, the relation picker, the embed picker) are unchanged (FR-NAV-01 AC-1…AC-10); ⌘O stays unbound (AC-18). *(L5)*
- **AC-21** **Keys in the field.** The caret stays in `Search query` while typing. ↓ moves the focus to the first row's link (FR-SRC-03 AC-17's row keys from there); ↑ on the first row returns the focus to `Search query`. ⏎ in the field opens the first result (`note/<path>`, `daily/<date>`, `tag/<key>`) as a new history entry: with `cteni`, ⏎ opens `note/Pages/Čtení knih.md`, and Back returns to `search` with `cteni`, the same filters and rows, and the focus in `Search query` (D-1217). ⏎ with no results, or with an empty query, does nothing and writes nothing. Esc keeps its meaning (it returns to the page Search was opened from, or clears the query when there is none). *(L5)*
- **AC-22** **Create buttons.** While the query has text and results are shown, the count line ends with a `button` `Create “<q>”` and a `button` `as…` (`aria-haspopup="menu"`): with `cteni`, `1 result`, `Create “cteni”`, `as…`. Activating `Create “cteni”` creates `Quick Notes/cteni.md` (the default type, FR-VLT-05) with one write through the one creation path (D-232) and opens it with the caret at the end of its title (editor.md AC-13, D-367), even though Čtení matches. `as…` opens the `Type` menu (D-550, FR-VLT-05 AC-3); choosing `Page` creates `Pages/cteni.md`. ⌥⏎ in the field creates with the default type, as the button. With no text there are no create buttons. With no match and no filters (`borůvkový koláč`), the empty state shows the title `No results for “borůvkový koláč”`, the body `No matches. Create “borůvkový koláč”?` and the same two buttons; ⏎ in the field does nothing there (no first result), ⌥⏎ creates `Quick Notes/borůvkový koláč.md`. ⌘↩ does nothing on `search`. The empty state with filters (FR-SRC-03 AC-15) is unchanged. *(L5; L6 once for the created file)*
- **AC-23** **Strings and writes.** `Create “{query}”`, `as…` and `No matches. Create “{query}”?` come from the catalog (NFR-OTH-02); the `Go to` strings are gone from it. Typing, ↓/↑, ⏎ on a result and Back write nothing to the vault (FR-SRC-03 AC-20); the only writes the page makes are the create buttons and ⌥⏎, one file each. *(L1; L5)*
