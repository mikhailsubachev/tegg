//! Slice Q (docs/contracts/v1-queries.md §1.3, R140; FR-FMT-06 AC-4, AC-5): the ```` ```query ```` fences of a note.
//! Read-only and platform-neutral (AR-03): a CommonMark parse of the body (frontmatter skipped) with `pulldown-cmark`, the
//! L3 twin of `@tegg/doc` `queryFences` (`tests/fixtures/queries-files/expected.json` `fences`).

use pulldown_cmark::{CodeBlockKind, Event, Parser, Tag, TagEnd};
use yaml_rust2::{Yaml, YamlLoader};

use crate::extract::{body_start, md_options, nfc};

/// One fenced code block whose info string's first word is exactly `query` (R140).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueryFence {
    /// Byte range of the whole fence in the file (opening to closing line, EOLs included).
    pub range: std::ops::Range<usize>,
    /// The body without container prefixes (`> `, list indentation), as CommonMark reads it.
    pub body: String,
    /// `read_fence(body)`'s Reference name (NFC), else None.
    pub saved: Option<String>,
    /// Inside a list, quote or callout.
    pub nested: bool,
    /// The whole info string as written.
    pub info: String,
}

/// R140: a fence body's `saved:` name when the body is a reference (a YAML mapping whose `saved` is a non-blank string),
/// trimmed and NFC; None for an empty, inline or unreadable body. The same rule as `tegg_core::queries_q::read_fence`.
pub fn saved_name(body: &str) -> Option<String> {
    if body.lines().all(|l| l.trim().is_empty() || l.trim_start().starts_with('#')) {
        return None;
    }
    let doc = YamlLoader::load_from_str(body).ok()?.into_iter().next()?;
    let Yaml::Hash(h) = doc else { return None };
    match h.get(&Yaml::String("saved".into()))? {
        Yaml::String(s) if !s.trim().is_empty() => Some(nfc(s.trim())),
        _ => None,
    }
}

/// Every fenced code block whose info string's first word is exactly `query` (case-sensitive), at any depth, in
/// document order; the frontmatter is skipped.
pub fn query_fences(text: &str) -> Vec<QueryFence> {
    let start = body_start(text).min(text.len());
    let body = &text[start..];
    let mut out = Vec::new();
    let mut depth = 0usize;
    // (range start, range end, info, nested) of the open query fence, and its text so far.
    let mut open: Option<(usize, usize, String, bool)> = None;
    let mut buf = String::new();
    for (ev, range) in Parser::new_ext(body, md_options()).into_offset_iter() {
        match ev {
            Event::Start(Tag::List(_) | Tag::Item | Tag::BlockQuote(_) | Tag::FootnoteDefinition(_)) => depth += 1,
            Event::End(TagEnd::List(_) | TagEnd::Item | TagEnd::BlockQuote(_) | TagEnd::FootnoteDefinition) => depth = depth.saturating_sub(1),
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(info))) => {
                if info.split_whitespace().next() == Some("query") {
                    open = Some((range.start, range.end, info.trim().to_string(), depth > 0));
                    buf.clear();
                }
            }
            Event::Text(t) if open.is_some() => buf.push_str(&t),
            Event::End(TagEnd::CodeBlock) => {
                if let Some((from, to, info, nested)) = open.take() {
                    // The range ends after the closing line's EOL (or at the end of the text).
                    let mut end = to.max(from);
                    if !body[..end].ends_with('\n') {
                        match body[end..].find('\n') {
                            Some(i) => end += i + 1,
                            None => end = body.len(),
                        }
                    }
                    let saved = saved_name(&buf);
                    out.push(QueryFence { range: start + from..start + end, body: std::mem::take(&mut buf), saved, nested, info });
                }
            }
            _ => {}
        }
    }
    out
}
