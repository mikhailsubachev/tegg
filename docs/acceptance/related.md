# Acceptance Criteria: Related notes (slice REL)

See [README](README.md) for conventions. Slice **REL "Related notes"** (D-1677, D-1678; plan `docs/plans/related-notes-plan.md`), released as **0.3.0**. It adds a `Related` tab to the right panel. For the open object, the tab lists the objects whose text shares the most distinctive words with it, best first, as chips with one excerpt each. Words are compared by **stem** after **folding** case and diacritics, so `důležité`, `dulezite` and `důležitých` are one word (D-1682). The slice follows the owner's boards `design/edit-note-page/Related.dc.html` (light) and `RelatedDark.dc.html` (dark), sections A–F. Where the board and a decision differ, the board cites the owner's answers of 2026-11-14; those answers still need a D-number (AP-1449…AP-1451). Where neither decides, a criterion follows the **proposal** of an AP point at the end of this file and names it.

Related notes only read. They write nothing to the vault (DIA-8). Their only stored state is the machine-local `Show linked notes` switch (`ui-state.json`, `related.showLinked`, D-1695) and the remembered panel tab.

**Status: draft, 2026-11-14.** AP-1449…AP-1477 (end of this file) are pending the owner. Contract: `docs/contracts/v1-related.md` (to be written after these criteria, plan §9). The names used here (`index_related`, `stem_cs`, `RelatedParams`, `related.toggleLinked`, `data-related-excerpt`) are the proposal the contract starts from.

**Scope.**
- **FR-LNK-15** (new, D-1677): the index side (R179…R181: folding, stop words, the two stemmers, the stem table, signature, candidates, the linked filter, the cut-off) and the panel side (R178, R182, R183: the tab, entries, excerpt, empty state, switch, commands, live updates, no background work). The plan's DIA-1…DIA-8 rules are criteria here (Trace).
- **NFR-PERF-13** (new, D-1687), and NFR-PERF-06 with the tab on screen.
- The slice's parts of FR-NAV-05 (the tab), FR-STO-07 (the switch), FR-SYN-06 and FR-FMT-07 (nothing written), FR-FMT-12 (NFD), FR-SRC-04 (search unchanged, D-1694), FR-UX-03, FR-UX-08, FR-UX-05 and NFR-OTH-02.

Reference tables R178…R183.

**Out of scope** (plan §8): embeddings, synonyms, Unlinked mentions (FR-LNK-05), stemming in search (D-1694), user-editable stop words (D-1693), tuning (`RelatedParams` changes after preview feedback and the evaluation command, D-1690; the command itself is not a gate step and has no criterion here beyond "prints numbers only", AC-35), tabs (FR-NAV-06).

**Risk tiers** (test-strategy §3). Related notes write nothing, so their **T1** risk is a write they shouldn't make (FR-SYN-06 AC-47, FR-FMT-07 AC-31). Their main risk is **T2, silently wrong data**:
- a stem that differs between `důležité` and `dulezite`, or between NFC and NFD bytes;
- a list built from a stale or partial stem table (the index is a cache, AR-01);
- a Tag, Image, PDF, template or trashed object in the list, or a linked object shown while the switch is off;
- the list of another object after a navigation;
- a cut-off that drops or keeps the wrong entries.

Those criteria name exact fixture objects and are marked **(T2)**. The rest is T3/T4.

**Test layers** (as in [graph-panel.md](graph-panel.md) and [outline.md](outline.md)):

| Tag | Layer |
| --- | --- |
| L0 | Static rules (dependencies, licences, no colour or string literal) |
| L1 | Unit tests. Rust: the pipeline of R179, `stem_cs`, the English stemmer, the signature and cut-off functions with given inputs. TS (Vitest): the tab component, the catalog, the registry |
| L2 | Property tests (proptest): a fixed seed plus one random seed per push, 10 × 1,000 runs nightly (TS-L2) |
| L4 | Rust: `tegg-index` and the core on a temporary copy of the fixture on APFS (`crates/*/tests/ac_*.rs`); external changes made through the watcher; a write counter on the one write function |
| L5 | **WebKit.** Playwright on WebKit with the fake core over mocked IPC. The fake core answers `index_related` from the fixture README's expected lists and records every call with its arguments. Playwright's clock drives every timing (300 ms, 1,000 ms, 2 s) |
| L6 | **Real app.** Appium `mac2` on the built app with `TEGG_TEST=1`, a temporary Application Support and a temporary copy of the fixture. Vault checks use bytes, mtime and inode. Every AC whose layer names L6 has an `app/e2e/` test in the red-test commit (D-382). Keys go only to Tegg (D-799) |
| manual | Owner design review, recorded in `qa/manual/` |

**Test clock** (L5, L6 with `TEGG_TEST=1`), unless a criterion says otherwise:
- `2026-11-14T10:00:00+01:00` (a Saturday), Europe/Prague, region `en-US`.
- Window 1,440 × 900, sidebar open (232 px).
- `ui-state.json` holds `rightPanel: { open: true, tab: 'related', width: 288 }` and no `related` key (so linked notes are hidden).
- Object preview *Hover to preview*, delay 1,000 ms (the default, D-1164).
- `prefers-reduced-motion` off.

Each criterion names a suggested test name (`Test:`). A test may split a criterion into several tests with the same prefix.

**Fixtures** (synthetic, D-50; committed with this draft):
- `tests/fixtures/format/stem/cs.tsv` and its README: the Czech stemmer's golden list (D-1691), 362 rows, with the rule set it was computed by.
- `tests/fixtures/vaults/related/` with `tests/fixtures/vaults/new-empty/.tegg/` copied in (D-1692). Its README lists every file, the stems each note shares with its neighbours, the expected list of every object with linked notes hidden and shown, and the files made at runtime.

Short names used below (paths in the fixture README):

| Short | Path | Role |
| --- | --- | --- |
| Souhvězdí | `Pages/Souhvězdí.md` | 18 shared astronomy words; links to Hvězda 01 |
| Hvězda 01…12 | `Pages/Hvězda 01.md` … `Pages/Hvězda 12.md` | in pairs, each pair shares 3 of Souhvězdí's words; Hvězda 02 links to Souhvězdí |
| Rozpočet | `Pages/Rozpočet na offsite 2027.md` | the board's note |
| Den 30. 9. | `Daily/2026-09-30.md` | a Daily Note, written without diacritics |
| Úkol | `Tasks/Poslat návrh rozpočtu financím.md` | a Task, To do, due 2026-11-27 |
| Termíny | `Pages/Důležité termíny školení.md` | twin A |
| Terminy | `Pages/Dulezite terminy skoleni.md` | twin B: Termíny with every diacritic removed (DIA-6) |
| Školení | `Quick Notes/Školení a dodavatel.md` | the twins' neighbour, `review: unreviewed` |
| Kniha | `Pages/Kniha vzpomínek.md` | nominative forms (`kniha`, `Praha`, `ruka`, `domek`) |
| Poznamky | `Quick Notes/Poznamky ke knize.md` | oblique forms without diacritics (`knize`, `Praze`, `ruce`, `domku`) |
| Zahrada | `Pages/Zahrada na jaře.md` | links to Záhon; Semínka links to it |
| Záhon | `Pages/Záhon s rajčaty.md` | linked from Zahrada |
| Semínka | `Quick Notes/Semínka na jaro.md` | links to Zahrada |
| Včelstvo | `Pages/Včelstvo na zimu.md` | shares 3 stems with each excluded object |
| Prohlídka | `Pages/Jarní prohlídka úlu.md` | Včelstvo's only valid neighbour |
| Včelaření | `Tags/Včelaření.md` | Tag object with a body |
| Úl u lesa | `Images/Úl u lesa.md` | Image object with a body |
| Návod | `PDFs/Návod ke krmení.md` | PDF object with a body |
| Šablona | `_templates/Page/Včelí deník.md` | template |
| Starý úl | `.trash/Pages/Starý úl.md` | trashed |
| Hiking | `Pages/Hiking in the mountains.md` | English |
| Trail | `Pages/Trail notes.md` | English |
| Túra | `Pages/Túra v horách.md` | Czech, on Hiking's topic |
| gear list | `Pages/gear list.md` | English, no frontmatter (a Page, D-103) |
| Mléko | `Quick Notes/Koupit mléko.md` | 3 stems |
| Buben | `Quick Notes/Buben.md` | exactly 4 stems |
| Kytara | `Quick Notes/Kytara.md` | exactly 5 stems |
| Kroužek | `Pages/Hudební kroužek.md` | contains all of Kytara's stems |
| Svatba | `Pages/Svatba Petra a Lucie.md` | the board's no-match note |
| Prázdná | `Pages/Prázdná.md` | empty body |

**Shared definitions.**
- **Stems of an object**: the result of R179 for its text. **Distinct stems**: the set of them over both columns.
- **Linked hidden** / **linked shown**: the switch off / on (`showLinked: false` / `true` in `index_related`).
- **Untouched**: bytes, mtime and inode unchanged.
- **The list** of an object: `index_related(path, showLinked)`'s `entries`, in order.

---

## Reference tables

### R178. The Related tab (FR-LNK-15, FR-NAV-05; boards `Related` A–D, `RelatedDark`)

Accessible names are catalog strings (R183) except titles and excerpt text (user content, `data-user-content`).

| Part | Role / element | Name, content and rules |
| --- | --- | --- |
| Tab | `tab` `Related` in the `Context panel`'s `tablist`, `data-command="panel.related"` | the **third** tab: Backlinks, Graph, Related (board A; AP-1452). No count badge and no count description (D-1688). Selecting it stores `rightPanel.tab: 'related'` (AP-1457) |
| Tab panel | `tabpanel` `Related` | the header, then the list or one state; scrolls vertically; the header stays at the top |
| Header | `switch` `Show linked notes` (`role="switch"`, `aria-checked`), `data-command="related.toggleLinked"` | shown in every state of the tab, including the empty state (board D) |
| List | `list` `Related notes` (AP-1472) | at most 10 `listitem`s, in the order `index_related` returns; no groups, no group headers, no count heading (board A) |
| Entry | `listitem` | in this order: (1) the D-600 chip of the object (`a.chip.link-chip`, `data-link-kind="note"`, `data-icon`, the D-633 suffix and review ring), the entry's only focusable element; (2) the mark `Linked` (`data-related-linked`), only with linked shown and only on a linked object (board B); (3) the excerpt, a `p` with `data-related-excerpt` (R182). Pointer hover gives the whole entry the `--hover` background (board C) |
| Empty | text `No related notes` | the one empty state for every case without entries (AP-1450, AP-1458) |
| Loading | `status` live region `Loading…` | only from 300 ms after a request with no answer, and while the index isn't ready (AP-1460) |

### R179. From text to stems (plan §3.1, §3.3; DIA-1, DIA-5; D-1689; AP-1464, AP-1466)

1. **Text.** The `rel` table's **title** column holds the stems of `title` and `aliases` (else the file name, D-103). The **body** column holds the stems of the body as search reads it (`text::words` on the raw body: code, link targets and aliases, URLs included), of its headings (also counted with weight 2 in the signature), and of the names in `tags:` (inline `#tags` are already body words). Other frontmatter keys and values, `description` included, are not text here (AP-1464).
2. **Fold** with `text::fold`: NFC, lower case, combining marks removed (`Čtení` → `cteni`), so NFC and NFD bytes give the same word (FR-FMT-12).
3. **Drop stop words**: words in the folded Czech list or the English list (D-1693), for every note (AP-1466).
4. **Drop numbers**: a word made only of digits.
5. **Stem** with the note's stemmer (rule 7).
6. **Drop stems shorter than 3 characters** (`den` → `dn`).
7. **Language** (D-1681, AP-1466): count the note's words in each stop-word list, ignoring words that are in both lists (`a`, `to`, `do`, `on` …). The note is English when it has at least 3 English stop words and more English than Czech ones; otherwise Czech. Czech uses `stem_cs` (R180); English uses the Snowball English (Porter2) stemmer (D-1680).

Templates (`_templates/`) and `.trash/` have no `rel` row (AP-1463). `fts` and `rel` are written in the same transaction (D-1694).

### R180. The Czech stemmer on folded text (D-1680, D-1682, D-1691; AP-1467, AP-1468)

`stem_cs(w)` takes a folded word. Its rules are those of Dolamic and Savoy's light stemmer (Lucene's `CzechStemmer`), with every ending written folded. The exact rule set is in `tests/fixtures/format/stem/README.md`, and the golden list `cs.tsv` is its contract. Four points differ from Lucene because folding loses information. They are listed in AP-1467: `št → sk` also applies to a plain `st`, the possessive `-ín` is stripped like `-in`, Lucene's `ů → o` is dropped, and the fleeting-`e` rule also removes an `e` that was `ě`. A fifth change is proposed in AP-1468: after the fleeting `e` is removed, a stem that ends in `ct` or `st` becomes `ck` or `sk`, so `rozpočet` and `rozpočtu` give one stem.

### R181. Signature, candidates and cut-off (plan §3.4; D-1683…D-1685; AP-1455, AP-1462, AP-1463, AP-1465, AP-1473)

1. **N and df.** N is the number of `rel` rows. A stem's df is the number of rows that contain it, from `rel`'s `fts5vocab`. Tag, Image and PDF objects have rows and count; templates and `.trash/` have none (AP-1463).
2. **Signature.** Each stem of the open object is weighted: tf counts a title or alias occurrence 3 times, a heading occurrence 2 times, any other once; then tf·idf. Stems with df = 1 (no other object) or df > 10 % of N are removed first. Of the rest, the 25 with the highest tf·idf are the signature, ties broken by stem in code-point order (AP-1462).
3. **Floor.** An object with fewer than 5 distinct stems gets no entries and `reason: 'short'` (D-1685, AP-1455). It can still be a candidate in other objects' lists.
4. **Candidates.** One FTS5 query, the signature stems joined by `OR`, ranked by `bm25(rel, 3.0, 1.0)`.
5. **Removed.** The object itself and any file with the same `id` (a conflict copy, AP-1473); Tag, Image and PDF objects (D-1684). When linked notes are hidden, every object linked with the open one in either direction (AP-1465: the two are linked when either is among the other's `index_backlinks` sources).
6. **Cut-off.** An entry shares at least 3 signature stems and scores at least 35 % of the best remaining entry. At most 10 entries are kept, after the linked filter, so the cap applies to the list as shown (D-1695).
7. **Order.** Score descending. Equal scores are ordered by title (D-122 collation, region), then by path in code-point order (AP-1462).
8. **Numbers.** 25, 10 %, 3, 2, 1, 3.0, 1.0, 5, 3 shared, 35 % and 10 live in one `RelatedParams` in the core (plan §3.4). They are not a setting (D-1685).

### R182. The excerpt (board C; AP-1449, AP-1453, AP-1454, AP-1456; DIA-7)

1. **Eligible text.** The candidate's body: paragraphs, headings, list items, quote and callout text (not mindmap callouts), and table rows (cells joined with ` · `). Never the frontmatter, fenced or indented code, math blocks, `%%comments%%`, HTML blocks, embeds or query blocks.
2. **Plain text, as written.** Inline marks are removed, links show their alias or else their target's text, block ids are removed, and whitespace is collapsed. Otherwise the characters are the file's own: no change of case, no diacritics added or removed, NFC-equal to the file.
3. **Sentences.** A block ends a sentence. Inside a block, a sentence ends after `.`, `!`, `?` or `…` (one or more, optionally followed by a closing quote or bracket) when whitespace and then an upper-case letter follow. So `Do pá 27. 11. musí …` is one sentence.
4. **The most relevant sentence.** It is the sentence with the most distinct stems of the open object's signature. Ties go to the sentence earlier in the file. If no sentence has one (a match through the title only), the excerpt is the body's first sentence. With no eligible text there is no excerpt.
5. **Shown.** The whole sentence is in the DOM. It is clamped to 3 lines at the panel's width, ending with `…`. There is no highlight, no bold and no `mark` (board C). The excerpt is not a link and not focusable; a click on it does nothing (AP-1454).

### R183. Commands, state and strings (FR-UX-03, FR-STO-07, NFR-OTH-02; AP-1451, AP-1457, AP-1471)

- **Commands.** No new shortcut. Both commands are in section `view` and have `needsVault: true`.
  - `panel.related` `Show related`. It is listed on `note/<path>`, `daily/<date>` and `new/<type>`, and not on `tag/<key>`, `graph/<path>`, `search` or `tasks`. It opens the `Context panel` on the Related tab and focuses the first entry's chip, or the switch when there are no entries.
  - `related.toggleLinked`. Its title is `Related: Show linked notes` while the switch is off and `Related: Hide linked notes` while it is on. It is listed on the same routes as `panel.related`, whether or not the panel is open or on another tab. It flips the stored choice and does not open the panel.
- **State.**
  - `ui-state.json` top level: `related: { showLinked: boolean }`. It is shared by every vault on this Mac. A missing or invalid value reads as `false` and isn't rewritten until changed (D-1695, D-634's rule).
  - `rightPanel.tab: 'related'` is stored like the other tabs (FR-UX-02 AC-10).
  - Nothing goes under `.tegg/`.
- **Strings** (catalog keys and English text; the keys are the contract's proposal):
  - `related.tab` `Related`
  - `related.list` `Related notes`
  - `related.showLinked` `Show linked notes`
  - `related.linked` `Linked`
  - `related.linkedDescription` `Linked with this note`
  - `related.empty` `No related notes`
  - `related.loading` `Loading…`
  - `cmd.related.show` `Show related`
  - `cmd.related.showLinked` `Related: Show linked notes`
  - `cmd.related.hideLinked` `Related: Hide linked notes`

  No string has a count, so none needs plural forms.

---

### FR-LNK-15 Related notes: the index (DIA-1…DIA-6)

- **AC-1** **One word with and without diacritics, in any case and form (DIA-1, DIA-3; T2).** The R179 pipeline (rules 2–6) gives exactly one stem, `dulezit`, for each of `důležité`, `dulezite`, `Důležité`, `DULEZITE`, `DŮLEŽITÉ`, `dulezité`, `důlezite`, and for each of them in NFD bytes. `Praha`, `praze` and `PRAZE` give `prah`. `rozpočtu`, `rozpoctu` and `ROZPOČTU` give `rozpock`. *(L1, Rust)* Test: `fr_lnk_15_ac1_folded_words_give_one_stem`
- **AC-2** **The golden list (D-1691; DIA-2, DIA-4; T2).** Every row of `tests/fixtures/format/stem/cs.tsv` passes: `stem_cs(fold(word))` equals the row's `stem`, and so does `stem_cs(fold(nfd(word)))`.
  - The rows with `AP-1467` or `AP-1468` in the `note` column take the value of the owner's decision; the README gives both values.
  - The test fails, naming the row, if the file has fewer than 300 rows or a row isn't `word<TAB>stem` or `word<TAB>stem<TAB>note`. The `note` column is optional.
  - Changing a row needs an `AC-Test-Change` trailer (D-1691).

  *(L1, Rust)* Test: `fr_lnk_15_ac2_czech_stemmer_golden_list`
- **AC-3** **Diacritics never change a stem: the property (DIA-2, DIA-3; T2).** Two kinds of text are used: random texts built from the golden list's words with Czech stop words between them, and paragraphs of the generated vault (`tools/gen-vault --seed 1`). For each, the pipeline's multiset of stems equals that of the same text (a) with every diacritic removed, (b) with a random subset of diacritics removed, (c) in upper case, (d) in NFD bytes. *(L2, Rust)* Test: `fr_lnk_15_ac3_property_diacritics_never_change_stems`
- **AC-4** **Stop words, numbers and short stems (DIA-5; D-1693).**
  - The pipeline returns no stem for `který ktery KTERÝ protože protoze ještě jeste`, for `the and with from`, or for the digit-only words of `10 2027 27. 11.`.
  - It returns no stem shorter than 3 characters: `den` and `řeka` give nothing (their stems `dn` and `rk` are dropped, golden list).
  - `Koupit mléko a chleba.` gives exactly {`koupit`, `mlk`, `chlb`}.
  - The Czech list holds at least `a ale aby by do i je jak jeho jen jeste jsem jsou k ke ktera ktere ktery na ne o od po pro protoze s se si ta to u uz v ve z za ze`, folded. The English list is Snowball's English stop-word list.
  - No file in `.tegg/` changes either list.

  *(L1)* Test: `fr_lnk_15_ac4_stop_words_numbers_and_short_stems`
- **AC-5** **Which text counts (R179 rule 1; D-1689; AP-1464).** The runtime note `Pages/Zdroje textu.md` has:
  - title `Zdroje textu`, alias `Textové zdroje`, `tags: [kytara]`, `poznamka: harmonika buben`, `description: klavír`;
  - a heading `## Housle`, a paragraph `Sázím #rajče.`, a fence holding `teleskop`, a paragraph `Viz [[Kniha vzpomínek|kniha]] a https://example.com/kometa.`

  Read through the contract's test hook, its title column holds exactly the stems {`zdroj`, `text`}. Its body column contains `kytar`, `housl`, `rajk`, `teleskop`, `knih`, `vzpomink` and `komt`, and contains none of `harmonik`, `bubn`, `klavir`. *(L4)* Test: `fr_lnk_15_ac5_which_text_is_stemmed`
- **AC-6** **The language of a note and English stems (D-1680, D-1681; AP-1466).**
  - The Snowball English stemmer gives: `hiking` → `hike`, `planning` → `plan`, `planned` → `plan`, `mountains` → `mountain`, `boots` → `boot`, `trails` → `trail`, `meetings` → `meet`, `budgets` → `budget`, `budgeting` → `budget`.
  - In the fixture, Hiking, Trail and gear list are English; every other note is Czech.
  - Souhvězdí, Hvězda 01 and Kytara have no stop word of either list, so they are Czech.
  - The runtime text `Budgets about meetings.` has 1 English stop word, so it is Czech, and `budgets` stays `budgets`.
  - Túra (Czech, on Hiking's topic) shares no stem with Hiking.

  *(L1; L4 for the fixture notes)* Test: `fr_lnk_15_ac6_language_per_note_and_english_stems`
- **AC-7** **Rebuilt from the files (AR-01, NFR-POR-03; T2).** Delete the index directory and reopen the vault. For every fixture object, with linked hidden and shown, `index_related` returns the same answer as before: paths, order, excerpts, chip fields, `linked` flags and `reason`. `rel` has one row per object outside `_templates/` and `.trash/` (39 rows), and no table stores a Related list per object. *(L4)* Test: `fr_lnk_15_ac7_stem_table_rebuilt_from_files`
- **AC-8** **Incremental equals rebuilt (T2; TS-L2's index property).** The test runs random sequences of these steps on random vaults of 20…200 notes built from the golden list's words and on the generated vault:
  - create, edit, rename and delete a note;
  - rewrite a note in NFD bytes, or remove its diacritics;
  - move a note into `.trash/` and out of it;
  - change a note's `type` between `page`, `tag` and `image`;
  - add or remove a link between two notes.

  Each step goes through the watcher, as another program's change would. After the index is idle, `index_related` for every object (linked hidden and shown) equals the answer on a freshly rebuilt index. *(L2, Rust)* Test: `fr_lnk_15_ac8_property_incremental_equals_rebuilt`
- **AC-9** **The stem table and the index version (D-1694).**
  - **Rebuild once.** Opening the fixture with an index whose schema version is set one lower rebuilds it once: one `index:progress` run to `done`. All vault files stay untouched, and the next open doesn't rebuild.
  - **Crashes.** A SIGKILL at a random point while a 500-file burst is indexed (TS-L4 harness; 100 cycles per push, 1,000 nightly) never leaves `fts` and `rel` describing different sets of objects. After reopening, `index_related` equals the freshly rebuilt answer for every object.

  *(L4; L6 once: the built app opened on such an index shows Souhvězdí's list after the rebuild)* Test: `fr_lnk_15_ac9_index_version_rebuild_and_crash_safety`
- **AC-10** **Candidates: types and folders (D-1684; T2).**
  - **Exclusions.** Včelstvo's list is exactly [Prohlídka], with linked hidden and shown. Včelaření (Tag), Úl u lesa (Image), Návod (PDF), Šablona (`_templates/`) and Starý úl (`.trash/`) each hold 3 of Včelstvo's signature stems (fixture README) and never appear. No object is in its own list.
  - **Included types.** Daily Notes, Tasks, Quick Notes and files without frontmatter are candidates: Rozpočet's list holds Den 30. 9. and Úkol, Termíny's holds Školení, and Hiking's holds gear list.
  - **Runtime changes.**
    - Another program changes Prohlídka's `type` to `tag`: Včelstvo's list becomes empty within 2 s.
    - Moving Starý úl from `.trash/` to `Pages/`: Včelstvo's list is {Prohlídka, Starý úl} within 2 s (Starý úl holds 4 shared stems).

  *(L4; L5 for the panel)* Test: `fr_lnk_15_ac10_candidates_by_type_and_folder`
- **AC-11** **Linked objects are hidden by default (D-1683, D-1695; AP-1465; T2).** Zahrada links to Záhon, and Semínka links to Zahrada.

  | Object | Linked hidden | Linked shown |
  | --- | --- | --- |
  | Zahrada | no entries, `reason: null` | exactly {Záhon, Semínka}, both `linked: true` |
  | Záhon | [Semínka] | {Zahrada `linked: true`, Semínka `linked: false`} |
  | Semínka | [Záhon] | {Zahrada `linked: true`, Záhon `linked: false`} |

  At runtime, Semínka's body link to Zahrada is replaced in turn by:
  - a property `souvisí: "[[Zahrada na jaře]]"`;
  - a heading link `[[Zahrada na jaře#Jaro]]`;
  - an embed `![[Zahrada na jaře]]`;
  - a Markdown link `[jaro](Zahrada%20na%20ja%C5%99e.md)`.

  Each gives the same table. With the link removed and the words `Zahrada na jaře` left as plain text, Semínka is in Zahrada's list with linked hidden. *(L4)* Test: `fr_lnk_15_ac11_linked_objects_hidden_by_default`
- **AC-12** **At most 10, as shown (D-1685, D-1695; AP-1462; T2).** Souhvězdí's list:
  - **Linked hidden:** exactly Hvězda 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, in this order. All ten score the same, so the order is by title (AP-1462). Hvězda 01 (linked from Souhvězdí) and Hvězda 02 (links to it) are absent.
  - **Linked shown:** exactly Hvězda 02, Hvězda 01, then Hvězda 03 … Hvězda 10. Hvězda 02 is first because its link to Souhvězdí adds the shared stem `souhvezd`; Hvězda 01 ties with the rest and is first among them by title. Hvězda 11 and 12 are cut by the cap. Only Hvězda 01 and 02 have `linked: true`.

  *(L4)* Test: `fr_lnk_15_ac12_cap_of_ten_applies_as_shown`
- **AC-13** **The floor, the 3 shared stems and the 35 % (D-1685; AP-1455).**
  - **The floor.** Buben has exactly 4 distinct stems. It gets no entries and `reason: 'short'`, with linked hidden and shown, although Kytara and Kroužek contain all 4. Kytara (exactly 5) lists {Kroužek, Buben}, so a short object is still a candidate. Mléko (3) and Prázdná (1) get `reason: 'short'`.
  - **The cut-off function** (L1, with `RelatedParams`), given a best score of 10.0: an entry (3.6, 3 shared stems) is kept, (3.4, 6 shared) is dropped, (9.0, 2 shared) is dropped. With 11 qualifying entries the first 10 are kept.

  *(L4; L1)* Test: `fr_lnk_15_ac13_floor_shared_stems_and_relative_score`
- **AC-14** **Every fixture object's list (T2).** For every object in the fixture README's table "Expected lists", with linked hidden and shown, `index_related` returns exactly the listed entries. The order is checked where the table gives one; elsewhere the entries are a set. Among them:
  - Rozpočet → [Den 30. 9., Úkol];
  - Hiking → [Trail, gear list];
  - Kroužek → {Kytara, Buben};
  - Túra and Svatba → no entries, `reason: null` (no match);
  - Prohlídka → [Včelstvo].

  *(L4, one test per row)* Test: `fr_lnk_15_ac14_expected_list_of_every_fixture_object`
- **AC-15** **Inflection across spellings (DIA-4; T2).** Kniha's list is [Poznamky] and Poznamky's is [Kniha]. They share 8 stems: `knih`, `prah`, `domk`, `matk`, `potok`, `ruk`, `zeln` and `plot`. The test also checks the files: their sets of folded words, without stop words, have exactly one word in common, `plot`. So the match comes from the stems. *(L4)* Test: `fr_lnk_15_ac15_inflected_forms_without_diacritics_match`
- **AC-16** **Twins (DIA-6; AP-1462; T2).** Terminy is Termíny with every diacritic removed, title included.
  - Through the test hook, their signatures are equal: the same stems with the same weights.
  - Termíny → [Terminy, Školení]; Terminy → [Termíny, Školení]; Školení → [Terminy, Termíny]. In Školení's list the two score the same, and Terminy is first by title in both `cs` and `en-US` collation.
  - Every fixture object scores the same (|Δ| ≤ 1e-9) against Termíny as against Terminy.
  - With Termíny rewritten in NFD bytes by another program, all three lists are the same within 2 s.

  *(L4)* Test: `fr_lnk_15_ac16_unaccented_twin_is_equivalent`
- **AC-17** **Tag names are words, with no bonus (D-1689).**
  - Another program gives Svatba `tags: [kniha, praha, matka]`. Within 2 s Svatba's list is {Kniha, Poznamky}: 3 shared stems, each now in 3 objects.
  - Kniha's score in that list equals its score when the paragraph `Kniha, Praha, matka.` replaces the tags. It also equals its score with inline `#kniha #praha #matka` instead (|Δ| ≤ 1e-9).

  *(L4)* Test: `fr_lnk_15_ac17_tag_names_are_words_without_bonus`
- **AC-18** **The signature (R181 rule 2; AP-1462, AP-1463).** The signature function gets a df table and N = 40, so the ceiling is df > 4:
  - With 30 eligible stems, it keeps the 25 highest by tf·idf. Two of them tie at the cut, and the one with the smaller stem in code-point order is kept.
  - A stem once in the title (tf 3) outranks a stem with the same df twice in the body (tf 2). A heading stem (tf 2) outranks a body stem with tf 1 and the same df.
  - A stem with df 4 is kept; df 5 is skipped; df 1 is skipped. The skipped stems never take a place among the 25.

  *(L1, Rust)* Test: `fr_lnk_15_ac18_signature_weights_skips_and_ties`
- **AC-19** **One read, with the chip fields; nothing written (D-1688, D-784, D-633; AP-1475).**
  - `index_related(path, showLinked)` returns the whole answer in one call: `entries` of `{ path, title, type, review, status, due, completed, linked, excerpt, score, shared }`, and `reason` (`null` or `'short'`).
  - Úkol's entry has `status: "To do"` and `due: "2026-11-27"`. Školení's has `review: "unreviewed"`. Den 30. 9.'s has `type: "daily-note"` and `title: "2026-09-30"`.
  - The answer is identical after a rebuild (AC-7).
  - Calling it for every object records no recency: the last-opened record and the Search page's recent list are unchanged. The write counter stays 0.

  *(L4)* Test: `fr_lnk_15_ac19_one_read_with_chip_fields`
- **AC-20** **The excerpt (R182; board C; AP-1449, AP-1453, AP-1456; DIA-7; T2).** `excerpt` is exactly:
  - In Rozpočet's list:
    - Den 30. 9.: `Zítra: projít rozpocet s Janou a poslat naklady na offsite financim.` It is written without diacritics in the file and shown that way.
    - Úkol: `Do pá 27. 11. musí návrh rozpočtu na offsite projít přes finance, Jana ho podepíše.` It isn't split at `27.` or `11.`.
  - In Termíny's list:
    - Terminy: `Dodavatel zasle prihlasky a termin schuzky s vedenim potvrdi ve ctvrtek.` It has 8 signature stems; the first sentence has 6.
    - Školení: `Školení pro vedení: dodavatel zašle přihlášky, termín schůzky ve čtvrtek.`
  - In Poznamky's list, Kniha: `Praha je daleko, ale ta kniha je blízko.` Four sentences hold 2 stems each, and the first wins.
  - In Hiking's list, Trail: `Notes from the trail: the boots held up, the lake was cold, and the mountain hut was full.`
  - In Zahrada's list with linked shown, Semínka: `Koupit semínka rajčat a paprik, na jaře do záhonu.`
  - In Souhvězdí's list, Hvězda 02: `Pozorování: teleskopem, kometou, meteory.` Its link paragraph `Souhvězdí` holds 1 stem.

  Each excerpt is NFC-equal to the file's text. With Termíny rewritten in NFD bytes at runtime, its excerpt in Terminy's list is NFC-equal to the one before. *(L4; L1 for the sentence splitter)* Test: `fr_lnk_15_ac20_excerpt_is_the_most_relevant_sentence_as_written`

### FR-LNK-15 Related notes: the tab

- **AC-21** **The tab (R178; AP-1452, AP-1457).**
  - On `note/Pages/Rozpočet na offsite 2027.md`, the `Context panel`'s tabs are, in this order, `Backlinks`, `Graph`, `Related`.
  - `Related` has no badge, no count and no `aria-description` with a number.
  - With `rightPanel.tab: 'backlinks'`, clicking `Related` sends one `index_related` (`{ path: "Pages/Rozpočet na offsite 2027.md", showLinked: false }`) and one `ui_state_set` with `rightPanel.tab: 'related'`, then shows 2 entries.
  - Showing the tab calls `nav_opened` zero times.

  *(L5)* Test: `fr_lnk_15_ac21_related_tab`
- **AC-22** **Entries are Backlinks chips in one flat list (D-1686, D-600, D-633, D-764; board A; T2).** On Rozpočet the tab shows the `list` `Related notes` with exactly 2 `listitem`s, in the order the core returned: Den 30. 9., then Úkol.
  - There are no groups, group headers, type names or count headings.
  - Each chip looks exactly as on the Backlinks tab (backlinks.md FR-LNK-01 AC-22): Den 30. 9. has the Daily Note icon and `2026-09-30`; Úkol has the To do box icon and the suffix `Fri 27 Nov · To do` (R44 label).
  - On Termíny, Školení's chip has the amber ring and the description `Unreviewed`.
  - A runtime title of 120 characters wraps inside the 288 px panel, as backlinks.md FR-LNK-01 AC-25.
  - Hovering an entry gives the whole `listitem` the computed `--hover` background.
  - The tab shows exactly what `index_related` returned: the fake core's answer is the fixture README's list.

  *(L5)* Test: `fr_lnk_15_ac22_entries_are_chips_in_one_flat_list`
- **AC-23** **How the excerpt is shown (R182 rule 5; board C; AP-1449, AP-1454).**
  - The excerpt is a `p[data-related-excerpt]` under the chip. It has no `link` role, no `tabindex` and no `mark`, `strong` or `em` element.
  - A runtime candidate whose best sentence has 600 characters shows it clamped: computed `-webkit-line-clamp: 3`, a box no taller than 3 × its line height + 1 px, and the visible end `…`. The `p`'s text content is the whole sentence.
  - A click on the excerpt, in each Object preview mode, changes no route, opens no preview and sends no command.
  - An entry whose `excerpt` is `null` has no `p`.

  *(L5)* Test: `fr_lnk_15_ac23_excerpt_plain_clamped_not_clickable`
- **AC-24** **One empty state (board D; AP-1450, AP-1458).** The tab shows the switch and the text `No related notes`, and nothing else in these cases:
  - no match: Svatba, Túra;
  - a short object: Buben, Mléko, Prázdná;
  - every candidate linked, with linked hidden: Zahrada;
  - no file yet: `new/page`, and the virtual `daily/2026-11-14`;
  - the file trashed by another program while Svatba is shown, within 2 s.

  The text `Not enough text to find related notes` appears nowhere. `new/page` and `daily/2026-11-14` send no `index_related`. On Buben, turning the switch on sends one `ui_state_set` and the tab still shows `No related notes`. *(L5)* Test: `fr_lnk_15_ac24_one_empty_state`
- **AC-25** **The `Show linked notes` switch (D-1695; board B; AP-1451; T2).**
  - **Default.** With no `related` key, the switch is unchecked.
  - **On.** On Souhvězdí, turning it on sends one `ui_state_set` with `related: { showLinked: true }` and one `index_related` with `showLinked: true`. The list becomes AC-12's linked-shown list. The visible text `Linked` (`data-related-linked`) appears on Hvězda 02 and Hvězda 01 only, and their chips' accessible description includes `Linked with this note`.
  - **Off again.** Turning it off restores AC-12's other list, with no `Linked` mark.
  - **Shared.** The choice holds on every route and in a second vault opened in the same app.
  - **Bad values.** A missing value, or `showLinked: "yes"`, reads as off and isn't rewritten until the switch changes.

  *(L5; L6 for the relaunch: the switch is still on)* Test: `fr_lnk_15_ac25_show_linked_notes_switch`
- **AC-26** **The chips act as Backlinks chips (FR-LNK-08…12; AP-1474).** The chip is R103's "inline chip in the backlinks panel" in every mode.
  - **Hover to preview** (the default). Resting the pointer on Den 30. 9.'s chip in Rozpočet's list shows `Preview: 2026-09-30` 1,000 ms later (± 50 ms), to the left of the panel (previews.md FR-LNK-08 AC-4). A click opens `daily/2026-09-30` with one `nav_opened`. The panel stays on Related and shows Den 30. 9.'s own list. ⌘[ returns to Rozpočet with the panel on Related and its scroll position kept.
  - **Click to preview.** A click previews; a double-click and ⌘↩ open; ⏎ previews.
  - **Off.** A click opens.
  - **Every mode.** ⌥Space previews. Nothing is written.

  *(L5)* Test: `fr_lnk_15_ac26_chips_preview_and_open_as_backlinks`
- **AC-27** **The list follows the page (T2).**
  - From Rozpočet, opening Hiking (Search, then ⏎) shows Hiking's 2 entries within 2 s. ⌘[ shows Rozpočet's again.
  - With the fake core answering Rozpočet's request after 800 ms, opening Hiking before that answer shows only Hiking's list. The late answer is dropped.
  - No list of another object is ever drawn, even for one frame. A mutation observer records every list the tab draws.

  *(L5)* Test: `fr_lnk_15_ac27_list_follows_navigation`
- **AC-28** **Live updates, focus kept (NFR-PERF-08; AP-1461, AP-1472; T2).**
  - **The user's own edit.** On Svatba, the user types `Dárek: rámky, plod, pyl a dělnice pro včelstvo.` at the end of the body.
    - Before `Saved`, the tab is unchanged, and no `index_related` is sent while the user types.
    - Within 2 s of `Saved`, the list is {Včelstvo, Prohlídka}.
    - The focus and the caret stay in the editor throughout.
  - **Another program's change.** With Včelstvo shown:
    - Moving Prohlídka to `.trash/` shows `No related notes` within 2 s. Moving it back shows [Prohlídka] within 2 s.
    - Changing Úkol's `title:` to `Poslat rozpočet` relabels its chip in Rozpočet's list within 2 s.
  - **Bursts.** Ten external changes within 500 ms cause at most 3 `index_related` calls. The final list equals a fresh query.
  - **Focus.** With the focus on Úkol's chip, an update that keeps Úkol keeps the focus on it. An update that removes the focused entry moves the focus to the next entry, else the previous one, else the switch. The tab's scroll position is kept.

  *(L5; L6 once for the external trash move)* Test: `fr_lnk_15_ac28_live_updates_keep_focus`
- **AC-29** **No background work (D-1688; T2).**
  - With the panel on Backlinks, opening 5 notes and 3 external changes cause 0 `index_related` calls. Choosing `Related` causes exactly 1.
  - With the panel closed (⌘\), external changes cause 0. Reopening it on Related causes 1.
  - In the core, a counter in the test hook reads 0 Related lists computed after the fixture is opened, indexed and left idle for 60 s with the panel closed.
  - Indexing computes no list.

  *(L5; L4 for the counter)* Test: `fr_lnk_15_ac29_no_background_work`
- **AC-30** **Loading and the index not ready (AP-1460).**
  - With the fake core answering after 250 ms, `Loading…` never appears.
  - With 800 ms, the `status` `Loading…` appears no earlier than 300 ms (± 1 frame) after the request. It is replaced by the list. `getAnimations()` on the tab panel is empty throughout.
  - While the fake core reports `indexing`, the tab shows `Loading…`. When `index:progress` reports `done`, it shows the list without a reload.
  - The switch works while loading. A new request makes the earlier answer obsolete.

  *(L5)* Test: `fr_lnk_15_ac30_loading_and_index_not_ready`
- **AC-31** **Which routes (D-127, D-1040; AP-1458, AP-1459).**
  - The tab is on `note/<path>`, `daily/<date>` and `new/<type>`.
  - Opening an Image or PDF object's page computes its list like any object's: Úl u lesa (`note/Images/Úl u lesa.md`) → [Včelstvo], and Návod → [Včelstvo]. Neither ever appears as an entry (AC-10).
  - `tag/včelaření`, `graph/<path>`, `search`, `tasks` and `type/page` show no panel. ⌘\ does nothing there (D-127, D-1040).

  *(L5; L4 for the two lists)* Test: `fr_lnk_15_ac31_routes_with_the_related_tab`
- **AC-32** **Offline, and the English stemmer's licence (NFR-SEC-01; D-1680; AP-1470).**
  - L0: the slice adds no HTTP, socket or network crate (TS-L0's network rule passes).
  - L0: the English stemmer is either code inside `tegg-index`, or a crate whose licence, and each of its dependencies' licences, is on the allow-list of AP-1470. The check fails on any other licence and names the crate.
  - L6: during the tour of FR-SYN-06 AC-47, the socket monitor sees no socket other than local IPC.

  *(L0; L6)* Test: `fr_lnk_15_ac32_offline_and_stemmer_licence`
- **AC-33** [manual] **Design review.** The owner compares the built tab with the boards `Related` and `RelatedDark`, sections A–F, in light and dark:
  - Rozpočet with linked hidden;
  - Souhvězdí with linked shown;
  - an entry hovered;
  - Svatba;
  - the palette with `related` typed.

  The owner records each deviation as an issue or accepts it. *(manual)*
- **AC-34** **Nothing only in the index (NFR-POR-03).** The rel table holds only stems computed from the files. A vault copied to another Mac (a fresh Application Support) gives the same lists as AC-14 after its first index. *(L4)* Test: `fr_lnk_15_ac34_same_lists_on_a_fresh_machine`
- **AC-35** **The evaluation command prints numbers only (D-1690).** `cargo run -p tegg-index --example related-eval -- <fixture copy>` prints, and nothing else:
  - recall@10 for the vault's links with linked shown;
  - mean reciprocal rank;
  - the share of notes with no list;
  - the median list length;
  - the timing.

  Its output has no path, title, stem or excerpt: the test checks it contains none of the fixture's titles, file names or stems of 4 or more characters. It writes nothing in the vault. It is not a `./verify` step. *(L4)* Test: `fr_lnk_15_ac35_evaluation_prints_numbers_only`

### NFR-PERF-13 Related notes list (D-1687; AP-1469)

- **AC-1** **The list in under 100 ms.** On the reference machine:
  - The vault is the 20,000-note generated vault (`tools/gen-vault --seed 1 --notes 20000 --small-images`).
  - The measure is from the `index_related` request to its answer in the core, linked hidden.
  - The objects are 20 chosen by seed 1 among those with ≥ 5 distinct stems, plus the 5 with the most distinct stems.
  - Each object runs 20 times.

  The overall p95 is under **75 ms** (75 % of 100 ms, D-59). The 5 largest are reported separately. The UI's `perfMark('related-request')` → `perfMark('related-ready')` on the same vault is reported with no target. Report-only before the v1.0 release gate, enforced at it (as D-940). *(L4 benchmark `crates/tegg-index/tests/ac_nfr_perf_13.rs`, nightly, outside the push run)* Test: `nfr_perf_13_ac1_related_list_under_target`
- **AC-2** **The index build stays within NFR-PERF-02.** On the 5,000-note reference vault, a full index with the `rel` table completes in under 18 s (60 % of 30 s, D-59). The full index of the 20,000-note vault is reported. *(L4 benchmark, nightly)* Test: `nfr_perf_13_ac2_full_index_with_stems_within_perf_02`
- **AC-3** **The index's size is reported.** The benchmark reports the index database's size with and without the `rel` table, for the 5,000- and 20,000-note vaults. There is no target. *(L4 benchmark, report only)* Test: `nfr_perf_13_ac3_index_size_reported`

### NFR-PERF-06 Typing with the Related tab on screen (adds to AC-3…AC-6; AP-1469)

- **AC-7** **Related doesn't slow typing.** The note is the 5,000-word benchmark note in the reference vault, with the Related tab shown. The latency probe of AC-3 (`TEGG_PERF_LOG`) types 200 characters, with autosave and the list re-queried after each `Saved`. ≥ 95 % of keystrokes are painted in the next frame, and none later than two frames (D-66). *(L6 benchmark `app/e2e/nfr_perf_06_related.ac.test.ts`, outside the push run)* Test: `nfr_perf_06_ac7_typing_with_the_related_tab_on_screen`

### FR-NAV-05 The Related tab (AC-1 in inbox.md; AC-2, AC-3 in graph-panel.md; AC-4, AC-5 removed by D-1675)

- **AC-6** **`Show related` (R183; AP-1451, AP-1471).**
  - On `note/Pages/Rozpočet na offsite 2027.md` with the panel closed, the palette's `Show related` opens the `Context panel` on Related and focuses Den 30. 9.'s chip. `ui-state.json` gets `rightPanel.open: true, tab: 'related'` in one write.
  - With the panel open on Graph, it switches to Related.
  - On Svatba (no entries), the focus goes to the switch.
  - It is listed on `note/<path>`, `daily/<date>` and `new/<type>`, and not on `tag/<key>`, `graph/<path>`, `search` or `tasks`.

  *(L5)* Test: `fr_nav_05_ac6_show_related_opens_the_tab`
- **AC-7** **The tab is remembered (FR-UX-02 AC-10; AP-1457).**
  - With Related chosen, these keep the Related tab: opening another note, ⌘\ twice, and focus mode on and off.
  - After quitting and relaunching the built app on Rozpočet, the panel opens on Related with its 2 entries.
  - A stored tab the app doesn't know shows Backlinks, as D-1675 does for `outline`.
  - The vault's files are untouched.

  *(L5; L6 for the relaunch)* Test: `fr_nav_05_ac7_related_tab_remembered`

### FR-STO-07 The switch is machine-local (adds to AC-1…AC-6; AC-7, AC-8 removed by D-1675)

- **AC-9** **`related.showLinked` in `ui-state.json` only (D-1695, D-634).**
  - Turning the switch on writes `related.showLinked: true` at the top level of `ui-state.json` in the temporary Application Support, atomically (a new inode). It is not under `vaults[…]`.
  - Nothing is created or changed under the vault's `.tegg/`, and `.tegg/vault.yml` is untouched.
  - A second vault opened on the same machine shows the switch on.
  - After a relaunch the switch is still on.
  - With a fresh Application Support and the same vault, it is off.

  *(L5; L6 for the relaunch)* Test: `fr_sto_07_ac9_show_linked_is_machine_local`

### FR-SYN-06 No writes from Related notes (slice REL; DIA-8)

- **AC-47** **Related never writes to the vault (T1).** The tour runs in the built app on a copy of the fixture.
  - Open the Related tab on Souhvězdí, Rozpočet, Den 30. 9., Termíny, Zahrada, Včelstvo, Úl u lesa, Hiking, gear list, Buben, Svatba, Prázdná and the virtual `daily/2026-11-14`, without typing.
  - Turn the switch on and off on Souhvězdí and Zahrada.
  - Preview Den 30. 9.'s chip by hover and open Úkol's chip by a click, then go Back.
  - Run `Show related`, `Related: Show linked notes` and `Related: Hide linked notes` from the palette.
  - Resize the panel; close and reopen it; relaunch.

  Afterwards every vault file is untouched and no file or folder was created: no `Daily/2026-11-14.md`, nothing under `.tegg/`. In the temporary Application Support, apart from what opening a vault writes (D-1676), only `ui-state.json` changed, atomically. In L5 the fake core counts 0 write commands over the same tour.

  *(L6; L5)* Test: `fr_syn_06_ac47_related_tour_writes_nothing`

### FR-FMT-07 Round-trip (adds to AC-1…AC-30)

- **AC-31** **Indexing and ranking leave files byte-identical (DIA-8; T1).** The core does a full index of the fixture with the `rel` table, an incremental update after an external edit, and `index_related` for every object with linked hidden and shown. Afterwards every vault file is untouched, and the one write function was called 0 times. *(L4)* Test: `fr_fmt_07_ac31_related_indexing_writes_no_vault_file`

### FR-FMT-12 NFC and NFD in Related notes (adds to AC-1…AC-10)

- **AC-11** **NFD paths and bodies are the same object (T2).**
  - Opening Termíny through a `note/<path>` whose path is in NFD bytes shows its 2 entries. The fake core's recorded request has the path in NFC.
  - Another program renames `Pages/Kniha vzpomínek.md` to its NFD-named form. Within 2 s Poznamky's list shows `Kniha vzpomínek` once, as an NFC title.
  - The `rel` index has one row for it, not two.
  - `ui-state.json` holds no NFD key.

  *(L4; L5)* Test: `fr_fmt_12_ac11_nfd_paths_and_bodies_in_related`

### FR-SRC-04 Search is unchanged (adds to AC-1…AC-11; D-1694)

- **AC-12** **Search doesn't stem.** On the Related fixture:
  - `rozpočtu` returns exactly {Úkol}. Rozpočet and Den 30. 9. hold only `rozpočet` and `rozpocet`, which are two edits away and not a prefix.
  - `knize` returns exactly {Poznamky}; Kniha holds `kniha` only.
  - `dulezite` returns exactly {Termíny, Terminy}: folding, not stemming.

  The `fts` table holds folded words, not stems, and no search command reads `rel`. *(L4)* Test: `fr_src_04_ac12_search_matches_words_not_stems`

### FR-UX-03 Related by keyboard (adds to app-shell.md and outline.md AC-45…AC-47)

- **AC-48** **Commands (R183; AP-1471).**
  - The registry has `panel.related` (`Show related`) and `related.toggleLinked`, with those ids, titles (catalog keys), section `view` and `needsVault: true`, and no shortcut. R4 has no new row.
  - The palette lists each command exactly on R183's routes.
  - `related.toggleLinked` reads `Related: Show linked notes` while the switch is off and `Related: Hide linked notes` while it is on. Running it flips the stored choice, with the panel closed too, and doesn't open the panel.
  - FR-UX-03 AC-7 passes.
  - FR-UX-03 AC-8 passes on Rozpočet with the tab on Related, and in the empty and loading states. The tab, the switch and every chip carry a registered command or are reached by Tab; the excerpts are plain text and exempt.

  *(L1 for the registry; L5)* Test: `fr_ux_03_ac48_related_commands`
- **AC-49** **Keyboard-only tour.** With no pointer event:
  1. Open Rozpočet from Search.
  2. ⌘K, `Show related`, ⏎: the focus is on Den 30. 9.'s chip.
  3. Tab moves to Úkol's chip. ⇧Tab ⇧Tab reaches the switch, ⇧Tab once more reaches the `Related` tab. No excerpt is a Tab stop.
  4. Tab back to the switch; Space turns it on.
  5. Tab to Den 30. 9.'s chip and ⏎ opens it (hover mode).
  6. ⌘[ returns to Rozpočet.
  7. ⌘\ closes the panel and returns the focus to the note body.

  Every focused element shows the indicator of app-shell FR-UX-03 AC-13 (b). No step needs the pointer. *(L5)* Test: `fr_ux_03_ac49_related_keyboard_only`

### FR-UX-08 Accessibility (adds to outline.md AC-21, AC-22; AP-1472)

- **AC-23** **VoiceOver names, roles and motion.**
  - The tab panel holds the `switch` `Show linked notes`, then the `list` `Related notes` with one `listitem` per entry.
  - A `listitem` is read as the chip's name (title, task suffix or `Unreviewed` as on Backlinks), then `Linked` when shown, then the excerpt.
  - The empty text is not a live region. A list change makes no announcement, except `Loading…` (R178).
  - With `prefers-reduced-motion: reduce` and without it, adding and removing entries runs no animation (`getAnimations()` empty).
  - In the built app, the macOS accessibility tree shows the switch with its state and the entries' chips by name.

  *(L5; L6 once)* Test: `fr_ux_08_ac23_related_voiceover_and_motion`

### FR-UX-05 Themes (adds to outline.md AC-22)

- **AC-23** **The Related tab in both themes (boards `Related`, `RelatedDark`).** In light and in dark, axe `color-contrast` reports zero violations and FR-UX-05 AC-5 passes, on each of:
  - Rozpočet;
  - Souhvězdí with linked shown and an entry hovered;
  - Svatba;
  - the loading state.

  The excerpt text, the `Linked` mark and the switch use theme tokens only (no colour literal, FR-UX-05 AC-2), and every text has ≥ 4.5:1 (D-129). The hovered entry is `--hover`. *(L5)* Test: `fr_ux_05_ac23_related_in_light_and_dark`

### NFR-OTH-02 Strings (adds to outline.md AC-19)

- **AC-20** **Catalog only.** The catalog has exactly R183's keys with the texts given. With the pseudo-locale, every visible text, tooltip and accessible name of the tab, the switch, the `Linked` mark, the empty and loading states and the two commands is inside `⟦ ⟧`, except titles and excerpts (user content, `data-user-content`). *(L1; L5)* Test: `nfr_oth_02_ac20_related_strings_in_the_catalog`

---

## Real-app tests (D-382)

`app/e2e/related.ac.test.ts` (built app, `TEGG_TEST=1`, temporary Application Support and fixture copy; keys only to Tegg, D-799):
- FR-LNK-15 AC-9 (the rebuild of an older index);
- FR-LNK-15 AC-25 (the switch after a relaunch);
- FR-LNK-15 AC-28 (an external trash move);
- FR-LNK-15 AC-32 (the socket monitor);
- FR-NAV-05 AC-7 (the tab after a relaunch);
- FR-STO-07 AC-9 (the switch after a relaunch);
- FR-SYN-06 AC-47 (the tour);
- FR-UX-08 AC-23 (the macOS accessibility tree).

`app/e2e/nfr_perf_06_related.ac.test.ts`: NFR-PERF-06 AC-7, outside the push run. NFR-PERF-13 is a core benchmark (L4), nightly.

---

## Trace: requirement → criteria

| Requirement / rule | Criteria | Decisions and points |
| --- | --- | --- |
| FR-LNK-15 (index) | AC-1…AC-20, AC-34, AC-35 (22) | D-1677, D-1680…D-1686, D-1689…D-1694; AP-1455, AP-1462…AP-1468, AP-1473, AP-1475 |
| FR-LNK-15 (tab) | AC-21…AC-33 (13, one manual) | D-127, D-600, D-633, D-764, D-1040, D-1164, D-1683, D-1686, D-1688, D-1695; AP-1449…AP-1454, AP-1456…AP-1461, AP-1470…AP-1472, AP-1474 |
| DIA-1 folded comparison | AC-1, AC-3, FR-FMT-12 AC-11 | D-1682 |
| DIA-2 same stem with and without diacritics | AC-2, AC-3 | D-1682, D-1691 |
| DIA-3 partly accented words | AC-1, AC-3 | D-1682 |
| DIA-4 inflection across spellings | AC-2, AC-15 | D-1682; AP-1467, AP-1468 |
| DIA-5 stop words folded | AC-4 | D-1693 |
| DIA-6 unaccented twin | AC-16 | AP-1462 |
| DIA-7 original text shown | AC-20, AC-23 (no highlights since board C) | AP-1449 |
| DIA-8 nothing written | FR-SYN-06 AC-47, FR-FMT-07 AC-31, AC-19 | — |
| NFR-PERF-13 | AC-1…AC-3 (3) | D-59, D-940, D-1687; AP-1469 |
| NFR-PERF-06 | AC-7 (1) | D-66; AP-1469 |
| FR-NAV-05 | AC-6, AC-7 (2); AC-1 changed in inbox.md (AP-1476) | D-127, D-1675; AP-1451, AP-1452, AP-1457, AP-1471 |
| FR-STO-07 | AC-9 (1) | D-634, D-1695 |
| FR-SYN-06 | AC-47 (1) | D-1676 |
| FR-FMT-07 | AC-31 (1) | — |
| FR-FMT-12 | AC-11 (1) | — |
| FR-SRC-04 | AC-12 (1) | D-101, D-1342, D-1694 |
| FR-UX-03 | AC-48, AC-49 (2) | AP-1471 |
| FR-UX-08 | AC-23 (1) | AP-1472 |
| FR-UX-05 | AC-23 (1) | D-129 |
| NFR-OTH-02 | AC-20 (1) | D-133 |

**51 new criteria** (50 automated, 1 manual), plus the changed FR-NAV-05 AC-1 in inbox.md (AP-1476).

**Changes in the commit that builds the slice** (after AP-1476 is decided):
- **App-shell R2.** A row `related` | Related | built (slice REL, related.md R178) | v1.0 (0.3.0) | FR-LNK-15, FR-NAV-05, after `graph` (`PANEL_TABS` in `shell/registry.ts`). R1, R3 and R4 are unchanged (no new route, control or shortcut).
- **FR-NAV-05 AC-1** in [inbox.md](inbox.md) lists the tabs Backlinks, Graph and Related (built, slice REL: selecting it shows R178). Its test `fr_nav_05_ac1_right_panel_tabs` changes with the trailer `AC-Test-Change: AP-1476, the Related tab is built in slice REL; approved-by: owner`.
- **README.** A row for this file is added to `docs/acceptance/README.md` when the APs are decided.
- **Contract.** `docs/contracts/v1-related.md` (plan §9): `stem_cs`, the English stemmer's entry point, the pipeline, `rel`, `RelatedParams`, `index_related`'s DTO (AP-1475), the test hooks used above (signature, `rel` terms, the computed-lists counter), the fake core's twin, the UI state field.

---

## Points for the owner (AP-1449…AP-1477, pending)

Raised while writing these criteria. Each criterion that depends on one names it and follows its **proposal**. AP-1449…AP-1451 record the owner's answers on the board (2026-11-14), which change decided text and so need a D-number. AP-1452…AP-1454 are the board's three open questions.

| AP | Point | Proposal | Alternative | Affects |
| --- | --- | --- | --- | --- |
| AP-1449 | **The excerpt: the board's answer (a).** D-1686 says "the passage with the most shared words, those words highlighted", and DIA-7 says a match "highlights the whole original word". The board (owner, 2026-11-14) says: the single most relevant sentence, as written, with no highlights, cut with `…` after 3 lines. | Record it as a new D: it amends D-1686's excerpt half and drops DIA-7's highlight half. DIA-7's "the file's own text" stays. R182, AC-20, AC-23 follow it. | Keep D-1686 (a passage with highlights) and change the board | R182, FR-LNK-15 AC-20, AC-23, DIA-7 |
| AP-1450 | **One empty state: the board's answer (b).** D-1685 names a second message, `Not enough text to find related notes`, for a note under 5 stems. The board shows one state, `No related notes`, for both, with the switch still shown. | Record it as a new D amending D-1685's message. `index_related` still returns `reason: 'short'`, for tests and the evaluation command, but the UI shows one text. | Keep two messages as D-1685 says | R178, FR-LNK-15 AC-13, AC-24 |
| AP-1451 | **Names and commands: the board's answer (c).** D-1695 names the switch and the toggle commands. The board adds `Show related`, which "opens the right panel on the Related tab", and draws the `Linked` mark and the switch label as D-1695 says. | Record it as a new D. It confirms `Linked`, `Show linked notes` and `Related: Show linked notes` / `Related: Hide linked notes` (one command whose title follows the state), and adds `Show related` (`panel.related`) as R183. | Record only `Show related` and leave D-1695 as it is | R178, R183, FR-NAV-05 AC-6, FR-UX-03 AC-48 |
| AP-1452 | **Tab order** (board "To decide" 1). D-1677 and the plan say "after Outline". D-1675 removed the Outline tab, and the board draws `Backlinks · Graph · Related`. | `Backlinks · Graph · Related`, Related third. A new D replaces D-1677's "after Backlinks, Graph and Outline". | `Backlinks · Related · Graph`: the two lists of notes side by side | R178, FR-LNK-15 AC-21, inbox.md FR-NAV-05 AC-1 |
| AP-1453 | **Sentence or paragraph** (board "To decide" 2). | One sentence, as drawn, clamped to 3 lines. A paragraph is usually longer than the panel shows. | The whole paragraph (block) holding the most shared stems, clamped to 3 lines | R182, FR-LNK-15 AC-20, AC-23 |
| AP-1454 | **Clicking the excerpt** (board "To decide" 3). | Not clickable, as drawn: only the chip acts. The excerpt is plain text and not a Tab stop. | A click opens the object at that sentence (`note/<path>?at=<line>:<byte>`, as a search result, FR-SRC-03), and the excerpt becomes a link and a Tab stop | R178, R182, FR-LNK-15 AC-23, FR-UX-03 AC-49 |
| AP-1455 | **What the "5" counts.** D-1685 says "fewer than 5 distinct stems"; the board says "under 5 words". They differ, e.g. Buben: 6 words, 4 stems. The decisions also don't say whether a short object can still be a candidate. | Distinct stems after R179, over title, aliases, headings, body and tag names (D-1685's wording). The board's "words" is the user-facing word for it. A short object gets no list but can be a candidate in other lists. | Count the body's words (folded tokens, stop words included) | R181 rule 3, FR-LNK-15 AC-13, AC-24, fixture Buben / Kytara |
| AP-1456 | **The sentence rule.** Nothing says where a sentence ends (Czech dates `27. 11.` and abbreviations hold periods), how "most relevant" is counted, how ties go, which blocks count, or how marks and links are shown. | R182: blocks end sentences. Inside a block, `.`/`!`/`?`/`…` followed by whitespace and an upper-case letter end one. The most distinct signature stems wins; ties go to the earlier sentence; with none, the first sentence. Code, math, comments, HTML, embeds and frontmatter are never excerpts. Shown as plain text with links as their text, all characters as in the file. | Split at every `.`/`!`/`?` followed by whitespace; ties to the shorter sentence | R182, FR-LNK-15 AC-20 |
| AP-1457 | **Which tab the panel opens on.** The panel remembers its tab (FR-UX-02 AC-10, D-1675). The decisions don't say whether `related` is remembered. | `related` is stored and restored like the other tabs. The default (no stored tab) stays Backlinks. An unknown stored tab shows Backlinks. | Never remember Related: the panel always reopens on Backlinks or Graph | R178, R183, FR-NAV-05 AC-7 |
| AP-1458 | **Objects with no body text, no file, or a deleted file.** D-1684: "the tab shows for every object that has body text". It doesn't say what an object without body text shows (title only, attributes only), or what a draft (`new/<type>`), a virtual day or a just-deleted file shows. | No special case for an empty body: the list is computed from title, aliases, headings and tags like any object, so usually `reason: 'short'`. Drafts, virtual days and deleted files show `No related notes` and send no `index_related` until the first write or restore. | No list at all for an object with an empty body; the graph's `appears once this note is saved` text for drafts | R178, FR-LNK-15 AC-24, AC-31 |
| AP-1459 | **Tag, Image and PDF objects as the open object.** D-1684 removes them as candidates. Tag pages have no panel (D-1040), but an Image or PDF object's page (`note/Images/…`) has one. | Their list is computed like any object's, from their title and body, and never contains Tag, Image or PDF entries. Tag pages keep no panel. | Image and PDF pages always show `No related notes` | FR-LNK-15 AC-31 |
| AP-1460 | **While the list loads or the index is building.** The board has no loading state. The schema bump (D-1694) rebuilds every index once on the first launch of 0.3.0. | As the graph panel: nothing for 300 ms, then a `Loading…` status, with no animation. While the index isn't ready, `Loading…`; the list comes when `index:progress` reports `done`. | `No related notes` until the index is ready | R178, FR-LNK-15 AC-30 |
| AP-1461 | **When the list is re-asked.** The plan says "debounced as the Backlinks tab is", but Backlinks has no number, and other surfaces use 300 ms (graph, queries, pins). | While the tab is shown: on opening it, on navigation, 300 ms after the last `vault:changed` (any path), and after the open note's `Saved`, never per keystroke. The latest request wins. | Re-ask only on navigation and the open note's `Saved`, ignoring other files' changes until the next navigation | FR-LNK-15 AC-28, AC-29 |
| AP-1462 | **Ties.** Equal scores (identical candidates, Souhvězdí's Hvězda 03…12) and equal tf·idf at the signature's 25th place have no order. | Entries with equal scores by title (D-122 collation, the region), then path in code-point order. Signature ties by stem in code-point order. | Path order for both | R181 rules 2, 7, FR-LNK-15 AC-12, AC-16, AC-18 |
| AP-1463 | **The 10 % ceiling and "found in no other object".** The plan doesn't say what N counts (all objects? candidates only?), whether templates and trash are in `rel`, or whether skipped stems are removed before or after taking the top 25. In a small vault this decides which stems count. | N = `rel` rows. Tag, Image and PDF objects have rows (they are indexed and searchable); templates and `.trash/` have none, as in search (D-102, FR-TPL-07). df comes from `rel`'s vocab. Skipped stems (df 1, or df > 10 % of N) are removed before the top 25 are taken. | N = candidate objects only (no Tag, Image, PDF); skip after taking the top 25 | R179, R181 rules 1–2, FR-LNK-15 AC-7, AC-18; the fixture's design (every stem it relies on is in ≤ 3 objects, N = 39) |
| AP-1464 | **Which text is stemmed.** The plan names title, aliases, headings, body and tag names, "as search treats them". Search also indexes attribute values in a column of their own, and the body holds link targets, URLs and code. Not covered: text property values, `description`, embedded notes' content. | As R179 rule 1: the raw body as search reads it (code, link targets and aliases, URL words included); `tags:` names; headings. No property value, not even `description`; no embedded note's content. A link `[[Title]]` thus adds Title's words to the linking note, so linked objects tend to rank high when shown (accepted). | Also stem text property values and `description` into the body column | R179, FR-LNK-15 AC-5, AC-11 |
| AP-1465 | **What "linked" means.** D-1683 says "link to the open object or are linked from it". It doesn't say whether property relations, embeds, Markdown links, heading links, `source:` or date mentions count. | Linked = either object is among the other's `index_backlinks` sources (body and Markdown links with any subpath, embeds, relation and link values in properties, `source:`), so the switch agrees with what the Backlinks tab shows. Tags are not links. | Only `[[wikilinks]]` in the body | R181 rule 5, FR-LNK-15 AC-11 |
| AP-1466 | **Language choice in detail.** D-1681: "too few stop words to tell → Czech; other languages are folded but not stemmed". It doesn't give "too few". With only two lists, nothing can tell a third language (a German note is "undecided", so Czech). Several stop words are in both lists (`a`, `to`, `do`, `on`), and the plan doesn't say which list is dropped from a note. | R179 rule 7: ignore words in both lists; English when ≥ 3 English stop words and more than the Czech count, else Czech. There is no third state in this slice, so D-1681's "other languages" sentence becomes a known limit. Both lists are dropped from every note (R179 rule 3). | A third state, "fold only": a note of ≥ 30 words with fewer than 3 stop words of either list isn't stemmed. Only the note's own language's list is dropped. | R179, FR-LNK-15 AC-4, AC-6 |
| AP-1467 | **Where folding loses information for the stemmer.** On folded text the Czech stemmer can't tell `š`/`s`, `í`/`i`, `ů`/`u` or `ě`/`e`. Four of Lucene's rules then behave differently. (1) `št → sk` also fires on a plain `st`: `město` → `mesk`, and `cesta` and `český` merge as `cesk`. (2) The possessive `-in` also strips `-ín`: `termín` → `term`. (3) `ů → o` can't run, so `dům`/`domu` stay apart, as the plan's limits say. (4) The fleeting-`e` rule also drops an `e` that was `ě`: `věk` → `vk`. All forms of one word still get one stem; only the stem strings and a few merges differ. **The golden list's 362 rows were computed by hand from the rule set in `tests/fixtures/format/stem/README.md`, not by running Lucene.** Lucene's own test words (`hrad`, `muž`, `soudce`) were checked against its rules as recalled, not run. | Keep (1), (2) and (4) as the README's rules, and drop (3). The rows marked `AP-1467` hold those values. Before the red tests, the contract author runs the port once over `cs.tsv`: any disagreement is checked against the README's rules and reported, never fixed silently. | Drop rule (1) (`mest`, `cest`, `letist`, `kompost`) and keep `čeští`/`český` apart; drop the possessive `-in` rule (`termin`, `mlhovin`) | R180, FR-LNK-15 AC-2, `cs.tsv` rows marked `AP-1467` |
| AP-1468 | **`rozpočet` and `rozpočtu` are two stems.** The board says "`rozpočet`, `rozpocet` and `rozpočtu` are one word". The light stemmer applies one normalization: `rozpocet` → `rozpoct` (fleeting `e`), while `rozpoctu` → `rozpoct` → `rozpock` (`čt → ck`). The same split hits `počet`, `účet`, `ocet`. | One extra rule in the folded port: after the fleeting `e` is removed, a stem ending in `ct` or `st` takes `ck` or `sk`, so every form of `rozpočet` is `rozpock`. Cost: `deset` and `deska` both give `desk`. Rows marked `AP-1468` hold these values. | The faithful port (`rozpoct` vs `rozpock`); the board's caption changes to `důležité`, `dulezite`, `důležitých` | R180, FR-LNK-15 AC-1, AC-2, board C caption |
| AP-1469 | **How NFR-PERF-13 is measured.** D-1687 gives < 100 ms p95 on the 20,000-note vault. It doesn't say whether D-59's 75 % applies, where the clock starts (core or UI), which objects, or when it becomes a gate. Typing latency with the tab on screen isn't covered. | Core-level, request to answer, `index_related` on 25 objects (20 by seed, plus the 5 with the most stems), target 75 ms (D-59). The UI's request-to-paint is reported with no target. Report-only until the v1.0 release gate (as D-940). The index build on the 5,000 vault within 18 s; index size reported. NFR-PERF-06 AC-7 with the tab shown. | 100 ms without the factor, measured in the UI from navigation to the painted list | NFR-PERF-13 AC-1…AC-3, NFR-PERF-06 AC-7 |
| AP-1470 | **The English stemmer's licence.** D-1680: "a crate whose licence is checked at build". `./verify` has no licence check today. | An L0 step in `./verify commit`: a licence allow-list (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Zlib, Unicode-3.0) over `tegg-index`'s Rust dependencies from `cargo metadata`, failing with the crate's name. Added to `qa.config.json`. | Port the Snowball English algorithm by hand into `tegg-index` (no new dependency, no check needed) | FR-LNK-15 AC-32, `qa.config.json` |
| AP-1471 | **Command details.** The board names the commands but not where they're listed, what gets the focus, or whether the toggle needs the panel. It shows `Panel` beside them in the palette; the registry's section for panel commands is `view` (`Show backlinks`, `Show local graph`). | R183: `Show related` on note, daily and new routes, focusing the first chip, else the switch. One command `related.toggleLinked` whose title follows the state, listed on the same routes whether or not the tab is shown, never opening the panel. Section `view`, as the other panel commands; no shortcut. | List the toggle only while the Related tab is shown; a new palette section `Panel` | R183, FR-NAV-05 AC-6, FR-UX-03 AC-48 |
| AP-1472 | **List semantics and focus after updates.** Backlinks uses groups of `article`s and moves the focus to a heading the Related tab doesn't have (the board has no heading). | A `list` `Related notes` of `listitem`s. The chip is the only Tab stop; `Linked` is text and part of the chip's description. When an update removes the focused entry, the focus goes to the next entry, else the previous, else the switch. Updates make no announcement. | `article`s as Backlinks, a visually hidden heading `Related notes` that takes the focus | R178, FR-LNK-15 AC-28, FR-UX-08 AC-23 |
| AP-1473 | **Conflict copies.** A sync conflict copy has the same `id` as the open object (D-56) and nearly the same text, so it would always be the first entry. | Never list a file with the same `id` as the open object: it is the same object, and conflicts have their own view (FR-SYN-04). | List it (it helps notice a conflict) | R181 rule 5 |
| AP-1474 | **The board's chip caption.** Board C says "Click previews, double-click opens, hover shows the preview". That mixes two modes: since D-1164 the default is *Hover to preview, click to open*. | The chip follows R103 in every mode, exactly as a Backlinks chip (FR-LNK-15 AC-26). The board's caption is read as "as on Backlinks". | — (confirm only) | FR-LNK-15 AC-26 |
| AP-1475 | **What `index_related` returns.** DIA-6 ("the same score against A as against B") and the cut-off need the score and the shared-stem count, and the plan's DTO has neither. With AP-1450, `reason` has no visible effect. | Each entry carries `score` (bm25, f64) and `shared` (distinct signature stems in common), used by tests and the evaluation command and not shown. `reason` stays (`null` / `'short'`). The contract adds read-only test hooks for the signature and `rel` terms. | No score in the DTO; tests read a debug-only command | FR-LNK-15 AC-13, AC-16, AC-17, AC-19 |
| AP-1476 | **AC-test changes this slice brings.** inbox.md FR-NAV-05 AC-1 lists the tabs Backlinks and Graph; app-shell R2 has no `related` row. | Approve now, applied in the build commit with `AC-Test-Change: AP-1476, the Related tab is built in slice REL; approved-by: owner`: FR-NAV-05 AC-1 lists Backlinks, Graph and Related; R2 gains the `related` row (as in "Changes in the commit that builds the slice"). | Approve when the slice lands | inbox.md FR-NAV-05 AC-1, app-shell R2 |
| AP-1477 | **AC numbers shared with parallel work.** Other sessions may add criteria to the same shared requirements. | Keep the numbers used here: FR-SYN-06 AC-47, FR-FMT-07 AC-31, FR-FMT-12 AC-11, FR-SRC-04 AC-12, FR-STO-07 AC-9, FR-NAV-05 AC-6, AC-7, NFR-PERF-06 AC-7, FR-UX-03 AC-48, AC-49, FR-UX-08 AC-23, FR-UX-05 AC-23, NFR-OTH-02 AC-20. Whichever set is approved second renumbers its clashes before its red tests (as D-1030). | Reserve fixed blocks per slice | every shared criterion here |
