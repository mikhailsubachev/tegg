//! MS4 slice 4C property test (L2): docs/acceptance/rename.md FR-LNK-03 AC-19, rename sequences round-trip, through
//! the real `@tegg/doc` engine (`NodeTransformer`, D-82) and an in-memory `VaultFs` (`MemFs`, case-insensitive like
//! APFS). Interface: docs/contracts/ms4-jobs.md §2, §4, §7 and ms4-links §1 (one resolution rule, `resolve_links`).
//! Written from the AC and the contracts only (D-61).
//!
//! Seeds (TS-L2): a fixed seed plus one random seed per run (`QA_SEED` when set, else the clock); with
//! `QA_PROPERTY_SCALE` ≥ 100 (nightly) 10 seeds × 1,000 vaults. Every seed is printed (`seed = N`) so a failing vault
//! can be rebuilt; its minimized case becomes a fixture. Vaults are synthetic (Czech titles, D-50).
//!
//! Properties after each rename: (a) changed files ⊆ {renamed note} ∪ {files with a link resolving to it before};
//! (b) every link that resolved to the renamed note still resolves to it, no other link's resolution changes;
//! (c) no two notes share a stem case-insensitively after NFC in one folder; after undoing every rename in reverse:
//! (d) every file's path and bytes equal the original.

#[macro_use]
mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use common::*;
use tegg_core::{Core, LinkKind};
use tegg_format::{extract, nfc, sanitize_file_stem};
use tegg_jobs::{JobOp, Phase};
use tegg_vault::{FsEntry, MemFs, VaultFs};

const FIXED_SEED: u64 = 20_261_017;

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
    fn pick<'a, T>(&mut self, v: &'a [T]) -> &'a T {
        &v[self.below(v.len())]
    }
}

fn scale() -> u64 {
    std::env::var("QA_PROPERTY_SCALE").ok().and_then(|s| s.parse().ok()).unwrap_or(1)
}
fn random_seed() -> u64 {
    std::env::var("QA_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or_else(|| {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(7)
    })
}
fn seeds() -> Vec<u64> {
    let r = random_seed();
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
        3
    }
}

fn nfd(s: &str) -> String {
    s.chars()
        .flat_map(|c| match c {
            'á' => vec!['a', '\u{301}'],
            'é' => vec!['e', '\u{301}'],
            'í' => vec!['i', '\u{301}'],
            'ú' => vec!['u', '\u{301}'],
            'ů' => vec!['u', '\u{30A}'],
            'Č' => vec!['C', '\u{30C}'],
            'č' => vec!['c', '\u{30C}'],
            'Ř' => vec!['R', '\u{30C}'],
            'ř' => vec!['r', '\u{30C}'],
            'Š' => vec!['S', '\u{30C}'],
            'Ž' => vec!['Z', '\u{30C}'],
            'ž' => vec!['z', '\u{30C}'],
            other => vec![other],
        })
        .collect()
}

/// Titles with Czech diacritics (NFC and NFD), forbidden characters, case variants and duplicates.
fn title_pool() -> Vec<String> {
    let base = ["Alfa", "alfa", "ALFA", "Čaj o páté", "Řeka", "řeka", "Žluva", "Beta", "Q3: plán/rozpočet", "Šumava?", "Úvod #1", "Gama", "Kůň [velký]", "Delta|epsilon"];
    let mut v: Vec<String> = base.iter().map(|s| s.to_string()).collect();
    v.push(nfd("Čaj o páté"));
    v.push(nfd("Řeka"));
    v.push(nfd("Kůň [velký]"));
    v
}
const FOLDERS: [&str; 4] = ["Pages", "Projekty", "Knihy", "Poznámky"];

fn yaml_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}
fn enc(path: &str) -> String {
    path.replace('%', "%25").replace(' ', "%20")
}

struct Note {
    path: String,
    stem: String,
    folder: String,
}

/// A random vault: `.tegg/` of new-empty plus 5–60 notes in 1–4 folders.
fn gen_vault(rng: &mut Rng) -> BTreeMap<String, Vec<u8>> {
    let pool = title_pool();
    let folders: Vec<&str> = FOLDERS[..rng.range(1, 4)].to_vec();
    let n = rng.range(5, 60);
    let mut notes: Vec<(Note, String)> = Vec::new();
    let mut taken: BTreeSet<(String, String)> = BTreeSet::new();
    for i in 0..n {
        let folder = rng.pick(&folders).to_string();
        let title = if rng.chance(70) { rng.pick(&pool).clone() } else { format!("{} {i}", rng.pick(&pool)) };
        let base = sanitize_file_stem(&title);
        let mut stem = base.clone();
        let mut k = 2;
        while taken.contains(&(folder.clone(), nfc(&stem).to_lowercase())) {
            stem = format!("{base} ({k})");
            k += 1;
        }
        taken.insert((folder.clone(), nfc(&stem).to_lowercase()));
        notes.push((Note { path: format!("{folder}/{stem}.md"), stem, folder }, title));
    }
    let mut files = BTreeMap::new();
    for (i, (note, title)) in notes.iter().enumerate() {
        let crlf = rng.chance(20);
        let mut fm = vec![format!("id: 01JB4CP{:019}", i), "type: page".to_string(), format!("title: {}", yaml_quote(title))];
        let mut body: Vec<String> = Vec::new();
        for _ in 0..rng.range(0, 6) {
            let (t, _) = &notes[rng.below(notes.len())];
            let rel = if t.folder == note.folder { format!("{}.md", t.stem) } else { format!("../{}/{}.md", t.folder, t.stem) };
            let link = match rng.below(10) {
                0 => format!("[[{}]]", t.stem),
                1 => format!("[[{}|vlastní text]]", t.stem),
                2 => format!("[[{}#Nadpis]]", t.stem),
                3 => format!("[[{}#^b1]]", t.stem),
                4 => format!("![[{}]]", t.stem),
                5 => format!("[[{}/{}]]", t.folder, t.stem),
                6 => format!("[[{}.md]]", t.stem),
                7 => format!("[odkaz]({})", enc(&rel)),
                8 => format!("`[[{}]]` v kódu", t.stem),
                _ => {
                    fm.push(format!("souvisí: \"[[{}]]\"", t.stem));
                    continue;
                }
            };
            body.push(format!("Text s {link} uprostřed."));
        }
        if rng.chance(15) {
            body.push(format!("```\n[[{}]]\n```", note.stem));
        }
        // A key may be pushed twice; keep the first so the YAML stays valid.
        let mut seen = BTreeSet::new();
        fm.retain(|l| seen.insert(l.split(':').next().unwrap_or("").to_string()));
        let mut text = format!("---\n{}\n---\n{}", fm.join("\n"), body.join("\n\n"));
        if !rng.chance(20) {
            text.push('\n');
        }
        if crlf {
            text = text.replace('\n', "\r\n");
        }
        files.insert(note.path.clone(), text.into_bytes());
    }
    files
}

fn memfs(files: &BTreeMap<String, Vec<u8>>) -> Arc<MemFs> {
    let fs = Arc::new(MemFs::new());
    let fx = repo_root().join("tests/fixtures/vaults/new-empty/.tegg");
    for e in std::fs::read_dir(fx.join("types")).expect("setup: types").flatten() {
        let bytes = std::fs::read(e.path()).expect("setup: type file");
        fs.write_external(&format!(".tegg/types/{}", e.file_name().to_string_lossy()), &bytes).expect("setup");
    }
    fs.write_external(".tegg/vault.yml", &std::fs::read(fx.join("vault.yml")).expect("setup: vault.yml")).expect("setup");
    for (p, b) in files {
        fs.write_external(p, b).expect("setup: memfs write");
    }
    fs
}

/// Every note path → bytes, from the file system as it is now.
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

fn stem_of(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).trim_end_matches(".md").to_string()
}

/// For every note, its links' resolutions in file order: (kind, path).
fn resolutions(core: &Core, files: &BTreeMap<String, Vec<u8>>) -> BTreeMap<String, Vec<(LinkKind, Option<String>)>> {
    files
        .iter()
        .map(|(p, b)| {
            let targets: Vec<String> = extract(b, &stem_of(p)).links.into_iter().map(|l| l.target).collect();
            (p.clone(), core.resolve_links(p, &targets).into_iter().map(|t| (t.kind, t.path.map(|x| nfc(&x)))).collect())
        })
        .collect()
}

/// One vault: a random rename sequence, the properties after each step, then the full undo.
fn one_vault(seed: u64, rng: &mut Rng, problems: &mut Vec<String>) -> Result<(), String> {
    let files = gen_vault(rng);
    let fs = memfs(&files);
    let sb = sandbox();
    let core = open_core_with(fs.clone(), &sb.dirs)?;
    let original = notes_now(&fs);
    let pool = title_pool();
    let mut jobs = Vec::new();
    let mut history: BTreeMap<String, Vec<String>> = BTreeMap::new(); // current path → earlier titles
    for step in 0..rng.range(1, 8) {
        let before = notes_now(&fs);
        let paths: Vec<String> = before.keys().cloned().collect();
        let n = rng.pick(&paths).clone();
        let title = match rng.below(3) {
            0 => history.get(&n).and_then(|h| h.first().cloned()).unwrap_or_else(|| rng.pick(&pool).clone()),
            1 => extract(&before[rng.pick(&paths)], "x").title, // a colliding title
            _ => rng.pick(&pool).clone(),
        };
        let res_before = resolutions(&core, &before);
        let (job, report) = rename(&core, &n, &title).map_err(|e| format!("seed = {seed}, step {step}: {e}"))?;
        jobs.push(job);
        let after = notes_now(&fs);
        let new_path = report.renamed.as_ref().map(|(_, to)| nfc(to)).unwrap_or_else(|| n.clone());
        let ctx = format!("seed = {seed}, step {step}: rename {n} → {title:?} ({new_path})");
        if report.phase != Phase::Done || !report.skipped.is_empty() {
            problems.push(format!("{ctx}: report {report:?}"));
        }
        // (a)
        let linking: BTreeSet<String> = res_before.iter().filter(|(_, r)| r.iter().any(|(_, p)| p.as_deref() == Some(n.as_str()))).map(|(p, _)| p.clone()).collect();
        let keys: BTreeSet<&String> = before.keys().chain(after.keys()).collect();
        for k in keys {
            if before.get(k) != after.get(k) && *k != n && *k != new_path && !linking.contains(k) {
                problems.push(format!("{ctx}: (a) {k} changed without a link to the renamed note"));
            }
        }
        // (b)
        let res_after = resolutions(&core, &after);
        for (p, rb) in &res_before {
            let pa = if *p == n { new_path.clone() } else { p.clone() };
            let ra = res_after.get(&pa).cloned().unwrap_or_default();
            let want: Vec<(LinkKind, Option<String>)> = rb.iter().map(|(k, x)| (*k, x.as_ref().map(|x| if *x == n { new_path.clone() } else { x.clone() }))).collect();
            if ra != want {
                problems.push(format!("{ctx}: (b) links of {p} resolve to {ra:?}, expected {want:?}"));
            }
        }
        // (c)
        let mut stems = BTreeSet::new();
        for p in after.keys() {
            let (dir, file) = p.rsplit_once('/').unwrap_or(("", p));
            if !stems.insert((dir.to_string(), nfc(file).to_lowercase())) {
                problems.push(format!("{ctx}: (c) two notes share the stem of {p} in one folder"));
            }
        }
        let mut h = history.remove(&n).unwrap_or_default();
        h.insert(0, extract(&before[&n], &stem_of(&n)).title);
        history.insert(new_path, h);
        if problems.len() > 20 {
            return Ok(());
        }
    }
    for job in jobs.iter().rev() {
        let (_, r) = run_job(&core, JobOp::Undo { job: *job }).map_err(|e| format!("seed = {seed}: undo of job {job}: {e}"))?;
        if r.phase != Phase::Done || !r.skipped.is_empty() {
            problems.push(format!("seed = {seed}: undo of job {job}: {r:?}"));
        }
    }
    // (d)
    let end = notes_now(&fs);
    if end != original {
        let a: BTreeSet<&String> = original.keys().collect();
        let b: BTreeSet<&String> = end.keys().collect();
        let differ: Vec<&String> = a.union(&b).filter(|k| original.get(**k) != end.get(**k)).cloned().collect();
        problems.push(format!("seed = {seed}: (d) after the full undo these paths differ from the original: {differ:?}"));
    }
    Ok(())
}

#[test]
fn fr_lnk_03_ac19_rename_sequences_round_trip() {
    let mut problems = Vec::new();
    for seed in seeds() {
        println!("FR-LNK-03 AC-19 seed = {seed}");
        let mut rng = Rng::new(seed);
        for _ in 0..vaults_per_seed() {
            ok!(one_vault(seed, &mut rng, &mut problems), format!("seed = {seed}: a rename sequence"));
            if problems.len() > 20 {
                break;
            }
        }
    }
    assert_eq!(problems, Vec::<String>::new(), "rename sequences keep link resolution, touch only linking files and undo to the original bytes");
}
