//! Slice REL (docs/contracts/v1-related.md §1.2–§1.4; docs/acceptance/related.md R179, R180): the folded Czech light
//! stemmer, the Snowball English stemmer, the compiled-in stop-word lists and R179's text-to-stems pipeline. Pure and
//! platform-neutral (AR-03): the same bytes give the same stems, NFC or NFD (folding runs first, FR-FMT-12).
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use unicode_normalization::char::is_combining_mark;

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

/// Characters that Rust's `is_alphanumeric` takes as lower-case letters or numbers but SQLite's `unicode61` tokenizer
/// (the bundled SQLite's tables, `remove_diacritics 0`) does not keep as themselves: it folds them to another
/// character (`µ`, `ſ`, `ς`, …) or treats them as separators (`ⓐ`, `🄰`, New Tai Lue digits, …). Found by checking
/// every code point against SQLite (tests/bug_qarel_fr_lnk_15_df_map_equals_rebuild.rs), D-1761.
const NOT_UNICODE61: &[(char, char)] = &[
    ('\u{00B5}', '\u{00B5}'),
    ('\u{017F}', '\u{017F}'),
    ('\u{03C2}', '\u{03C2}'),
    ('\u{03D0}', '\u{03D1}'),
    ('\u{03D5}', '\u{03D6}'),
    ('\u{03F0}', '\u{03F1}'),
    ('\u{03F5}', '\u{03F5}'),
    ('\u{19B0}', '\u{19C0}'),
    ('\u{19C8}', '\u{19C9}'),
    ('\u{1CF2}', '\u{1CF3}'),
    ('\u{1E9B}', '\u{1E9B}'),
    ('\u{1FBE}', '\u{1FBE}'),
    ('\u{24D0}', '\u{24E9}'),
    ('\u{1F130}', '\u{1F149}'),
    ('\u{1F150}', '\u{1F169}'),
    ('\u{1F170}', '\u{1F189}'),
];

/// D-1761 (v1-related §1.4): `c` is a character that SQLite's `unicode61` tokenizer keeps as itself in a token: a
/// lower-case-stable letter or number that is not a mark and not in `NOT_UNICODE61`. Conservative: a test checks every
/// code point this accepts against the bundled SQLite, so a newer Rust Unicode table can't add one SQLite lacks
/// unnoticed. ASCII lower-case letters and digits (all folded Czech and English) are always accepted.
pub fn is_rel_token_char(c: char) -> bool {
    if c.is_ascii() {
        return c.is_ascii_lowercase() || c.is_ascii_digit();
    }
    c.is_alphanumeric()
        && !is_combining_mark(c)
        && c.to_lowercase().eq([c])
        && NOT_UNICODE61.binary_search_by(|&(lo, hi)| if hi < c { std::cmp::Ordering::Less } else if lo > c { std::cmp::Ordering::Greater } else { std::cmp::Ordering::Equal }).is_err()
}

/// R179 rules 3–6 on folded words; a stem with a character that is not `is_rel_token_char` is dropped, so every stem
/// written to `rel` is exactly one `unicode61` token (D-1761).
fn stems_of_words<'a>(words: impl Iterator<Item = &'a str>, lang: Lang, out: &mut Vec<String>) {
    for w in words {
        if w.is_empty() || is_stop_word(w) || is_number(w) {
            continue;
        }
        let s = match lang {
            Lang::Cs => stem_cs(w),
            Lang::En => stem_en(w),
        };
        if s.chars().count() >= MIN_STEM_CHARS && s.chars().all(is_rel_token_char) {
            out.push(s);
        }
    }
}

/// R179 rules 2–6 on one text: words → fold → drop stop words (both lists) → drop numbers → stem → drop stems under
/// 3 characters and stems that are not exactly one `unicode61` token (D-1761). In text order, duplicates kept.
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

/// The stems of a body's ATX heading lines outside fenced code, in order (`RelRow.heading`).
pub fn heading_stems(body: &str, lang: Lang) -> Vec<String> {
    let mut out = Vec::new();
    for_lines(body, |line, is_heading| {
        if is_heading {
            out.extend(stems(line, lang));
        }
    });
    out
}

/// Each line of a body with whether it is an ATX heading outside fenced code.
fn for_lines(body: &str, mut f: impl FnMut(&str, bool)) {
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
        f(line, is_heading);
    }
}

/// The `rel` row of one note (R179 rule 1; §1.4).
pub fn rel_row(title: &str, aliases: &[String], body: &str, tags: &[String]) -> RelRow {
    rel_row_from_lines(title, aliases, &body_lines(body), tags)
}

/// The folded words of each body line, with whether the line is an ATX heading outside fenced code. Joined in order
/// they are exactly `text::tokens(body)`: a word never spans a line.
pub(crate) fn body_lines(body: &str) -> Vec<(Vec<String>, bool)> {
    let mut lines = Vec::new();
    for_lines(body, |line, is_heading| lines.push((text::tokens(line), is_heading)));
    lines
}

/// `rel_row` on a body already split by `body_lines` (the index splits it once for `fts` and `rel`).
pub(crate) fn rel_row_from_lines(title: &str, aliases: &[String], lines: &[(Vec<String>, bool)], tags: &[String]) -> RelRow {
    // Each text is split into folded words once; the language is decided on all of them, then they are stemmed.
    let mut names: Vec<Vec<String>> = vec![text::tokens(title)];
    names.extend(aliases.iter().map(|a| text::tokens(a)));
    let tag_words: Vec<Vec<String>> = tags.iter().map(|t| text::tokens(t)).collect();
    let all: Vec<String> = names.iter().flatten().chain(lines.iter().flat_map(|l| &l.0)).chain(tag_words.iter().flatten()).cloned().collect();
    let lang = language_of(&all);
    let mut title_stems = Vec::new();
    for n in &names {
        stems_of_words(n.iter().map(String::as_str), lang, &mut title_stems);
    }
    // Line by line: a word never spans a line, so the concatenation equals `stems(body)`.
    let mut body_stems = Vec::new();
    let mut heading = Vec::new();
    for (words, is_heading) in lines {
        let from = body_stems.len();
        stems_of_words(words.iter().map(String::as_str), lang, &mut body_stems);
        if *is_heading {
            heading.extend(body_stems[from..].iter().cloned());
        }
    }
    for t in &tag_words {
        stems_of_words(t.iter().map(String::as_str), lang, &mut body_stems);
    }
    RelRow { lang, title: title_stems, body: body_stems, heading }
}
