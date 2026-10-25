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
- **AC-17** [MS3] **Typo matches stay below (D-101, AP-185).** For `účet chatty` (one letter more than `chaty`), a typo-matched word counts as a matched word for the tiers: the results are the AC-15 set in the AC-15 tiers. With a runtime note `Pages/Překlep.md` whose body is `Účet chatty.`, that note is first in tier 1 (exact words) and `Účet chaty` and `Přesná fráze` (typo-matched) follow it in tier 1. *(L4)*

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

- **AC-15** **`Go to` rows.** On `search`, typing `cteni` in `Search query` shows, above `Search results`, a `listbox` `Go to` whose first `option` is Čtení, selected (`aria-selected="true"`, the field's `aria-activedescendant`), with its type icon (`data-icon`) and the folder `Pages`; `reading` shows Čtení with `alias: Reading list`; `rozpo` lists Rozpočet before Projekt (AC-3). At most 8 options; an empty query shows no `Go to` list. The full-text `Search results` below are unchanged (FR-SRC-01, FR-SRC-03). *(L5)*
- **AC-16** **Keyboard.** The caret stays in `Search query`: ↓/↑ move the selection through `Go to` (wrapping), ⏎ opens the selected object's route (`note/<path>`, `daily/<date>`, `tag/<key>` per D-692) and the Back button returns to `search` with the query kept; Tab moves to the next control and then into the full-text results; Esc in the field clears the query. *(L5)*
- **AC-17** **Create.** `Nová myšlenka` (no match) shows the create option `Create "Nová myšlenka"` (plus its `as…` row, D-550) and no object; ⏎ creates it through the one creation path (D-232) as AC-7 (`Quick Notes/Nová myšlenka.md`, one write) and opens it with the caret in the body per editor.md FR-EDT-02 AC-13; the option's Type menu (D-550, FR-VLT-05 AC-3) chooses another type before creating. *(L5)*
- **AC-18** **No ⌘O.** On every built route of R1, ⌘O opens no dialog, changes no route and writes nothing; no element named `Quick switcher` or `Switcher query` exists; the palette lists no `Search or jump to` / `Quick switcher` command; R4 has no ⌘O row; ⇧⌘F (and the sidebar `Search` button, app-shell FR-NAV-01 AC-14) opens `search` with the caret in `Search query` and its text selected. *(L5; L1 for R4)*

### FR-UX-07 Non-blocking progress

- **AC-1** **Indexing progress:** opening the reference vault with no index emits `index:progress` events with `done` and `total` counts; `done` never decreases, `total` is fixed once known, the last event has `done == total`, and at least one event is emitted per 500 ms while indexing runs (D-110).
- **AC-2** **Non-blocking:** while the full index of AC-1 runs, `index.switcher` and `note.read` calls return in < 100 ms (p95), and the switcher returns results for the files indexed so far.
- **AC-3** **Cancel (D-110):** cancelling an operation marked cancellable stops it within 1 s, emits a final progress event with a `cancelled` state, and leaves the vault byte-identical to before (for indexing: no vault write ever; for jobs: cancel is offered only before the write phase, architecture §5.6).
- **AC-4** [MS4] Bulk jobs (rename, tag rename, attribute rename, bulk type change) report `job:progress` with the same rules as AC-1 and AC-3.
- **AC-5** [MS7] The Capacities import reports progress and can be cancelled (FR-IMP-07) with the same rules as AC-1 and AC-3.
- **AC-6** [MS3] [manual] Progress is shown in the UI without a modal dialog; the user can keep typing in an open note while it runs.
