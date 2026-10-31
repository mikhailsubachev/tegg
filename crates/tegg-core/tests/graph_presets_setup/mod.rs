//! Setup for the slice G3 L4 tests of the presets file (docs/contracts/v1-graph.md §16.1): the graph fixture in a
//! temporary directory with one of tests/fixtures/graph-presets/ as `.tegg/graph.yml` (or none), the expected bytes,
//! the runtime variants of the fixture README (NFD names, CRLF, no final newline, invalid versions…), ops and file
//! probes. No AC assertions here: a panic in this module is a setup failure, never a red test (tools/qa CONTRACT §5.2).
#![allow(dead_code)]

use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

use crate::common::{repo_root, Sandbox};
use crate::graph_setup::graph_vault;
use tegg_core::PresetOp;

pub const YML: &str = ".tegg/graph.yml";
pub const COPY_A: &str = ".tegg/graph (conflicted copy 2026-10-28).yml";
pub const COPY_B: &str = ".tegg/graph 2.yml";

pub fn fx_dir() -> PathBuf {
    repo_root().join("tests/fixtures/graph-presets")
}
/// `tests/fixtures/graph-presets/<name>` (e.g. `valid.yml`, `expected/created.yml`) as bytes.
pub fn fx(name: &str) -> Vec<u8> {
    std::fs::read(fx_dir().join(name)).unwrap_or_else(|e| panic!("setup: fixture {name}: {e}"))
}
pub fn fxs(name: &str) -> String {
    String::from_utf8(fx(name)).expect("setup: fixture is UTF-8")
}

/// The graph fixture in `<sandbox>/Graf` with `bytes` as `.tegg/graph.yml` (None: no file).
pub fn vault_with(sb: &Sandbox, bytes: Option<&[u8]>) -> PathBuf {
    let root = graph_vault(sb);
    if let Some(b) = bytes {
        std::fs::write(root.join(YML), b).expect("setup: write graph.yml");
    }
    root
}
/// The graph fixture with `tests/fixtures/graph-presets/<name>` as `.tegg/graph.yml`.
pub fn vault_fx(sb: &Sandbox, name: &str) -> PathBuf {
    vault_with(sb, Some(&fx(name)))
}

pub fn disk(root: &Path, rel: &str) -> Option<Vec<u8>> {
    std::fs::read(root.join(rel)).ok()
}
pub fn disk_s(root: &Path, rel: &str) -> Option<String> {
    disk(root, rel).map(|b| String::from_utf8_lossy(&b).into_owned())
}
/// Bytes, mtime (ns) and inode of a file, or None.
pub fn stamp(root: &Path, rel: &str) -> Option<(Vec<u8>, i128, u64)> {
    let p = root.join(rel);
    let md = std::fs::metadata(&p).ok()?;
    let bytes = std::fs::read(&p).ok()?;
    Some((bytes, md.mtime() as i128 * 1_000_000_000 + md.mtime_nsec() as i128, md.ino()))
}
pub fn ino(root: &Path, rel: &str) -> Option<u64> {
    std::fs::metadata(root.join(rel)).ok().map(|m| m.ino())
}
/// Replaces `.tegg/graph.yml` "as another program" by writing a temp file next to the vault and renaming it over the
/// target (a sync client's atomic replace).
pub fn replace_atomically(root: &Path, rel: &str, bytes: &[u8]) {
    let tmp = root.parent().expect("setup: vault parent").join(format!("ext-{}.tmp", std::process::id()));
    std::fs::write(&tmp, bytes).expect("setup: write temp");
    std::fs::rename(&tmp, root.join(rel)).expect("setup: rename over");
}

/// Every `name:` value of a YAML text converted to NFD (fixture README: "NFD names").
pub fn nfd_names(text: &str) -> String {
    text.split_inclusive('\n')
        .map(|l| match l.find("- name: ") {
            Some(i) => {
                let (head, rest) = l.split_at(i + "- name: ".len());
                format!("{head}{}", nfd(rest))
            }
            None => l.to_string(),
        })
        .collect()
}
/// NFD of the Czech letters the fixtures use (the test crate has no Unicode tables; checked by `nfc(nfd(x)) == x`).
pub fn nfd(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        let (base, mark) = match c {
            'á' => ('a', '\u{301}'), 'é' => ('e', '\u{301}'), 'í' => ('i', '\u{301}'), 'ó' => ('o', '\u{301}'), 'ú' => ('u', '\u{301}'),
            'ý' => ('y', '\u{301}'), 'č' => ('c', '\u{30C}'), 'ď' => ('d', '\u{30C}'), 'ě' => ('e', '\u{30C}'), 'ň' => ('n', '\u{30C}'),
            'ř' => ('r', '\u{30C}'), 'š' => ('s', '\u{30C}'), 'ť' => ('t', '\u{30C}'), 'ž' => ('z', '\u{30C}'), 'ů' => ('u', '\u{30A}'),
            'Č' => ('C', '\u{30C}'), 'Š' => ('S', '\u{30C}'), 'Ž' => ('Z', '\u{30C}'), 'Ř' => ('R', '\u{30C}'), 'É' => ('E', '\u{301}'),
            'Ú' => ('U', '\u{301}'), 'Á' => ('A', '\u{301}'), 'Í' => ('I', '\u{301}'),
            other => {
                out.push(other);
                continue;
            }
        };
        out.push(base);
        out.push(mark);
    }
    assert_eq!(tegg_format::nfc(&out), s, "setup: nfd table");
    out
}
pub fn crlf(text: &str) -> String {
    text.replace('\n', "\r\n")
}
/// A text with its line `n` (1-based) replaced by `with` (None removes it; LF endings).
pub fn line_set(text: &str, n: usize, with: Option<&str>) -> String {
    let mut out = String::new();
    for (i, l) in text.split_inclusive('\n').enumerate() {
        if i + 1 == n {
            if let Some(w) = with {
                out.push_str(w);
                out.push('\n');
            }
        } else {
            out.push_str(l);
        }
    }
    out
}
/// A text without lines `from..=to` (1-based).
pub fn lines_cut(text: &str, from: usize, to: usize) -> String {
    text.split_inclusive('\n').enumerate().filter(|(i, _)| *i + 1 < from || *i + 1 > to).map(|(_, l)| l).collect()
}
/// A text with `add` inserted after line `n` (1-based).
pub fn lines_insert_after(text: &str, n: usize, add: &[&str]) -> String {
    let mut out = String::new();
    for (i, l) in text.split_inclusive('\n').enumerate() {
        out.push_str(l);
        if i + 1 == n {
            for a in add {
                out.push_str(a);
                out.push('\n');
            }
        }
    }
    out
}

pub fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| tegg_format::nfc(s)).collect()
}
pub fn save(name: &str, t: &[&str], k: &[&str]) -> PresetOp {
    PresetOp::Save { name: name.to_string(), hidden_types: strs(t), hidden_kinds: strs(k) }
}
pub fn update(name: &str, t: &[&str], k: &[&str]) -> PresetOp {
    PresetOp::Update { name: tegg_format::nfc(name), hidden_types: strs(t), hidden_kinds: strs(k) }
}
pub fn rename(from: &str, to: &str) -> PresetOp {
    PresetOp::Rename { from: from.to_string(), to: to.to_string() }
}
pub fn delete(name: &str) -> PresetOp {
    PresetOp::Delete { name: name.to_string() }
}
