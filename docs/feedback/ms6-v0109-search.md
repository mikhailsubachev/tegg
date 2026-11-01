# Feedback: v0.109, Search (owner, 2026-10-31)

Build v0.109 (main acadf90), the redesigned Search page (PR #98, D-1200…D-1232) on the generated 20k reference vault.
Triage as in `ms5-v052.md`: **bug** means the build contradicts an existing AC, decision or design board; **change**
means new behaviour and needs a D-xx. Decisions are D-1340 onward; points are AP-1200 onward.

| # | Area | Finding | Triage |
|---|---|---|---|
| F1 | Search | Remove the `Go to` section from Search; keep only the search itself | change: AP-1200, AP-1202, AP-1203. Reverses D-760's page part and D-1200, D-1201 |
| F2 | Search | Searching by name doesn't work: `Go to` finds the object by its title, but the results list doesn't put it first. Once `Go to` is gone, Search must prefer a match in the title | bug against D-107 ("title matches rank above body matches"), and a change to D-253's order: AP-1201 |

## Cause of F2

For an unquoted multi-word query, D-253 sorts by tier first (1 exact phrase, 2 all words, 3 any word) and only then by
field. The phrase tier counts a phrase **anywhere** (title, file name, alias, attribute or body), and the field counts
as Title when **any one** query word is in the title. Reproduced on five notes for `summer angstrom`:

| Rank today | Title | Why |
|---|---|---|
| 1 | Summer summer Ångström naïve computer | phrase in the title |
| 2 | Goal Ångström Ångström budget | phrase `summer Ångström` in the **body**, one word in the title; best bm25 |
| 3 | Week dinner friend summer Ångström | phrase in the title |
| 4 | Summer Ångström old by | phrase in the title |
| 5 | River big team summer quarter | one word in the title |

Rank 2 ties with 1, 3 and 4 on (phrase tier, exact, Title) and wins on bm25, because the body repeats both words.

## Points for the owner

Decided 2026-10-31: AP-1200…AP-1203 accepted as proposed → D-1340…D-1343 (BRD v1.140).

| Point | Question | Proposal | Alternative |
|---|---|---|---|
| AP-1200 | **No `Go to` on Search (F1).** D-760 moved quick switching (FR-NAV-01) into the Search page's `Go to` list, and D-1200 kept it on the redesigned page. | The Search page shows the field, the filters, the count line and the results, and nothing between them. Quick switching is the results list itself, ranked title first (AP-1201), with partial words (AP-1202). FR-NAV-01's UI criteria (search-navigation.md AC-15…AC-17) are replaced; its core criteria AC-1…AC-10 stay, because `index.switcher` still answers the `[[` and `@` pickers, the relation picker and the embed picker. ⌘O stays unbound (D-760, AC-18). **Keys:** the caret stays in the field; ↓ moves to the first result row (rows as today: ↑/↓, ⏎ opens, slice P input); ⏎ in the field opens the first result as a new history entry, so Back returns to the search as D-1217 restores it. NFR-PERF-03 (switcher, < 100 ms per keystroke) then applies to the pickers only; Search keeps NFR-PERF-04 (< 200 ms) | (b) ⏎ in the field does nothing; only ↓ then ⏎ opens |
| AP-1201 | **Title first (F2).** | For a text query, results come in three groups. **1 Title:** the title or file name contains every query word: first a title equal to the query, then the words as a phrase in the title, then all words anywhere in the title. **2 Alias:** an alias contains every query word (same three steps). **3 The rest**, in D-253's order (tier, exact before typo, field, bm25). Inside groups 1 and 2: exact words before typo matches (D-101), then bm25, then path. Quoted phrases and `-word` keep their meaning (a quoted phrase must match somewhere, D-253). D-1205 (filters only) is unchanged. For the example above, ranks 1, 3 and 4 come before `Goal Ångström Ångström budget` | (b) a single title score (share of query words in the title) ahead of D-253, so a title with 2 of 3 words also beats a body phrase |
| AP-1202 | **Partial last word.** `Go to` matched a word as you typed it (`summ` found Summer); the full-text search matches whole words only (plus D-101 typos for words of 5+ letters), so with `Go to` gone, typing `summ` finds nothing until the word is complete. | The last unquoted word of the query, when it has at least 2 letters and the query doesn't end with a space, also matches as a word prefix (`summ` finds `summer`, `Summer`, `summertime`), diacritics folded (FR-FMT-12). A prefix-only match ranks after an exact word match inside the same step of AP-1201, as a typo match does. Highlights cover the matched prefix. Other words stay whole-word | (b) no prefix matching: whole words only, as today |
| AP-1203 | **Create without `Go to`.** `Go to` carried `Create "<q>"` and `Create "<q>" as…` (D-106, D-550), and the no-match empty state points to it (D-1201). | While the query has text, the count line ends with a `button` `Create "<q>"` (default type, FR-VLT-05) and a `Type` menu button `as…` (D-550), always visible, so an object can be created even when other objects match. The no-match empty state says `No matches. Create "<q>"?` with the same two buttons. ⌥⏎ in the field creates with the default type; there is no other new shortcut (D-1201: ⌘↩ stays unbound) | (b) the create buttons only in the no-match empty state |

## Red-test points (test author, red tests f50d186)

Decided 2026-11-01: AP-1204…AP-1206 accepted as proposed → D-1344…D-1346 (BRD v1.141).

| Point | Question | Proposal |
|---|---|---|
| AP-1204 | Where the create buttons sit in the count line | After the `status` element, as siblings, so the live region announces only the count |
| AP-1205 | About 25 WebKit AC files and some L6 tests open or create objects through `Go to` | Helpers type the title in `Search query` and press ⏎ on the first row; direct AC uses move to result rows or the create buttons in one `AC-Test-Change` commit |
| AP-1206 | `fr_src_03_ac18_every_string_is_a_catalog_key_with_its_english_text` still checks `search.noMatchBody` | Drop that row in the same commit |

## Build points (build 4efdb9a…6282bdd)

Decided 2026-11-01: AP-1207…AP-1210 accepted as proposed → D-1348…D-1351 (BRD v1.143).

| Point | Question | Proposal | Alternative |
|---|---|---|---|
| AP-1207 | **Back after opening from Search (31 tests).** With `Go to`, opening an object replaced the Search entry (D-760), so Back skipped Search. D-1340 (FR-NAV-01 AC-21) makes it a new entry, so Back now lands on Search. Tests that open notes through the helpers and then expect Back to reach the page before fail: history (10), history_v094 FR-NAV-03 AC-8 (4), editor_save FR-EDT-09 AC-5, rename FR-FMT-08 AC-5, trash FR-HIS-01 AC-1, type_moves FR-STO-04 AC-4, page_width FR-SET-02 AC-7, AC-9 (AC-9 asserts the old replace), graph panel FR-GRP-01 AC-30, AC-31, AC-39, AC-40, FR-GRP-06 AC-8, FR-UX-03 AC-36, FR-GRP-02 AC-33, and regression tests bug_3c, bug_qag2 | One more `AC-Test-Change` commit: these tests open their notes the way they mean to test (or press Back once more over `Search`), keeping every check; page_width AC-9's replace check goes | (b) opening from Search replaces the Search entry again, as `Go to` did; then Back never returns to the search (reverses AC-21 and AC-23) |
| AP-1208 | **Duplicate titles in Search (2 tests).** FR-LNK-14 AC-6 shows D-289's details line (folder, type, modified) for objects with the same title in the quick switcher; result rows show type and date only | Result rows whose titles collide also show the details line, as the pickers do | (b) drop the quick-switcher part of AC-6; the `[[`, `@` and relation pickers keep it |
| AP-1209 | **Typo order in Rust (1 test).** `ac_search.rs` `fr_src_04_ac5_typo_matches_rank_after_exact_matches` expects every typo match after every exact match; under D-1341 a title with a typo (group 1) ranks above an exact body match (AC-24) | Change the test to "after exact matches within the same group step" (`AC-Test-Change`) | — |
| AP-1210 | **Type menu key (FR-VLT-05 AC-3).** AP-478 opened the create row's Type menu with ⌥⏎; D-1343 makes ⌥⏎ in the field create with the default type | The Type menu opens from `as…` (click, or Tab to it and ⏎); FR-VLT-05 AC-3's key part follows (moved in 6282bdd) | (b) another shortcut for the menu |

## Affected documents

- BRD: FR-NAV-01's text, D-760 (page part), D-1200, D-1201, D-253 / D-107 (order), new D-1340…D-1343.
- ACs: `docs/acceptance/search-navigation.md` FR-NAV-01 AC-15…AC-17 replaced, FR-SRC-01 and FR-SRC-03 order criteria,
  the redesign's page elements (board `Search` already shows no `Go to`, FR-NAV-01 AC-19).
- Contract: `docs/contracts/v1-search.md` (search order, prefix, create row).
