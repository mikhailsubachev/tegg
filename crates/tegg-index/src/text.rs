//! Folding, tokenizing, query syntax and snippets (FR-SRC-03, FR-SRC-04, D-101, D-107, D-108).
//! The FTS table stores folded text and is queried with folded tokens, so every rule here and the
//! SQLite tokenizer see the same words.

use std::ops::Range;

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
    /// D-101: alternative tokens within one edit (filled by the index for single words of ≥ 5 letters).
    pub alternatives: Vec<String>,
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
        if is_open_quote(chars[i]) {
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
        if !toks.is_empty() {
            items.push(Item { tokens: toks, negative, alternatives: Vec::new() });
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

/// Positions (indexes into `ws`) where `item` matches: its tokens in sequence, or one of its alternatives.
pub fn match_positions(ws: &[(Range<usize>, String)], item: &Item) -> Vec<Range<usize>> {
    let n = item.tokens.len();
    let mut out = Vec::new();
    if n == 0 || ws.len() < n {
        return out;
    }
    for i in 0..=ws.len() - n {
        let exact = (0..n).all(|k| ws[i + k].1 == item.tokens[k]);
        let alt = n == 1 && item.alternatives.iter().any(|a| *a == ws[i].1);
        if exact || alt {
            out.push(i..i + n);
        }
    }
    out
}

/// Whether the folded token list contains the item (exactly or through an alternative).
pub fn contains_item(toks: &[String], item: &Item) -> bool {
    let n = item.tokens.len();
    if n == 0 || toks.len() < n {
        return false;
    }
    toks.windows(n).any(|w| w == item.tokens.as_slice()) || (n == 1 && toks.iter().any(|t| item.alternatives.contains(t)))
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
            for r in match_positions(&ws, it) {
                hits.push(ws[r.start].0.start..ws[r.end - 1].0.end);
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
    fn snippet_strips_markers() {
        let items = parse_query("rozpočet");
        let s = snippet("Nic.\n## Rozpočet na cestu\n", &items).map(|s| (s.text, s.highlights, s.body_line, s.byte_in_line));
        assert_eq!(s, Some(("Rozpočet na cestu".into(), vec![(0, 9)], 1, 3)));
    }
}
