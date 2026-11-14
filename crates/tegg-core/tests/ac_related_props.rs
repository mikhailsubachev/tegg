//! Slice REL L2 property test of the incremental index (docs/acceptance/related.md FR-LNK-15 AC-8; TS-L2's index
//! property; docs/contracts/v1-related.md §1.5, §1.8): random sequences of external changes, made on disk while the core
//! watches the vault (create, edit, rename, delete, NFD rewrite, diacritics removed, into `.trash/` and out, `type`
//! changed between page, tag and image, a link added or removed), then, once the index is idle, `index_related` for every
//! object (linked hidden and shown) equals the answer of a core freshly built on the same files. Random vaults of 20…200
//! notes from the golden list's words (tests/fixtures/format/stem/cs.tsv); nightly (`QA_PROPERTY_SCALE` ≥ 100) also
//! the generated reference vault, checked on the changed objects and 100 more chosen by the seed.
//!
//! Seeds (TS-L2): a fixed seed plus one random seed per run (`QA_SEED` when set, else the clock); nightly 10 seeds × 1,000
//! steps. Every seed is printed (`seed = N`). Written from the ACs and the contract only (D-61); every check is an
//! assertion in this file (tools/qa CONTRACT §5.2).

mod common;
mod related_setup;

use std::path::Path;
use std::time::Duration;

use common::{fresh_dirs, reference_vault_copy, sandbox, write_raw};
use related_setup::{nfc, nfd, open};
use tegg_core::Core;

const FIXED_SEED: u64 = 20_261_114;

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
fn steps() -> usize {
    if scale() >= 100 {
        1000
    } else {
        10
    }
}

fn golden_words() -> Vec<String> {
    let p = related_setup::fixture_dir().join("../../format/stem/cs.tsv");
    let text = std::fs::read_to_string(p).expect("setup: cs.tsv");
    text.lines().skip(1).filter_map(|l| l.split('\t').next()).map(str::to_string).collect()
}
fn strip(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'á' => 'a', 'é' | 'ě' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' | 'ů' => 'u', 'ý' => 'y', 'č' => 'c', 'ď' => 'd', 'ň' => 'n', 'ř' => 'r',
            'š' => 's', 'ť' => 't', 'ž' => 'z', 'Č' => 'C', 'Ř' => 'R', 'Š' => 'S', 'Ž' => 'Z', 'Ú' => 'U', 'Á' => 'A', 'Í' => 'I', 'É' => 'E',
            x => x,
        })
        .collect()
}

/// The objects of a vault on disk: `.md` outside dot-folders and `_templates/`, NFC.
fn objects_of(root: &Path) -> Vec<String> {
    let mut out: Vec<String> = related_setup::files(root)
        .into_iter()
        .map(|(r, _)| nfc(&r))
        .filter(|r| r.ends_with(".md") && !r.split('/').any(|c| c.starts_with('.')) && !r.starts_with("_templates/"))
        .collect();
    out.sort();
    out
}

fn answer(core: &Core, p: &str) -> String {
    let mut parts = Vec::new();
    for shown in [false, true] {
        parts.push(match core.related(p, shown) {
            Ok(l) => format!(
                "{shown} {:?} {}",
                l.reason,
                l.entries
                    .iter()
                    .map(|e| format!("{}|{}|{}|{:?}|{:?}|{:?}|{:?}|{}|{:?}|{:.9}|{}", nfc(&e.path), e.title, e.r#type, e.review, e.status, e.due, e.completed, e.linked, e.excerpt, e.score, e.shared))
                    .collect::<Vec<_>>()
                    .join(" ; ")
            ),
            Err(e) => format!("{shown} error {e:?}"),
        });
    }
    parts.join(" || ")
}

struct Gen {
    words: Vec<String>,
    next_id: usize,
}
impl Gen {
    fn note(&mut self, r: &mut Rng, title: &str, ty: &str, links: &[String]) -> String {
        self.next_id += 1;
        let n = 8 + r.below(30);
        let body: Vec<String> = (0..n).map(|_| self.words[r.below(self.words.len())].clone()).collect();
        let l: String = links.iter().map(|t| format!(" [[{t}]]")).collect();
        format!("---\ntype: {ty}\ntitle: {title}\n---\n{}.{l}\n", body.join(" "))
    }
}
fn title_of(rel: &str) -> String {
    rel.rsplit('/').next().unwrap_or(rel).trim_end_matches(".md").to_string()
}

/// One random external change; returns the paths it touched.
fn step(root: &Path, g: &mut Gen, r: &mut Rng) -> Vec<String> {
    let objs = objects_of(root);
    let pick = |r: &mut Rng| objs[r.below(objs.len())].clone();
    match r.below(10) {
        0 => {
            let t = format!("Nová {} {}", g.words[r.below(g.words.len())], g.next_id);
            let rel = format!("Pages/{t}.md");
            let text = g.note(r, &t, "page", &[]);
            write_raw(root, &rel, text.as_bytes());
            vec![rel]
        }
        1 if !objs.is_empty() => {
            let p = pick(r);
            let t = title_of(&p);
            let text = g.note(r, &t, "page", &[]);
            write_raw(root, &p, text.as_bytes());
            vec![p]
        }
        2 if !objs.is_empty() => {
            let p = pick(r);
            let to = format!("Pages/Přejmenovaná {}.md", g.next_id);
            g.next_id += 1;
            let _ = std::fs::rename(root.join(&p), root.join(&to));
            vec![p, to]
        }
        3 if objs.len() > 20 => {
            let p = pick(r);
            let _ = std::fs::remove_file(root.join(&p));
            vec![p]
        }
        4 if !objs.is_empty() => {
            let p = pick(r);
            let text = std::fs::read_to_string(root.join(&p)).unwrap_or_default();
            write_raw(root, &p, nfd(&text).as_bytes());
            vec![p]
        }
        5 if !objs.is_empty() => {
            let p = pick(r);
            let text = std::fs::read_to_string(root.join(&p)).unwrap_or_default();
            let fm_end = tegg_format::body_start(&text);
            let out = format!("{}{}", &text[..fm_end], strip(&text[fm_end..]));
            write_raw(root, &p, out.as_bytes());
            vec![p]
        }
        6 if !objs.is_empty() => {
            let p = pick(r);
            let to = format!(".trash/{p}");
            if let Some(d) = root.join(&to).parent() {
                let _ = std::fs::create_dir_all(d);
            }
            let _ = std::fs::rename(root.join(&p), root.join(&to));
            vec![p]
        }
        7 => {
            let trashed: Vec<String> = related_setup::files(&root.join(".trash")).into_iter().map(|(r, _)| r).filter(|r| r.ends_with(".md")).collect();
            if trashed.is_empty() {
                return Vec::new();
            }
            let t = trashed[r.below(trashed.len())].clone();
            if root.join(&t).exists() {
                return Vec::new();
            }
            let _ = std::fs::rename(root.join(".trash").join(&t), root.join(&t));
            vec![t]
        }
        8 if !objs.is_empty() => {
            let p = pick(r);
            let ty = ["page", "tag", "image"][r.below(3)];
            let text = std::fs::read_to_string(root.join(&p)).unwrap_or_default();
            let re = regex_lite(&text, ty);
            write_raw(root, &p, re.as_bytes());
            vec![p]
        }
        _ if objs.len() >= 2 => {
            let a = pick(r);
            let b = pick(r);
            let text = std::fs::read_to_string(root.join(&a)).unwrap_or_default();
            let link = format!("[[{}]]", title_of(&b));
            let out = if text.contains(&link) { text.replace(&link, "") } else { format!("{}\n{link}\n", text.trim_end()) };
            write_raw(root, &a, out.as_bytes());
            vec![a]
        }
        _ => Vec::new(),
    }
}
/// Sets the `type:` line of a note (adds one when missing).
fn regex_lite(text: &str, ty: &str) -> String {
    let mut lines: Vec<String> = text.lines().map(str::to_string).collect();
    if let Some(i) = lines.iter().position(|l| l.starts_with("type: ")) {
        lines[i] = format!("type: {ty}");
        format!("{}\n", lines.join("\n"))
    } else {
        format!("---\ntype: {ty}\n---\n{text}")
    }
}

fn random_vault(root: &Path, g: &mut Gen, r: &mut Rng) {
    std::fs::create_dir_all(root.join(".tegg")).expect("setup: .tegg");
    related_setup::copy_dir(&related_setup::fixture_dir().join("../new-empty/.tegg"), &root.join(".tegg"), &[]);
    let n = 20 + r.below(181);
    let titles: Vec<String> = (0..n).map(|i| format!("Poznámka {} {i:03}", g.words[r.below(g.words.len())])).collect();
    for t in &titles {
        let links: Vec<String> = if r.below(4) == 0 { vec![titles[r.below(titles.len())].clone()] } else { vec![] };
        let text = g.note(r, t, "page", &links);
        write_raw(root, &format!("Pages/{t}.md"), text.as_bytes());
    }
}

fn compare(core: &Core, root: &Path, sb: &common::Sandbox, name: &str, only: Option<&[String]>) -> Vec<String> {
    std::thread::sleep(Duration::from_millis(1500));
    if !core.wait_idle(Duration::from_secs(60)) {
        return vec![format!("{name}: the watched core did not become idle")];
    }
    let fresh = open(root, &fresh_dirs(sb, name), false);
    let objs = objects_of(root);
    let check: Vec<String> = match only {
        Some(o) => o.iter().filter(|p| objs.contains(p)).cloned().collect(),
        None => objs,
    };
    let mut bad = Vec::new();
    let mut lists = 0usize;
    for p in &check {
        let (a, b) = (answer(core, p), answer(&fresh, p));
        if a.contains(" error ") {
            bad.push(format!("{name}: {p}: index_related failed: {a}"));
        }
        if core.related(p, true).map(|l| !l.entries.is_empty()).unwrap_or(false) {
            lists += 1;
        }
        if a != b {
            bad.push(format!("{name}: {p}: incremental {a} ≠ rebuilt {b}"));
        }
        if bad.len() > 3 {
            break;
        }
    }
    if lists == 0 && !check.is_empty() {
        bad.push(format!("{name}: no object has a list (the property would be vacuous)"));
    }
    bad
}

#[test]
fn fr_lnk_15_ac8_property_incremental_equals_rebuilt() {
    let words = golden_words();
    let mut bad = Vec::new();
    for seed in seeds() {
        println!("seed = {seed}");
        let mut r = Rng::new(seed);
        let mut g = Gen { words: words.clone(), next_id: 0 };
        let sb = sandbox();
        let root = sb.base.join("Náhodný");
        random_vault(&root, &mut g, &mut r);
        let core = open(&root, &sb.dirs, true);
        for i in 0..steps() {
            let _ = step(&root, &mut g, &mut r);
            if i % 10 == 9 || i + 1 == steps() {
                bad.extend(compare(&core, &root, &sb, &format!("seed {seed} step {i}"), None));
            }
            if !bad.is_empty() {
                break;
            }
        }
        if !bad.is_empty() {
            break;
        }
    }
    if bad.is_empty() && scale() >= 100 {
        let sb = sandbox();
        let root = reference_vault_copy(&sb);
        let core = open(&root, &sb.dirs, true);
        let mut r = Rng::new(FIXED_SEED);
        let mut g = Gen { words: words.clone(), next_id: 0 };
        let mut touched = Vec::new();
        for _ in 0..50 {
            touched.extend(step(&root, &mut g, &mut r).into_iter().map(|p| nfc(&p)));
        }
        let objs = objects_of(&root);
        for _ in 0..100 {
            touched.push(objs[r.below(objs.len())].clone());
        }
        bad.extend(compare(&core, &root, &sb, "generated vault", Some(&touched)));
    }
    assert_eq!(bad, Vec::<String>::new(), "index_related after watched changes equals the freshly rebuilt answer");
}
