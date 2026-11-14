//! Slice REL (docs/contracts/v1-related.md §1.2–§1.4; docs/acceptance/related.md R179, R180): the folded Czech light
//! stemmer, the Snowball English stemmer, the compiled-in stop-word lists and R179's text-to-stems pipeline. Pure and
//! platform-neutral (AR-03): the same bytes give the same stems, NFC or NFD (folding runs first, FR-FMT-12).
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};

use crate::text;

mod cs;

/// The language of a note (R179 rule 7): serialized `"cs"` / `"en"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    #[default]
    Cs,
    En,
}

/// R179 rule 6: stems shorter than this (in Unicode scalar values) are dropped.
pub const MIN_STEM_CHARS: usize = 3;

/// R180: the folded Czech light stemmer (`w` is a folded word). May return fewer than 3 characters (`den` → `dn`).
pub fn stem_cs(w: &str) -> String {
    cs::stem(w)
}

static ENGLISH: LazyLock<rust_stemmers::Stemmer> = LazyLock::new(|| rust_stemmers::Stemmer::create(rust_stemmers::Algorithm::English));

/// The Snowball English (Porter2) stemmer on a folded word (`rust_stemmers::Algorithm::English`).
pub fn stem_en(w: &str) -> String {
    ENGLISH.stem(w).into_owned()
}

fn list(text: &'static str) -> Vec<&'static str> {
    text.lines().map(str::trim).filter(|l| !l.is_empty()).collect()
}
static STOP_CS: LazyLock<Vec<&'static str>> = LazyLock::new(|| list(include_str!("stop_cs.txt")));
static STOP_EN: LazyLock<Vec<&'static str>> = LazyLock::new(|| list(include_str!("stop_en.txt")));

fn in_list(l: &[&str], w: &str) -> bool {
    l.binary_search(&w).is_ok()
}

/// In the Czech list or the English list (§1.3; both lists are dropped from every note, D-1713).
pub fn is_stop_word(folded: &str) -> bool {
    in_list(&STOP_CS, folded) || in_list(&STOP_EN, folded)
}

/// The folded, sorted stop-word list of `lang` (§1.3).
pub fn stop_words(lang: Lang) -> &'static [&'static str] {
    match lang {
        Lang::Cs => &STOP_CS,
        Lang::En => &STOP_EN,
    }
}

fn is_number(w: &str) -> bool {
    w.chars().all(char::is_numeric)
}

/// R179 rules 3–6 on folded words.
fn stems_of_words<'a>(words: impl Iterator<Item = &'a str>, lang: Lang, out: &mut Vec<String>) {
    for w in words {
        if w.is_empty() || is_stop_word(w) || is_number(w) {
            continue;
        }
        let s = match lang {
            Lang::Cs => stem_cs(w),
            Lang::En => stem_en(w),
        };
        if s.chars().count() >= MIN_STEM_CHARS {
            out.push(s);
        }
    }
}

/// R179 rules 2–6 on one text: words → fold → drop stop words (both lists) → drop numbers → stem → drop stems under
/// 3 characters. In text order, duplicates kept.
pub fn stems(text: &str, lang: Lang) -> Vec<String> {
    let mut out = Vec::new();
    let words = text::words(text);
    stems_of_words(words.iter().map(|(_, w)| w.as_str()), lang, &mut out);
    out
}

/// R179 rule 7: words in both lists are ignored; `En` when there are ≥ 3 English-only stop words and more English-only
/// than Czech-only ones, else `Cs` (D-1713).
pub fn language_of(folded_words: &[String]) -> Lang {
    let (mut cs, mut en) = (0usize, 0usize);
    for w in folded_words {
        match (in_list(&STOP_CS, w), in_list(&STOP_EN, w)) {
            (true, false) => cs += 1,
            (false, true) => en += 1,
            _ => {}
        }
    }
    if en >= 3 && en > cs {
        Lang::En
    } else {
        Lang::Cs
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelRow {
    pub lang: Lang,
    /// stems(title), then stems(each alias), in order.
    pub title: Vec<String>,
    /// stems(raw body), then stems(each tag name), in order.
    pub body: Vec<String>,
    /// The stems of `body` from ATX heading lines outside fenced code: a sub-multiset of `body`.
    pub heading: Vec<String>,
}

/// An ATX heading line (`#{1,6}` then a space, tab or the end; up to 3 spaces before).
fn is_atx_heading(line: &str) -> bool {
    let indent = line.len() - line.trim_start_matches(' ').len();
    if indent > 3 {
        return false;
    }
    let t = &line[indent..];
    let hashes = t.chars().take_while(|&c| c == '#').count();
    (1..=6).contains(&hashes) && t[hashes..].chars().next().is_none_or(|c| c == ' ' || c == '\t')
}

/// A fence line: up to 3 spaces, then ≥ 3 backticks or tildes. Returns (char, run).
fn fence(line: &str) -> Option<(char, usize)> {
    let indent = line.len() - line.trim_start_matches(' ').len();
    if indent > 3 {
        return None;
    }
    let t = &line[indent..];
    let c = t.chars().next()?;
    if c != '`' && c != '~' {
        return None;
    }
    let n = t.chars().take_while(|&x| x == c).count();
    (n >= 3).then_some((c, n))
}

/// The `rel` row of one note (R179 rule 1; §1.4).
pub fn rel_row(title: &str, aliases: &[String], body: &str, tags: &[String]) -> RelRow {
    let mut words: Vec<String> = text::tokens(title);
    for a in aliases {
        words.extend(text::tokens(a));
    }
    let body_words = text::tokens(body);
    words.extend(body_words.iter().cloned());
    for t in tags {
        words.extend(text::tokens(t));
    }
    let lang = language_of(&words);
    let mut title_stems = stems(title, lang);
    for a in aliases {
        title_stems.extend(stems(a, lang));
    }
    // Line by line: a word never spans a line, so the concatenation equals `stems(body)`.
    let mut body_stems = Vec::new();
    let mut heading = Vec::new();
    let mut open: Option<(char, usize)> = None;
    for line in body.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let mut is_heading = false;
        match (open, fence(line)) {
            (Some((c, n)), Some((c2, n2))) if c == c2 && n2 >= n && line.trim_start().trim_start_matches(c).trim().is_empty() => open = None,
            (Some(_), _) => {}
            (None, Some(f)) => open = Some(f),
            (None, None) => is_heading = is_atx_heading(line),
        }
        let s = stems(line, lang);
        if is_heading {
            heading.extend(s.iter().cloned());
        }
        body_stems.extend(s);
    }
    for t in tags {
        body_stems.extend(stems(t, lang));
    }
    RelRow { lang, title: title_stems, body: body_stems, heading }
}
