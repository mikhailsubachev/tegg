//! MS5 slice 5B preview feedback F9, AC test of the desktop shell (L4 static, `app-shell-test` step):
//! docs/acceptance/capture.md FR-CAP-01 AC-17 "Window chrome and the title line" (D-592, AP-520) and R55 "Look"
//! (Window, Saved panel rows): the capture and saved windows (labels `capture` and `capture-saved`,
//! docs/contracts/ms5-capture.md §1.2) are built transparent (`transparent(true)`), without decorations, with the
//! shadow on, with the macOS popover effect and a 14 px corner radius; `tauri.conf.json` sets `macOSPrivateApi: true`.
//! A static rule over the shell's source text (no build of the windows): each window's builder statement
//! (`WebviewWindowBuilder::new(…, "<label>", …)`, the label a literal or a `const`, or a helper `fn` that builds the
//! window and is called with the label), together with the function that holds it and the functions it calls, must
//! name every property. Written from the AC and the contract only (D-61); it never reads the feature's code into the
//! test, only searches the source text for the AC's tokens.

use std::fs;
use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn rust_sources(dir: &Path, out: &mut Vec<(PathBuf, String)>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            rust_sources(&p, out);
        } else if p.extension().map(|x| x == "rs").unwrap_or(false) {
            if let Ok(t) = fs::read_to_string(&p) {
                out.push((p, t));
            }
        }
    }
}

/// Length of a char literal (`'"'`, `'\\''`, `'\\n'`) at `i`, 0 when `i` isn't one (a lifetime, say).
fn char_literal(b: &[u8], i: usize) -> usize {
    if b.get(i) != Some(&b'\'') {
        return 0;
    }
    if b.get(i + 1) == Some(&b'\\') {
        return (i + 3..(i + 12).min(b.len())).find(|&j| b[j] == b'\'').map(|j| j + 1 - i).unwrap_or(0);
    }
    // One UTF-8 character, then the closing quote.
    let mut j = i + 1;
    if j < b.len() {
        j += 1;
        while j < b.len() && (b[j] & 0xC0) == 0x80 {
            j += 1;
        }
    }
    if b.get(j) == Some(&b'\'') { j + 1 - i } else { 0 }
}

/// The source with comments removed (line and block), string literals kept.
fn strip_comments(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    let mut in_str = false;
    while i < b.len() {
        let c = b[i] as char;
        if in_str {
            out.push(c);
            if c == '\\' && i + 1 < b.len() {
                out.push(b[i + 1] as char);
                i += 2;
                continue;
            }
            if c == '"' {
                in_str = false;
            }
            i += 1;
            continue;
        }
        let cl = char_literal(b, i);
        if cl > 0 {
            out.push_str(&s[i..i + cl]);
            i += cl;
        } else if c == '"' {
            in_str = true;
            out.push(c);
            i += 1;
        } else if c == '/' && i + 1 < b.len() && b[i + 1] == b'/' {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
        } else if c == '/' && i + 1 < b.len() && b[i + 1] == b'*' {
            i += 2;
            while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                i += 1;
            }
            i += 2;
        } else {
            // Keep multi-byte UTF-8 intact.
            let ch = s[i..].chars().next().unwrap_or(' ');
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

/// End index (exclusive) of the statement starting at `start`: the first `;` at bracket depth 0, or the closing
/// bracket that leaves the enclosing block.
fn statement_end(s: &str, start: usize) -> usize {
    let b = s.as_bytes();
    let mut depth: i32 = 0;
    let mut in_str = false;
    let mut i = start;
    while i < b.len() {
        let c = b[i];
        if in_str {
            if c == b'\\' {
                i += 2;
                continue;
            }
            if c == b'"' {
                in_str = false;
            }
        } else if char_literal(b, i) > 0 {
            i += char_literal(b, i);
            continue;
        } else {
            match c {
                b'"' => in_str = true,
                b'(' | b'[' | b'{' => depth += 1,
                b')' | b']' | b'}' => {
                    depth -= 1;
                    if depth < 0 {
                        return i;
                    }
                }
                b';' if depth == 0 => return i + 1,
                _ => {}
            }
        }
        i += 1;
    }
    b.len()
}

/// `(name, body start, body end)` of every `fn` in `s`.
fn functions(s: &str) -> Vec<(String, usize, usize)> {
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(k) = s[from..].find("fn ") {
        let at = from + k;
        from = at + 3;
        if at > 0 && (s.as_bytes()[at - 1].is_ascii_alphanumeric() || s.as_bytes()[at - 1] == b'_') {
            continue;
        }
        let name: String = s[at + 3..].chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
        if name.is_empty() {
            continue;
        }
        // The body: the first `{` after the signature at paren depth 0 (skipping `where` clauses' generics is not
        // needed for the patterns searched here).
        let mut depth = 0i32;
        let mut j = at;
        let b = s.as_bytes();
        let mut open = None;
        while j < b.len() {
            match b[j] {
                b'(' | b'<' => depth += 1,
                b')' | b'>' => depth -= 1,
                b';' if depth <= 0 => break,
                b'{' if depth <= 0 => {
                    open = Some(j);
                    break;
                }
                _ => {}
            }
            j += 1;
        }
        let Some(o) = open else { continue };
        let end = statement_end(s, o + 1);
        out.push((name, o, end.min(s.len())));
    }
    out
}

fn compact(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).collect()
}

/// The text the AC's tokens are searched in for the window `label`: every builder statement for it, the function
/// holding it, and the bodies of the functions those call (one level).
fn window_text(all: &str, label: &str) -> Option<String> {
    let fns = functions(all);
    let literal = format!("\"{label}\"");
    // Constants holding the label (`const CAPTURE: &str = "capture";`).
    let mut names = vec![literal.clone()];
    let mut from = 0;
    while let Some(k) = all[from..].find("const ") {
        let at = from + k;
        from = at + 6;
        let end = statement_end(all, at);
        let st = &all[at..end];
        if compact(st).ends_with(&format!("={literal};")) {
            let n: String = st[6..].chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
            if !n.is_empty() {
                names.push(n);
            }
        }
    }
    let mentions = |t: &str| {
        names.iter().any(|n| {
            if n.starts_with('"') {
                t.contains(n.as_str())
            } else {
                t.match_indices(n.as_str()).any(|(i, _)| {
                    let before = t[..i].chars().last().map(|c| c.is_alphanumeric() || c == '_').unwrap_or(false);
                    let after = t[i + n.len()..].chars().next().map(|c| c.is_alphanumeric() || c == '_').unwrap_or(false);
                    !before && !after
                })
            }
        })
    };
    let mut parts: Vec<String> = Vec::new();
    let mut builders: Vec<(usize, usize)> = Vec::new();
    for pat in ["WebviewWindowBuilder::new(", "WindowBuilder::new("] {
        let mut f = 0;
        while let Some(k) = all[f..].find(pat) {
            let at = f + k;
            f = at + pat.len();
            if builders.iter().any(|(s, e)| at >= *s && at < *e) {
                continue;
            }
            builders.push((at, statement_end(all, at)));
        }
    }
    let enclosing = |pos: usize| fns.iter().filter(|(_, s, e)| *s <= pos && pos < *e).min_by_key(|(_, s, e)| e - s).cloned();
    let mut hit = false;
    for (s, e) in &builders {
        let st = &all[*s..*e];
        let direct = mentions(&st[..st.len().min(400)]);
        let via_helper = !direct
            && enclosing(*s)
                .map(|(name, _, _)| {
                    let call = format!("{name}(");
                    all.match_indices(call.as_str()).any(|(i, _)| {
                        let end = statement_end(all, i);
                        let fn_decl = all[..i].ends_with("fn ");
                        !fn_decl && mentions(&all[i..end])
                    })
                })
                .unwrap_or(false);
        if direct || via_helper {
            hit = true;
            parts.push(st.to_string());
            if let Some((_, fs_, fe)) = enclosing(*s) {
                let body = &all[fs_..fe];
                parts.push(body.to_string());
                for (name, cs, ce) in &fns {
                    if body.contains(&format!("{name}(")) && !(*cs <= *s && *s < *ce) {
                        parts.push(all[*cs..*ce].to_string());
                    }
                }
            }
        }
    }
    hit.then(|| compact(&parts.join("\n")))
}

fn shell_source() -> String {
    let mut files = Vec::new();
    rust_sources(&root().join("src"), &mut files);
    assert!(!files.is_empty(), "the shell's sources under app/src-tauri/src");
    files.iter().map(|(_, t)| strip_comments(t)).collect::<Vec<_>>().join("\n")
}

fn assert_popover(label: &str) {
    let all = shell_source();
    let text = window_text(&all, label);
    assert!(text.is_some(), "a `WebviewWindowBuilder::new(…, \"{label}\", …)` builds the `{label}` window (ms5-capture §1.2)");
    let t = text.unwrap();
    let mut missing = Vec::new();
    for (what, any) in [
        ("transparent(true)", vec![".transparent(true)"]),
        ("no decorations", vec![".decorations(false)"]),
        ("shadow on", vec![".shadow(true)"]),
        ("the macOS popover effect", vec!["Effect::Popover"]),
        ("14 px corner radius", vec![".radius(14.0)", ".radius(14)", "radius:Some(14.0)", "radius:Some(14)"]),
    ] {
        if !any.iter().any(|p| t.contains(p)) {
            missing.push(what);
        }
    }
    assert!(missing.is_empty(), "the `{label}` window is a transparent popover (D-592); missing: {missing:?}");
}

#[test]
fn fr_cap_01_ac17_the_capture_window_is_a_transparent_popover() {
    assert_popover("capture");
}

#[test]
fn fr_cap_01_ac17_the_saved_window_is_a_transparent_popover() {
    assert_popover("capture-saved");
}

#[test]
fn fr_cap_01_ac17_tauri_conf_sets_macos_private_api() {
    let text = fs::read_to_string(root().join("tauri.conf.json")).unwrap_or_default();
    let conf: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    assert_eq!(
        conf.pointer("/app/macOSPrivateApi"),
        Some(&serde_json::Value::Bool(true)),
        "tauri.conf.json sets app.macOSPrivateApi: true (transparent windows on macOS, D-592)"
    );
}
