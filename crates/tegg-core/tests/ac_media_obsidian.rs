//! MS6 slice 6A AC test at the core (L4): FR-ATT-01 AC-10 Obsidian compatibility (docs/acceptance/trash-media.md;
//! NFR-POR-01, D-05). After AC-1…AC-3's adds (a paste, a drop of a PNG and a PDF, a picked file with a taken name), done
//! with `Core::media_add` and the note written as the editor does (`![[<embed>]]` paragraphs, `insertEmbeds`), every
//! `![[…]]` of every note resolves by Obsidian's rule for attachments (an exact vault path, else the shortest path with
//! that file name; several of equal length: the vault-path order) to an existing file, and every Image/PDF object is a
//! valid note: YAML frontmatter of plain `key: value` lines, `file: "[[…]]"` resolving to its file, no duplicate keys.
//! There is no automated obsidian-check harness yet (tests/fixtures/vaults/obsidian-check is the owner's manual check),
//! so Obsidian's resolution rule is written out here (red-test point AP-552). Interface docs/contracts/ms6-trash-media.md
//! §3.4 (`embed`: the file name when unique, else the vault path). Written from the ACs and the contract only (D-61).

mod common;
mod trash6a_setup;

use std::path::Path;
use std::time::{Duration, SystemTime};

use common::*;
use tegg_core::{MediaAdd, OwnerRef};
use tegg_format::nfc;
use trash6a_setup::*;

macro_rules! ok {
    ($e:expr, $what:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => {
                assert!(false, "{} failed: {:?}", $what, e);
                unreachable!()
            }
        }
    };
}

fn files(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    fn walk(root: &Path, d: &Path, out: &mut Vec<String>) {
        let Ok(rd) = std::fs::read_dir(d) else { return };
        for e in rd.flatten() {
            let p = e.path();
            let rel = nfc(&p.strip_prefix(root).map(|x| x.to_string_lossy().to_string()).unwrap_or_default());
            if rel.starts_with(".tegg") || rel.starts_with(".trash") || rel.starts_with("_templates") {
                continue;
            }
            if p.is_dir() { walk(root, &p, out) } else { out.push(rel) }
        }
    }
    walk(root, root, &mut out);
    out.sort();
    out
}
/// Obsidian's attachment link rule: an exact vault path, else the shortest path with that name (then path order).
fn obsidian(all: &[String], target: &str) -> Option<String> {
    let t = nfc(target.split(['|', '#']).next().unwrap_or("").trim());
    if all.contains(&t) {
        return Some(t);
    }
    let name = t.rsplit('/').next().unwrap_or(&t).to_string();
    let mut c: Vec<&String> = all.iter().filter(|p| p.rsplit('/').next() == Some(name.as_str())).collect();
    c.sort_by(|a, b| a.chars().count().cmp(&b.chars().count()).then(a.cmp(b)));
    c.first().map(|s| s.to_string())
}
fn embeds(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find("![[") {
        rest = &rest[i + 3..];
        if let Some(j) = rest.find("]]") {
            out.push(rest[..j].to_string());
            rest = &rest[j + 2..];
        }
    }
    out
}
fn add(name: &str, bytes: Vec<u8>) -> MediaAdd {
    let t = chrono::DateTime::parse_from_rfc3339(NOW).expect("setup: NOW");
    MediaAdd {
        bytes,
        name: name.to_string(),
        owner: Some(OwnerRef { path: PLAN.to_string(), title: "Plán zahrady".to_string() }),
        now: SystemTime::UNIX_EPOCH + Duration::from_secs(t.timestamp() as u64),
        zone_date: "2026-10-22".to_string(),
    }
}

#[test]
fn fr_att_01_ac10_the_vault_after_adding_media_opens_in_obsidian() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    write_raw(&root, "Archiv/Záhon 2.PNG", &fixture(PNG)); // the name of the drop below exists elsewhere
    let core = open(&root, &sb);
    let mut lines = Vec::new();
    for (name, bytes) in [
        ("Pasted image 20261022100000.png", fixture(PNG)),
        ("Záhon 2.PNG", fixture(PNG)),
        ("Rozpočet 2026.pdf", fixture(PDF)),
        ("záhon.png", fixture(PNG)),
    ] {
        let a = ok!(core.media_add(add(name, bytes)), format!("media_add {name}"));
        lines.push(format!("![[{}]]", a.embed));
    }
    let base = version(&core, PLAN);
    let new = text(&root, PLAN).replace("Záhon u plotu.\n\n", &format!("Záhon u plotu.\n\n{}\n\n", lines.join("\n\n")));
    ok!(core.write_note(PLAN, new.as_bytes(), Some(&base)), "the note's autosave");
    let all = files(&root);
    let mut bad = Vec::new();
    for f in all.iter().filter(|p| p.ends_with(".md")) {
        let t = text(&root, f);
        for e in embeds(&t) {
            if e.ends_with(".md") || !e.contains('.') {
                continue;
            }
            // The fixture's Odkazy embeds a trashed file on purpose (T3, R74): Obsidian doesn't resolve into `.trash/`
            // either, so a target whose file exists only in `.trash/` is skipped (D-632).
            let name = e.split(['|', '#']).next().unwrap_or("").trim().rsplit('/').next().unwrap_or("").to_string();
            if obsidian(&all, &e).is_none() && root.join(".trash/_attachments").join(&name).is_file() {
                continue;
            }
            match obsidian(&all, &e) {
                Some(p) if root.join(&p).is_file() => {}
                other => bad.push(format!("{f}: ![[{e}]] → {other:?}")),
            }
        }
    }
    assert!(bad.is_empty(), "every embed resolves to its file by Obsidian's rule: {bad:#?}");
    // `Záhon 2.PNG` also exists in Archiv/: its embed is the vault path, so Obsidian finds the new file (§3.4).
    assert_eq!(lines.get(1).map(|l| nfc(l)), Some("![[_attachments/Záhon 2.PNG]]".to_string()), "a non-unique name is embedded by its path: {lines:?}");
    assert_eq!(lines.get(3).map(|l| nfc(l)), Some("![[záhon (2).png]]".to_string()), "a taken name gets ` (2)` and, being unique, is embedded by name");
    let objects: Vec<&String> = all.iter().filter(|p| p.starts_with("Images/") || p.starts_with("PDFs/")).collect();
    assert!(objects.len() >= 6, "the new objects exist: {objects:?}");
    for o in objects {
        let t = text(&root, o);
        let fm = t.strip_prefix("---\n").and_then(|r| r.split_once("\n---\n")).map(|(f, _)| f.to_string());
        assert!(fm.is_some(), "{o}: YAML frontmatter");
        let mut keys = Vec::new();
        for line in fm.unwrap_or_default().lines() {
            let k = line.split_once(": ").map(|(k, _)| k.to_string());
            assert!(k.is_some(), "{o}: a plain `key: value` line: {line:?}");
            keys.push(k.unwrap_or_default());
        }
        let mut uniq = keys.clone();
        uniq.dedup();
        assert_eq!(uniq.len(), keys.len(), "{o}: no duplicate keys");
        let file = t.lines().find_map(|l| l.strip_prefix("file: \"[[").and_then(|r| r.strip_suffix("]]\""))).map(|s| s.to_string());
        assert!(file.as_deref().and_then(|f| obsidian(&all, f)).is_some_and(|p| root.join(p).is_file()), "{o}: file: resolves to its file ({file:?})");
    }
}
