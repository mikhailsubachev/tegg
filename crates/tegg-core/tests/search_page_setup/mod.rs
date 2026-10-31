//! Setup for the Search page redesign L4 tests (docs/acceptance/search-navigation.md § "Search page redesign",
//! docs/contracts/v1-search.md §1). No AC assertions here and no panics: a failure here is a setup failure, never an
//! AC assertion (tools/qa CONTRACT §5.2).
//!
//! The vault: `tests/fixtures/vaults/search/`, then the overlay `search-page/`, then `new-empty/.tegg/` (D-1222).
//!
//! The new `SearchResult` fields (`modified`, `tags`, `title_highlights`, `alias`, `attribute`, v1-search §1) don't
//! exist before the build, and the red tests may not stop the crate's test build (the commit gate's
//! `cargo check --tests`), so the accessors below read them from the result's derived `Debug` text and answer
//! `Err("no field …")` while a field is missing: the AC test then fails on an assertion (TS-I1). Once the fields
//! exist, the build may replace each accessor body with the plain field read (this file is a helper, not an AC test,
//! TS-I3); the AC tests don't change.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::common::{repo_root, Sandbox};
use tegg_core::{AppDirs, Core, CoreOptions, SearchResult, Snippet};

// The overlay's objects (search-page/), with the search/ ones in common.
pub const CHATA: &str = "Pages/Chata na horách.md";
pub const POZDNI: &str = "Quick Notes/Pozdní zápis.md";
pub const BOUDA: &str = "Pages/Horská bouda.md";

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from)? {
        let e = e?;
        let p = e.path();
        if e.file_type()?.is_dir() {
            copy_tree(&p, &to.join(e.file_name()))?;
        } else {
            std::fs::copy(&p, to.join(e.file_name()))?;
        }
    }
    Ok(())
}

/// `search/` + `search-page/` + `new-empty/.tegg/` copied into `<sandbox>/Hledání`. `None` when a copy fails.
pub fn page_vault(sb: &Sandbox) -> Option<PathBuf> {
    let root = sb.base.join("Hledání");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_tree(&fx.join("search"), &root).ok()?;
    copy_tree(&fx.join("search-page"), &root).ok()?;
    copy_tree(&fx.join("new-empty/.tegg"), &root.join(".tegg")).ok()?;
    Some(root)
}

/// Writes a vault file (parents created); false when it fails.
pub fn put(root: &Path, rel: &str, bytes: &[u8]) -> bool {
    let p = root.join(rel);
    if let Some(parent) = p.parent() {
        if std::fs::create_dir_all(parent).is_err() {
            return false;
        }
    }
    std::fs::write(&p, bytes).is_ok()
}

pub fn open_core(root: &Path, dirs: &AppDirs, watch: bool) -> Result<Core, String> {
    let core = Core::open(root, dirs, CoreOptions { watch, sync: None }).map_err(|e| format!("Core::open: {e:?}"))?;
    if !core.wait_idle(Duration::from_secs(600)) {
        return Err("indexing did not become idle".into());
    }
    Ok(core)
}

/// `Pages/Hromada 01.md` … `Hromada 60.md` of FR-SRC-03 AC-12: `type: page`, `tags: [hromada]`, `modified`
/// 2026-08-01T10:00:00+02:00 plus `i` minutes, body `Poznámka číslo <i>: ostružiník.`
pub fn write_hromada(root: &Path) -> bool {
    let mut ok = true;
    for i in 1..=60u32 {
        let minutes = 10 * 60 + i;
        let (h, m) = (minutes / 60, minutes % 60);
        let text = format!(
            "---\ntype: page\ntags: [hromada]\nmodified: 2026-08-01T{h:02}:{m:02}:00+02:00\n---\nPoznámka číslo {i}: ostružiník.\n"
        );
        ok &= put(root, &hromada(i), text.as_bytes());
    }
    ok
}
pub fn hromada(i: u32) -> String {
    format!("Pages/Hromada {i:02}.md")
}

/// Byte ranges into `text` → `[start, end)` in UTF-16 code units (the IPC unit, v1-search §2; the AC's numbers).
/// `None` when a range isn't on character boundaries of `text`.
pub fn utf16(text: &str, ranges: &[(usize, usize)]) -> Option<Vec<(usize, usize)>> {
    ranges
        .iter()
        .map(|&(a, b)| {
            let pa = text.get(..a)?;
            let pb = text.get(..b)?;
            Some((pa.encode_utf16().count(), pb.encode_utf16().count()))
        })
        .collect()
}

/// The highlighted pieces of `text` (byte ranges), `None` when a range is out of bounds.
pub fn pieces(text: &str, ranges: &[(usize, usize)]) -> Option<Vec<String>> {
    ranges.iter().map(|&(a, b)| text.get(a..b).map(|s| s.to_string())).collect()
}

// ------------------------------------------------------------------------------------------------ the new fields

/// `modified` (v1-search §1): the frontmatter value as written when it is a valid date-time, else `None`.
pub fn modified(r: &SearchResult) -> Result<Option<String>, String> {
    let v = field(r, "modified")?;
    match v {
        V::Unit(ref n) if n == "None" => Ok(None),
        V::Call(ref n, ref a) if n == "Some" && a.len() == 1 => a[0].string().map(Some).ok_or_else(|| bad("modified", &v)),
        other => Err(bad("modified", &other)),
    }
}

/// `tags` (v1-search §1): tag keys, NFC, lower case, de-duplicated.
pub fn tags(r: &SearchResult) -> Result<Vec<String>, String> {
    let v = field(r, "tags")?;
    match v {
        V::List(ref items) => items.iter().map(|x| x.string().ok_or_else(|| bad("tags", &v))).collect(),
        other => Err(bad("tags", &other)),
    }
}

/// `title_highlights` (v1-search §1): byte ranges into `title`.
pub fn title_highlights(r: &SearchResult) -> Result<Vec<(usize, usize)>, String> {
    let v = field(r, "title_highlights")?;
    v.ranges().ok_or_else(|| bad("title_highlights", &v))
}

/// `alias` (v1-search §1): the matched alias as a snippet, only for an alias match.
pub fn alias(r: &SearchResult) -> Result<Option<Snippet>, String> {
    let v = field(r, "alias")?;
    match v {
        V::Unit(ref n) if n == "None" => Ok(None),
        V::Call(ref n, ref a) if n == "Some" && a.len() == 1 => a[0].snippet().map(Some).ok_or_else(|| bad("alias", &v)),
        other => Err(bad("alias", &other)),
    }
}

/// `attribute` (v1-search §1): `(key as written, value snippet)`, only for an attribute match.
pub fn attribute(r: &SearchResult) -> Result<Option<(String, Snippet)>, String> {
    let v = field(r, "attribute")?;
    match v {
        V::Unit(ref n) if n == "None" => Ok(None),
        V::Call(ref n, ref a) if n == "Some" && a.len() == 1 => {
            let hit = &a[0];
            let key = hit.get("key").and_then(|k| k.string());
            let value = hit.get("value").and_then(|s| s.snippet());
            match (key, value) {
                (Some(k), Some(s)) => Ok(Some((k, s))),
                _ => Err(bad("attribute", &v)),
            }
        }
        other => Err(bad("attribute", &other)),
    }
}

/// Every v1-search §1 field of `r`, or the first one that is missing (the red guard of the tests).
pub fn fields_present(r: &SearchResult) -> Result<(), String> {
    modified(r)?;
    tags(r)?;
    title_highlights(r)?;
    alias(r)?;
    attribute(r)?;
    Ok(())
}

fn bad(name: &str, v: &V) -> String {
    format!("SearchResult.{name} has an unexpected shape: {v:?}")
}

fn field(r: &SearchResult, name: &str) -> Result<V, String> {
    let text = format!("{r:?}");
    let v = Parser { s: text.as_bytes(), i: 0, src: &text }.value().ok_or_else(|| format!("cannot read SearchResult's Debug text: {text}"))?;
    v.get(name).cloned().ok_or_else(|| format!("SearchResult has no field `{name}` yet (docs/contracts/v1-search.md §1)"))
}

// ------------------------------------------------------------------------------------------------ Debug text reader

#[derive(Debug, Clone)]
enum V {
    Str(String),
    Num(u128),
    Unit(String),
    Call(String, Vec<V>),
    Tuple(Vec<V>),
    List(Vec<V>),
    Struct(String, Vec<(String, V)>),
}

impl V {
    fn get(&self, name: &str) -> Option<&V> {
        match self {
            V::Struct(_, fs) => fs.iter().find(|(k, _)| k == name || k.strip_prefix("r#") == Some(name)).map(|(_, v)| v),
            _ => None,
        }
    }
    fn string(&self) -> Option<String> {
        match self {
            V::Str(s) => Some(s.clone()),
            _ => None,
        }
    }
    fn num(&self) -> Option<usize> {
        match self {
            V::Num(n) => usize::try_from(*n).ok(),
            _ => None,
        }
    }
    fn ranges(&self) -> Option<Vec<(usize, usize)>> {
        match self {
            V::List(items) => items
                .iter()
                .map(|x| match x {
                    V::Tuple(t) if t.len() == 2 => Some((t[0].num()?, t[1].num()?)),
                    _ => None,
                })
                .collect(),
            _ => None,
        }
    }
    fn snippet(&self) -> Option<Snippet> {
        Some(Snippet {
            text: self.get("text")?.string()?,
            highlights: self.get("highlights")?.ranges()?,
            line: self.get("line")?.num()?,
            byte_in_line: self.get("byte_in_line")?.num()?,
        })
    }
}

struct Parser<'a> {
    s: &'a [u8],
    i: usize,
    src: &'a str,
}

impl<'a> Parser<'a> {
    fn ws(&mut self) {
        while self.i < self.s.len() && (self.s[self.i] as char).is_ascii_whitespace() {
            self.i += 1;
        }
    }
    fn peek(&mut self) -> Option<u8> {
        self.ws();
        self.s.get(self.i).copied()
    }
    fn eat(&mut self, c: u8) -> bool {
        if self.peek() == Some(c) {
            self.i += 1;
            true
        } else {
            false
        }
    }
    fn ident(&mut self) -> Option<String> {
        self.ws();
        let start = self.i;
        while self.i < self.s.len() {
            let c = self.s[self.i];
            if c.is_ascii_alphanumeric() || c == b'_' || c == b'#' || c == b':' && self.s.get(self.i + 1) == Some(&b':') {
                self.i += if c == b':' { 2 } else { 1 };
            } else {
                break;
            }
        }
        (self.i > start).then(|| self.src[start..self.i].to_string())
    }
    fn string(&mut self) -> Option<String> {
        // Debug escapes: \" \\ \n \r \t \' \0 \u{…}
        self.i += 1; // opening quote
        let mut out = String::new();
        loop {
            let rest = self.src.get(self.i..)?;
            let c = rest.chars().next()?;
            self.i += c.len_utf8();
            match c {
                '"' => return Some(out),
                '\\' => {
                    let e = self.src.get(self.i..)?.chars().next()?;
                    self.i += e.len_utf8();
                    match e {
                        'n' => out.push('\n'),
                        'r' => out.push('\r'),
                        't' => out.push('\t'),
                        '0' => out.push('\0'),
                        'u' => {
                            let rest = self.src.get(self.i..)?;
                            let close = rest.find('}')?;
                            let hex = rest.get(1..close)?;
                            out.push(char::from_u32(u32::from_str_radix(hex, 16).ok()?)?);
                            self.i += close + 1;
                        }
                        other => out.push(other),
                    }
                }
                _ => out.push(c),
            }
        }
    }
    fn list(&mut self, close: u8) -> Option<Vec<V>> {
        let mut out = Vec::new();
        loop {
            if self.eat(close) {
                return Some(out);
            }
            out.push(self.value()?);
            if !self.eat(b',') {
                return self.eat(close).then_some(out);
            }
        }
    }
    fn value(&mut self) -> Option<V> {
        match self.peek()? {
            b'"' => self.string().map(V::Str),
            b'(' => {
                self.i += 1;
                self.list(b')').map(V::Tuple)
            }
            b'[' => {
                self.i += 1;
                self.list(b']').map(V::List)
            }
            c if c.is_ascii_digit() || c == b'-' => {
                let start = self.i;
                self.i += 1;
                while self.i < self.s.len() && (self.s[self.i].is_ascii_digit() || self.s[self.i] == b'.') {
                    self.i += 1;
                }
                Some(V::Num(self.src[start..self.i].parse::<u128>().unwrap_or(u128::MAX)))
            }
            _ => {
                let name = self.ident()?;
                match self.peek() {
                    Some(b'{') => {
                        self.i += 1;
                        let mut fs = Vec::new();
                        loop {
                            if self.eat(b'}') {
                                break;
                            }
                            if self.eat(b'.') {
                                // `..` of a non-exhaustive Debug
                                self.eat(b'.');
                                continue;
                            }
                            let k = self.ident()?;
                            if !self.eat(b':') {
                                return None;
                            }
                            let v = self.value()?;
                            fs.push((k, v));
                            if !self.eat(b',') {
                                if !self.eat(b'}') {
                                    return None;
                                }
                                break;
                            }
                        }
                        Some(V::Struct(name, fs))
                    }
                    Some(b'(') => {
                        self.i += 1;
                        self.list(b')').map(|a| V::Call(name, a))
                    }
                    _ => Some(V::Unit(name)),
                }
            }
        }
    }
}
