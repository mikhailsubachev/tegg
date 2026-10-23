//! MS4 slice 4D-lite property tests (L2) of the tag jobs end to end, through the real `@tegg/doc` engine
//! (`NodeTransformer`, D-82) and an in-memory `VaultFs` (`MemFs`): docs/acceptance/tags.md FR-TAG-04 AC-11 (a) the
//! changed files ⊆ files with an occurrence of K plus K's Tag file (and links to it, D-714), (c) the tag query
//! afterwards has K′ with K's old count and no K, (d) renaming back returns every file to its original bytes (except
//! the Tag file's `modified`) when K had a single spelling; FR-TAG-08 AC-6 (removal changes only the files with an
//! occurrence and moves K's Tag file; afterwards no file has an occurrence of K; every other tag's count is unchanged);
//! FR-FMT-07 AC-23 (rename and reverse rename are byte-identical except `modified`). The text-level properties (b) are
//! in packages/doc/test/tag_ops.property.ac.test.ts. Interface: docs/contracts/ms4-tags.md §1, §4.
//!
//! Seeds (TS-L2): a fixed seed plus one random seed per run (`QA_SEED` when set, else the clock); with
//! `QA_PROPERTY_SCALE` ≥ 100 (nightly) 10 seeds × 1,000 vaults. Every seed is printed (`seed = N`). Vaults are synthetic
//! (Czech tags in NFC and NFD, D-50). Written from the ACs and the contracts only (D-61).

#[macro_use]
mod common;
mod tags_setup;

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use common::{open_core_with, repo_root, sandbox};
use tags_setup::{nfd, run_confirmed};
use tegg_format::nfc;
use tegg_jobs::{JobOp, Phase};
use tegg_vault::{FsEntry, MemFs, VaultFs};

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
        (self.next() % n.max(1) as u64) as usize
    }
    fn range(&mut self, lo: usize, hi: usize) -> usize {
        lo + self.below(hi - lo + 1)
    }
    fn chance(&mut self, pct: u64) -> bool {
        self.next() % 100 < pct
    }
}
fn scale() -> u64 {
    std::env::var("QA_PROPERTY_SCALE").ok().and_then(|s| s.parse().ok()).unwrap_or(1)
}
fn seeds() -> Vec<u64> {
    let r = std::env::var("QA_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or_else(|| {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(7)
    });
    if scale() >= 100 {
        (0..10).map(|i| if i == 0 { FIXED_SEED } else { r.wrapping_add(i) }).collect()
    } else {
        vec![FIXED_SEED, r]
    }
}
fn vaults_per_seed() -> usize {
    if scale() >= 100 {
        1000
    } else {
        2
    }
}

/// A random vault of 5–40 notes: K = `účty` in one or many spellings, other tags, near misses, a Tag file for K.
fn gen_vault(rng: &mut Rng, single: bool) -> BTreeMap<String, Vec<u8>> {
    let spellings = ["účty".to_string(), "Účty".to_string(), "ÚČTY".to_string(), nfd("účty"), nfd("Účty")];
    let one = spellings[rng.below(spellings.len())].clone();
    let k = |rng: &mut Rng| if single { one.clone() } else { spellings[rng.below(spellings.len())].clone() };
    let others = ["finance", "x-y", "x/y", "účty-2026", "účty/archiv", "čtení"];
    let mut files = BTreeMap::new();
    let n = rng.range(5, 40);
    for i in 0..n {
        let mut fm = vec![format!("id: 01JB4DP{i:019}"), "type: page".into(), format!("title: Poznámka {i}")];
        let list: Vec<String> = (0..rng.range(0, 3)).map(|_| if rng.chance(50) { k(rng) } else { others[rng.below(4)].to_string() }).collect();
        if !list.is_empty() {
            if rng.chance(50) {
                fm.push(format!("tags: [{}]", list.join(", ")));
            } else {
                fm.push(format!("tags:\n{}", list.iter().map(|t| format!("  - {t}")).collect::<Vec<_>>().join("\n")));
            }
        }
        fm.push("modified: 2026-10-01T09:00:00+02:00".into());
        let mut body = Vec::new();
        for _ in 0..rng.range(0, 5) {
            body.push(match rng.below(8) {
                0 => format!("Text #{} uprostřed.", k(rng)),
                1 => format!("#{}", k(rng)),
                2 => format!("Kód `#{}` a $#{}$ a [#{}](Cíl.md).", k(rng), k(rng), k(rng)),
                3 => format!("Adresa <https://site.cz/#{}> a [[Cíl#{}]].", k(rng), k(rng)),
                4 => format!("Jiný #{} štítek.", others[rng.below(others.len())]),
                5 => "```\n#účty\n```".to_string(),
                _ => "Obyčejný odstavec.".to_string(),
            });
        }
        let mut text = format!("---\n{}\n---\n{}", fm.join("\n"), body.join("\n\n"));
        if rng.chance(80) {
            text.push('\n');
        }
        if rng.chance(20) {
            text = text.replace('\n', "\r\n");
        }
        files.insert(format!("Pages/Poznámka {i:02}.md"), text.into_bytes());
    }
    // K's Tag file, titled with K's one NFC spelling in a single-spelling vault (so the reverse rename restores it).
    let title = if single { nfc(&one) } else { "Účty".to_string() };
    files.insert(format!("Tags/{title}.md"), format!("---\nid: 01JB4DP0000000000000000099\ntype: tag\ntitle: {title}\ncolor: blue\ncreated: 2026-09-01T09:00:00+02:00\nmodified: 2026-09-01T09:00:00+02:00\n---\n").into_bytes());
    // Always one occurrence of K.
    files.insert("Pages/Jistá.md".into(), format!("---\nid: 01JB4DP0000000000000000098\ntype: page\ntitle: Jistá\n---\nJistý #{}.\n", k(rng)).into_bytes());
    files
}
fn memfs(files: &BTreeMap<String, Vec<u8>>) -> Arc<MemFs> {
    let fs = Arc::new(MemFs::new());
    let fx = repo_root().join("tests/fixtures/vaults/new-empty/.tegg");
    for e in std::fs::read_dir(fx.join("types")).expect("setup: types").flatten() {
        fs.write_external(&format!(".tegg/types/{}", e.file_name().to_string_lossy()), &std::fs::read(e.path()).expect("setup")).expect("setup");
    }
    fs.write_external(".tegg/vault.yml", &std::fs::read(fx.join("vault.yml")).expect("setup")).expect("setup");
    for (p, b) in files {
        fs.write_external(p, b).expect("setup: memfs write");
    }
    fs
}
fn notes_now(fs: &MemFs) -> BTreeMap<String, Vec<u8>> {
    let mut out = BTreeMap::new();
    for e in fs.list().unwrap_or_default() {
        if let FsEntry::File { path } = e {
            if path.ends_with(".md") {
                if let Ok((b, _)) = fs.read(&path) {
                    out.insert(nfc(&path), b);
                }
            }
        }
    }
    out
}
fn has_k(b: &[u8], key: &str) -> bool {
    tegg_format::extract(b, "x").tags.iter().any(|t| t == key)
}
fn counts(core: &tegg_core::Core) -> BTreeMap<String, usize> {
    core.tag_rows().into_iter().map(|r| (r.key, r.count)).collect()
}
fn no_modified(b: &[u8]) -> String {
    String::from_utf8_lossy(b).lines().filter(|l| !l.starts_with("modified:")).collect::<Vec<_>>().join("\n")
}

fn one_rename(seed: u64, rng: &mut Rng, problems: &mut Vec<String>) -> Result<(), String> {
    let single = rng.chance(60);
    let files = gen_vault(rng, single);
    let fs = memfs(&files);
    let sb = sandbox();
    let core = open_core_with(fs.clone(), &sb.dirs)?;
    let before = notes_now(&fs);
    let c0 = counts(&core);
    let (_, r) = run_confirmed(&core, JobOp::TagRename { from: "účty".into(), to: "Výdaje".into() }).map_err(|e| format!("seed = {seed}: {e}"))?;
    if r.phase != Phase::Done || !r.skipped.is_empty() {
        problems.push(format!("seed = {seed}: report {r:?}"));
    }
    let after = notes_now(&fs);
    // (a)
    let allowed: BTreeSet<String> = before.iter().filter(|(p, b)| has_k(b, "účty") || p.starts_with("Tags/")).map(|(p, _)| p.clone()).chain(["Tags/Výdaje.md".to_string()]).collect();
    for k in before.keys().chain(after.keys()) {
        if before.get(k) != after.get(k) && !allowed.contains(k) {
            problems.push(format!("seed = {seed}: (a) {k} changed without an occurrence of K"));
        }
    }
    // (c)
    let c1 = counts(&core);
    if c1.get("výdaje") != c0.get("účty") || c1.contains_key("účty") || c0.get("účty").is_none() {
        problems.push(format!("seed = {seed}: (c) counts {c0:?} → {c1:?}"));
    }
    // (d) and FR-FMT-07 AC-23
    if single {
        let tag_file = before.keys().find(|p| p.starts_with("Tags/")).cloned().unwrap_or_default();
        let spelling = tag_file.trim_start_matches("Tags/").trim_end_matches(".md").to_string();
        let (_, back) = run_confirmed(&core, JobOp::TagRename { from: "výdaje".into(), to: spelling.clone() }).map_err(|e| format!("seed = {seed}: back to {spelling}: {e}"))?;
        if back.phase != Phase::Done {
            problems.push(format!("seed = {seed}: (d) the reverse rename: {back:?}"));
        }
        let end = notes_now(&fs);
        for (p, b) in &before {
            let e = end.get(p).cloned().unwrap_or_default();
            let want = String::from_utf8_lossy(b).into_owned();
            let same = if p.starts_with("Tags/") { no_modified(&e) == no_modified(b) } else { nfc(&String::from_utf8_lossy(&e)) == nfc(&want) };
            if !same {
                problems.push(format!("seed = {seed}: (d) {p} differs after the reverse rename"));
            }
        }
    }
    Ok(())
}

fn one_delete(seed: u64, rng: &mut Rng, problems: &mut Vec<String>) -> Result<(), String> {
    let files = gen_vault(rng, false);
    let fs = memfs(&files);
    let sb = sandbox();
    let core = open_core_with(fs.clone(), &sb.dirs)?;
    let before = notes_now(&fs);
    let c0 = counts(&core);
    let (_, r) = run_confirmed(&core, JobOp::TagDelete { tag: "účty".into(), keep_text: false }).map_err(|e| format!("seed = {seed}: {e}"))?;
    if r.phase != Phase::Done || !r.skipped.is_empty() {
        problems.push(format!("seed = {seed}: report {r:?}"));
    }
    let after = notes_now(&fs);
    let allowed: BTreeSet<String> = before.iter().filter(|(_, b)| has_k(b, "účty")).map(|(p, _)| p.clone()).chain(["Tags/Účty.md".to_string(), ".trash/Tags/Účty.md".to_string()]).collect();
    for k in before.keys().chain(after.keys()) {
        if before.get(k) != after.get(k) && !allowed.contains(k) {
            problems.push(format!("seed = {seed}: {k} changed without an occurrence of K"));
        }
    }
    if after.get(".trash/Tags/Účty.md") != before.get("Tags/Účty.md") {
        problems.push(format!("seed = {seed}: K's Tag file isn't moved to .trash/ unchanged"));
    }
    for (p, b) in &after {
        if !p.starts_with(".trash/") && has_k(b, "účty") {
            problems.push(format!("seed = {seed}: {p} still has an occurrence of K"));
        }
    }
    let mut c1 = counts(&core);
    let mut c0 = c0;
    if c0.remove("účty").is_none() {
        problems.push(format!("seed = {seed}: K wasn't a tag before"));
    }
    c1.remove("účty");
    if c1 != c0 {
        problems.push(format!("seed = {seed}: other counts changed {c0:?} → {c1:?}"));
    }
    Ok(())
}

#[test]
fn fr_tag_04_ac11_rename_is_local_and_reversible_on_random_vaults() {
    let mut problems = Vec::new();
    for seed in seeds() {
        println!("seed = {seed}");
        let mut rng = Rng::new(seed);
        for _ in 0..vaults_per_seed() {
            let r = one_rename(seed, &mut rng, &mut problems);
            assert!(r.is_ok(), "{r:?}");
        }
    }
    assert_eq!(problems, Vec::<String>::new(), "FR-TAG-04 AC-11 (a), (c), (d)");
}

#[test]
fn fr_tag_08_ac6_removal_is_local_on_random_vaults() {
    let mut problems = Vec::new();
    for seed in seeds() {
        println!("seed = {seed}");
        let mut rng = Rng::new(seed ^ 0x5EED);
        for _ in 0..vaults_per_seed() {
            let r = one_delete(seed, &mut rng, &mut problems);
            assert!(r.is_ok(), "{r:?}");
        }
    }
    assert_eq!(problems, Vec::<String>::new(), "FR-TAG-08 AC-6");
}
