# Contract: Related notes (v1.0 slice REL, released as 0.3.0)

Public interfaces of slice REL, for the test author (D-61) and the build. ACs: `docs/acceptance/related.md` (approved;
R178…R183; FR-LNK-15 AC-1…AC-35, NFR-PERF-13 AC-1…AC-3, NFR-PERF-06 AC-7, FR-NAV-05 AC-6, AC-7, FR-STO-07 AC-9,
FR-SYN-06 AC-47, FR-FMT-07 AC-31, FR-FMT-12 AC-11, FR-SRC-04 AC-12, FR-UX-03 AC-48, AC-49, FR-UX-08 AC-23, FR-UX-05
AC-23, NFR-OTH-02 AC-20). Decisions: D-1677…D-1695 (plan `docs/plans/related-notes-plan.md`), D-1696…D-1724 (the
ACs' AP-1449…AP-1477; AP-n → D-(n−1449+1696)). Boards: `design/edit-note-page/Related.dc.html`, `RelatedDark.dc.html`
A–F. Fixtures: `tests/fixtures/format/stem/cs.tsv` (+ README, the rule set) and `tests/fixtures/vaults/related/`
(+ README, the expected lists). Precedents: [v1-graph.md](v1-graph.md) §15 (a right-panel tab), [v1-pinned.md](v1-pinned.md)
(contract layout), [ms4-links.md](ms4-links.md) (backlinks DTO, chips D-600/D-633), [v1-outline.md](v1-outline.md).

Related notes **only read**. They write nothing in the vault (DIA-8): no note, no `.tegg/` file. The index gains one
FTS5 table (`rel`), rebuilt from the files (AR-01). The only stored UI state is `ui-state.json`'s `related.showLinked`
and the existing `rightPanel.tab` (§4). §9 lists the choices this contract makes where the ACs leave room; §10 lists the
points for the owner (CP-1…CP-7 → D-1725…D-1731, decided: the proposals); §11 reports the stemmer check of D-1714.

## 1. Core (`tegg-index`, `tegg-format`, `tegg-core`; AR-03)

Everything in this section is platform-neutral Rust: no Tauri, no desktop API, no network (NFR-SEC-01).

### 1.1 Modules

| Crate | Module | Owns |
| --- | --- | --- |
| `tegg-index` | `src/stemming/mod.rs` (`pub mod stemming`) | `Lang`, `stem_cs`, `stem_en`, the stop-word lists, `is_stop_word`, `language_of`, `stems`, `rel_row`, `is_rel_token_char` (§1.2–§1.4) |
| `tegg-index` | `src/stemming/cs.rs` | the folded Czech stemmer (R180), private; exported as `stemming::stem_cs` |
| `tegg-index` | `src/stemming/stop_cs.txt`, `stop_en.txt` | the lists of §1.3, `include_str!`'d; one folded word per line, LF, sorted, no duplicates |
| `tegg-index` | `src/related.rs` (`pub mod related`) | `RelatedParams`, `TermCounts`, `signature`, `cut_off`, `sentences`, `by_code_point`, `RelatedList`, `RelatedEntry`, `RelatedReason`; `Index::related` (§1.6–§1.9) |
| `tegg-index` | `src/lib.rs` | the `rel` table, `SCHEMA_VERSION` (now `pub`), `Prepared` gains the `rel` row, `apply` / `remove` write `fts` and `rel` together (§1.5), test hooks (§1.10) |
| `tegg-index` | `examples/related-eval.rs` | the evaluation command (§1.12) |
| `tegg-format` | `src/plain.rs` (`pub mod plain`) | `plain_blocks(body) -> Vec<String>`: R182 rules 1–2 (§1.9) |
| `tegg-core` | `src/related.rs` | `Core::related`, `RelatedError`, core test hooks (§1.11) |

`tegg-index` re-exports `pub use related::{RelatedEntry, RelatedList, RelatedParams, RelatedReason};`. `tegg-core`
re-exports the same names. New dependency of `tegg-index`: `rust-stemmers = "1.2"` (the Snowball English stemmer,
§1.2); dev-dependency: `gen-vault = { path = "../../tools/gen-vault" }` (§1.13).

### 1.2 The stemmers (R180; D-1680, D-1682, D-1691, D-1714, D-1715)

```rust
// tegg_index::stemming
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Lang { Cs, En }                      // serialized "cs" / "en"

/// R180: the folded Czech light stemmer. `w` is a folded word (`text::fold`: NFC, lower case, no combining marks).
/// The rule set is exactly `tests/fixtures/format/stem/README.md` §"The rule set", rule 3.5 (D-1715) included and
/// Lucene's `ů → o` excluded (D-1714). Pure, total, never panics; may return a stem shorter than 3 characters
/// (`den` → `dn`); lengths are counted in Unicode scalar values.
pub fn stem_cs(w: &str) -> String;

/// The Snowball English (Porter2) stemmer on a folded word (`rust_stemmers::Algorithm::English`). Pure, total.
pub fn stem_en(w: &str) -> String;
```

- `stem_cs` sees only folded text, so a word and its unaccented form get one stem by construction (DIA-2). Its golden
  list is `cs.tsv` (FR-LNK-15 AC-2): `stem_cs(fold(word)) == stem` and `stem_cs(fold(nfd(word))) == stem` for every row.
- `stem_en` gets folded input too; non-ASCII letters pass through unchanged.

### 1.3 Stop words (R179 rule 3; D-1693, D-1713)

```rust
pub fn is_stop_word(folded: &str) -> bool;          // in the Czech list or the English list
pub fn stop_words(lang: Lang) -> &'static [&'static str];   // sorted, folded
```

Both lists are dropped from **every** note, whatever its language (D-1713). They are compiled in; nothing in `.tegg/`
or Application Support changes them (FR-LNK-15 AC-4). Changing a list later is tuning (D-1690); a change that alters a
fixture expectation is an AC-test change.

**English** (`stop_en.txt`): Snowball's English stop-word list without its entries containing an apostrophe
(`i'm`, `don't` …: `text::words` splits them, so they can never match one token), plus `cannot`, which the list holds as
one word.

**Czech** (`stop_cs.txt`, 221 folded words). It contains AC-4's minimum and is checked against the related fixture
(§11.2): every expected list of `tests/fixtures/vaults/related/README.md` holds with it.

```
a aby ackoli ale ani aniz ano asi az bez beze bude budem budeme budes budete budou budu by bych bychom byl byla byli
bylo byly bys byste ci co coz dalsi do i jak jaka jake jako jaky je jeho jej jeji jejich jemu jen jenom jenz jeste
jestli jestlize ji jich jim jimi jiz jsem jsi jsme jsou jste k kam kde kdo kdy kdyz ke kolem ktera kterak ktere
ktereho kteremu kteri kterou ktery kterych kterym kterymi ku kvuli ma maji mam mame mas mate me mel mela meli melo
mezi mi mne mnou moje moji muj my mych na nad nade nam nami nas nase nasi ne nebo neboli neco nej nejaky nekdo nemu
neni nez ni nic nikdo nim nimi no o od ode okolo on ona oni ono ony pak po pod pode podle pokud potom pred prede pres
pri pro proc protoze s se sebe sebou sem si snad sobe sve svoje svou svuj svych svym ta tady tak take takze tam te
tebe tebou tech ted tedy tem temi ten tento tez ti tim tito to tobe toho tohoto tom tomto tomu toto tu tuto tvoje
tvuj ty tyto u uz v vam vami vas vase vasi ve vedle velmi vice vsak vse vsech vsechno vsichni vy z za zase zatim zda
ze
```

`byt` (folded `být`) is deliberately absent: it would also drop `byt` (a flat), D-1682's folding merge.

Words in **both** lists (with these lists: `a by do i me my no on to`) are ignored by the language count (§1.4) and
dropped like any stop word.

### 1.4 From text to stems (R179; D-1681, D-1689, D-1711, D-1713)

```rust
/// R179 rules 2–6 on one text, with a given language: `text::words` → `text::fold` → drop stop words (both lists) →
/// drop numbers (a word whose every char `is_numeric()`) → stem (`stem_cs` / `stem_en`) → drop stems of fewer than
/// 3 chars → drop stems with a character that is not `is_rel_token_char` (D-1761). In text order, duplicates kept.
pub fn stems(text: &str, lang: Lang) -> Vec<String>;

/// R179 rule 7 on folded words (stop words not yet dropped): words in both lists are ignored; `En` when the note has
/// ≥ 3 English-only stop words and more English-only than Czech-only ones, else `Cs`. No third state (D-1713).
pub fn language_of(folded_words: &[String]) -> Lang;

/// The `rel` row of one note (R179 rule 1). `title` is the object's title (`title:`, else the file name, D-103; a
/// Daily Note's displayed title is its date, whose digits are dropped), `aliases` its aliases, `body` the raw body
/// after the frontmatter, `tags` the names in `tags:`.
pub fn rel_row(title: &str, aliases: &[String], body: &str, tags: &[String]) -> RelRow;

pub struct RelRow {
    pub lang: Lang,          // language_of(words of title + aliases + body + tag names)
    pub title: Vec<String>,  // stems(title), then stems(each alias), in order
    pub body: Vec<String>,   // stems(raw body), then stems(each tag name), in order
    pub heading: Vec<String>,// the stems of `body` that come from ATX heading lines (`#{1,6} ` outside fenced code); a sub-multiset of `body`
}
```

- **Body as search reads it** (D-1711): the raw body, fences, code, link targets and aliases, URLs and inline `#tags`
  included (FR-LNK-15 AC-5: `teleskop` in a fence, `kniha` and `vzpominek` from `[[Kniha vzpomínek|kniha]]`, `komt`
  from a URL). No frontmatter value is text here, `description` included; only `title`, `aliases` and `tags`.
- **Headings** are in the body column once; the signature counts a heading occurrence 2 instead of 1 (§1.7). Setext
  headings count as body text.
- `stems` and `rel_row` are pure: the same bytes give the same row, NFC or NFD (folding runs first, FR-FMT-12).
- **Stems are exactly `unicode61` tokens** (D-1761): a stem is kept only when every character is
  `pub fn is_rel_token_char(c: char) -> bool` (a lower-case-stable letter or number, not a mark, outside the code points
  the bundled SQLite's `unicode61 remove_diacritics 0` folds or separates, such as `ς`, `ſ`, `µ`, `ⓐ`), else it is
  dropped, so each stem in `rel` is one token equal to itself and the kept df map equals a rebuild from `rel_vocab`
  (D-1757, AR-01); folded Czech and English (ASCII letters and digits) are unaffected.

### 1.5 The `rel` table and the schema version (R179, R181 rule 1; D-1694)

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS rel USING fts5(title, body, tokenize = 'unicode61 remove_diacritics 0');
CREATE VIRTUAL TABLE IF NOT EXISTS rel_vocab USING fts5vocab(rel, 'row');
```

- One `rel` row per `notes` row, same `rowid`: every indexable object (`is_indexable`), Tag, Image and PDF objects
  included; templates (`_templates/`) and `.trash/` have none (they are not indexed). Each column holds the row's stems
  joined by single spaces (`RelRow.title`, `RelRow.body`). The note's `Lang` is stored in the `notes.meta` JSON
  (`Stored.lang`, `"cs"` / `"en"`).
- `prepare` computes the `RelRow` outside the index lock (as it does for `fts`, FR-UX-07 AC-2); `apply` and `remove`
  write `notes`, `fts` and `rel` **in the same transaction**, so `fts` and `rel` always describe the same objects
  (FR-LNK-15 AC-9). Indexing computes no Related list (AC-29).
- `pub const SCHEMA_VERSION: i64 = 7` (was 6, private). A database with another version is dropped and rebuilt, `rel`
  and `rel_vocab` included (the drop list gains them), so opening a 0.2.x index rebuilds once (FR-LNK-15 AC-9). The
  database file is `<vault local dir>/index.sqlite` (`tegg-core`'s `INDEX_FILE`, unchanged).
- `fts` and every search command are unchanged; no search reads `rel` (D-1694, FR-SRC-04 AC-12).

### 1.6 `RelatedParams` (R181 rule 8; D-1685, D-1690)

```rust
#[derive(Debug, Clone, PartialEq)]
pub struct RelatedParams {
    pub signature_size: usize,   // 25
    pub df_ceiling: f64,         // 0.10: skip a stem when df > max(df_ceiling × N, df_floor) (D-1731)
    pub df_floor: usize,         // 2: the ceiling never goes below 2 objects (CP-7, D-1731)
    pub title_weight: u32,       // 3
    pub heading_weight: u32,     // 2
    pub body_weight: u32,        // 1
    pub bm25_title: f64,         // 3.0
    pub bm25_body: f64,          // 1.0
    pub min_stems: usize,        // 5: fewer distinct stems → no entries, reason Short
    pub min_shared: usize,       // 3
    pub min_relative: f64,       // 0.35
    pub max_entries: usize,      // 10
}
impl Default for RelatedParams { /* the values above */ }
```

`df = 1` (no other object) is always skipped; it is not a parameter. The minimum stem length (3, R179 rule 6) is a
constant of the pipeline (`stemming::MIN_STEM_CHARS`), not a ranking number. The core always uses
`RelatedParams::default()`; nothing reads them from a file or setting (D-1685).

### 1.7 Ranking functions (pure, L1; R181 rules 2, 6; D-1709, D-1710)

```rust
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TermCounts { pub title: u32, pub heading: u32, pub body: u32 }   // body = occurrences outside headings

/// R181 rule 2. tf = title_weight·title + heading_weight·heading + body_weight·body; weight = tf × ln(n / df).
/// Stems with df < 2 or (df as f64) > max(df_ceiling × (n as f64), df_floor as f64) are removed first (D-1731); of the rest the
/// `signature_size` highest weights are kept, ties by stem in code-point order. Returned in that order.
pub fn signature(terms: &BTreeMap<String, TermCounts>, df: &dyn Fn(&str) -> usize, n: usize, p: &RelatedParams) -> Vec<(String, f64)>;

/// R181 rule 6. `entries` are `(score, shared)` in final order; `best` is the reference score (CP-3). Returns the
/// indexes kept: shared ≥ min_shared and score ≥ min_relative × best, the first `max_entries` of them.
pub fn cut_off(entries: &[(f64, usize)], best: f64, p: &RelatedParams) -> Vec<usize>;

/// Title order for equal scores when the caller has no collator (tests, the evaluation command): code points.
pub fn by_code_point(a: &str, b: &str) -> std::cmp::Ordering;
```

AC-18 (N = 40, ceiling df > 4) and AC-13's L1 part (best 10.0: (3.6, 3) kept, (3.4, 6) and (9.0, 2) dropped; 11
qualifying → the first 10) call these directly.

### 1.8 `Index::related` (R181; D-1683…D-1685, D-1702, D-1709, D-1710, D-1712, D-1720, D-1722)

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelatedReason { Short }

#[derive(Debug, Clone, PartialEq)]
pub struct RelatedEntry {
    pub path: String,               // NFC vault path
    pub title: String,              // as `index_backlinks` shows it (D-320: a Daily Note's date)
    pub r#type: String,             // matched type key (FR-TYP-13): `page`, `task`, `daily-note` …
    pub review: Option<String>,     // D-633: trimmed non-empty string values of the frontmatter keys, as BacklinkEntry
    pub status: Option<String>,
    pub due: Option<String>,
    pub completed: Option<String>,
    pub linked: bool,
    pub excerpt: Option<String>,    // §1.9; None when the candidate has no eligible text
    pub score: f64,                 // −bm25(rel, 3.0, 1.0): positive, higher is better
    pub shared: usize,              // distinct signature stems the candidate holds (either column)
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct RelatedList { pub entries: Vec<RelatedEntry>, pub reason: Option<RelatedReason> }

impl Index {
    /// `None` when `path` (NFC-normalized first) is not indexed: missing, in `.trash/`, in `_templates/`, not `.md`.
    /// `extra_linked`: further paths linked with the open object that only the core knows (§1.11, media embeds).
    /// `title_order`: the order of equal scores' titles (§1.11, CP-2).
    pub fn related(&self, path: &str, show_linked: bool, p: &RelatedParams, extra_linked: &[String],
                   title_order: &dyn Fn(&str, &str) -> std::cmp::Ordering) -> Option<RelatedList>;
}
```

Steps, in order:

1. **Open object.** Its `RelRow` is recomputed from its stored raw text and fields with `rel_row` (so headings are
   known); it equals its `rel` row. Distinct stems = the set over `title` ∪ `body`. Fewer than `min_stems` → `entries:
   []`, `reason: Some(Short)` (with linked hidden and shown, AC-13). An empty object (Prázdná) is the same case.
2. **N and df.** N = `SELECT count(*) FROM rel`; df(s) = `rel_vocab`'s `doc` for `s` (rows holding `s` in any column).
3. **Signature** = `signature(terms, df, N, p)`; `terms` counts the open object's occurrences (`title`: in
   `RelRow.title`; `heading`: in `RelRow.heading`; `body`: the rest of `RelRow.body`). Empty signature → `entries: []`,
   `reason: None`.
4. **Candidates.** One FTS5 query: `SELECT rowid, -bm25(rel, 3.0, 1.0) FROM rel WHERE rel MATCH ?1`, `?1` = the
   signature stems, each written as an FTS5 string (`"stem"`), joined by ` OR `. `shared` = the number of signature
   stems among the candidate's distinct stems.
5. **Removed** (AC-10, AC-11; D-1684, D-1712, D-1720): the open object; any object whose `id` (trimmed, NFC, non-empty)
   equals the open object's (a conflict copy); objects of type `tag`, `image`, `pdf`; with `show_linked == false`,
   every **linked** object. Linked = the union of (a) the sources of `backlinks(open)` (every link kind the index
   resolves: body and Markdown links with any subpath, embeds, link and relation values in properties, `source:`,
   date links to a Daily Note), (b) the notes the open object's own links resolve to (`Resolved::Note`,
   `Resolved::Daily`), (c) `extra_linked`. Tags are not links.
6. **Best** = the highest score among the candidates left after step 5 that share ≥ `min_shared` stems (CP-3).
7. **Order**: score descending; equal scores (exactly equal `f64`) by `title_order(title_a, title_b)`, then path in
   code-point order (AP-1462 = D-1709).
8. **Cut-off**: `cut_off(ordered (score, shared), best, p)`; the kept entries, in order, are the answer, each with
   `linked` (member of the linked set; only ever true with linked shown) and its excerpt (§1.9).
9. **Counter**: every call adds 1 to the computed-lists counter (§1.10), whatever it returns. Nothing else changes:
   no write, no cache of lists (AC-7: no table stores a Related list).

The answer is a function of the files only (AR-01): a rebuilt index gives an equal `RelatedList` (AC-7, AC-8, AC-34).

### 1.9 The excerpt (R182; D-1696, D-1700, D-1701, D-1703)

```rust
// tegg_format::plain
/// R182 rules 1–2: the eligible blocks of a body, each as plain text in file order. Eligible: paragraphs, headings,
/// list items (each item its own block, without its marker or task box), quote and callout text (not `> [!mindmap]`
/// callouts; a callout's title line counts), table rows (header row included; cells joined with ` · `). Never:
/// frontmatter, fenced or indented code, `$$` math blocks, `%%comments%%`, HTML blocks, query blocks, embeds
/// (`![[…]]`, `![](…)`). Inline marks removed; `[[target|alias]]` → alias, `[[target#sub]]` → `target`, `[text](url)` →
/// text; block ids (` ^id`) removed; whitespace runs → one space; trimmed; empty blocks dropped. Characters are the
/// file's own, NFC.
pub fn plain_blocks(body: &str) -> Vec<String>;

// tegg_index::related
/// R182 rule 3 inside one block: a sentence ends after a run of `.`, `!`, `?` or `…`, optionally followed by one
/// closing quote or bracket (`"”’»)]`), when whitespace and then an upper-case letter (`char::is_uppercase`) follow.
/// Returns the sentences, trimmed, in order (`Do pá 27. 11. musí …` stays one sentence).
pub fn sentences(block: &str) -> Vec<&str>;
```

For each kept entry: the sentences of `plain_blocks(candidate body)`, in file order; a sentence's score = the number of
distinct signature stems among `stems(sentence, candidate lang)`. The excerpt is the first sentence with the highest
score ≥ 1; if none scores (a match through the title only), the first sentence; with no eligible block, `None`. The
string is the whole sentence (no cut; the UI clamps it), NFC (AC-20: NFC-equal to the file, also when the file is NFD).

### 1.10 Test hooks (`#[cfg(any(test, feature = "test-hooks"))]`, read-only)

```rust
pub struct RelTerms { pub lang: Lang, pub title: Vec<String>, pub body: Vec<String> }   // the stored `rel` row, split on spaces

impl Index {
    /// The stored `rel` row of `path` (NFC), or None (FR-LNK-15 AC-5, AC-16, FR-FMT-12 AC-11).
    pub fn rel_terms(&self, path: &str) -> Option<RelTerms>;
    /// Steps 1–3 of §1.8 for `path`: the signature, in order, with weights (AC-16); None when not indexed; empty when short.
    pub fn related_signature(&self, path: &str, p: &RelatedParams) -> Option<Vec<(String, f64)>>;
    /// `rel` rows (AC-7: 39 for the fixture).
    pub fn rel_rows(&self) -> usize;
    /// Calls of `Index::related` since this `Index` was opened (AC-29).
    pub fn related_computed(&self) -> u64;
}
```

They read; none writes, and none increments the counter.

### 1.11 The core (`tegg-core/src/related.rs`)

```rust
#[derive(Debug, Clone, PartialEq)]
pub enum RelatedError { NotReady }

impl Core {
    /// §2 `index_related`. Read-only: no vault write, no recency (`nav_opened`, the last-opened record and the
    /// Search page's recent list are untouched), no event.
    pub fn related(&self, path: &str, show_linked: bool) -> Result<RelatedList, RelatedError>;
    #[cfg(any(test, feature = "test-hooks"))] pub fn rel_terms(&self, path: &str) -> Option<tegg_index::RelTerms>;
    #[cfg(any(test, feature = "test-hooks"))] pub fn related_signature(&self, path: &str) -> Option<Vec<(String, f64)>>;
    #[cfg(any(test, feature = "test-hooks"))] pub fn related_computed(&self) -> u64;
}
```

- `NotReady` while the first build of an empty index runs (`index_ready()` false, as `graph_neighbourhood`, D-990).
- Not indexed (`Index::related` → None) → `Ok(RelatedList::default())`: no entries, `reason: None` (a trashed or
  deleted open object, AC-24).
- `extra_linked` = the sources of `media_sources(open)` (notes that embed the open Image or PDF object's file,
  FR-ATT-07), so the switch agrees with what the Backlinks tab lists (D-1712).
- `title_order` = ICU4X root collation (`und`, primary strength, numeric on: `queries_q`'s collator with locale `und`),
  CP-2.
- `related_computed` reads the index's counter; it is 0 after open, a full index and any idle time with no request (AC-29).

### 1.12 The evaluation command (D-1690; FR-LNK-15 AC-35)

`cargo run -p tegg-index --example related-eval -- <vault>`:

- Reads the vault's indexable `.md` files read-only (`tegg_vault::LocalFs`), builds an index in a new temporary
  directory under `std::env::temp_dir()` (removed at the end), and writes nothing in the vault (no file, no folder, no
  mtime change).
- **Pairs**: each distinct (A, B) where a link of A resolves to note B ≠ A and B's type is not `tag`, `image` or `pdf`.
- Prints exactly these lines and nothing else (stdout; stderr empty on success):

  ```
  objects: <n>
  pairs: <n>
  recall@10: <0.000>          # pairs with B in A's list, linked shown (n/a when pairs = 0)
  mrr: <0.000>                # mean of 1/rank of B in A's list, linked shown (0 when absent)
  empty_share: <0.000>        # objects whose list is empty, linked hidden, over all objects
  median_length: <n>          # median list length, linked hidden, over all objects
  index_ms: <n>
  query_p50_ms: <0.0>
  query_p95_ms: <0.0>
  ```

  The keys are fixed and hold no fixture word or stem of 4 or more characters (the test checks the output against the
  fixture's titles, file names and stems). Title order: `by_code_point`; `extra_linked`: none.
- Exit 2 with a usage line on a missing or unreadable argument. It is not a `./verify` step.

### 1.13 Performance (NFR-PERF-13, D-1687, D-1716; report-only until the v1.0 release gate, as D-940)

- **AC-1**: `crates/tegg-index/tests/ac_nfr_perf_13.rs`, test `nfr_perf_13_ac1_related_list_under_target`. The 20,000-note
  vault comes from `gen-vault` (`seed 1, notes 20_000, small images`, as `tegg-core`'s `headroom_vault_20k`; the helper
  is copied into `crates/tegg-index/tests/support/`, generated once per target dir). It times `Index::related(path,
  false, &RelatedParams::default(), &[], &by_code_point)` (the core adds only a lock and a sort of equal titles): 25
  objects (20 by seed 1 among those with ≥ 5 distinct stems, plus the 5 with the most), 20 runs each; prints p95
  overall and for the 5 largest separately; asserts p95 < 75 ms only when `VERIFY_GATE=release`, else reports.
- **AC-2, AC-3**: `crates/tegg-core/tests/ac_related_perf.rs` (`nfr_perf_13_ac2_…`, `nfr_perf_13_ac3_…`): `Core::open` on
  a copy of the 5,000-note reference vault, time to `wait_idle` (< 18 s, asserted under the same rule) and the 20,000
  vault's (reported); index database size (`index.sqlite` + `-wal`, after a checkpoint) with `rel`, and on a copy of
  the database after `DROP TABLE rel; DROP TABLE rel_vocab; VACUUM` without it, for both vaults (reported, no target).
- UI marks (reported, no target): `perfMark('related-request')` when a request is sent (a repeatable mark: one line per
  request, D-1759), `perfMark('related-ready')` two animation frames after its list is drawn (once per process, as
  every other mark). `perf_mark` takes a name only (as G2, v1-graph §15.7).
- All three files' tests are named `nfr_perf_13_…`, so the push step's `--skip nfr_perf_` skips them; the nightly
  `core-perf-ac` step runs them (§5).

## 2. IPC

| Command | Arguments | Returns | Errors |
| --- | --- | --- | --- |
| `index_related` | `path: string` (NFC), `showLinked: boolean` | `RelatedDto` | `NotReady`, `NoVault` |

New Tauri module `app/src-tauri/src/shellrel.rs`, registered next to `shellpin`:

```rust
#[tauri::command]
pub async fn index_related(state: State<'_, AppState>, path: String, show_linked: bool) -> Result<RelatedDto, IpcError>
// core.related(&tegg_format::nfc(&path), show_linked); RelatedError::NotReady → err("NotReady", "the index is being built")
```

DTOs in `app/src-tauri/src/dto.rs` (ts-rs; `types.ts` regenerated with
`UPDATE_TYPES=1 cargo test --manifest-path app/src-tauri/Cargo.toml types_file_is_current`):

```ts
export type RelatedEntryDto = {
  path: string; title: string; type: string;
  review: string | null; status: string | null; due: string | null; completed: string | null;   // D-633
  linked: boolean;
  excerpt: string | null;
  score: number;      // f64, positive, higher is better (not shown)
  shared: number;     // u32 (not shown)
};
export type RelatedDto = { entries: Array<RelatedEntryDto>; reason: 'short' | null };
```

`app/ui/src/ipc/client.ts`: `related: (path: string, showLinked: boolean) => invoke<RelatedDto>('index_related', { path, showLinked })`.
The recorded arguments of a call are exactly `{ path, showLinked }` (FR-LNK-15 AC-21). No new event.

`UiStateDto` (Rust) gains:

```rust
/// Slice REL (v1-related §4, D-1695): `{ showLinked }`, kept as stored (the UI reads only `showLinked === true`).
#[serde(default, skip_serializing_if = "Option::is_none")]
#[ts(optional, type = "{ showLinked?: unknown }")]
pub related: Option<serde_json::Value>,
```

A `serde_json::Value`, so a stored `showLinked: "yes"` neither fails the read nor is rewritten by other writes
(AC-25). `RightPanelDto.tab`'s doc comment lists `related`.

## 3. UI (`app/ui/src/related/`)

### 3.1 Modules

| Module | Owns |
| --- | --- |
| `model.ts` | Pure, L1. `showLinkedOf(ui)` → `ui.related?.showLinked === true`; `withShowLinked(ui, on)` → the new `UiState` (`related` an object holding the old keys and `showLinked: on`); `centrePath(route, dailyFile)` → the NFC path to ask for, or `null` for `new/<type>` and a virtual day; `focusAfter(prev: string[], focused: string \| null, next: string[])` → `{ path } \| 'switch' \| 'keep'` (§3.5); `openRouteOf(entry)` → `daily/<title>` for a `daily-note` whose title is `YYYY-MM-DD`, else `note/<path>`. |
| `RelatedPanel.tsx` | The `tabpanel` `Related` (R178): request lifecycle (§3.4), header switch, list, entries, empty and loading states, focus, scroll per path, perf marks. |

`RelatedPanel` renders the chip with the Backlinks parts: `useReference({ target: { path, fragment: null, kind:
'note' }, kind: 'chip', open })`, `chipParts({ kind: 'note', type, review, status, due, completed })`,
`chipIcon(type)` (a type without a definition: the generic type icon, as Backlinks). The build may move `BacklinkChip`
from `links/BacklinksPanel.tsx` into `links/PanelChip.tsx` and use it in both; the Backlinks DOM stays unchanged.

```ts
export type RelatedPanelProps = {
  path: string | null;                 // centrePath(…): null → empty state, no request
  showLinked: boolean;                 // showLinkedOf(ui)
  onToggleLinked(): void;              // App: updateUi(withShowLinked(u, !on)): one ui_state_set
  onOpen(entry: RelatedEntryDto): void;// App: go(openRouteOf(entry)): one nav_opened, as a Backlinks chip
  onOwnSave(f: () => void): () => void;// App's existing listener set (as GraphPanel): re-ask after the page's Saved
  focusFirst: number;                  // changes when `Show related` ran
  types: TypeDefDto[];
};
```

`shell/Frame.tsx` `ContextPanel`: `tab: 'backlinks' | 'related' | 'graph'`, `onTab` likewise, new prop `related?:
RelatedPanelProps`; it renders `<RelatedPanel key="related" {...related} />` for `tab === 'related'` when the row is
built. The Backlinks badge (`BadgeCount`) is unchanged. `App.tsx`: `PanelTab` gains `'related'`; the stored tab maps
`'graph'` → graph, `'related'` → related, anything else → backlinks (D-1675's rule, FR-NAV-05 AC-7).

### 3.2 Registry, commands, strings (R183; FR-UX-03 AC-48)

- `shell/registry.ts` `PANEL_TABS`, between `backlinks` and `graph` (D-1699):
  `{ id: 'related', name: 'related.tab', status: { built: true, due: { milestone: 'v1.0' } }, reqs: ['FR-LNK-15', 'FR-NAV-05'] }`.
  The tab carries `data-command="panel.related"` (Frame's existing `panel.${id}`), no badge, no `aria-description`.
- `shell/commands.ts`, in the block that lists `panel.backlinks` (`note/<path>`, `new/<type>`, `daily/YYYY-MM-DD`):

  | Id | Title key | Section | Shortcut | Runs |
  | --- | --- | --- | --- | --- |
  | `panel.related` | `cmd.related.show` | `view` | — | `actions.showRelated()` |
  | `related.toggleLinked` | `cmd.related.showLinked` while `ctx.related.showLinked` is false, else `cmd.related.hideLinked` | `view` | — | `actions.toggleRelatedLinked()` |

  Both `needsVault: true`. `ShellContext` gains `related?: { showLinked: boolean }`; `panel.tab` gains `'related'`;
  App's `commands(ctx)` memo depends on `showLinked`. `ShellActions` gains `showRelated?()` (one `updateUi`: `rightPanel
  { open: true, tab: 'related' }`, then the `focusFirst` tick) and `toggleRelatedLinked?()` (one `updateUi` with
  `withShowLinked`; never opens the panel). R4 (shortcuts) is unchanged.
- Strings in `app/ui/src/i18n/catalog.ts`, exactly R183's keys and English texts: `related.tab`, `related.list`,
  `related.showLinked`, `related.linked`, `related.linkedDescription`, `related.empty`, `related.loading`,
  `cmd.related.show`, `cmd.related.showLinked`, `cmd.related.hideLinked`. No plurals.

### 3.3 DOM (R178; FR-UX-08 AC-23)

| Part | Element | Attributes and content |
| --- | --- | --- |
| Tab panel | `div` | `role="tabpanel"`, `aria-label` `related.tab`, class `panel-body related`, `data-related-state="list" \| "empty" \| "loading" \| "idle"` (`idle`: no answer yet and under 300 ms); scrolls vertically; the header is `position: sticky; top: 0` |
| Header | `div.related-header` | holds only the switch |
| Switch | `button` | `type="button"`, `role="switch"`, `aria-checked`, `data-command="related.toggleLinked"`, visible text `related.showLinked` (its accessible name), a track drawn with `aria-hidden="true"` |
| List | `ul` | `role="list"`, `aria-label` `related.list`; present only with ≥ 1 entry |
| Entry | `li` | `data-related-entry="<path>"`; background `var(--hover)` on `:hover`; children in this order: |
| (1) Chip | `a` | `href="#"`, `tabIndex=0`, class `chip link-chip kind-note`, `data-link-kind="note"`, `data-icon`, `data-command="panel.related.open"`, `aria-label` = title, `title` = title, `aria-description` = the chip parts' description (`Unreviewed`, the task state…) and, when `linked` is shown, `related.linkedDescription`, joined with `, `; the D-633 suffix and review ring from `chipParts`; title in `span[data-user-content]`; wraps (D-764) |
| (2) Mark | `span` | `data-related-linked`, text `related.linked`; only when `showLinked` and `entry.linked`; not `aria-hidden`, not focusable |
| (3) Excerpt | `p` | `data-related-excerpt`, `data-user-content`; the whole sentence as text; CSS `display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden`; no `tabindex`, no role, no handler, no `mark`/`strong`/`em`; absent when `excerpt` is null |
| Empty | `p.related-empty` | text `related.empty`; not a live region |
| Loading | `div` | `role="status"`, `aria-live="polite"`, text `related.loading`; no animation (`getAnimations()` empty) |

Exactly one of list / empty / loading is drawn under the header (or none while `idle`). Colours are theme tokens only
(FR-UX-05 AC-2): excerpt and mark in the Backlinks hint's text token, ≥ 4.5:1 in both themes (D-129). No entry or state
animates, with or without Reduce motion. The tab draws at most 10 entries, so no windowing.

### 3.4 Requests and timing (R178; D-1688, D-1707, D-1708; NFR-PERF-08)

A request is `ipc.related(path, showLinked)`. Requests are sent **only while the panel is shown and its tab is
`related`** (AC-29); the tab never asks in the background, and nothing computes a count for the tab.

- **When.** (1) On mount and whenever `path` or `showLinked` changes: at once. (2) `vault:changed` (any paths): 300 ms
  after the last one (trailing debounce; a burst of 10 changes in 500 ms sends 1–3 requests, AC-28). (3) The page's own
  `Saved` (`onOwnSave`): at once. Never per keystroke: an own edit asks only through its `Saved`. (4) `index:progress`
  with `state: 'done'`: at once. The App's generic `refresh` tick is **not** an input of `RelatedPanel`.
- **No path** (`new/<type>`, a virtual day): no request; the empty state at once (AC-24).
- **Latest wins.** Each request has a sequence number and a key `(path, showLinked)`; only the latest request's answer
  is drawn, earlier answers are dropped (AC-27). A key change clears the drawn list at once (the header stays), so no
  list of another object, or of the other switch state, is drawn even for one frame (AC-27; the T2 risk of a linked
  object shown while the switch is off).
- **Loading.** `Loading…` appears only when the latest request has no answer 300 ms after it was sent (±1 frame), and
  while the answer is `NotReady`; a `NotReady` answer is asked again on `index:progress` `done` (AC-30). A re-ask for
  the same key (live update) keeps the drawn list until its answer and never shows `Loading…`.
- **Equal answers** (deep-equal DTO) redraw nothing.
- **Errors** other than `NotReady`: the empty state; no retry until the next trigger.
- **Marks**: §1.13.

### 3.5 Focus and scroll (R178; D-1718, D-1719; FR-UX-03 AC-49)

- Tab stops inside the panel: the switch, then each entry's chip. The mark and the excerpt are not Tab stops.
- `Show related` (`focusFirst` tick): when the answer for the current key is drawn, focus the first chip, else the
  switch (empty, short, no path). Consumed once per tick, as Backlinks' `focusConsumed`.
- **Live update** with the focus inside the list: `focusAfter(prevPaths, focusedPath, nextPaths)`: the same path still
  listed → keep it (re-focus the new element if the node was replaced); removed → the entry now at its former index,
  else the previous one, else the switch. Updates make no announcement (only `Loading…` is a live region).
- A chip click or ⏎ opens per the Object preview mode (R103, as a Backlinks chip, D-1721); opening navigates, and the
  panel stays on Related with the new object's list.
- **Scroll**: the tab panel's `scrollTop` per path in a session map (as Backlinks' `scrolls`), restored when that
  path's list is drawn again (Back, AC-26); a live update keeps the current scroll.
- ⌘\ closing the panel returns the focus to the note body (the existing panel rule).

## 4. Machine-local state (FR-STO-07 AC-9; D-1695, D-634)

`ui-state.json`, top level (shared by every vault on this Mac; not under `vaults[…]`):

```ts
related?: { showLinked?: unknown }   // read: showLinked === true; anything else (missing, "yes", 1) reads as false
rightPanel.tab: 'backlinks' | 'related' | 'graph'   // existing field; 'related' stored and restored (D-1704)
```

- One `ui_state_set` per switch flip (the switch, `related.toggleLinked`), through the existing atomic write. A missing
  or invalid value is left as stored until the user flips the switch (D-634's rule).
- Nothing about Related goes under `.tegg/` or into the index.

## 5. QA configuration (D-1717; FR-LNK-15 AC-32)

**Licence allow-list step.** New script `tools/qa/src/licences.ts`:

```
node tools/qa/src/licences.ts --crate tegg-index --allow "MIT Apache-2.0 BSD-2-Clause BSD-3-Clause ISC Zlib Unicode-3.0"
```

- Lists the crate's dependency closure with `cargo tree --offline --locked -p <crate> -e normal,build --prefix none
  --format '{p}|{l}'` (CP-5: D-1717 names `cargo metadata`), dedupes, and skips workspace path packages (a `{p}` holding
  a local path).
- A package passes when its licence expression is satisfiable with allowed ids: SPDX `OR`, `AND`, parentheses,
  `X WITH exception` read as `X`, and the legacy `/` read as `OR`. A missing licence fails.
- On failure prints one line per package, `licence: <name> <version>: <expression>`, and exits 1; on success one line
  `licences: <n> crates OK`, exit 0.
- `qa.config.json` step, at `commit` level (runs in every gate):
  `{ "id": "rust-licences", "lane": "cargo", "inputs": ["Cargo.toml", "Cargo.lock", "crates", "tools/qa/src/licences.ts"], "dir": ".", "run": "node tools/qa/src/licences.ts --crate tegg-index --allow \"MIT Apache-2.0 BSD-2-Clause BSD-3-Clause ISC Zlib Unicode-3.0\"", "level": "commit" }`.
- Today's closure fails on `notify 8.2.0` (`CC0-1.0`, via `tegg-vault`) before any stemmer is added: CP-1.

**Other changes.** The nightly `core-perf-ac` step's file list gains `crates/tegg-index/tests/ac_nfr_perf_13.rs` and
`crates/tegg-core/tests/ac_related_perf.rs`. No other new step: the new test files live in packages with steps (the push
step's `ls crates/*/tests/ac_*.rs` picks them up; `nfr_perf_` tests are skipped there; L5/L6 by their globs;
`nfr_perf_06_related` runs in `app-perf`).

## 6. Fake core and test hooks (L5)

- `app/ui/test/fake-related.ts`, wired into `installFakeCore` like `fake-pins.ts`; `index_related` is added to the
  fake's `READS` set (never a write; FR-SYN-06 AC-47 counts 0 write commands).
- **Data**: `app/ui/test/related-expected.ts`, hand-written from `tests/fixtures/vaults/related/README.md`: per NFC path,
  the hidden and shown answers (entries in the README's order; for sets, any fixed order), `reason`, `linked`,
  `shared` (README cluster tables), `score` (synthetic, strictly descending except README ties, which get equal
  scores), and `excerpt` (the README's "Expected excerpts" where listed, else the candidate's first body sentence as
  written).
- **Answer** of `index_related({ path, showLinked })`: path NFC; `relatedNotReady` on → `NotReady`; an override (below)
  if set; else the data row. Then, against the fake's current files: the open path missing or under `.trash/` →
  `{ entries: [], reason: null }`; entries whose file is missing, under `.trash/`, or whose `type` is now `tag`,
  `image` or `pdf` are dropped; `title`, `type`, `review`, `status`, `due`, `completed` are read from each file's current
  frontmatter (so an external `title:` change relabels the chip, AC-28). A path with no data row →
  `{ entries: [], reason: null }`.
- **Handle additions** (`FakeCoreHandle`):
  - `relatedCalls(): Promise<{ path: string; showLinked: boolean; at: number }[]>` (the `index_related` calls in order;
    `calls()` has them too);
  - `relatedAnswer(path: string, showLinked: boolean | 'both', answer: RelatedDto | null)` (an override; `null` removes
    it; used for AC-22's 120-character title, AC-23's 600-character sentence and `excerpt: null`, AC-28's edit of
    Svatba, AC-10's panel cases);
  - `relatedDelay(ms: number, path?: string)` (later answers, or those for `path`, after `ms`; 0 removes);
  - `relatedNotReady(on: boolean)` (turning it off emits `index:progress` `{ state: 'done' }`).
  Existing hooks cover the rest: `setFile` (edits, type and title changes, NFD bytes), `renameFile` (an external move
  into or out of `.trash/`, an NFD rename), `emit('vault:changed', …)`, `uiState()`, `writes()`, `calls()`.
- **Start**: `uiState: { …, rightPanel: { open: true, tab: 'related', width: 288 } }` and no `related` key (the test
  clock of the ACs); `UiStateDto` in `fake-core.ts` gains `related?: { showLinked?: unknown }` and the tab value
  `'related'`.
- **L6** (`TEGG_TEST=1`): `TEGG_ROUTE=note/<path>` with a seeded `ui-state.json` (`rightPanel.tab: 'related'`), then the
  DOM or `perfMark('related-ready')`. FR-LNK-15 AC-9's older index: after a first launch and quit, the helper sets
  `PRAGMA user_version = 6` (`SCHEMA_VERSION − 1`) in the one `index.sqlite` under the temporary Application Support
  with the system `sqlite3`. External changes go through `app/e2e/helpers/external.ts`; the socket monitor is the one
  used by `previews.ac.test.ts`.

## 7. Test layout (D-61; test names as in the ACs)

| Layer | File | Criteria |
| --- | --- | --- |
| L1 Rust | `crates/tegg-index/tests/ac_related_text.rs` | FR-LNK-15 AC-1, AC-2 (`cs.tsv`), AC-4, AC-6 (stemmer, runtime `Budgets about meetings.`), AC-13 (`cut_off`), AC-18 (`signature`), AC-20 (`sentences`; `tegg_format::plain::plain_blocks`) |
| L2 Rust | `crates/tegg-index/tests/ac_related_props.rs` | AC-3 (golden-list texts and `gen-vault` paragraphs) |
| L4 Rust (index) | `crates/tegg-index/tests/ac_related.rs` (+ `tests/support/related.rs`: fixture copy with `new-empty/.tegg/`, `Index::upsert` of every file, short names) | AC-5, AC-6 (fixture languages), AC-10 (exclusions; type change and restore by `upsert`/`remove`), AC-11 (all link variants), AC-12, AC-13 (fixture), AC-14 (one test per README row), AC-15, AC-16 (static parts and an NFD `upsert`), AC-17, AC-20, AC-31 (Úl u lesa, Návod lists), FR-SRC-04 AC-12, FR-FMT-12 AC-11 (one `rel` row) |
| L4 Rust (eval) | `crates/tegg-index/tests/ac_related_eval.rs` | AC-35 (runs `$CARGO run -p tegg-index --example related-eval --quiet -- <copy>`; checks the output and that the copy is untouched) |
| L4 Rust (core) | `crates/tegg-core/tests/ac_related.rs` | AC-7 (index dir deleted, reopen), AC-9 (version rebuild, one `index:progress` run, no second rebuild), AC-10 and AC-16, AC-17 runtime parts through the watcher within 2 s, AC-19, AC-29 (counter after 60 s idle), AC-34, FR-FMT-07 AC-31 (`CountingFs`, `snapshot`), FR-FMT-12 AC-11 (NFD rename through the watcher) |
| L4 Rust (crash) | `crates/tegg-core/tests/ac_related_index.rs` | AC-9 (SIGKILL during a 500-file `Burst/`; D-1113's re-run-the-binary harness; 100 cycles per push, 1,000 nightly) |
| L2 Rust (core) | `crates/tegg-core/tests/ac_related_props.rs` | AC-8 (watcher steps; fixed seed + one random seed per push at 20…200 notes, the generated vault nightly) |
| L4 bench | `crates/tegg-index/tests/ac_nfr_perf_13.rs`; `crates/tegg-core/tests/ac_related_perf.rs` | NFR-PERF-13 AC-1; AC-2, AC-3 (§1.13) |
| L0 | `tools/qa/test/licences.ac.test.ts` | AC-32 (the checker on crafted `cargo tree` lines incl. `/`, `WITH`, `AND`; and the real repo's step passes); the network part is the existing `ac_core_static.rs` (unchanged) |
| L1 TS | `app/test/related_registry.ac.test.ts`; `app/test/related_catalog.ac.test.ts`; `app/test/related_model.ac.test.ts` | FR-UX-03 AC-48 (registry part); NFR-OTH-02 AC-20 (catalog); `model.ts` (supporting AC-25, AC-28, AC-31) |
| L5 | `app/webkit/related.ac.test.ts` | FR-LNK-15 AC-21…AC-24, AC-26, AC-31; FR-NAV-05 AC-6, AC-7 |
| L5 | `app/webkit/related_live.ac.test.ts` | AC-10 (panel), AC-27…AC-30; FR-FMT-12 AC-11 (NFD route) |
| L5 | `app/webkit/related_switch.ac.test.ts` | AC-25; FR-STO-07 AC-9; FR-SYN-06 AC-47 (0 write commands) |
| L5 | `app/webkit/related_a11y.ac.test.ts` | FR-UX-03 AC-48 (palette, AC-7, AC-8), AC-49; FR-UX-08 AC-23; FR-UX-05 AC-23; NFR-OTH-02 AC-20 (pseudo-locale) |
| L5 helpers | `app/webkit/related-helpers.ts` | start on the fixture, open the panel, read the list (paths, `Linked`, excerpts) |
| L6 | `app/e2e/related.ac.test.ts` | AC-9, AC-25, AC-28 (external trash move), AC-32 (sockets), FR-NAV-05 AC-7, FR-STO-07 AC-9, FR-SYN-06 AC-47, FR-UX-08 AC-23 (the related.md "Real-app tests" list; D-382, D-799) |
| L6 bench | `app/e2e/nfr_perf_06_related.ac.test.ts` | NFR-PERF-06 AC-7 (outside the push run) |
| manual | `qa/manual/` | AC-33 |

Fixtures are committed (D-1692). Each L4 test copies the fixture into a temporary directory with
`tests/fixtures/vaults/new-empty/.tegg/` and never writes inside `tests/fixtures/`.

## 8. Changes to other documents and tests (in the build commit)

- **AC-test changes** with `AC-Test-Change: AP-1476, the Related tab is built in slice REL; approved-by: owner`
  (D-1723): `app/webkit/sidebar_5b.ac.test.ts` (`fr_nav_05_ac1_right_panel_tabs`: Backlinks, Related, Graph);
  `app/test/registry.ac.test.ts` and the R2 table it reads (app-shell R2 row `related`). CP-4 asks to add
  `app/test/outline_registry.ac.test.ts` (`fr_ux_03_ac45_…` asserts `PANEL_TABS` is exactly backlinks, graph).
- `docs/acceptance/app-shell.md` R2 row; `docs/acceptance/inbox.md` FR-NAV-05 AC-1 (D-1723); `docs/acceptance/README.md`
  row for `related.md`.
- `docs/architecture.md`: a paragraph on the `rel` table, the stemmers and `SCHEMA_VERSION` 7 (plan §9).
- `app/src-tauri/src/dto.rs`: `RelatedDto`, `RelatedEntryDto`, `UiStateDto.related`, `RightPanelDto.tab` doc; `types.ts`
  regenerated.

## 9. Contract choices (no owner decision needed)

1. The text pipeline, `rel`, the signature and the candidate query live in `tegg-index`; the core adds only `NotReady`,
   the media links and the title collation (§1.11), so L1/L4 tests reach everything through `Index`.
2. The English stemmer is the `rust-stemmers` crate (Snowball's generated Porter2, the reference) rather than a hand
   port; AC-32 allows either. If its licence fails §5's step, a port inside `tegg-index` replaces it with the same API.
3. The stop-word lists are §1.3's; the Czech list is hand-written (no third-party list, no licence question) and was
   checked against every expected list of the fixture (§11.2).
4. Language detection counts the words of the title, aliases, body and tag names, the same words that are stemmed.
5. Headings are detected as ATX lines outside fences; Setext headings count as body text.
6. A digit-only word is one whose every char `is_numeric()` (`2027`, `01`, `²`); `3d` is a word.
7. The `Lang` of a note is stored in `notes.meta`, not as a third `rel` column, so `bm25(rel, 3.0, 1.0)` sees exactly
   R181's two columns.
8. The open object's signature is recomputed from its stored raw text with `rel_row` (the heading counts need it); it
   equals its `rel` row.
9. Stems are quoted as FTS5 strings in the `MATCH` expression, so a stem equal to an FTS5 keyword (`not`, `and`) is a
   term.
10. `score` is −bm25 (positive) and `shared` counts distinct signature stems in either column; neither is shown.
11. An open path that isn't indexed answers an empty list with `reason: null`, not an error; only the first build answers
    `NotReady`.
12. Equal scores compare as exact `f64` equality.
13. The excerpt's sentences are stemmed with the candidate's language; the excerpt is NFC.
14. `plain_blocks` lives in `tegg-format` beside the backlinks block texts; `sentences` in `tegg-index` beside the
    ranking.
15. The panel ignores the App's `refresh` tick and has its own debounced `vault:changed`, `Saved` and `done` triggers,
    so bursts and keystrokes don't ask (AC-28).
16. A switch flip or navigation clears the drawn list at once (header kept); a live re-ask of the same key keeps it.
17. The switch is a `button role="switch"`; the `Linked` mark is visible text in the entry and also in the chip's
    description, as R178 and AC-25 ask.
18. Chips carry `data-command="panel.related.open"` (as Backlinks' `panel.backlinks.open`) so FR-UX-03 AC-8's audit of
    the open panel finds a command on every control.
19. Related entries are not pin drag sources (R135's list is closed).
20. A chip opens `daily/<date>` for a Daily Note with an ISO-date title, else `note/<path>` (the graph panel's rule).
21. The licence check reads `cargo tree --offline --locked` (CP-5) and skips workspace path crates.
22. NFR-PERF-13 AC-1 times `Index::related` in the AC's file; AC-2 and AC-3 run through `Core` in `tegg-core`, where the
    reference-vault helpers are.

## 10. Contract points for the owner (CP-1…CP-7 → D-1725…D-1731)

Decided 2026-11-14 (owner, "Accept all proposals"; BRD v1.185): every proposal is the decision. CP-n → D-(n+1724).

| CP | Point | Proposal | Alternative | Affects |
| --- | --- | --- | --- | --- |
| CP-1 | **The allow-list fails today.** `tegg-index`'s closure already holds `notify 8.2.0` (via `tegg-vault`, the file watcher) under `CC0-1.0`, which D-1717's list lacks. Every other current crate passes (`blake3` and `constant_time_eq` through their `Apache-2.0` option, `encoding_rs` `(Apache-2.0 OR MIT) AND BSD-3-Clause`, `unicode-ident` `(MIT OR Apache-2.0) AND Unicode-3.0`). | Add `CC0-1.0` (a public-domain dedication) to the allow-list. | Check only what the slice adds: the stemmer crate's own closure, or the closure minus a recorded baseline of today's crates | §5, FR-LNK-15 AC-32, `qa.config.json` |
| CP-2 | **Title order of equal scores needs a region the core doesn't get.** R181 rule 7 says D-122 collation "for the region", but `index_related(path, showLinked)` carries no locale and AC-21 checks its arguments exactly. | The core orders equal titles by ICU4X root collation (`und`, primary, numeric: `queries_q`'s collator); the UI keeps the core's order. It equals the `cs` and `en-US` order for every fixture tie (AC-12, AC-16) and differs only in Czech-specific orders such as `ch` after `h`. | Add `locale` (the region) to the request, as `query_run`'s `env.locale`; AC-21's recorded arguments then carry it | §1.8 step 7, §1.11, §2, FR-LNK-15 AC-12, AC-16, AC-21 |
| CP-3 | **"35 % of the best remaining entry": best of what?** R181 rule 6 doesn't say whether the best is taken before or after the 3-shared rule. Taken before, one candidate sharing only 2 heavy title stems can push every 3-stem match under 35 % and empty the list. | The best among candidates left after rule 5 that share ≥ 3 signature stems. Every fixture list is the same under both readings (checked, §11.2). | The best among all candidates left after rule 5 | §1.7, §1.8 step 6, FR-LNK-15 AC-13 |
| CP-4 | **An AC test D-1723 doesn't list.** `app/test/outline_registry.ac.test.ts` `fr_ux_03_ac45_outline_commands_and_shortcut` asserts `PANEL_TABS` ids are exactly `['backlinks', 'graph']`, so it fails once `related` is added. | Change it in the build commit under the same trailer: `['backlinks', 'related', 'graph']`. | — (confirm only) | §8 |
| CP-5 | **`cargo metadata` needs the network.** D-1717 names `cargo metadata`; it resolves the whole workspace, platform and dev dependencies included, and here fails `--offline` (it wants to download `arbitrary`). A commit hook shouldn't depend on the network. | Use `cargo tree --offline --locked -p tegg-index -e normal,build` (works offline from `Cargo.lock`), which lists the same runtime and build closure with each licence. | `cargo metadata` without `--offline` (fetches on first run) | §5 |
| CP-6 | **AC-6's "no stop word of either list" is false for Hvězda 01.** Its body `Zápis z hvězdárny.` holds `z`, which AC-4 requires in the Czech list (every Hvězda note has it). Kytara's `a` is in both lists and ignored. The conclusion (Czech) holds. | Red-test reading: assert the three are Czech with stop counts (Czech-only, English-only) = (0, 0) for Souhvězdí and Kytara and (1, 0) for Hvězda 01, and no AC text change. | Correct AC-6's sentence to "no English stop word" | FR-LNK-15 AC-6 |
| CP-7 | **Small vaults get no lists.** With the 10 % ceiling, a vault of fewer than 20 objects skips every stem (df ≥ 2 > 10 % of N), so every list is empty; under 30 objects only stems in exactly 2 objects count. | The ceiling never goes below 2 objects: a stem is skipped when df > max(10 % of N, 2) (`RelatedParams.df_floor = 2`). The fixture (N = 39, 40) is unchanged. | Accept: small vaults show no lists | R181 rule 2, `signature` |



## 11. The stemmer check (D-1714) and the fixture check

### 11.1 `cs.tsv` against the rule set

A throwaway Python port of the README's rule set (steps 1–3 with rule 3.5, first matching rule per step, `fold` = NFC →
lower case → combining marks removed), outside the repository, run over every row of `tests/fixtures/format/stem/cs.tsv`
(362 rows, header `word	stem	note`, UTF-8, NFC, LF):

- **0 disagreements**: `stem_cs(fold(word))` and `stem_cs(fold(nfd(word)))` equal the golden `stem` on all 362 rows,
  the `AP-1467`, `AP-1468` and `limit` rows included.
- Without rule 3.5 the port gives the README's "Alternative" column exactly (`rozpoct`, `uct`, `dest`) and nothing else
  changes.
- AC-1's and AC-4's words give the stated stems (`dulezit` for all 7 spellings and their NFD forms; `prah`; `rozpock`;
  `den` → `dn`, `řeka` → `rk`; `Koupit mléko a chleba.` → {`koupit`, `mlk`, `chlb`}); AC-5's words give the stated
  stems (`zdroj`, `text`, `kytar`, `housl`, `rajk`, `teleskop`, `knih`, `vzpomink`, `komt`).

### 11.2 The fixture's expected lists

A throwaway twin of §1.4–§1.8 (the port above, §1.3's lists, a hand table of the Snowball stems of the English
fixture words, FTS5's bm25 with k1 = 1.2, b = 0.75 and column weights 3 / 1) reproduces, on
`tests/fixtures/vaults/related/`:

- N = 39 `rel` rows; every stem a criterion relies on in ≤ 3 objects; `hvezd` 13, `hvezdarn`, `pozorovan`, `zapis` 12.
- Every row of the README's "Expected lists", hidden and shown, in order where ordered (Souhvězdí's ten and its linked
  list cut at Hvězda 10; Školení's tie; Rozpočet [Den 30. 9., Úkol]); `reason: short` for Mléko (3 stems), Buben (4),
  Prázdná (1); Kytara 5, Svatba 9 distinct stems; Hiking, Trail, gear list English, every other note Czech.
- Every excerpt of the README's table and AC-20's sentence counts (Terminy 8 vs 6, Kniha's four 2-stem sentences).
- The runtime cases: AC-10 (Starý úl restored → {Prohlídka, Starý úl}; Prohlídka as `tag` → empty), AC-11 (plain words →
  Semínka in Zahrada's hidden list), AC-17 (Svatba's tags → {Kniha, Poznamky}), AC-28 (Svatba's typed sentence →
  {Včelstvo, Prohlídka}); both readings of CP-3 give the same lists.

The only discrepancy found is CP-6 (AC-6's wording). The twins are not in the repository (D-1714: a check, not code).

## 12. Red-test decisions (D-1732…D-1746, BRD v1.186; red tests 541c3fe7…830b83c1)

RT-1…RT-15 of the test author, accepted as proposed (owner, 2026-11-14: "Accept all proposals"); RT-n → D-(n+1731).

| D | Decision |
| --- | --- |
| D-1732 | **Compile-only Rust stubs by the test author (RT-1).** The compile-only stubs of commit 541c3fe7 (written by the test author, not the main session as D-1398 says) stay; the build replaces them. |
| D-1733 | **AC-4's `.tegg/` clause is not tested (RT-2).** The stop-word lists are compiled in (`&'static`), so no file can change them; FR-LNK-15 AC-4's "no file in `.tegg/` changes either list" has no test of its own. |
| D-1734 | **The English stop-word list is checked exactly (RT-3).** FR-LNK-15 AC-4 asserts the English list equals Snowball's English list without its apostrophe entries (constant `SNOWBALL_EN` in the test); the build verifies that constant against the Snowball source and reports any difference. |
| D-1735 | **AC-11's `souvisí` variant (RT-4).** The variant removes the paragraph `Patří k [[Zahrada na jaře]].` and adds the relation property. |
| D-1736 | **AC-9's rebuild at L4 (RT-5).** "Rebuilds once" is one `IndexProgress Done` with every note read (`CountingFs`); "no second rebuild" is fewer `.md` reads than notes; the version is `PRAGMA user_version` ≥ 7. |
| D-1737 | **AC-9's kill test reads the tables with `sqlite3` (RT-6).** After each SIGKILL the test checks `count(fts) = count(rel)` and that every `rel` rowid is in `notes`, by the contract's table names. |
| D-1738 | **AC-8 nightly samples objects (RT-7).** On the generated vault, AC-8 checks the changed objects plus 100 chosen by the seed, not every object. |
| D-1739 | **AC-23's visible end (RT-8).** Checked as computed `-webkit-line-clamp: 3`, `overflow: hidden` and the text clipped, not the drawn ellipsis. |
| D-1740 | **Fake-core override entries (RT-9).** The fake core keeps test override entries without a file (AC-22's long title, AC-23's long sentence); contract §6's "entries whose file is missing are dropped" applies to the fixture's data rows only. |
| D-1741 | **FR-UX-03 AC-48's audit (RT-10).** Every control in the Related tab has a `data-command` or is a Tab stop, and excerpts are not controls; FR-UX-03 AC-7 (no shortcut clashes) is checked at L1. |
| D-1742 | **AC-26's scroll on Back (RT-11).** The test overrides Rozpočet's answer with 10 entries so the tab can scroll. |
| D-1743 | **AC-22's task icon (RT-12).** The To do box is asserted as a task icon other than `file-text` or `calendar`; the contract names no icon. |
| D-1744 | **The L6 tours (RT-13).** The tour relaunches on each route (as G2's), with D-1676's filter; AC-32 runs its own copy with the socket monitor (two runs). |
| D-1745 | **Gate wiring left to the build (RT-14).** The build commit adds the `rust-licences` step and puts `ac_nfr_perf_13.rs` and `ac_related_perf.rs` in the nightly `core-perf-ac` step; the push run carries AC-9's 100 kill cycles and AC-29's 60 s idle wait. |
| D-1746 | **AC-35's object count (RT-15).** The evaluation command's test also asserts `objects: 39` (the fixture's `rel` rows). |

## 13. Build decisions (D-1747…D-1757, BRD v1.187)

B-1…B-11 of the build, accepted as proposed (owner, 2026-11-14: "Accept all proposals"); B-n → D-(n+1746).

| D | Decision |
| --- | --- |
| D-1747 | **AC-4's short-stem cases are Czech only (B-1).** FR-LNK-15 AC-4's `den` / `řeka` cases (stems `dn`, `rk` dropped) run for Czech notes only; under English `stem_en` keeps `den` and `reka`. AC-test change. |
| D-1748 | **AC-9's core rebuild test lowers the reopened index (B-2).** The test lowers the schema version in the index database that the counting core then reopens, so it really checks one rebuild from 6 to 7. AC-test change. |
| D-1749 | **AC-8's random vaults use small word groups (B-3).** The AC-8 property's generator draws each note from small disjoint word groups so stems stay under the df ceiling and lists exist; the non-vacuity check stays. AC-test change. |
| D-1750 | **AC-22's date label follows the test region (B-4).** AC-22 expects the en-US label of the shared chip code (`Fri, Nov 27 · To do`), as a Backlinks chip shows under the test clock's region. AC-test change. |
| D-1751 | **AC-27 opens Hiking by its route (B-5).** Opening from Search adds a history entry (D-1217), so AC-27 opens Hiking by its route through a sidebar pin (the test vault pins it in `.tegg/pinned.yml`), adding no Search entry, and ⌘[ shows Rozpočet's list again. AC-test change. |
| D-1752 | **The accented note is opened by its route (B-6).** FR-SYN-06 AC-47 and FR-LNK-15 AC-22 open `Důležité termíny školení` by its route, since Search ranks its unaccented twin first. AC-test change. |
| D-1753 | **Related re-asks after an own save only when idle (B-7).** While the user types, the editor's maximum-wait autosave writes about every second; Related re-asks 300 ms after an own save only if the page is still saved (`noteApi.pending()` is false), so no request is sent while typing (AC-28). |
| D-1754 | **The panel's tablist is one Tab stop (B-8).** The right panel's tablist (Backlinks, Related, Graph) is one Tab stop, the selected tab; ←/→/Home/End move to and select a tab (WAI-ARIA tabs). Applies to all panel tabs. |
| D-1755 | **Related chips have the link role (B-9).** Related chips carry `role="link"` for VoiceOver; Backlinks chips are unchanged. |
| D-1756 | **`Loading…` is drawn in the frame after 300 ms (B-10).** `Loading…` is drawn in the animation frame after the 300 ms timer, only if the answer hasn't arrived; within AC-30's 300 ms ± 1 frame. |
| D-1757 | **Document frequencies are kept in memory (B-11).** `Index::related` reads df from a map read once from `rel_vocab` and updated by each write, instead of per-term vocab lookups (about 3× faster on the 20,000-note vault); exact for folded Czech and English stems. |
| D-1758 | **AC-23 ignores `perf_mark`** (owner, "Yes, approve"; BRD v1.188). The excerpt-click check's "no command sent" ignores test-build timing marks, as the editor and embeds tests do. |

## 14. QA decisions (D-1759…D-1761, BRD v1.189)

QA-1…QA-3 of the QA review, accepted as proposed (owner, 2026-11-14: "Accept all proposals").

| D | Decision |
| --- | --- |
| D-1759 | **The typing benchmark counts asks, not redraws (QA-1).** NFR-PERF-06 AC-7's test counts `related-request` marks (sent on every ask) to show the list was re-asked after Saved, not `related-ready` (sent only when the drawn list changes, which typing `a`×200 doesn't). AC-test change. |
| D-1760 | **AC-8 compares the incremental df map on push (QA-2).** FR-LNK-15 AC-8's property asks the watched core for one list right after opening, so later comparisons use the document-frequency map kept by each write (D-1757), on push as well as nightly. AC-test change. |
| D-1761 | **Stems are exactly unicode61 tokens (QA-3).** Every stem written to `rel` is exactly one token of SQLite's `unicode61` tokenizer: stems holding characters it wouldn't treat as token characters are dropped (conservatively, where Rust can't know SQLite's table), so the in-memory df map always equals a rebuild (AR-01, D-1757). Czech and English text is unaffected; a property test on arbitrary Unicode checks it. |
