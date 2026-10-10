//! Link scanning (FR-IMP-10, FR-IMP-14) and clean-up counting (FR-IMP-17).
//! Links are found outside fenced and inline code: `[[target|alias]]`, `![[embed]]`,
//! and Markdown links/images with a relative destination. External URLs are not object links.

use regex::Regex;
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkKind { Wiki, Markdown, Image }

#[derive(Debug, Clone)]
pub struct RawLink {
    pub kind: LinkKind,
    /// Wikilink target without alias/heading, or the decoded Markdown destination.
    pub target: String,
    /// 1-based line number in the note (frontmatter lines count).
    pub line: usize,
}

static WIKI: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(!?)\[\[([^\[\]\n]+?)\]\]").unwrap());
static INLINE_CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"`[^`\n]*`").unwrap());

fn is_external(dest: &str) -> bool {
    let d = dest.to_ascii_lowercase();
    d.contains("://") || d.starts_with("mailto:") || d.starts_with('#') || d.starts_with("tel:")
}

pub fn decode_path(s: &str) -> String {
    percent_encoding::percent_decode_str(s).decode_utf8_lossy().into_owned()
}

/// Scan a whole note (frontmatter included: relation attributes hold wikilinks).
pub fn links(text: &str) -> Vec<RawLink> {
    let mut out = Vec::new();
    let mut fence: Option<String> = None;
    for (i, line) in text.lines().enumerate() {
        let t = line.trim_start();
        if let Some(f) = &fence {
            if t.starts_with(f.as_str()) { fence = None }
            continue;
        }
        if t.starts_with("```") || t.starts_with("~~~") {
            fence = Some(t[..3].to_string());
            continue;
        }
        let clean = INLINE_CODE.replace_all(line, |c: &regex::Captures| " ".repeat(c[0].len()));
        for c in WIKI.captures_iter(&clean) {
            let inner = &c[2];
            let target = inner.split('|').next().unwrap().split('#').next().unwrap().trim();
            if target.is_empty() { continue }
            out.push(RawLink { kind: LinkKind::Wiki, target: target.nfc().collect(), line: i + 1 }); // FR-FMT-12
        }
    }
    out.extend(markdown_links(text));
    out.sort_by_key(|l| l.line);
    out
}

/// Markdown links and images found by a CommonMark parser (nested images in links, link text over
/// several lines, brackets in link text). Found in the real-export run: a line regex missed 12 links.
fn markdown_links(text: &str) -> Vec<RawLink> {
    use pulldown_cmark::{Event, Parser, Tag};
    let line_starts: Vec<usize> = std::iter::once(0).chain(text.match_indices('\n').map(|(i, _)| i + 1)).collect();
    let line_of = |off: usize| line_starts.partition_point(|&s| s <= off);
    let mut out = Vec::new();
    for (ev, range) in Parser::new(text).into_offset_iter() {
        let (dest, image) = match ev {
            Event::Start(Tag::Link { dest_url, .. }) => (dest_url, false),
            Event::Start(Tag::Image { dest_url, .. }) => (dest_url, true),
            _ => continue,
        };
        let raw = dest.as_ref().trim_start_matches('<').trim_end_matches('>');
        if raw.is_empty() || is_external(raw) { continue }
        let target: String = decode_path(raw.split('#').next().unwrap()).nfc().collect();
        let kind = if image || !target.to_lowercase().ends_with(".md") { LinkKind::Image } else { LinkKind::Markdown };
        out.push(RawLink { kind, target, line: line_of(range.start) });
    }
    out
}

/// FR-IMP-17 AC-1: invisible characters that the importer removes.
/// U+200C/U+200D are kept between two non-ASCII symbols (emoji sequences).
pub fn invisible_chars(text: &str) -> usize {
    let cs: Vec<char> = text.chars().collect();
    let emojiish = |c: Option<&char>| c.is_some_and(|c| (*c as u32) > 0x2000 && !c.is_alphanumeric());
    cs.iter().enumerate().filter(|(i, c)| match c {
        '\u{200B}' | '\u{FEFF}' => true,
        '\u{200C}' | '\u{200D}' => !(emojiish(i.checked_sub(1).and_then(|j| cs.get(j))) && emojiish(cs.get(i + 1))),
        _ => false,
    }).count()
}
