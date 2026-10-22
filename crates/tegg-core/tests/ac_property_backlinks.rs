//! MS4 slice 4A property test (L2): FR-LNK-01 AC-8, the inverse of link resolution (T2). docs/acceptance/backlinks.md;
//! interface docs/contracts/ms4-links.md §1 (one resolution rule, re-resolution on add/remove/move/rename, the invariant
//! `backlinks(T) = { S ≠ T | S outside _templates/ and .trash/, some link of S resolves to T }`; 6A, D-632: a link that
//! resolves to a file paired with an Image/PDF object counts for that object, FR-ATT-07, ms6-trash-media §12.5). Written from the AC
//! and the contract only (D-61).
//!
//! Seeds (TS-L2): a fixed seed plus one random seed per run (`QA_SEED` when set, else the clock); with
//! `QA_PROPERTY_SCALE` ≥ 100 (nightly) 10 seeds × 1,000 steps. Every seed is printed (`seed = N`) so a failing vault
//! can be rebuilt; its minimized case becomes a fixture. Random vaults are synthetic (Czech stems, D-50); the
//! generated vault is gen-vault `--seed 1 --small-images` (read-only).

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use common::*;
use tegg_core::{Core, CoreOptions, LinkKind};
use tegg_format::nfc;

const FIXED_SEED: u64 = 20_261_015;

struct Rng(u64);
impl Rng {
    fn new(seed: u64) -> Rng {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    fn next(&mut self) -> u64 {
        // xorshift64*
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
fn steps() -> usize {
    if scale() >= 100 {
        1000
    } else {
        10
    }
}

fn nfd(s: &str) -> String {
    s.chars()
        .flat_map(|c| match c {
            'í' => vec!['i', '\u{301}'],
            'á' => vec!['a', '\u{301}'],
            'é' => vec!['e', '\u{301}'],
            'ý' => vec!['y', '\u{301}'],
            'ú' => vec!['u', '\u{301}'],
            'Č' => vec!['C', '\u{30C}'],
            'č' => vec!['c', '\u{30C}'],
            'ě' => vec!['e', '\u{30C}'],
            'ř' => vec!['r', '\u{30C}'],
            'š' => vec!['s', '\u{30C}'],
            'ů' => vec!['u', '\u{30A}'],
            c => vec![c],
        })
        .collect()
}
fn encode(s: &str) -> String {
    s.bytes().map(|b| if b.is_ascii_alphanumeric() || b == b'.' || b == b'-' { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

const STEMS: [&str; 10] = ["Cíl", "Dvojník", "Plán", "Čtení", "Jana Nováková", "Úkol", "Poznámka", "Rozpočet 2027", "Schůzka", "Výlet"];
const FOLDERS: [&str; 5] = ["Pages", "Quick Notes", "Kontakty", "Projekty/Alfa", ""];
const KONTAKT: &str = "# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.\nversion: 1\nname: Kontakt\nplural: Kontakty\nsystem: false\nfolder: Kontakty\nicon: user\ncolor: purple\nreview: false\npreview: []\nattributes:\n  - key: vztah\n    name: Vztah\n    type: relation\n    multiple: true\n";

/// One generated note: its text and the link targets as the UI passes them to `link_resolve` (wikilink target without
/// subpath and alias; a Markdown link's decoded path).
#[derive(Clone)]
struct Note {
    text: String,
    targets: Vec<String>,
}

fn join(folder: &str, stem: &str) -> String {
    if folder.is_empty() {
        format!("{stem}.md")
    } else {
        format!("{folder}/{stem}.md")
    }
}

/// A random link to one of `paths` (or to an alias-only / missing target): returns (Markdown, target for link_resolve).
fn random_link(rng: &mut Rng, paths: &[String]) -> (String, String) {
    if paths.is_empty() || rng.chance(8) {
        let t = format!("Alias {}", rng.below(5));
        return (format!("[[{t}]]"), t);
    }
    let p = rng.pick(paths).clone();
    let stem = Path::new(&p).file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
    let folderless = p.trim_end_matches(".md").to_string();
    match rng.below(9) {
        0 => (format!("[[{}]]", stem.to_lowercase()), stem.to_lowercase()),
        1 => (format!("[[{}]]", nfd(&stem)), nfd(&stem)),
        2 => (format!("[[{folderless}]]"), folderless),
        3 => (format!("[[{stem}|jiný popis]]"), stem),
        4 => (format!("[[{stem}#Nadpis]]"), stem),
        5 => (format!("![[{stem}]]"), stem),
        6 => (format!("[odkaz]({})", encode(&format!("{stem}.md"))), format!("{stem}.md")),
        _ => (format!("[[{stem}]]"), stem),
    }
}

fn random_note(rng: &mut Rng, i: usize, path: &str, paths: &[String]) -> Note {
    let stem = Path::new(path).file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
    let mut targets = Vec::new();
    let mut fm = String::new();
    let kontakt = path.starts_with("Kontakty/");
    if kontakt || rng.chance(80) {
        let ty = if kontakt { "kontakt" } else { *rng.pick(&["page", "quick-note"]) };
        fm.push_str(&format!("---\nid: 01JB4P{i:020}\ntype: {ty}\ntitle: {stem}\n"));
        if rng.chance(30) {
            fm.push_str(&format!("aliases: [Alias {}]\n", rng.below(5)));
        }
        if rng.chance(30) {
            let (md, t) = random_link(rng, paths);
            if md.starts_with("[[") {
                fm.push_str(&format!("description: \"Viz {md}\"\n"));
                targets.push(t);
            }
        }
        if kontakt && rng.chance(70) {
            fm.push_str("vztah:\n");
            for _ in 0..1 + rng.below(2) {
                let (md, t) = random_link(rng, paths);
                if md.starts_with("[[") {
                    fm.push_str(&format!("  - \"{md}\"\n"));
                    targets.push(t);
                }
            }
        }
        fm.push_str("modified: 2026-10-15T10:00:00+02:00\n---\n");
    }
    let mut body = String::new();
    for _ in 0..rng.below(4) {
        let (md, t) = random_link(rng, paths);
        body.push_str(&format!("Odstavec s odkazem {md} uprostřed.\n\n"));
        targets.push(t);
    }
    body.push_str("`[[Cíl]]` v kódu se nepočítá.\n");
    Note { text: format!("{fm}{body}"), targets }
}

struct Vault {
    root: PathBuf,
    notes: BTreeMap<String, Note>,
}

fn generate(sb: &Sandbox, seed: u64) -> Vault {
    let mut rng = Rng::new(seed);
    let root = sb.base.join(format!("Náhodný {seed}"));
    let fx = repo_root().join("tests/fixtures/vaults/new-empty");
    for (rel, bytes) in files_with_bytes(&fx) {
        write_raw(&root, &rel, &bytes);
    }
    write_raw(&root, ".tegg/types/kontakt.yml", KONTAKT.as_bytes());
    let n = 20 + rng.below(181);
    let mut paths: Vec<String> = vec!["Pages/Cíl.md".into()];
    while paths.len() < n {
        let stem = if rng.chance(60) { rng.pick(&STEMS).to_string() } else { format!("{} {}", rng.pick(&STEMS), paths.len()) };
        let p = join(rng.pick(&FOLDERS), &stem);
        if !paths.iter().any(|q| q.to_lowercase() == p.to_lowercase()) {
            paths.push(p);
        }
    }
    let mut notes = BTreeMap::new();
    for (i, p) in paths.iter().enumerate() {
        let mut note = random_note(&mut rng, i, p, &paths);
        if i == 1 {
            note.text.push_str("Jistý odkaz na [[Cíl]].\n");
            note.targets.push("Cíl".into());
        }
        notes.insert(p.clone(), note);
    }
    // Sources that never count: two templates and two trashed notes linking into the vault.
    for (k, p) in ["_templates/Page/Šablona.md", "_templates/Kontakt/Kontakt.md", ".trash/Pages/Smazaná.md", ".trash/Smazaná 2.md"].iter().enumerate() {
        let (md, t) = random_link(&mut rng, &paths);
        notes.insert(p.to_string(), Note { text: format!("---\ntitle: Ignorovaná {k}\n---\n{md} a [[Cíl]]\n"), targets: vec![t, "Cíl".into()] });
    }
    for (p, note) in &notes {
        write_raw(&root, p, note.text.as_bytes());
    }
    Vault { root, notes }
}

fn excluded(p: &str) -> bool {
    p.starts_with("_templates/") || p.starts_with(".trash/")
}

/// `{ S | some link of S resolves to T by link_resolve }` minus T itself, templates and `.trash/`.
/// 6A (FR-ATT-07, FR-ATT-01 AC-15; ms6-trash-media §3.2, §12.5; D-632): the live Image/PDF objects whose `file:`
/// resolves to each vault file (`Core::pair_of`).
fn media_owners(core: &Core) -> BTreeMap<String, BTreeSet<String>> {
    let mut out: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for o in core.objects().into_iter().filter(|o| o.r#type == "image" || o.r#type == "pdf") {
        if let Some(f) = core.pair_of(&o.path) {
            out.entry(nfc(&f)).or_default().insert(nfc(&o.path));
        }
    }
    out
}

fn expected(core: &Core, sources: &BTreeMap<String, Vec<String>>) -> BTreeMap<String, BTreeSet<String>> {
    let mut out: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let owners = media_owners(core);
    for (s, targets) in sources {
        if excluded(s) || targets.is_empty() {
            continue;
        }
        for t in core.resolve_links(s, targets) {
            match (t.kind, t.path) {
                (LinkKind::Note | LinkKind::Daily, Some(p)) => {
                    let p = nfc(&p);
                    if &p != s {
                        out.entry(p).or_default().insert(s.clone());
                    }
                }
                // FR-ATT-07 (D-632): a link naming a file paired with an Image/PDF object's `file:` is a backlink of
                // that object (every object pairing the file).
                (LinkKind::Media, Some(f)) => {
                    for o in owners.get(&nfc(&f)).into_iter().flatten() {
                        if o != s {
                            out.entry(o.clone()).or_default().insert(s.clone());
                        }
                    }
                }
                _ => {}
            }
        }
    }
    out
}

fn panel_sources(core: &Core, t: &str) -> BTreeSet<String> {
    core.backlinks_panel(t).groups.iter().flat_map(|g| g.entries.iter().map(|e| nfc(&e.source))).collect()
}

/// Mismatches between the panel command (and `Core::backlinks`) and the inverse of link_resolve, for every note
/// (or for the notes in `only`).
fn mismatches_for(core: &Core, want: &BTreeMap<String, BTreeSet<String>>, only: Option<&BTreeSet<String>>) -> Vec<String> {
    let mut bad = Vec::new();
    for o in core.objects() {
        let t = nfc(&o.path);
        if only.map(|s| !s.contains(&t)).unwrap_or(false) {
            continue;
        }
        let w = want.get(&t).cloned().unwrap_or_default();
        let panel = panel_sources(core, &t);
        if panel != w {
            bad.push(format!("{t}: panel {panel:?}, want {w:?}"));
        }
        let bl: BTreeSet<String> = core.backlinks(&t).into_iter().map(|p| nfc(&p)).collect();
        if bl != w {
            bad.push(format!("{t}: Core::backlinks {bl:?}, want {w:?}"));
        }
    }
    bad
}
fn mismatches(core: &Core, sources: &BTreeMap<String, Vec<String>>) -> Vec<String> {
    mismatches_for(core, &expected(core, sources), None)
}
fn report(seed: u64, step: &str, bad: &[String]) -> String {
    format!("seed = {seed}, {step}: {} mismatch(es), first: \n{}", bad.len(), bad.iter().take(10).cloned().collect::<Vec<_>>().join("\n"))
}
fn targets_of(v: &Vault) -> BTreeMap<String, Vec<String>> {
    v.notes.iter().map(|(p, n)| (nfc(p), n.targets.clone())).collect()
}

#[test]
fn fr_lnk_01_ac8_property_inverse_on_random_vaults_and_external_changes() {
    for seed in seeds() {
        println!("fr_lnk_01_ac8 seed = {seed}");
        let sb = sandbox();
        let mut v = generate(&sb, seed);
        let core = match Core::open(&v.root, &sb.dirs, CoreOptions { watch: true, sync: None }) {
            Ok(c) => c,
            Err(e) => {
                assert!(false, "Core::open: {e:?}");
                unreachable!()
            }
        };
        assert!(core.wait_idle(Duration::from_secs(60)), "indexing idle");
        let initial = targets_of(&v);
        assert!(expected(&core, &initial).values().map(|s| s.len()).sum::<usize>() > 0, "seed = {seed}: the vault has resolving links");
        let bad = mismatches(&core, &initial);
        assert!(bad.is_empty(), "{}", report(seed, "initial vault", &bad));

        let mut rng = Rng::new(seed ^ 0xA5A5);
        for step in 0..steps() {
            let live: Vec<String> = v.notes.keys().filter(|p| !excluded(p)).cloned().collect();
            let what = match rng.below(4) {
                0 => {
                    // Create a new file.
                    let p = join(rng.pick(&FOLDERS), &format!("{} nový {step}", rng.pick(&STEMS)));
                    let note = random_note(&mut rng, 10_000 + step, &p, &live);
                    write_raw(&v.root, &p, note.text.as_bytes());
                    v.notes.insert(p.clone(), note);
                    format!("create {p}")
                }
                1 if live.len() > 2 => {
                    // Delete a file.
                    let p = rng.pick(&live[1..]).clone();
                    std::fs::remove_file(v.root.join(&p)).unwrap_or(());
                    v.notes.remove(&p);
                    format!("delete {p}")
                }
                2 if live.len() > 2 => {
                    // Move a file to another folder, keeping its stem.
                    let p = rng.pick(&live).clone();
                    let stem = Path::new(&p).file_stem().and_then(|s| s.to_str()).unwrap_or("x").to_string();
                    let to = join(rng.pick(&FOLDERS), &stem);
                    if v.notes.keys().any(|q| q.to_lowercase() == to.to_lowercase()) {
                        continue;
                    }
                    std::fs::create_dir_all(v.root.join(&to).parent().unwrap_or(&v.root)).unwrap_or(());
                    std::fs::rename(v.root.join(&p), v.root.join(&to)).unwrap_or(());
                    if let Some(n) = v.notes.remove(&p) {
                        v.notes.insert(to.clone(), n);
                    }
                    format!("move {p} → {to}")
                }
                _ => {
                    // Rename a file (new stem, same folder), possibly to a stem that other files share.
                    let p = rng.pick(&live).clone();
                    let folder = Path::new(&p).parent().and_then(|f| f.to_str()).unwrap_or("").to_string();
                    let to = join(&folder, rng.pick(&STEMS));
                    if v.notes.keys().any(|q| q.to_lowercase() == to.to_lowercase()) {
                        continue;
                    }
                    std::fs::rename(v.root.join(&p), v.root.join(&to)).unwrap_or(());
                    if let Some(n) = v.notes.remove(&p) {
                        v.notes.insert(to.clone(), n);
                    }
                    format!("rename {p} → {to}")
                }
            };
            let now = targets_of(&v);
            let ok = wait_until(Duration::from_secs(5), || mismatches(&core, &now).is_empty());
            if ok.is_none() {
                let bad = mismatches(&core, &now);
                assert!(bad.is_empty(), "{}", report(seed, &format!("after step {step} ({what})"), &bad));
            }
        }
    }
}

#[test]
fn fr_lnk_01_ac8_property_inverse_on_the_generated_vault() {
    let vault = reference_vault();
    let sb = sandbox();
    let core = match Core::open(&vault, &sb.dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => {
            assert!(false, "Core::open: {e:?}");
            unreachable!()
        }
    };
    assert!(core.wait_idle(Duration::from_secs(600)), "indexing idle");
    // Link targets as the UI sends them, from the real extractor (body wikilinks and scanned property values).
    let mut all: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for p in indexable_notes(&vault) {
        let stem = Path::new(&p).file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let x = tegg_format::extract(&std::fs::read(vault.join(&p)).unwrap_or_default(), &stem);
        all.insert(nfc(&p), x.links.iter().map(|l| l.target.clone()).filter(|t| !t.is_empty()).collect());
    }
    // Every note at nightly scale; else a seeded sample of 40 notes. Only sources with a link whose last segment
    // (folded, without `.md`) is a sampled note's stem or id, or a date, can resolve to a sampled note (§1 rules),
    // so only those are resolved (link_resolve is one call per source).
    let objs = core.objects();
    let mut rng = Rng::new(random_seed());
    let only: BTreeSet<String> = if scale() >= 100 {
        objs.iter().map(|o| nfc(&o.path)).collect()
    } else {
        (0..40).map(|_| nfc(&rng.pick(&objs).path)).collect()
    };
    let key = |t: &str| {
        let t = nfc(t).to_lowercase();
        let t = t.split(['#', '|']).next().unwrap_or("").trim().to_string();
        let t = t.trim_end_matches(".md").to_string();
        t.rsplit('/').next().unwrap_or("").to_string()
    };
    let mut keys: BTreeSet<String> = BTreeSet::new();
    for o in objs.iter().filter(|o| only.contains(&nfc(&o.path))) {
        keys.insert(key(Path::new(&o.path).file_stem().and_then(|s| s.to_str()).unwrap_or("")));
        if let Some(id) = &o.id {
            keys.insert(nfc(id).to_lowercase());
        }
        // FR-ATT-07 (D-632): a sampled Image/PDF object's backlinks include the sources that name its file.
        if let Some(f) = core.pair_of(&o.path) {
            keys.insert(key(&f));
        }
    }
    // A date link's key is the date, which is its Daily Note's stem, so the stem keys cover dates too.
    let sources: BTreeMap<String, Vec<String>> = all.into_iter().filter(|(_, ts)| ts.iter().any(|t| keys.contains(&key(t)))).collect();
    println!("fr_lnk_01_ac8 generated vault: {} sampled notes, {} candidate sources", only.len(), sources.len());
    let want = expected(&core, &sources);
    assert!(want.values().map(|s| s.len()).sum::<usize>() > 0, "the generated vault has resolving links");
    let bad = mismatches_for(&core, &want, Some(&only));
    assert!(bad.is_empty(), "{}", report(1, "generated vault (gen-vault --seed 1)", &bad));
}
