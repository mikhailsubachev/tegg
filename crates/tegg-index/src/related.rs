//! Slice REL (docs/contracts/v1-related.md §1.6–§1.10): compile-only red-test stubs, no behaviour (TS-I1, D-1398).
//! `Index::related` answers "not indexed", the ranking functions keep nothing and the test hooks read nothing, so the red
//! tests fail by assertion. The build replaces them.
use std::collections::BTreeMap;

use crate::stemming::Lang;
use crate::Index;

#[derive(Debug, Clone, PartialEq)]
pub struct RelatedParams {
    pub signature_size: usize,
    pub df_ceiling: f64,
    pub df_floor: usize,
    pub title_weight: u32,
    pub heading_weight: u32,
    pub body_weight: u32,
    pub bm25_title: f64,
    pub bm25_body: f64,
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

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TermCounts {
    pub title: u32,
    pub heading: u32,
    pub body: u32,
}

/// R181 rule 2. Stub: an empty signature.
pub fn signature(_terms: &BTreeMap<String, TermCounts>, _df: &dyn Fn(&str) -> usize, _n: usize, _p: &RelatedParams) -> Vec<(String, f64)> {
    Vec::new()
}

/// R181 rule 6. Stub: keeps nothing.
pub fn cut_off(_entries: &[(f64, usize)], _best: f64, _p: &RelatedParams) -> Vec<usize> {
    Vec::new()
}

/// R182 rule 3. Stub: no sentences.
pub fn sentences(_block: &str) -> Vec<&str> {
    Vec::new()
}

/// Title order for equal scores without a collator. Stub: everything is equal.
pub fn by_code_point(_a: &str, _b: &str) -> std::cmp::Ordering {
    std::cmp::Ordering::Equal
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelatedReason {
    Short,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RelatedEntry {
    pub path: String,
    pub title: String,
    pub r#type: String,
    pub review: Option<String>,
    pub status: Option<String>,
    pub due: Option<String>,
    pub completed: Option<String>,
    pub linked: bool,
    pub excerpt: Option<String>,
    pub score: f64,
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

impl Index {
    /// §1.8. Stub: never indexed.
    pub fn related(
        &self,
        _path: &str,
        _show_linked: bool,
        _p: &RelatedParams,
        _extra_linked: &[String],
        _title_order: &dyn Fn(&str, &str) -> std::cmp::Ordering,
    ) -> Option<RelatedList> {
        let _ = Lang::Cs;
        None
    }
}

#[cfg(any(test, feature = "test-hooks"))]
impl Index {
    /// §1.10. Stub: no row.
    pub fn rel_terms(&self, _path: &str) -> Option<RelTerms> {
        None
    }
    /// §1.10. Stub: not indexed.
    pub fn related_signature(&self, _path: &str, _p: &RelatedParams) -> Option<Vec<(String, f64)>> {
        None
    }
    /// §1.10. Stub: no rows.
    pub fn rel_rows(&self) -> usize {
        0
    }
    /// §1.10. Stub: no calls counted.
    pub fn related_computed(&self) -> u64 {
        0
    }
}
