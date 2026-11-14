//! Slice REL (docs/contracts/v1-related.md §1.6–§1.10; docs/acceptance/related.md R181, R182): the ranking functions,
//! `Index::related` and the read-only test hooks. Nothing here writes: a Related list is computed on request from the
//! `rel` table and the stored raw text, never cached or stored (FR-LNK-15 AC-7, AC-29); it is a function of the files
//! only (AR-01).
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use tegg_format::nfc;

use crate::stemming::{self, RelRow};
#[cfg(any(test, feature = "test-hooks"))]
use crate::stemming::Lang;
use crate::{Index, Meta, Resolved, Stored};

/// R181 rule 8 (D-1685, D-1690, D-1731): the ranking numbers. The core always uses `RelatedParams::default()`.
#[derive(Debug, Clone, PartialEq)]
pub struct RelatedParams {
    pub signature_size: usize,
    /// Skip a stem when df > max(df_ceiling × N, df_floor) (D-1731).
    pub df_ceiling: f64,
    /// The ceiling never goes below 2 objects (CP-7, D-1731).
    pub df_floor: usize,
    pub title_weight: u32,
    pub heading_weight: u32,
    pub body_weight: u32,
    pub bm25_title: f64,
    pub bm25_body: f64,
    /// Fewer distinct stems → no entries, reason Short.
    pub min_stems: usize,
    pub min_shared: usize,
    pub min_relative: f64,
    pub max_entries: usize,
}
impl Default for RelatedParams {
    fn default() -> Self {
        RelatedParams {
            signature_size: 25,
            df_ceiling: 0.10,
            df_floor: 2,
            title_weight: 3,
            heading_weight: 2,
            body_weight: 1,
            bm25_title: 3.0,
            bm25_body: 1.0,
            min_stems: 5,
            min_shared: 3,
            min_relative: 0.35,
            max_entries: 10,
        }
    }
}

/// Occurrences of one stem in the open object: in the title column, in headings, in the rest of the body.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TermCounts {
    pub title: u32,
    pub heading: u32,
    pub body: u32,
}

/// R181 rule 2. tf = title_weight·title + heading_weight·heading + body_weight·body; weight = tf × ln(n / df). Stems
/// with df < 2 or df > max(df_ceiling × n, df_floor) are removed first (D-1731); of the rest the `signature_size`
/// highest weights are kept, ties by stem in code-point order. Returned in that order.
pub fn signature(terms: &BTreeMap<String, TermCounts>, df: &dyn Fn(&str) -> usize, n: usize, p: &RelatedParams) -> Vec<(String, f64)> {
    let ceiling = (p.df_ceiling * n as f64).max(p.df_floor as f64);
    let mut out: Vec<(String, f64)> = terms
        .iter()
        .filter_map(|(s, c)| {
            let d = df(s);
            if d < 2 || d as f64 > ceiling {
                return None;
            }
            let tf = p.title_weight * c.title + p.heading_weight * c.heading + p.body_weight * c.body;
            Some((s.clone(), tf as f64 * (n as f64 / d as f64).ln()))
        })
        .collect();
    out.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    out.truncate(p.signature_size);
    out
}

/// R181 rule 6. `entries` are `(score, shared)` in final order; `best` is the reference score (CP-3). Returns the
/// indexes kept: shared ≥ min_shared and score ≥ min_relative × best, the first `max_entries` of them.
pub fn cut_off(entries: &[(f64, usize)], best: f64, p: &RelatedParams) -> Vec<usize> {
    entries
        .iter()
        .enumerate()
        .filter(|(_, (score, shared))| *shared >= p.min_shared && *score >= p.min_relative * best)
        .map(|(i, _)| i)
        .take(p.max_entries)
        .collect()
}

fn is_closer(c: char) -> bool {
    matches!(c, '"' | '”' | '’' | '»' | ')' | ']')
}

/// R182 rule 3 inside one block: a sentence ends after a run of `.`, `!`, `?` or `…`, optionally followed by one
/// closing quote or bracket, when whitespace and then an upper-case letter follow. Trimmed, in order.
pub fn sentences(block: &str) -> Vec<&str> {
    let chars: Vec<(usize, char)> = block.char_indices().collect();
    let mut out = Vec::new();
    let mut start = 0usize;
    let mut i = 0usize;
    while i < chars.len() {
        if !matches!(chars[i].1, '.' | '!' | '?' | '…') {
            i += 1;
            continue;
        }
        let mut j = i;
        while j < chars.len() && matches!(chars[j].1, '.' | '!' | '?' | '…') {
            j += 1;
        }
        if j < chars.len() && is_closer(chars[j].1) {
            j += 1;
        }
        let end = chars.get(j).map_or(block.len(), |c| c.0);
        let mut k = j;
        while k < chars.len() && chars[k].1.is_whitespace() {
            k += 1;
        }
        if k > j && k < chars.len() && chars[k].1.is_uppercase() {
            let s = block[start..end].trim();
            if !s.is_empty() {
                out.push(s);
            }
            start = chars[k].0;
            i = k;
        } else {
            i = j.max(i + 1);
        }
    }
    let s = block[start..].trim();
    if !s.is_empty() {
        out.push(s);
    }
    out
}

/// Title order for equal scores when the caller has no collator (tests, the evaluation command): code points.
pub fn by_code_point(a: &str, b: &str) -> std::cmp::Ordering {
    a.cmp(b)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelatedReason {
    Short,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RelatedEntry {
    /// NFC vault path.
    pub path: String,
    /// As `index_backlinks` shows it (D-320: a Daily Note's date).
    pub title: String,
    /// Matched type key (FR-TYP-13).
    pub r#type: String,
    /// D-633: trimmed non-empty string values of the frontmatter keys.
    pub review: Option<String>,
    pub status: Option<String>,
    pub due: Option<String>,
    pub completed: Option<String>,
    pub linked: bool,
    /// §1.9; None when the candidate has no eligible text.
    pub excerpt: Option<String>,
    /// −bm25(rel, 3.0, 1.0): positive, higher is better.
    pub score: f64,
    /// Distinct signature stems the candidate holds (either column).
    pub shared: usize,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct RelatedList {
    pub entries: Vec<RelatedEntry>,
    pub reason: Option<RelatedReason>,
}

/// §1.10: the stored `rel` row of a note, split on spaces.
#[cfg(any(test, feature = "test-hooks"))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelTerms {
    pub lang: Lang,
    pub title: Vec<String>,
    pub body: Vec<String>,
}

/// R179 rule 1 for a stored note: its displayed title (a Daily Note's date, D-320), aliases, raw body and the names in
/// its frontmatter `tags:` (inline `#tags` are already body words).
pub(crate) fn rel_row_of(s: &Stored, body: &str) -> RelRow {
    let daily = (s.r#type == "daily-note").then(|| crate::daily_date(&s.attributes)).flatten();
    let title = daily.map(tegg_format::format_date).unwrap_or_else(|| s.title.clone());
    let mut tags = Vec::new();
    if let Some(v) = s.attributes.get("tags") {
        crate::value_texts(v, &mut tags);
    }
    stemming::rel_row(&title, &s.aliases, body, &tags)
}

/// D-633: a chip field, trimmed; empty reads as None.
fn chip_str(attrs: &Value, key: &str) -> Option<String> {
    attrs.get(key).and_then(|v| v.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn fts_string(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// Steps 1–3 of §1.8.
enum Sig {
    Short,
    Stems(Vec<(String, f64)>),
}

impl Index {
    /// The indexed note at `path`, compared in NFC (a file indexed under its NFD name is found by the NFC path).
    fn meta_nfc(&self, path: &str) -> Option<&Meta> {
        if let Some(m) = self.meta(path) {
            return Some(m);
        }
        let want = nfc(path);
        self.metas.values().find(|m| nfc(&m.path) == want)
    }

    fn body_of(&self, m: &Meta) -> String {
        let raw = self.raw_of(m).ok().flatten().unwrap_or_default();
        raw.get(m.s.body_start..).unwrap_or("").to_string()
    }

    fn signature_for(&self, m: &Meta, p: &RelatedParams) -> Sig {
        let row = rel_row_of(&m.s, &self.body_of(m));
        let distinct: BTreeSet<&String> = row.title.iter().chain(&row.body).collect();
        if distinct.len() < p.min_stems {
            return Sig::Short;
        }
        let mut terms: BTreeMap<String, TermCounts> = BTreeMap::new();
        for s in &row.title {
            terms.entry(s.clone()).or_default().title += 1;
        }
        let mut heading: HashMap<&str, u32> = HashMap::new();
        for s in &row.heading {
            *heading.entry(s.as_str()).or_default() += 1;
        }
        let mut body: HashMap<&str, u32> = HashMap::new();
        for s in &row.body {
            *body.entry(s.as_str()).or_default() += 1;
        }
        for (s, n) in body {
            let h = heading.get(s).copied().unwrap_or(0).min(n);
            let t = terms.entry(s.to_string()).or_default();
            t.heading += h;
            t.body += n - h;
        }
        let mut stmt = match self.conn.prepare_cached("SELECT doc FROM rel_vocab WHERE term = ?1") {
            Ok(s) => s,
            Err(_) => return Sig::Stems(Vec::new()),
        };
        let mut dfs: HashMap<String, usize> = HashMap::new();
        for s in terms.keys() {
            let d: i64 = stmt.query_row(params![s], |r| r.get(0)).optional().ok().flatten().unwrap_or(0);
            dfs.insert(s.clone(), d.max(0) as usize);
        }
        Sig::Stems(signature(&terms, &|s: &str| dfs.get(s).copied().unwrap_or(0), self.metas.len(), p))
    }

    /// The paths linked with `m` either way (§1.8 step 5: backlinks' sources and its own resolved links), NFC.
    fn linked_with(&self, m: &Meta) -> HashSet<String> {
        self.with_links(|l| {
            let mut out: HashSet<String> = HashSet::new();
            if let Some(b) = l.backlinks.get(&m.path) {
                out.extend(b.iter().map(|p| nfc(p)));
            }
            if let Some(r) = l.resolved.get(&m.path) {
                for x in r {
                    if let Resolved::Note(p) | Resolved::Daily(p) = x {
                        out.insert(nfc(p));
                    }
                }
            }
            out
        })
    }

    /// R182: the first sentence with the most distinct signature stems (≥ 1), else the first sentence; None without
    /// an eligible block.
    fn excerpt_of(&self, m: &Meta, sig: &HashSet<&str>) -> Option<String> {
        let blocks = tegg_format::plain::plain_blocks(&self.body_of(m));
        let mut first: Option<String> = None;
        let mut best: Option<(usize, String)> = None;
        for b in &blocks {
            for s in sentences(b) {
                if first.is_none() {
                    first = Some(s.to_string());
                }
                let st: HashSet<String> = stemming::stems(s, m.s.lang).into_iter().collect();
                let score = st.iter().filter(|x| sig.contains(x.as_str())).count();
                if score >= 1 && best.as_ref().is_none_or(|(b, _)| score > *b) {
                    best = Some((score, s.to_string()));
                }
            }
        }
        best.map(|b| b.1).or(first).map(|s| nfc(&s))
    }

    /// §1.8: the Related list of `path` (NFC-normalized first); `None` when it is not indexed. `extra_linked`: further
    /// paths linked with it that only the core knows (media embeds); `title_order`: the order of equal scores' titles.
    pub fn related(
        &self,
        path: &str,
        show_linked: bool,
        p: &RelatedParams,
        extra_linked: &[String],
        title_order: &dyn Fn(&str, &str) -> std::cmp::Ordering,
    ) -> Option<RelatedList> {
        // Step 9: every call counts, whatever it returns.
        self.related_calls.set(self.related_calls.get() + 1);
        let m = self.meta_nfc(&nfc(path))?;
        // Steps 1–3.
        let sig = match self.signature_for(m, p) {
            Sig::Short => return Some(RelatedList { entries: Vec::new(), reason: Some(RelatedReason::Short) }),
            Sig::Stems(s) if s.is_empty() => return Some(RelatedList::default()),
            Sig::Stems(s) => s,
        };
        // Step 4: candidates and their bm25; `shared` from each stem's rows.
        let query = sig.iter().map(|(s, _)| fts_string(s)).collect::<Vec<_>>().join(" OR ");
        let mut scores: Vec<(i64, f64)> = Vec::new();
        let mut shared: HashMap<i64, usize> = HashMap::new();
        let read = (|| -> rusqlite::Result<()> {
            let mut stmt = self.conn.prepare_cached("SELECT rowid, -bm25(rel, ?2, ?3) FROM rel WHERE rel MATCH ?1")?;
            let rows = stmt.query_map(params![query, p.bm25_title, p.bm25_body], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)))?;
            for r in rows {
                scores.push(r?);
            }
            let mut one = self.conn.prepare_cached("SELECT rowid FROM rel WHERE rel MATCH ?1")?;
            for (s, _) in &sig {
                let rows = one.query_map(params![fts_string(s)], |r| r.get::<_, i64>(0))?;
                for r in rows {
                    *shared.entry(r?).or_default() += 1;
                }
            }
            Ok(())
        })();
        if read.is_err() {
            return Some(RelatedList::default());
        }
        // Step 5: removed objects.
        let open_id = m.s.id.as_deref().map(|i| nfc(i.trim())).filter(|i| !i.is_empty());
        let mut linked = self.linked_with(m);
        linked.extend(extra_linked.iter().map(|p| nfc(p)));
        let mut cands: Vec<(&Meta, f64, usize, bool)> = Vec::new();
        for (rowid, score) in scores {
            let Some(c) = self.metas.get(&rowid) else { continue };
            if c.rowid == m.rowid || matches!(c.s.r#type.as_str(), "tag" | "image" | "pdf") {
                continue;
            }
            if open_id.is_some() && c.s.id.as_deref().map(|i| nfc(i.trim())) == open_id {
                continue;
            }
            let is_linked = linked.contains(&nfc(&c.path));
            if is_linked && !show_linked {
                continue;
            }
            cands.push((c, score, shared.get(&rowid).copied().unwrap_or(0), is_linked));
        }
        // Step 6 (CP-3): the best score among candidates sharing ≥ min_shared stems.
        let best = cands.iter().filter(|c| c.2 >= p.min_shared).map(|c| c.1).fold(f64::NEG_INFINITY, f64::max);
        // Step 7: score descending; equal scores by title, then path in code-point order (D-1709).
        cands.sort_by(|a, b| {
            b.1.total_cmp(&a.1)
                .then_with(|| title_order(&a.0.s.title, &b.0.s.title))
                .then_with(|| nfc(&a.0.path).cmp(&nfc(&b.0.path)))
        });
        // Step 8: the cut-off, then each kept entry with its excerpt.
        let keep = if best.is_finite() { cut_off(&cands.iter().map(|c| (c.1, c.2)).collect::<Vec<_>>(), best, p) } else { Vec::new() };
        let sig_set: HashSet<&str> = sig.iter().map(|(s, _)| s.as_str()).collect();
        let entries = keep
            .into_iter()
            .map(|i| {
                let (c, score, shared, is_linked) = cands[i];
                RelatedEntry {
                    path: nfc(&c.path),
                    title: nfc(&c.s.title),
                    r#type: c.s.r#type.clone(),
                    review: chip_str(&c.s.attributes, "review"),
                    status: chip_str(&c.s.attributes, "status"),
                    due: chip_str(&c.s.attributes, "due"),
                    completed: chip_str(&c.s.attributes, "completed"),
                    linked: is_linked,
                    excerpt: self.excerpt_of(c, &sig_set),
                    score,
                    shared,
                }
            })
            .collect();
        Some(RelatedList { entries, reason: None })
    }
}

#[cfg(any(test, feature = "test-hooks"))]
impl Index {
    /// §1.10: the stored `rel` row of `path` (NFC), or None.
    pub fn rel_terms(&self, path: &str) -> Option<RelTerms> {
        let m = self.meta_nfc(&nfc(path))?;
        let (title, body): (String, String) =
            self.conn.query_row("SELECT title, body FROM rel WHERE rowid = ?1", params![m.rowid], |r| Ok((r.get(0)?, r.get(1)?))).optional().ok().flatten()?;
        let split = |s: &str| s.split(' ').filter(|x| !x.is_empty()).map(str::to_string).collect::<Vec<_>>();
        Some(RelTerms { lang: m.s.lang, title: split(&title), body: split(&body) })
    }
    /// §1.10: steps 1–3 of §1.8 for `path`: the signature with weights; None when not indexed; empty when short.
    pub fn related_signature(&self, path: &str, p: &RelatedParams) -> Option<Vec<(String, f64)>> {
        let m = self.meta_nfc(&nfc(path))?;
        Some(match self.signature_for(m, p) {
            Sig::Short => Vec::new(),
            Sig::Stems(s) => s,
        })
    }
    /// §1.10: `rel` rows.
    pub fn rel_rows(&self) -> usize {
        self.conn.query_row("SELECT count(*) FROM rel", [], |r| r.get::<_, i64>(0)).map(|n| n as usize).unwrap_or(0)
    }
    /// §1.10: calls of `Index::related` since this `Index` was opened.
    pub fn related_computed(&self) -> u64 {
        self.related_calls.get()
    }
}
