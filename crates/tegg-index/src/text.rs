//! Folding, tokenizing, query syntax and snippets (FR-SRC-03, FR-SRC-04, D-101, D-107, D-108).
//! The FTS table stores folded text and is queried with folded tokens, so every rule here and the
//! SQLite tokenizer see the same words.

use std::ops::Range;
use std::sync::LazyLock;

use regex::Regex;

use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

/// NFC → lower case → combining marks removed (FR-SRC-04, FR-FMT-12): `Čtení` → `cteni`.
pub fn fold(s: &str) -> String {
    s.nfd().filter(|c| !is_combining_mark(*c)).flat_map(char::to_lowercase).nfc().collect()
}

fn word_char(c: char) -> bool {
    c.is_alphanumeric() || is_combining_mark(c)
}

/// Words of `s` with their byte ranges in `s` and their folded form.
pub fn words(s: &str) -> Vec<(Range<usize>, String)> {
    let mut out = Vec::new();
    let mut start = None;
    for (i, c) in s.char_indices() {
        match (word_char(c), start) {
            (true, None) => start = Some(i),
            (false, Some(st)) => {
                out.push((st..i, fold(&s[st..i])));
                start = None;
            }
            _ => {}
        }
    }
    if let Some(st) = start {
        out.push((st..s.len(), fold(&s[st..])));
    }
    out.retain(|(_, w)| !w.is_empty());
    out
}

/// Folded tokens of `s`, as the FTS table gets them.
pub fn tokens(s: &str) -> Vec<String> {
    words(s).into_iter().map(|(_, w)| w).collect()
}

/// Folded text for the FTS table: tokens joined by spaces.
pub fn fts_text(s: &str) -> String {
    tokens(s).join(" ")
}

/// One query item: a word, a phrase, or a word with an inner `-` (`2026-10`, matched as a phrase).
#[derive(Debug, Clone, PartialEq)]
pub struct Item {
    pub tokens: Vec<String>,
    pub negative: bool,
    /// Written in quotes: a strict phrase filter, outside the ranking tiers (D-108, D-253).
    pub quoted: bool,
    /// D-101: alternative tokens within one edit (filled by the index for single words of ≥ 5 letters).
    pub alternatives: Vec<String>,
    /// D-1342 (v1-search §9.1): the query's last item, unquoted and positive, its last token ≥ 2 characters, the raw
    /// query not ending with whitespace: that token also matches every word starting with it.
    pub prefix: bool,
}

impl Item {
    pub fn typo_eligible(&self) -> bool {
        !self.negative && self.tokens.len() == 1 && self.tokens[0].chars().count() >= 5
    }
}

fn is_open_quote(c: char) -> bool {
    matches!(c, '"' | '„' | '“')
}

fn is_close_quote(c: char) -> bool {
    matches!(c, '"' | '“' | '”')
}

/// D-108: `"…"` and `„…“` are phrases (an unclosed quote runs to the end), `-` excludes only at the start
/// of a term, everything else is literal. Never fails.
pub fn parse_query(q: &str) -> Vec<Item> {
    let q: String = q.nfc().collect();
    let chars: Vec<char> = q.chars().collect();
    let mut items = Vec::new();
    let mut last_raw_is_word = false; // D-1342: the raw last item, not the last item that yielded words
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_whitespace() {
            i += 1;
            continue;
        }
        let mut negative = false;
        if chars[i] == '-' && i + 1 < chars.len() && !chars[i + 1].is_whitespace() {
            negative = true;
            i += 1;
        }
        let text: String;
        let quoted = is_open_quote(chars[i]);
        if quoted {
            i += 1;
            let start = i;
            while i < chars.len() && !is_close_quote(chars[i]) {
                i += 1;
            }
            text = chars[start..i].iter().collect();
            i += 1; // the closing quote, if any
        } else {
            let start = i;
            while i < chars.len() && !chars[i].is_whitespace() {
                i += 1;
            }
            text = chars[start..i].iter().collect();
        }
        let toks = tokens(&text);
        last_raw_is_word = !toks.is_empty() && !quoted && !negative;
        if !toks.is_empty() {
            items.push(Item { tokens: toks, negative, quoted, alternatives: Vec::new(), prefix: false });
        }
    }
    // D-1342: the last word as a prefix.
    if !q.ends_with(char::is_whitespace) && last_raw_is_word {
        if let Some(last) = items.last_mut() {
            if !last.quoted && !last.negative && last.tokens.last().is_some_and(|t| t.chars().count() >= 2) {
                last.prefix = true;
            }
        }
    }
    items
}

/// D-101: Damerau (adjacent swap) / Levenshtein distance of at most one.
pub fn within_one_edit(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    let (la, lb) = (a.len(), b.len());
    if la.abs_diff(lb) > 1 {
        return false;
    }
    let p = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    if la == lb {
        // one substitution, or one swap of adjacent letters
        a[p + 1..] == b[p + 1..] || (p + 1 < la && a[p] == b[p + 1] && a[p + 1] == b[p] && a[p + 2..] == b[p + 2..])
    } else if la > lb {
        a[p + 1..] == b[p..]
    } else {
        a[p..] == b[p + 1..]
    }
}

/// Whether `item` matches `toks` starting at `at`: its tokens in sequence (the last one as a prefix too when
/// `loose` and the item is a D-1342 prefix), or, when `loose`, one of its D-101 alternatives.
pub fn item_at(toks: &[String], at: usize, item: &Item, loose: bool) -> bool {
    let n = item.tokens.len();
    if n == 0 || at + n > toks.len() {
        return false;
    }
    let seq = (0..n).all(|k| toks[at + k] == item.tokens[k] || (loose && item.prefix && k == n - 1 && toks[at + k].starts_with(item.tokens[k].as_str())));
    seq || (loose && n == 1 && item.alternatives.contains(&toks[at]))
}

/// Bytes of `word` (as written) that its first `chars` folded characters come from, combining marks after them
/// included (D-1342: a prefix highlight covers the query's characters, mapped to the original text).
fn prefix_bytes(word: &str, chars: usize) -> usize {
    let mut end = word.len();
    for (i, _) in word.char_indices().skip(1) {
        if fold(&word[..i]).chars().count() >= chars {
            end = i;
            break;
        }
    }
    let rest = &word[end..];
    end + rest.chars().take_while(|c| is_combining_mark(*c)).map(char::len_utf8).sum::<usize>()
}

/// Byte ranges in `s` (whose words are `ws`) where `item` matches, exactly, by a typo (the whole word) or by the
/// D-1342 prefix (the matched prefix only).
pub fn match_spans(s: &str, ws: &[(Range<usize>, String)], item: &Item) -> Vec<(usize, usize)> {
    let n = item.tokens.len();
    let mut out = Vec::new();
    if n == 0 || ws.len() < n {
        return out;
    }
    let toks: Vec<String> = ws.iter().map(|w| w.1.clone()).collect();
    for i in 0..=ws.len() - n {
        if !item_at(&toks, i, item, true) {
            continue;
        }
        let last = &ws[i + n - 1];
        let want = &item.tokens[n - 1];
        let whole = last.1 == *want || (n == 1 && item.alternatives.contains(&last.1));
        let end = if whole { last.0.end } else { last.0.start + prefix_bytes(&s[last.0.clone()], want.chars().count()) };
        out.push((ws[i].0.start, end));
    }
    out
}

/// Whether the folded token list contains the item (exactly, through an alternative or the D-1342 prefix).
pub fn contains_item(toks: &[String], item: &Item) -> bool {
    (0..toks.len()).any(|i| item_at(toks, i, item, true))
}

/// Whether the folded token list contains the item exactly (no alternative, no prefix).
pub fn contains_item_exact(toks: &[String], item: &Item) -> bool {
    (0..toks.len()).any(|i| item_at(toks, i, item, false))
}

pub struct SnippetParts {
    pub text: String,
    pub highlights: Vec<(usize, usize)>,
    /// 0-based line within the body.
    pub body_line: usize,
    pub byte_in_line: usize,
}

const SNIPPET_CHARS: usize = 160;

/// Bytes of block markers at the start of a line (`## `, `- `, `> `, `1. `, `- [ ] `).
fn marker_len(line: &str) -> usize {
    let mut i = line.len() - line.trim_start().len();
    loop {
        let rest = &line[i..];
        let hashes = rest.chars().take_while(|c| *c == '#').count();
        let step = if hashes > 0 && rest[hashes..].starts_with(' ') {
            hashes + 1
        } else if rest.starts_with("> ") || rest.starts_with("- ") || rest.starts_with("* ") || rest.starts_with("+ ") {
            2
        } else if rest.starts_with("[ ] ") || rest.starts_with("[x] ") || rest.starts_with("[X] ") {
            4
        } else {
            let digits = rest.chars().take_while(char::is_ascii_digit).count();
            if digits > 0 && (rest[digits..].starts_with(". ") || rest[digits..].starts_with(") ")) {
                digits + 2
            } else {
                0
            }
        };
        if step == 0 {
            return i;
        }
        i += step;
        i += line[i..].len() - line[i..].trim_start().len();
    }
}

/// D-107: ≤ 160 characters of the first body line with a match, block markers removed, every match on it
/// marked by byte ranges into the snippet text (on the original, unfolded text).
pub fn snippet(body: &str, items: &[Item]) -> Option<SnippetParts> {
    let positives: Vec<&Item> = items.iter().filter(|i| !i.negative).collect();
    if positives.is_empty() {
        return None;
    }
    for (line_no, line) in body.split('\n').enumerate() {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let ws = words(line);
        let mut hits: Vec<Range<usize>> = Vec::new();
        for it in &positives {
            for (a, b) in match_spans(line, &ws, it) {
                hits.push(a..b);
            }
        }
        if hits.is_empty() {
            continue;
        }
        hits.sort_by_key(|r| (r.start, r.end));
        let first = hits[0].clone();
        let cut = marker_len(line).min(first.start);
        let display = &line[cut..];
        // Window of ≤ 160 characters around the first match.
        let char_starts: Vec<usize> = display.char_indices().map(|(i, _)| i).collect();
        let total = char_starts.len();
        let match_char = char_starts.iter().position(|&b| b >= first.start - cut).unwrap_or(0);
        let (from_c, to_c) = if total <= SNIPPET_CHARS {
            (0, total)
        } else {
            let from = match_char.saturating_sub(40).min(total - SNIPPET_CHARS);
            (from, from + SNIPPET_CHARS)
        };
        let from_b = char_starts.get(from_c).copied().unwrap_or(display.len());
        let to_b = char_starts.get(to_c).copied().unwrap_or(display.len());
        let text = display[from_b..to_b].to_string();
        let highlights = hits
            .iter()
            .filter(|h| h.start >= cut + from_b && h.end <= cut + to_b)
            .map(|h| (h.start - cut - from_b, h.end - cut - from_b))
            .collect();
        return Some(SnippetParts { text, highlights, body_line: line_no, byte_in_line: first.start });
    }
    None
}

/// Whether `items` occur next to each other, in order, in the folded token list (each exactly, through the D-1342
/// prefix or, for a single token, through an alternative): the phrase tier of D-253.
pub fn contains_sequence(toks: &[String], items: &[&Item]) -> bool {
    let n: usize = items.iter().map(|i| i.tokens.len()).sum();
    if n == 0 || toks.len() < n {
        return false;
    }
    (0..=toks.len() - n).any(|start| {
        let mut at = start;
        items.iter().all(|it| {
            let ok = item_at(toks, at, it, true);
            at += it.tokens.len();
            ok
        })
    })
}

/// D-254: the start of the body for a hit matched only by its file name: the first non-empty line, block markers
/// removed, ≤ 160 characters, no highlights.
pub fn lead(body: &str) -> Option<SnippetParts> {
    for (line_no, line) in body.split('\n').enumerate() {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let cut = marker_len(line);
        let display = line[cut..].trim_end();
        if display.is_empty() {
            continue;
        }
        let text: String = display.chars().take(SNIPPET_CHARS).collect();
        return Some(SnippetParts { text, highlights: Vec::new(), body_line: line_no, byte_in_line: cut });
    }
    None
}

/// 5A-1 card content (D-482, R43): the start of the body as plain text. Headings, embeds, fences, tables and
/// comments are skipped; block markers and inline marks are removed; links become their alias or target text. Lines
/// join with a space; at most 300 characters.
pub fn excerpt(body: &str) -> String {
    static LINK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]").expect("regex"));
    static MDLINK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"!?\[([^\]]*)\]\([^)]*\)").expect("regex"));
    static MARKS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(\*\*|__|~~|==|`)").expect("regex"));
    static BLOCK_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s\^[A-Za-z0-9-]+\s*$").expect("regex"));
    let mut out = String::new();
    let mut fence = false;
    for line in body.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let t = line.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            fence = !fence;
            continue;
        }
        if fence || t.starts_with('#') && t.trim_start_matches('#').starts_with([' ', '\t']) || t.starts_with('|') || t.starts_with("<!--") {
            continue;
        }
        let t = &line[marker_len(line)..];
        if LINK.find(t.trim()).is_some_and(|m| m.as_str().starts_with('!') && m.len() == t.trim().len()) {
            continue; // an embed alone on its line
        }
        let t = LINK.replace_all(t, |c: &regex::Captures| if c[0].starts_with('!') { String::new() } else { c.get(2).map(|a| a.as_str()).unwrap_or(&c[1]).to_string() });
        let t = MDLINK.replace_all(&t, |c: &regex::Captures| if c[0].starts_with('!') { String::new() } else { c[1].to_string() });
        let t = MARKS.replace_all(&t, "");
        let t = BLOCK_ID.replace(&t, "");
        let t = t.trim();
        if t.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(t);
        if out.chars().count() >= 300 {
            break;
        }
    }
    out.chars().take(300).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_syntax() {
        let t = |q: &str| parse_query(q).into_iter().map(|i| (i.tokens.join(" "), i.negative)).collect::<Vec<_>>();
        assert_eq!(t("rozpočet -krkonoš"), vec![("rozpocet".into(), false), ("krkonos".into(), true)]);
        assert_eq!(t("\"a b\" -\"c d\""), vec![("a b".into(), false), ("c d".into(), true)]);
        assert_eq!(t("„a b“ c"), vec![("a b".into(), false), ("c".into(), false)]);
        assert_eq!(t("\"a b"), vec![("a b".into(), false)]);
        assert_eq!(t("- x -"), vec![("x".into(), false)]);
        assert_eq!(t("2026-10"), vec![("2026 10".into(), false)]);
    }

    #[test]
    fn edits() {
        assert!(within_one_edit("rozpcoet", "rozpocet"));
        assert!(within_one_edit("rozpoct", "rozpocet"));
        assert!(within_one_edit("rozpocetx", "rozpocet"));
        assert!(within_one_edit("rozpocex", "rozpocet"));
        assert!(!within_one_edit("rozpoctu", "rozpocet"));
    }

    #[test]
    fn prefix_rule() {
        let p = |q: &str| parse_query(q).into_iter().map(|i| i.prefix).collect::<Vec<_>>();
        assert_eq!(p("rozpo"), vec![true]);
        assert_eq!(p("rozpo "), vec![false]);
        assert_eq!(p("r"), vec![false]);
        assert_eq!(p("\"rozpo\""), vec![false]);
        assert_eq!(p("rozpo výlet"), vec![false, true]);
        assert_eq!(p("rozpočet -kr"), vec![false, false]);
        // The raw last item decides (v1-search §9.1): a trailing `-`, quote or symbol leaves no prefix.
        for q in ["rozpo -", "rozpo \"", "rozpo !!"] {
            assert_eq!(p(q), vec![false], "{q:?}");
        }
        assert_eq!(p("20"), vec![true]); // D-1354: any 2 characters
    }

    #[test]
    fn prefix_highlight_maps_to_the_original_text() {
        let items = parse_query("cten");
        for (text, want) in [("Čtení knih", 5), ("C\u{30C}tení knih", 6)] {
            let ws = words(text);
            assert_eq!(match_spans(text, &ws, &items[0]), vec![(0, want)], "{text:?}");
        }
    }

    #[test]
    fn snippet_strips_markers() {
        let items = parse_query("rozpočet");
        let s = snippet("Nic.\n## Rozpočet na cestu\n", &items).map(|s| (s.text, s.highlights, s.body_line, s.byte_in_line));
        assert_eq!(s, Some(("Rozpočet na cestu".into(), vec![(0, 9)], 1, 3)));
    }
}
