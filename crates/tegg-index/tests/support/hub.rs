//! The hub of the graph fixture (tests/fixtures/vaults/graph/README.md "Hub"), the Rust twin of
//! `tests/fixtures/vaults/graph/make-hub.mjs` (docs/contracts/v1-graph.md §8): 1,362 pages under `Pages/Hub/`, the same
//! bytes. Setup code: no assertions about the criteria here.
#![allow(dead_code)]

use std::path::Path;

fn page(n: usize, title: &str, body: &str) -> String {
    format!("---\nid: 01JBGR000000000000000H{n:04}\ntype: page\ntitle: {title}\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\n{body}\n")
}

/// (vault path, text) of every hub file, in the generator's order.
pub fn hub_files() -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut put = |title: String, n: usize, body: String| out.push((format!("Pages/Hub/{title}.md"), page(n, &title, &body)));
    put("Rozcestník".into(), 1, (1..=40).map(|n| format!("[[Paprsek {n:02}]]")).collect::<Vec<_>>().join(" "));
    for n in 1..=40usize {
        put(format!("Paprsek {n:02}"), 1 + n, ["a", "b", "c"].iter().map(|x| format!("[[Uzel {n:02}-{x}]]")).collect::<Vec<_>>().join(" "));
    }
    for n in 1..=40usize {
        for (i, x) in ["a", "b", "c"].iter().enumerate() {
            let body = if *x == "c" { "Konec.".to_string() } else { (1..=15).map(|m| format!("[[List {n:02}-{x}-{m:02}]]")).collect::<Vec<_>>().join(" ") };
            put(format!("Uzel {n:02}-{x}"), 41 + 3 * (n - 1) + (i + 1), body);
        }
    }
    for n in 1..=40usize {
        for (xi, x) in ["a", "b"].iter().enumerate() {
            for m in 1..=15usize {
                put(format!("List {n:02}-{x}-{m:02}"), 161 + 15 * (2 * (n - 1) + xi) + m, "List.".into());
            }
        }
    }
    put(
        "Široký rozcestník".into(),
        1362,
        (1..=40).map(|n| format!("[[List {n:02}-a-01]] [[List {n:02}-a-02]] [[List {n:02}-b-01]] [[List {n:02}-b-02]]")).collect::<Vec<_>>().join(" "),
    );
    out
}

/// Writes the hub into `vault` (a temporary copy of the fixture).
pub fn write_hub(vault: &Path) {
    for (rel, text) in hub_files() {
        let p = vault.join(&rel);
        if let Some(d) = p.parent() {
            std::fs::create_dir_all(d).expect("setup: hub folder");
        }
        std::fs::write(&p, text.as_bytes()).expect("setup: hub file");
    }
}

pub const ROZCESTNIK: &str = "Pages/Hub/Rozcestník.md";
pub const SIROKY: &str = "Pages/Hub/Široký rozcestník.md";
pub fn paprsek(n: usize) -> String {
    format!("Pages/Hub/Paprsek {n:02}.md")
}
pub fn uzel(n: usize, x: char) -> String {
    format!("Pages/Hub/Uzel {n:02}-{x}.md")
}
pub fn list(n: usize, x: char, m: usize) -> String {
    format!("Pages/Hub/List {n:02}-{x}-{m:02}.md")
}
