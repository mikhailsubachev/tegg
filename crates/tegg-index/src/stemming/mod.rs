//! Slice REL (docs/contracts/v1-related.md §1.2–§1.4): compile-only red-test stubs, no behaviour (TS-I1, D-1398).
//! Every function answers nothing (empty stems, no stop words), so the red tests fail by assertion. The build replaces
//! this module with the folded Czech stemmer (R180), the Snowball English stemmer, the stop-word lists and R179's pipeline.
use serde::{Deserialize, Serialize};

/// The language of a note (R179 rule 7): serialized `"cs"` / `"en"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    Cs,
    En,
}

/// R179 rule 6: stems shorter than this (in Unicode scalar values) are dropped.
pub const MIN_STEM_CHARS: usize = 3;

/// R180: the folded Czech light stemmer. Stub: no stem.
pub fn stem_cs(_w: &str) -> String {
    String::new()
}

/// The Snowball English (Porter2) stemmer on a folded word. Stub: no stem.
pub fn stem_en(_w: &str) -> String {
    String::new()
}

/// In the Czech list or the English list (§1.3). Stub: no word is a stop word.
pub fn is_stop_word(_folded: &str) -> bool {
    false
}

/// The folded, sorted stop-word list of `lang` (§1.3). Stub: empty.
pub fn stop_words(_lang: Lang) -> &'static [&'static str] {
    &[]
}

/// R179 rules 2–6 on one text. Stub: no stems.
pub fn stems(_text: &str, _lang: Lang) -> Vec<String> {
    Vec::new()
}

/// R179 rule 7. Stub: always Czech.
pub fn language_of(_folded_words: &[String]) -> Lang {
    Lang::Cs
}

/// The `rel` row of one note (R179 rule 1). Stub: an empty Czech row.
pub fn rel_row(_title: &str, _aliases: &[String], _body: &str, _tags: &[String]) -> RelRow {
    RelRow { lang: Lang::Cs, title: Vec::new(), body: Vec::new(), heading: Vec::new() }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelRow {
    pub lang: Lang,
    pub title: Vec<String>,
    pub body: Vec<String>,
    pub heading: Vec<String>,
}
