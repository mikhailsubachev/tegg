//! Slice REL (docs/contracts/v1-related.md §1.9; docs/acceptance/related.md R182 rules 1–2): the plain text of a body's
//! eligible blocks, the source of the Related excerpt. Read-only; the characters are the file's own, NFC (FR-FMT-12).

use std::ops::Range;
use std::sync::LazyLock;

use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use regex::Regex;

use crate::extract::{math_blocks, md_options, COMMENT, WIKILINK};

static BLOCK_ID_END: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+\^[A-Za-z0-9-]+\s*$").expect("regex"));
static CALLOUT_MARK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*\[![^\]\n]*\][+-]?\s*").expect("regex"));

/// R182 rules 1–2: the eligible blocks of a body, each as plain text in file order. Eligible: paragraphs, headings, list
/// items (each item its own block, without its marker or task box), quote and callout text (not `> [!mindmap]`
/// callouts; a callout's title line counts), table rows (header row included; cells joined with ` · `). Never:
/// frontmatter, fenced or indented code, `$$` math blocks, `%%comments%%`, HTML blocks, query blocks, embeds. Inline
/// marks removed; `[[target|alias]]` → alias, `[[target#sub]]` → `target`, `[text](url)` → text; block ids removed;
/// whitespace runs → one space; trimmed; empty blocks dropped.
pub fn plain_blocks(body: &str) -> Vec<String> {
    let mut excluded: Vec<Range<usize>> = COMMENT.find_iter(body).map(|m| m.range()).collect();
    excluded.extend(math_blocks(body));
    excluded.sort_by_key(|r| r.start);

    let mut out: Vec<String> = Vec::new();
    let mut buf = String::new();
    let mut cell = 0usize;
    let mut skip_until = 0usize;
    let finish = |buf: &mut String, out: &mut Vec<String>| {
        if let Some(b) = clean(buf) {
            out.push(b);
        }
        buf.clear();
    };
    for (ev, r) in Parser::new_ext(body, md_options()).into_offset_iter() {
        if r.start < skip_until {
            continue;
        }
        match ev {
            Event::Start(Tag::CodeBlock(_)) | Event::Start(Tag::HtmlBlock) | Event::Start(Tag::Image { .. }) => {
                if !matches!(ev, Event::Start(Tag::Image { .. })) {
                    finish(&mut buf, &mut out);
                }
                skip_until = r.end;
            }
            Event::Start(Tag::BlockQuote(_)) => {
                finish(&mut buf, &mut out);
                let rest = body[r.start..].trim_start_matches(['>', ' ', '\t']);
                if rest.get(..9).is_some_and(|p| p.eq_ignore_ascii_case("[!mindmap")) {
                    skip_until = r.end;
                }
            }
            Event::Start(Tag::Paragraph)
            | Event::Start(Tag::Heading { .. })
            | Event::Start(Tag::Item)
            | Event::Start(Tag::List(_))
            | Event::End(TagEnd::Paragraph)
            | Event::End(TagEnd::Heading(_))
            | Event::End(TagEnd::Item)
            | Event::End(TagEnd::BlockQuote(_))
            | Event::End(TagEnd::TableHead)
            | Event::End(TagEnd::TableRow) => finish(&mut buf, &mut out),
            Event::Start(Tag::TableHead) | Event::Start(Tag::TableRow) => {
                finish(&mut buf, &mut out);
                cell = 0;
            }
            Event::Start(Tag::TableCell) => {
                if cell > 0 {
                    buf.push_str(" · ");
                }
                cell += 1;
            }
            Event::Text(t) | Event::Code(t) => push_outside(&mut buf, body, &r, &t, &excluded),
            Event::SoftBreak | Event::HardBreak => buf.push(' '),
            _ => {}
        }
    }
    finish(&mut buf, &mut out);
    out
}

/// Appends the parts of a text event that lie outside comments and math.
fn push_outside(buf: &mut String, body: &str, r: &Range<usize>, t: &str, excluded: &[Range<usize>]) {
    let hits: Vec<&Range<usize>> = excluded.iter().filter(|x| x.start < r.end && x.end > r.start).collect();
    if hits.is_empty() {
        buf.push_str(t);
        return;
    }
    if body.get(r.clone()) != Some(t) {
        // The event's text isn't its source (escapes, entities): keep it only when no exclusion covers it entirely.
        if !hits.iter().any(|x| x.start <= r.start && x.end >= r.end) {
            buf.push_str(t);
        }
        return;
    }
    let mut pos = r.start;
    for x in hits {
        if x.start > pos {
            buf.push_str(&body[pos..x.start]);
        }
        pos = pos.max(x.end);
    }
    if pos < r.end {
        buf.push_str(&body[pos..r.end]);
    }
}

/// Wikilinks and embeds, a callout's marker, a trailing block id, whitespace; NFC. None when empty.
fn clean(raw: &str) -> Option<String> {
    if raw.trim().is_empty() {
        return None;
    }
    let s = WIKILINK.replace_all(raw, |c: &regex::Captures| {
        if &c[1] == "!" {
            return String::new();
        }
        let inner = &c[2];
        match inner.split_once('|') {
            Some((_, alias)) => alias.to_string(),
            None => inner.split('#').next().unwrap_or("").to_string(),
        }
    });
    let s = CALLOUT_MARK.replace(&s, "");
    let s = BLOCK_ID_END.replace(&s, "");
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    (!s.is_empty()).then(|| crate::nfc(&s))
}
