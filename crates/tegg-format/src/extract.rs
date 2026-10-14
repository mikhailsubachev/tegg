//! What the index stores about a note: title, id, type, attributes, links and tags
//! (docs/contracts/ms1-core.md §2). Ported from spike S4 (D-83); every rule mirrors the
//! TypeScript engine (`packages/doc`), checked by the shared conformance corpus (L3).

use std::ops::Range;
use std::sync::LazyLock;

use pulldown_cmark::{Event, LinkType, Options, Parser, Tag};
use regex::Regex;
use serde_json::{Map, Number, Value};
use unicode_normalization::UnicodeNormalization;
use yaml_rust2::parser::{Event as YEvent, MarkedEventReceiver, Parser as YParser};
use yaml_rust2::scanner::{Marker, TScalarStyle};

#[derive(Debug, Clone, PartialEq)]
pub struct Link {
    pub target: String,
    pub subpath: Option<String>,
    pub alias: Option<String>,
    pub embed: bool,
    pub in_frontmatter: bool,
}

/// NFR-REL-03: what is wrong with the frontmatter and where (1-based line in the file).
#[derive(Debug, Clone, PartialEq)]
pub struct FrontmatterError {
    pub message: String,
    pub line: usize,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Extracted {
    /// `title:` if set, else the file stem (FR-FMT-08).
    pub title: String,
    pub id: Option<String>,
    /// None for untyped files (shown as Page, FR-TYP-10).
    pub r#type: Option<String>,
    /// Frontmatter as JSON; None when there is none or it is invalid.
    pub attributes: Option<Value>,
    pub frontmatter_error: Option<FrontmatterError>,
    pub links: Vec<Link>,
    /// Tag keys (NFC, lower case) in source order, frontmatter first; duplicates kept.
    pub tags: Vec<String>,
    /// The same tags as written (NFC, case kept), aligned with `tags` (D-185 spelling).
    pub tag_spellings: Vec<String>,
}

struct Frontmatter {
    inner: Range<usize>,
    end: usize,
    data: Result<Map<String, Value>, (String, usize)>,
}

static CLOSE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)").unwrap());
static WIKILINK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(!?)\[\[([^\[\]\n]+?)\]\]").unwrap());
static PIPE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\\?\|").unwrap());
static TAG_RUN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[\p{L}\p{M}\p{N}_\-/]+").unwrap());
static TAG_NON_DIGIT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\p{L}_\-/]").unwrap());
static COMMENT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)%%.*?%%").unwrap());

pub fn nfc(s: &str) -> String {
    s.nfc().collect()
}

/// `stem` is the file name without `.md`.
pub fn extract_text(text: &str, stem: &str) -> Extracted {
    let start = if text.starts_with('\u{feff}') { 3 } else { 0 };
    let fm = frontmatter(text, start);
    let body_start = fm.as_ref().map_or(start, |f| f.end);
    let data = fm.as_ref().and_then(|f| f.data.clone().ok());
    let s = |k: &str| match data.as_ref().and_then(|d| d.get(k)) {
        Some(Value::String(v)) if !v.trim().is_empty() => Some(nfc(v)),
        _ => None,
    };

    let (code, links_md) = excluded(text, body_start);
    let mut links = Vec::new();
    let mut link_ranges = Vec::new();
    if let Some(f) = &fm {
        scan_links(text, f.inner.clone(), &[], true, &mut links, &mut link_ranges);
    }
    scan_links(text, body_start..text.len(), &code, false, &mut links, &mut link_ranges);

    let mut tag_spellings: Vec<String> = match data.as_ref().and_then(|d| d.get("tags")) {
        Some(Value::Array(a)) => a.iter().filter_map(|v| v.as_str()).filter(|t| !t.is_empty()).map(nfc).collect(),
        Some(Value::String(t)) if !t.is_empty() => vec![nfc(t)],
        _ => vec![],
    };
    let tag_excluded: Vec<Range<usize>> = code.iter().chain(&links_md).chain(&link_ranges).cloned().collect();
    scan_tags(text, body_start, &tag_excluded, &mut tag_spellings);
    let tags: Vec<String> = tag_spellings.iter().map(|t| tag_key(t)).collect();

    let frontmatter_error = match &fm {
        // The frontmatter starts on line 1 (`---`), so YAML line n is file line n + 1.
        Some(Frontmatter { data: Err((message, line)), .. }) => Some(FrontmatterError { message: message.clone(), line: line + 1 }),
        // D-97: an opening `---` that never closes; the whole file is body.
        None if unclosed(text, start) => Some(FrontmatterError { message: "frontmatter not closed".into(), line: 1 }),
        _ => None,
    };
    Extracted {
        title: s("title").unwrap_or_else(|| nfc(stem)),
        id: s("id"),
        r#type: s("type"),
        attributes: data.map(Value::Object),
        frontmatter_error,
        links,
        tags,
        tag_spellings,
    }
}

/// Byte offset where the body starts: after a closed frontmatter block (valid or not), else 0 (after a BOM).
pub fn body_start(text: &str) -> usize {
    let start = if text.starts_with('\u{feff}') { 3 } else { 0 };
    frontmatter(text, start).map_or(start, |f| f.end)
}

pub fn tag_key(name: &str) -> String {
    nfc(name).to_lowercase()
}

// ------------------------------------------------------------------ frontmatter (parse.ts)

fn unclosed(text: &str, start: usize) -> bool {
    let rest = &text[start..];
    rest.starts_with("---\n") || rest.starts_with("---\r\n")
}

fn frontmatter(text: &str, start: usize) -> Option<Frontmatter> {
    let rest = &text[start..];
    let inner_start = if rest.starts_with("---\n") {
        start + 4
    } else if rest.starts_with("---\r\n") {
        start + 5
    } else {
        return None;
    };
    let close = CLOSE.find_at(text, inner_start)?;
    let inner = inner_start..close.start();
    let data = parse_yaml(&text[inner.clone()]);
    Some(Frontmatter { inner, end: close.end(), data })
}

/// YAML 1.2 core schema → JSON like `yaml` (eemeli) `toJS()`: null on any error, including
/// duplicate keys (`uniqueKeys: true`); a non-map document becomes `{}`.
/// Built from parser events because the loader loses quoting (`"Null"` vs `Null`).
/// Errors carry a message and a 1-based line within `src` (NFR-REL-03).
fn parse_yaml(src: &str) -> Result<Map<String, Value>, (String, usize)> {
    match parse_yaml_value(src)? {
        Some(Value::Object(m)) => Ok(m),
        _ => Ok(Map::new()),
    }
}

/// The YAML document `src` as JSON by the rules of `parse_yaml` (YAML 1.2 core schema, `yaml` v2 resolution,
/// duplicate keys refused), without the "non-map becomes `{}`" step: `None` for an empty document. Used for type
/// files by `tegg-schema` (ms3-shell §14.1.1), so they read exactly like frontmatter.
pub fn parse_yaml_value(src: &str) -> Result<Option<Value>, (String, usize)> {
    let mut b = Builder { stack: vec![], anchors: Default::default(), root: None, error: None, mark: 0 };
    if let Err(e) = YParser::new_from_str(src).load(&mut b, false) {
        let mut line = e.marker().line();
        let msg = e.info().to_string();
        // A missing closing quote is found at the end of input; point at the line that opens it.
        if msg.contains("quote") || msg.contains("quoted") {
            line = unclosed_quote_line(src, e.marker().index()).unwrap_or(line);
        }
        return Err((msg, line.max(1)));
    }
    if let Some(err) = b.error {
        return Err(err);
    }
    Ok(b.root)
}

/// 1-based line of the last line before `pos` (a char index) with an unbalanced `"` or `'`.
fn unclosed_quote_line(src: &str, pos: usize) -> Option<usize> {
    let before: String = src.chars().take(pos).collect();
    let lines: Vec<&str> = before.split('\n').collect();
    (0..lines.len()).rev().find(|&i| {
        let l = lines[i].replace("\\\"", "");
        l.matches('"').count() % 2 == 1 || l.replace("''", "").matches('\'').count() % 2 == 1
    }).map(|i| i + 1)
}

enum Frame {
    Seq(Vec<Value>, usize),
    Map(Map<String, Value>, Option<String>, usize),
}

struct Builder {
    stack: Vec<Frame>,
    anchors: std::collections::HashMap<usize, Value>,
    root: Option<Value>,
    /// First problem the parser didn't report itself (duplicate key), with its 1-based line.
    error: Option<(String, usize)>,
    /// Line of the event being processed.
    mark: usize,
}

impl Builder {
    fn push_value(&mut self, v: Value, anchor: usize) {
        if anchor > 0 {
            self.anchors.insert(anchor, v.clone());
        }
        match self.stack.last_mut() {
            None => {
                if self.root.is_none() {
                    self.root = Some(v)
                }
            }
            Some(Frame::Seq(a, _)) => a.push(v),
            Some(Frame::Map(m, key, _)) => match key.take() {
                None => {
                    let k = match v {
                        Value::String(s) => s,
                        Value::Null => String::new(),
                        other => other.to_string(),
                    };
                    if m.contains_key(&k) && self.error.is_none() {
                        self.error = Some((format!("duplicate key `{k}`"), self.mark)); // uniqueKeys
                    }
                    *key = Some(k);
                }
                Some(k) => {
                    m.insert(k, v);
                }
            },
        }
    }
}

impl MarkedEventReceiver for Builder {
    fn on_event(&mut self, ev: YEvent, mark: Marker) {
        self.mark = mark.line();
        match ev {
            YEvent::Scalar(s, style, anchor, tag) => {
                let plain = style == TScalarStyle::Plain;
                let str_tag = tag.as_ref().is_some_and(|t| t.suffix == "str");
                let v = if plain && !str_tag { resolve_core(&s) } else { Value::String(s) };
                self.push_value(v, anchor);
            }
            YEvent::SequenceStart(anchor, _) => self.stack.push(Frame::Seq(vec![], anchor)),
            YEvent::MappingStart(anchor, _) => self.stack.push(Frame::Map(Map::new(), None, anchor)),
            YEvent::SequenceEnd | YEvent::MappingEnd => {
                let (v, anchor) = match self.stack.pop() {
                    Some(Frame::Seq(a, an)) => (Value::Array(a), an),
                    Some(Frame::Map(m, _, an)) => (Value::Object(m), an),
                    None => return,
                };
                self.push_value(v, anchor);
            }
            YEvent::Alias(id) => {
                let v = self.anchors.get(&id).cloned().unwrap_or(Value::Null);
                self.push_value(v, 0);
            }
            _ => {}
        }
    }
}

static INT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[-+]?[0-9]+$").unwrap());
static FLOAT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$").unwrap());

/// YAML 1.2 core schema tags for plain scalars, as resolved by `yaml` v2.
fn resolve_core(s: &str) -> Value {
    match s {
        "" | "~" | "null" | "Null" | "NULL" => return Value::Null,
        "true" | "True" | "TRUE" => return Value::Bool(true),
        "false" | "False" | "FALSE" => return Value::Bool(false),
        _ => {}
    }
    let num = |f: f64| {
        if f.is_finite() && f.fract() == 0.0 && f.abs() < 9e15 {
            Value::Number((f as i64).into())
        } else {
            Number::from_f64(f).map_or(Value::Null, Value::Number) // ±inf / NaN → null, like JSON.stringify
        }
    };
    if let Some(h) = s.strip_prefix("0x") {
        if let Ok(i) = i64::from_str_radix(h, 16) {
            return Value::Number(i.into());
        }
    }
    if let Some(o) = s.strip_prefix("0o") {
        if let Ok(i) = i64::from_str_radix(o, 8) {
            return Value::Number(i.into());
        }
    }
    if INT.is_match(s) {
        return s.parse::<f64>().map_or(Value::String(s.into()), num);
    }
    if FLOAT.is_match(s) {
        return s.parse::<f64>().map_or(Value::String(s.into()), num);
    }
    match s.trim_start_matches(['+', '-']) {
        ".inf" | ".Inf" | ".INF" | ".nan" | ".NaN" | ".NAN" => Value::Null,
        _ => Value::String(s.into()),
    }
}

// ------------------------------------------------------------------ excluded ranges (links.ts)

/// Ranges where `[[…]]` and `#tags` don't count: code, inline code, HTML, `%%comments%%`
/// (first) and Markdown links (second; excluded for tags only).
fn excluded(text: &str, body_start: usize) -> (Vec<Range<usize>>, Vec<Range<usize>>) {
    let body = &text[body_start..];
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_FOOTNOTES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);
    let mut code = Vec::new();
    let mut links = Vec::new();
    let shift = |r: Range<usize>| r.start + body_start..r.end + body_start;
    let mut skip_until = 0;
    for (ev, r) in Parser::new_ext(body, opts).into_offset_iter() {
        if r.start < skip_until {
            continue; // inside an excluded node: the reference doesn't descend
        }
        match ev {
            Event::Start(Tag::CodeBlock(_)) | Event::Start(Tag::HtmlBlock) => {
                skip_until = r.end;
                code.push(shift(r));
            }
            Event::Code(_) | Event::InlineHtml(_) | Event::Html(_) => code.push(shift(r)),
            Event::Start(Tag::Link { link_type: LinkType::Inline | LinkType::Autolink | LinkType::Email, .. }) => {
                links.push(shift(r));
            }
            _ => {}
        }
    }
    // Math is excluded (dialect §5 for links; tags are AP-15). pulldown-cmark's math rules differ
    // from Obsidian's (`$5 [[A]] $6` is text in Obsidian), so math is scanned here, as S1 does.
    code.extend(math_blocks(body).into_iter().map(shift));
    let skip: Vec<Range<usize>> = code.iter().map(|r| r.start - body_start..r.end - body_start).collect();
    code.extend(inline_math(body, &skip).into_iter().map(shift));
    for m in COMMENT.find_iter(&text[body_start..]) {
        code.push(shift(m.range()));
    }
    (code, links)
}

/// `$$` math blocks (micromark-extension-math "math flow"), which pulldown-cmark doesn't have:
/// a line of ≤ 3 spaces + `$$…` (no `$` after the fence) opens a block, also in the middle of a
/// paragraph; it ends at a line of ≤ 3 spaces + at least as many `$` + spaces, or at the end of
/// the note. Top level only, outside fenced code: inside lists and quotes the rules depend on
/// container continuation, which this pre-pass doesn't model (see FINDINGS.md, P3).
fn math_blocks(body: &str) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    let mut open: Option<(usize, usize)> = None; // (start, fence length)
    let mut fence: Option<(char, usize)> = None; // code fence
    let mut pos = 0;
    for line in body.split_inclusive('\n') {
        let content = line.trim_end_matches(['\n', '\r']);
        let indent = content.len() - content.trim_start_matches(' ').len();
        let t = content.trim_start_matches(' ');
        let run = |c: char| t.chars().take_while(|&x| x == c).count();
        if indent <= 3 {
            if let Some((start, n)) = open {
                if run('$') >= n && t.trim_start_matches('$').trim().is_empty() {
                    out.push(start..pos + line.len());
                    open = None;
                }
            } else if let Some((c, n)) = fence {
                if run(c) >= n && t.trim_start_matches(c).trim().is_empty() {
                    fence = None;
                }
            } else if run('`') >= 3 && !t.trim_start_matches('`').contains('`') {
                fence = Some(('`', run('`')));
            } else if run('~') >= 3 {
                fence = Some(('~', run('~')));
            } else if run('$') >= 2 && !t.trim_start_matches('$').contains('$') {
                open = Some((pos, run('$')));
            }
        }
        pos += line.len();
    }
    if let Some((start, _)) = open {
        out.push(start..body.len());
    }
    out
}

/// Inline math as in S1 (`inline.ts`): `$x$` with a non-space after the opening `$`, a non-space
/// before the closing `$` that isn't `\$`, no digit after the closing `$`, one line only;
/// and `$$x$$` (micromark-extension-math, same-length `$` runs, within the paragraph).
fn inline_math(body: &str, skip: &[Range<usize>]) -> Vec<Range<usize>> {
    let b = body.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'$' || inside(skip, i) || (i > 0 && b[i - 1] == b'\\') {
            i += 1;
            continue;
        }
        let run = b[i..].iter().take_while(|&&c| c == b'$').count();
        if run >= 2 {
            // `$$…$$`: next run of exactly `run` dollars before a blank line.
            let para_end = body[i..].find("\n\n").map_or(b.len(), |p| i + p);
            let mut j = i + run;
            let mut found = None;
            while j < para_end {
                if b[j] == b'$' {
                    let r = b[j..para_end].iter().take_while(|&&c| c == b'$').count();
                    if r == run {
                        found = Some(j + r);
                        break;
                    }
                    j += r;
                } else {
                    j += 1;
                }
            }
            match found {
                Some(end) => {
                    out.push(i..end);
                    i = end;
                }
                None => i += run,
            }
            continue;
        }
        // Single `$`.
        let next = b.get(i + 1).copied();
        if matches!(next, None | Some(b' ' | b'\t' | b'\n' | b'\r')) {
            i += 1;
            continue;
        }
        let mut prev = b'\0'; // "no previous" counts as space
        let mut j = i + 1;
        let mut end = None;
        while j < b.len() && b[j] != b'\n' && b[j] != b'\r' {
            if b[j] == b'$' && !matches!(prev, b'\0' | b' ' | b'\t' | b'\\') && !b.get(j + 1).is_some_and(u8::is_ascii_digit) {
                end = Some(j + 1);
                break;
            }
            prev = b[j];
            j += 1;
        }
        match end {
            Some(e) => {
                out.push(i..e);
                i = e;
            }
            None => i += 1,
        }
    }
    out
}

fn inside(ranges: &[Range<usize>], i: usize) -> bool {
    ranges.iter().any(|r| r.contains(&i))
}

// ------------------------------------------------------------------ wikilinks and tags (links.ts)

fn scan_links(
    text: &str,
    span: Range<usize>,
    excluded: &[Range<usize>],
    in_frontmatter: bool,
    out: &mut Vec<Link>,
    ranges: &mut Vec<Range<usize>>,
) {
    for c in WIKILINK.captures_iter(&text[span.clone()]) {
        let all = c.get(0).unwrap();
        let start = span.start + all.start();
        if inside(excluded, start) {
            continue;
        }
        let inner = c.get(2).unwrap().as_str();
        let pipe = PIPE.find(inner);
        let reference = pipe.map_or(inner, |p| &inner[..p.start()]);
        let (name, subpath) = match reference.find('#') {
            Some(h) => (&reference[..h], Some(reference[h + 1..].to_string())),
            None => (reference, None),
        };
        out.push(Link {
            target: nfc(name.trim()),
            subpath,
            alias: pipe.map(|p| inner[p.end()..].to_string()),
            embed: !c.get(1).unwrap().as_str().is_empty(),
            in_frontmatter,
        });
        ranges.push(start..span.start + all.end());
    }
}

/// JS `\s` (ECMAScript WhiteSpace + LineTerminator).
fn js_space(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}'
        | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

/// `(?<=^|[\s(])#(run of [\p{L}\p{M}\p{N}_\-/] containing a non-digit [\p{L}_\-/])`.
fn scan_tags(text: &str, body_start: usize, excluded: &[Range<usize>], out: &mut Vec<String>) {
    let body = &text[body_start..];
    for (i, _) in body.match_indices('#') {
        let at = body_start + i;
        let prev = text[..at].chars().next_back();
        let ok_prev = match prev {
            None => true,
            Some(c) => js_space(c) || c == '(',
        };
        if !ok_prev || inside(excluded, at) {
            continue;
        }
        let run = TAG_RUN.find(&text[at + 1..]).map_or("", |m| m.as_str());
        if TAG_NON_DIGIT.is_match(run) {
            out.push(nfc(run));
        }
    }
}
