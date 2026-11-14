# Slice REL: Related notes (2026-11-14)

Status: **accepted by the owner on 2026-11-14: AP-1430…AP-1448 are D-1677…D-1695 in order (BRD v1.183; new FR-LNK-15 and NFR-PERF-13).** Four points in the owner's words (AP-1431 built now as 0.3.0, AP-1432 the owner's board first, AP-1436 a switch with linked hidden by default, AP-1437 Daily Notes stay), the others as proposed ("Accept the rest"). Next: the owner's `Related` board, then the ACs (`docs/acceptance/related.md`), the contract and the red tests (D-61). Owner brief (2026-11-14): *for each note Tegg finds similar notes and shows them like backlinks; fully offline; little CPU; lexical matching with Czech stemming; `důležité` may be spelled `dulezite`; no spike; a tab in the right panel, shown the same way as Backlinks, not grouped by object type.*

## 1. What is built

A fourth tab `Related` in the right panel (after Backlinks, Graph, Outline). For the open object it lists the objects whose text shares the most distinctive words with it, best first. Words are compared by their **stem**, so Czech inflected forms count as one word, and with **case and diacritics folded**, so `důležité`, `dulezite` and `DŮLEŽITÝCH` are the same word.

No model, no network (NFR-SEC-01), no data outside the index (AR-01, FR-STO-07). The index stays a disposable cache: deleting it and rebuilding gives the same Related lists.

Not in this slice (see §8): embeddings, a synonym dictionary, Unlinked mentions (FR-LNK-05).

## 2. Where we are

- The index (`crates/tegg-index`) already stores **folded** text in its FTS5 table: `text::fold` is NFC → lower case → combining marks removed (`Čtení` → `cteni`), and the table uses `unicode61 remove_diacritics 0` because the text is folded before it gets there (FR-SRC-04, D-101). `fts_vocab` gives each term's document count.
- FTS5 has no Czech stemmer (`porter` is English only). The stemmer is ported by hand.
- The Backlinks tab shows one entry per linking object: a D-600 chip (D-633) and excerpts (D-278). The Related tab reuses that entry.

## 3. How it works

### 3.1 From text to stems

For each word of an object's title, aliases, headings and body (the same `text::words` the search uses, so code blocks, frontmatter keys and link syntax are treated as search treats them):

1. **Fold** with `text::fold` (unchanged).
2. **Drop stop words** (a folded Czech list and an English list, in the core, about 300 words each).
3. **Stem** with the note's stemmer (§3.2).
4. Drop stems shorter than 3 characters and pure numbers.

### 3.2 The stemmers

- **Czech:** the light stemmer of Dolamic and Savoy (the algorithm behind Lucene's `CzechStemmer`), ported to Rust in `tegg-index` and **rewritten to work on folded text** (§4). It removes case endings, plural endings and possessive endings, and normalizes the common consonant changes (`k`/`c`, `h`/`z`, the fleeting `e`). It has no dictionary.
- **English:** a standard Porter/Snowball English stemmer (AP-1433).
- **Which one:** chosen per note by counting stop words of each language in the note (no library). A note with too few stop words to tell uses the Czech stemmer (AP-1434).

### 3.3 The stem table

A second FTS5 table `rel(title, body)` in the same index database, holding each object's stems (title column: title and aliases; body column: headings, body, tag names), with its own `fts5vocab`. It is written in the same transaction as `fts`, so it is always in step with the files. Adding it raises the index schema version, which rebuilds the index once.

### 3.4 Ranking

1. **Signature:** the open object's 25 stems with the highest tf·idf. A title or alias stem counts three times, a heading stem twice. A stem found in no other object, or in more than 10 % of objects, is skipped.
2. **Candidates:** one FTS5 query, the signature stems joined by `OR`, ranked by `bm25(rel, 3.0, 1.0)`.
3. **Removed:** the object itself, `_templates/`, `.trash/`, Tag, Image and PDF objects (AP-1437), and, unless the user switched them on, objects already linked with it in either direction (AP-1436).
4. **Cut-off:** at most 10 entries, and only those sharing at least 3 signature stems with a score of at least 35 % of the best entry's (AP-1438). A note with fewer than 5 distinct stems gets no list.

All numbers above live in one `RelatedParams` struct in the core, so tuning (§7) changes one place.

### 3.5 CPU

- **Nothing runs in the background.** The list is computed when the Related tab is showing, for the open object only: on opening the tab, on navigating, and after an index change (debounced as the Backlinks tab is).
- **One read:** `index_related(path)` returns the whole list (D-784's rule: never one read per row).
- **Indexing cost:** stemming is a few string operations per word, done once when a file changes, in the pass that already folds its text.
- **Targets** (AP-1440): the list in < 100 ms p95 on the 20,000-note reference vault; the full index build stays inside NFR-PERF-02.

## 4. Czech diacritics: requirements

| # | Requirement |
| --- | --- |
| DIA-1 | **Folded comparison.** Two words are the same word when they are equal after `text::fold`: `důležité` = `dulezite` = `Důležité` = `DULEZITE`, in NFC or NFD bytes (FR-FMT-12, FR-SRC-04). |
| DIA-2 | **Same stem with and without diacritics.** For every word *w*, the stem of *w* equals the stem of *w* written without diacritics. This holds by construction: the stemmer only ever sees folded text, and its ending tables are written folded (`-ých` is stored as `ych`, `-ého` as `eho`, `-ími` as `imi`). |
| DIA-3 | **Partly accented words** (`dulezité`, `důlezite`) follow DIA-1 and DIA-2. |
| DIA-4 | **Inflection across spellings.** `důležitý`, `důležitá`, `důležité`, `důležitých`, `důležitým`, `dulezitymi` give one stem. The fixture lists such families for nouns, adjectives and the consonant changes the stemmer covers (`Praha` / `Praze`, `kniha` / `knize`, `ruka` / `ruce`, `domek` / `domku`). |
| DIA-5 | **Stop words are folded too:** `ktery`, `protoze`, `jeste` are dropped like `který`, `protože`, `ještě`. |
| DIA-6 | **A note and its unaccented twin are equivalent.** If note B is note A with every diacritic removed, A and B have the same signature, each is the other's first Related entry, and every other note gets the same score against A as against B. |
| DIA-7 | **Original text is shown.** Excerpts and highlights use the file's own text and byte ranges; a match found through folding or stemming highlights the whole original word (`důležitých`), as FR-SRC-03 AC-3 does for search. |
| DIA-8 | **Nothing is written.** Folding and stemming exist only in the index; no vault file changes (FR-SYN-06, FR-FMT-07). |

Known limits, accepted with the approach (AP-1435):

- **Folding merges different words:** `řada` / `rada`, `být` / `byt`, `žena` / `zeny`… The search already has this property. It costs a little precision, never a missed match.
- **Vowel changes inside the stem are not unified:** `dům` / `domu`, `stůl` / `stolu`, `vítr` / `větru` stay different stems. A light stemmer has no dictionary; a lemmatizer would fix it at the cost of a dictionary file and a licence check.
- **Verbs** are stemmed less well than nouns and adjectives.
- **No meaning:** `auto` and `vůz`, or a Czech and an English note on one topic, are not related by this slice (§8).

## 5. The Related tab

- **Place:** the panel's tablist gets `Related` after `Outline`. Palette command `Show related` (FR-UX-03); all strings externalized (NFR-OTH-02); light and dark themes (FR-UX-05).
- **List:** flat, best first, **no grouping by type**. Each entry is the Backlinks entry: the object's D-600 chip (type icon, title, task and review states, D-633), then **one excerpt** from that object: the passage with the most shared words, those words highlighted (AP-1439). Clicks, hover previews and the keyboard behave as on a Backlinks entry (FR-LNK-08…12).
- **Linked notes switch (AP-1436):** a `Show linked notes` switch in the tab's header, off by default. When on, objects that link here or are linked from here take part in the ranking and their entries carry a `Linked` mark. The cut-off (AP-1438) applies to the list as shown.
- **Empty states:** `No related notes` when nothing passes the cut-off; `Not enough text to find related notes` for a note under 5 stems.
- **No count badge** on the tab: a badge would need the list for every open object, which is the background work §3.5 avoids (AP-1441).
- **Live:** the list follows saves of the open note and index changes, without moving the focus (as Backlinks).

## 6. Points for the owner

All decided: the Proposal column is the decision, except where a row says what the owner decided instead.

### 6.1 Scope

| AP | Point | Proposal | Alternative |
| --- | --- | --- | --- |
| AP-1430 | **A new requirement** | **FR-LNK-15** "Related notes: objects with similar text, in the right panel" (S). No existing requirement covers it | Fold it into FR-LNK-05 |
| AP-1431 | **Phase** | **Decided (owner, 2026-11-14):** built now as slice REL and released as **0.3.0** | |
| AP-1432 | **Design board** | **Decided (owner, 2026-11-14):** the owner draws the `Related` board first (the tab, an entry, the switch, both empty states, dark); the ACs follow the board | |

### 6.2 Matching

| AP | Point | Proposal | Alternative |
| --- | --- | --- | --- |
| AP-1433 | **English** | Stem English notes with a Snowball English stemmer (a small Rust crate, licence checked at build, or a port) | Czech stemmer only; English words match by exact folded form |
| AP-1434 | **Language per note** | By stop-word count; undecided notes use Czech; other languages are folded but not stemmed | Apply the Czech stemmer to everything |
| AP-1435 | **Light stemmer limits (§4)** | Accept them; no dictionary in this slice | A Hunspell-based lemmatizer (several MB, licence to check) |
| AP-1436 | **Already linked objects** | **Decided (owner, 2026-11-14):** the user's choice, a switch; linked objects are hidden by default. Details in AP-1448 | |
| AP-1437 | **Types** | **Decided (owner, 2026-11-14):** candidates are every type except Tag, Image and PDF; **Daily Notes stay**. The tab itself shows for every object that has body text | |
| AP-1448 | **The switch's details** (follows AP-1436) | `Show linked notes` in the tab's header (§5); the choice is machine-local for all vaults (`ui-state.json`, `related.showLinked`, missing = off), like the panel width (D-634); palette command `Related: Show linked notes` / `Related: Hide linked notes`; shown entries carry a `Linked` mark | Stored per vault in `.tegg/vault.yml`; no mark |
| AP-1438 | **Cut-off** | At most 10; at least 3 shared signature stems and 35 % of the best score; under 5 stems no list. Fixed numbers, no setting | A `Show more` button; a setting |
| AP-1439 | **What an entry shows** | Chip + one excerpt with the shared words highlighted | Chip + the shared words as text (`Shared: rozpočet, daně`) |
| AP-1440 | **Performance** | New **NFR-PERF-13**: Related list < 100 ms p95 on the 20,000-note vault; full index build still within NFR-PERF-02; index size growth reported, no target | No new NFR |
| AP-1441 | **No badge, no background work** | As §3.5 and §5 | Precompute for every note at idle and show a count |
| AP-1442 | **Shared tags** | Tag names are words in the body column, nothing more | A fixed bonus per shared tag |

### 6.3 Tuning and tests

| AP | Point | Proposal | Alternative |
| --- | --- | --- | --- |
| AP-1443 | **A local evaluation command** (§7) | `cargo run -p tegg-index --example related-eval -- <vault>`, run by the owner on the real vault; prints numbers only | No command; tune from preview feedback alone |
| AP-1444 | **The stemmer's golden list** | `tests/fixtures/format/stem/cs.tsv` (word → stem, about 300 synthetic rows, each family with and without diacritics) is the stemmer's contract; changing a row is an AC-test change | Property tests only (DIA-2) |
| AP-1445 | **Fixture vault** | `tests/fixtures/vaults/related/`: about 30 synthetic Czech and English notes with known neighbours, accented and unaccented twins (DIA-6), a short note, linked pairs, a template, a trashed note | Reuse the search fixture |
| AP-1446 | **Stop-word lists** | In the core, not user-editable in this slice | `.tegg/stopwords.yml` |
| AP-1447 | **Search is unchanged** | Search keeps exact folded words (D-101, D-1342); stemming in search is a separate question | Search uses the stems too |

## 7. Tuning on the real notes

There is no spike. The algorithm ships with the defaults of §3.4, then is tuned in two ways, neither of which lets Claude read the real vault (D-62):

1. **Link recovery (AP-1443).** The owner runs the evaluation command on the real vault. For each existing link A → B it asks: with linked objects *not* hidden, is B in A's top 10? It prints only numbers: recall@10, mean reciprocal rank, the share of notes with no list, median list length, and timing. The owner pastes the numbers; `RelatedParams` is changed; the command is run again. No titles, paths or content are printed.
2. **Daily use.** Preview feedback as for every slice (`docs/feedback/`): entries that should not be there, entries that are missing. Each report becomes a synthetic case in the fixture vault where it can be reproduced.

Tunables, in the order they are likely to matter: the document-frequency ceiling (10 %), the minimum shared stems (3), the relative score floor (35 %), the signature size (25), the title weight (3), the stop-word lists.

## 8. Later, on the same table

- **Unlinked mentions (FR-LNK-05, v1.x):** a phrase query for the title's and aliases' stems in `rel`, minus objects that already link here. The stem table is what makes it work for inflected Czech titles.
- **Personal synonyms:** `.tegg/synonyms.yml`, expanding signature stems at query time (`auto` – `vůz`, `schůzka` – `meeting`).
- **Embeddings:** a local multilingual model as a second ranking signal, if the lexical list proves too literal in daily use.

## 9. What changes

- **BRD (done, v1.183):** D-1677…D-1695; FR-LNK-15 and NFR-PERF-13 added; §11 v1.0 row names slice REL; `requirements-coverage.md`; CLAUDE.md status.
- **Design:** the owner's `Related` board (D-1679), before the ACs.
- **ACs:** `docs/acceptance/related.md` (FR-LNK-15, the DIA rules of §4 as criteria, NFR-PERF-13, FR-UX-03 and NFR-OTH-02 additions, app-shell's panel tablist).
- **Contract:** `docs/contracts/v1-related.md`: `stem(folded, lang)`, the `rel` table, `RelatedParams`, `index_related(path) → { entries: [{ path, chip fields as D-633, excerpt, highlights }], reason: null | 'short' }`, the fake core's twin.
- **Architecture:** a paragraph in `docs/architecture.md` on the stem table and the schema version.
- **Fixtures:** AP-1444, AP-1445.
- **QA config:** no new package; the example command is not a gate step.

## 10. Order inside the slice

1. **REL-a core:** the stemmers and their golden list, stop words, the `rel` table, `index_related`, the performance test, the evaluation command.
2. **REL-b panel:** the tab, entries, empty states, palette command, live updates, real-app tests (D-382).

Both follow the per-slice loop (ACs → contract → red tests → implementation → `./verify push` → explorer → preview) and the D-61 rules.
