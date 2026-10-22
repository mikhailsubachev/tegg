//! MS6 slice 6A AC property test at the core (L2, AR-06, T1): FR-FMT-07 AC-22's file half (docs/acceptance/
//! trash-media.md). Random notes of the round-trip corpus (tests/fixtures/format/roundtrip, byte-exact) and random
//! media pairs are written into a vault in random folders; random sequences of `trash_object` and `trash_restore`
//! (§1.4) move them into `.trash/` and back: every restored file is byte-identical with the same mtime and inode, a pair
//! moves and returns together, and no other file is touched. The editor half (media paragraphs change only themselves)
//! is packages/editor/test/media.prop.ac.test.ts. Interface docs/contracts/ms6-trash-media.md §1.4. Written from the ACs
//! and the contract only (D-61).
//!
//! Seeds (TS-L2): a fixed seed plus one random seed per run (`QA_SEED` when set, else the clock); with
//! `QA_PROPERTY_SCALE` ≥ 100 (nightly) 10 seeds × 200 steps. Every seed is printed (`seed = N`).

mod common;
mod trash6a_setup;

use std::path::{Path, PathBuf};

use common::*;
use tegg_format::nfc;
use trash6a_setup::{changed, copy_dir, ident, open, snap, version};

const FIXED_SEED: u64 = 20_261_022;

struct Rng(u64);
impl Rng {
    fn new(seed: u64) -> Rng {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}
fn scale() -> u64 {
    std::env::var("QA_PROPERTY_SCALE").ok().and_then(|s| s.parse().ok()).unwrap_or(1)
}
fn seeds() -> Vec<u64> {
    let r = std::env::var("QA_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or_else(|| {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(7)
    });
    if scale() >= 100 { (0..10).map(|i| if i == 0 { FIXED_SEED } else { r.wrapping_add(i) }).collect() } else { vec![FIXED_SEED, r] }
}
fn steps() -> usize {
    if scale() >= 100 { 200 } else { 25 }
}

// ------------------------------------------------------------------------------------------------ setup (no AC assertions)

fn corpus() -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    fn walk(d: &Path, out: &mut Vec<Vec<u8>>) {
        let Ok(rd) = std::fs::read_dir(d) else { return };
        let mut es: Vec<PathBuf> = rd.filter_map(|e| e.ok().map(|e| e.path())).collect();
        es.sort();
        for p in es {
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|e| e == "md") && p.file_name().is_some_and(|n| n != "README.md") {
                out.push(std::fs::read(&p).expect("setup: corpus file"));
            }
        }
    }
    walk(&repo_root().join("tests/fixtures/format/roundtrip"), &mut out);
    out
}
const FOLDERS: [&str; 4] = ["Pages", "Quick Notes", "Projekty/Zahrada", "Tasks"];

/// A vault with `n` corpus notes and two media pairs; returns the live note paths and the pair objects.
fn vault(sb: &Sandbox, rng: &mut Rng, n: usize) -> (PathBuf, Vec<String>, Vec<String>) {
    let root = sb.base.join(format!("Vlastnost {}", rng.next() % 1_000_000));
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"), &[]);
    let docs = corpus();
    let mut notes = Vec::new();
    for i in 0..n {
        let rel = format!("{}/Poznámka {i} čšř.md", FOLDERS[rng.below(FOLDERS.len())]);
        write_raw(&root, &rel, &docs[rng.below(docs.len())]);
        notes.push(rel);
    }
    let png = std::fs::read(repo_root().join("tests/fixtures/vaults/trash-media/_attachments/záhon.png")).expect("setup: png");
    let mut objects = Vec::new();
    for (k, name) in ["obrázek jedna", "obrázek dva"].iter().enumerate() {
        write_raw(&root, &format!("_attachments/{name}.png"), &png);
        let obj = format!("Images/{name}.md");
        let bytes = format!("---\nid: 01JB6A00000000000000000P{k:02}\ntype: image\ntitle: {name}\nfile: \"[[{name}.png]]\"\nmedia-type: image/png\nsize: {}\nwidth: 64\nheight: 48\n---\n", png.len());
        write_raw(&root, &obj, bytes.as_bytes());
        objects.push(obj);
    }
    (root, notes, objects)
}

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-22

#[test]
fn fr_fmt_07_ac22_property_trash_and_restore_return_files_byte_identical() {
    let mut failures: Vec<String> = Vec::new();
    for seed in seeds() {
        println!("seed = {seed}");
        let mut rng = Rng::new(seed);
        let sb = sandbox();
        let (root, notes, objects) = vault(&sb, &mut rng, 6);
        let core = open(&root, &sb);
        let start = snap(&root);
        // Each live entry: (live path, Some(trashed row path) while in the trash).
        let mut items: Vec<(String, Option<String>)> = notes.iter().chain(objects.iter()).map(|p| (p.clone(), None)).collect();
        let ids: Vec<Option<(u64, i128)>> = items.iter().map(|(p, _)| ident(&root, p)).collect();
        for step in 0..steps() {
            let k = rng.below(items.len());
            let (live, trashed) = items[k].clone();
            match trashed {
                None => {
                    let base = version(&core, &live);
                    match core.trash_object(&live, &base) {
                        Ok(moved) => {
                            let is_pair = objects.contains(&live);
                            if moved.len() != if is_pair { 2 } else { 1 } {
                                failures.push(format!("seed {seed} step {step}: trash {live} moved {moved:?}"));
                            }
                            items[k].1 = moved.first().map(|m| nfc(&m.to));
                        }
                        Err(e) => failures.push(format!("seed {seed} step {step}: trash {live}: {e:?}")),
                    }
                }
                Some(row) => match core.trash_restore(&row) {
                    Ok(moved) => {
                        if moved.first().map(|m| nfc(&m.to)) != Some(nfc(&live)) {
                            failures.push(format!("seed {seed} step {step}: restore {row} → {moved:?}, want {live}"));
                        }
                        items[k].1 = None;
                    }
                    Err(e) => failures.push(format!("seed {seed} step {step}: restore {row}: {e:?}")),
                },
            }
            if failures.len() > 3 {
                break;
            }
        }
        for (k, (live, trashed)) in items.clone().into_iter().enumerate() {
            if let Some(row) = trashed {
                if let Err(e) = core.trash_restore(&row) {
                    failures.push(format!("seed {seed}: final restore {row}: {e:?}"));
                }
            }
            if ident(&root, &live) != ids[k] {
                failures.push(format!("seed {seed}: {live} isn't the same file after trash and restore (inode, mtime)"));
            }
        }
        let mut diff = changed(&start, &snap(&root));
        diff.retain(|p| !p.ends_with('/'));
        if !diff.is_empty() {
            failures.push(format!("seed {seed}: files differ after every restore: {diff:?}"));
        }
    }
    assert!(failures.is_empty(), "{} failures, first: {:?}", failures.len(), failures.iter().take(5).collect::<Vec<_>>());
}
