//! AR-03 AC-3 (D-100, static rule D-95): platform-specific APIs in `crates/` appear only
//! inside items gated by `#[cfg(target_os = "X")]`, each with a
//! `#[cfg(not(target_os = "X"))]` counterpart of the same name in the same file.

use std::path::{Path, PathBuf};

const MARKERS: &[&str] = &[
    "libc::renamex_np", "RENAME_EXCL", "objc2", "cocoa", "AppKit", "core_foundation",
    "windows::", "winapi", "jni::", "android",
];

fn indent(l: &str) -> usize { l.len() - l.trim_start().len() }

fn code_part(l: &str) -> &str {
    match l.find("//") { Some(i) => &l[..i], None => l }
}

/// Returns (kind, name) if the line starts a fn/impl/mod/use item.
fn item_header(l: &str) -> Option<(String, String)> {
    let mut t = code_part(l).trim();
    loop {
        let before = t;
        for p in ["pub(crate) ", "pub(super) ", "pub ", "unsafe ", "async ", "const ", "extern \"C\" "] {
            if let Some(r) = t.strip_prefix(p) { t = r.trim_start(); }
        }
        if t == before { break; }
    }
    for kw in ["fn ", "impl ", "impl<", "mod ", "use "] {
        if let Some(rest) = t.strip_prefix(kw) {
            let kind = kw.trim_end_matches(['<', ' ']).to_string();
            let name: String = if kind == "use" {
                rest.trim_end_matches(';').trim().to_string()
            } else {
                let rest = if kw == "impl<" { rest.splitn(2, '>').nth(1).unwrap_or("").trim() } else { rest };
                rest.chars().take_while(|c| c.is_alphanumeric() || *c == '_' || *c == ':').collect()
            };
            return Some((kind, name));
        }
    }
    None
}

/// Attribute lines directly above line `idx` (skipping doc comments / other attributes).
fn attrs_above(lines: &[&str], idx: usize) -> Vec<String> {
    let mut out = vec![];
    let mut i = idx;
    while i > 0 {
        i -= 1;
        let t = lines[i].trim();
        if t.starts_with("#[") || t.starts_with("///") || t.starts_with("//") { out.push(t.replace(' ', "")); } else { break; }
    }
    out
}

fn gated_os(attrs: &[String]) -> Option<String> {
    for a in attrs {
        if let Some(p) = a.strip_prefix("#[cfg(target_os=\"") {
            return p.split('"').next().map(|s| s.to_string());
        }
    }
    None
}

fn has_counterpart(lines: &[&str], kind: &str, name: &str, os: &str) -> bool {
    let want = format!("#[cfg(not(target_os=\"{os}\"))]");
    lines.iter().enumerate().any(|(i, l)| {
        item_header(l).map_or(false, |(k, n)| k == kind && n == name)
            && attrs_above(lines, i).iter().any(|a| *a == want)
    })
}

/// Returns violations as "line N: message".
fn check_source(src: &str) -> Vec<String> {
    let lines: Vec<&str> = src.lines().collect();
    let mut v = vec![];
    for (i, l) in lines.iter().enumerate() {
        let t = l.trim_start();
        if t.starts_with("//") || t.starts_with("*") || t.starts_with("/*") { continue; }
        let code = code_part(l);
        let Some(m) = MARKERS.iter().find(|m| code.contains(**m)) else { continue };
        // Walk enclosing items outward; any gated one with a counterpart passes.
        let mut ok = false;
        let mut limit = indent(l) + 1; // the line itself may be the header
        let mut j = i + 1;
        let mut found_any = false;
        while j > 0 {
            j -= 1;
            let lj = lines[j];
            if lj.trim().is_empty() || indent(lj) >= limit { continue; }
            if let Some((kind, name)) = item_header(lj) {
                found_any = true;
                if let Some(os) = gated_os(&attrs_above(&lines, j)) {
                    if has_counterpart(&lines, &kind, &name, &os) { ok = true; break; }
                    v.push(format!("line {}: `{m}` in `{kind} {name}` gated on {os} has no #[cfg(not(target_os = \"{os}\"))] counterpart", i + 1));
                    ok = true; // already reported
                    break;
                }
            }
            limit = indent(lj);
            if limit == 0 { break; }
        }
        if !ok {
            v.push(format!("line {}: `{m}` outside a #[cfg(target_os)] item{}", i + 1, if found_any { "" } else { " (no enclosing item)" }));
        }
    }
    v
}

fn rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() { rs_files(&p, out) } else if p.extension().map_or(false, |x| x == "rs") { out.push(p) }
    }
}

#[test]
fn ar_03_ac3_platform_apis_only_in_cfg_gated_items_with_fallback() {
    let crates = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let mut files = vec![];
    for e in std::fs::read_dir(crates).unwrap().flatten() {
        rs_files(&e.path().join("src"), &mut files);
    }
    assert!(!files.is_empty(), "no Rust sources found under crates/*/src");
    let mut all = vec![];
    for f in &files {
        let src = std::fs::read_to_string(f).unwrap();
        for v in check_source(&src) { all.push(format!("{}: {v}", f.display())); }
    }
    assert_eq!(all, Vec::<String>::new(), "AR-03 AC-3 violations");
}

#[test]
fn ar_03_ac3_checker_self_check_bites() {
    let good = r#"
/// Uses RENAME_EXCL on macOS.
#[cfg(target_os = "macos")]
#[inline]
fn create_excl(a: &str, b: &str) -> i32 {
    unsafe { libc::renamex_np(a, b, libc::RENAME_EXCL) }
}

#[cfg(not(target_os = "macos"))]
fn create_excl(a: &str, b: &str) -> i32 { portable(a, b) }
"#;
    let bad = r#"
fn create_excl(a: &str, b: &str) -> i32 {
    unsafe { libc::renamex_np(a, b, libc::RENAME_EXCL) }
}
"#;
    let no_fallback = r#"
#[cfg(target_os = "macos")]
fn create_excl() { libc::renamex_np(); }
"#;
    assert_eq!(check_source(good), Vec::<String>::new());
    assert_eq!(check_source(bad), vec!["line 3: `libc::renamex_np` outside a #[cfg(target_os)] item".to_string()]);
    assert_eq!(check_source(no_fallback).len(), 1);
}
