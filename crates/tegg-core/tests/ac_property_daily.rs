//! MS4 slice 4B property test (L2): FR-DLY-02 AC-10, a Daily Note is virtual until a keystroke changes it (T1).
//! docs/acceptance/daily-notes.md; interface docs/contracts/ms4-daily.md §3 (`daily_view`, `daily_create`) and §4.1
//! (the UI's first save: nothing is sent while the document equals the virtual content, D-323; a file that arrived
//! first is never written over, D-326). Written from the AC and the contract only (D-61).
//!
//! A Rust model of the UI drives the real core: random sequences of {open date d, type, undo, navigate away, external
//! create / delete of a Daily Note for d, quit} on dates around month, year and DST boundaries. After every step:
//! the vault holds a Daily Note for d only if a keystroke on d changed the document or another program created one,
//! and Tegg has created at most one file per date (FR-SYN-06). Every run starts with one open-type-leave cycle so a
//! core that never writes fails at once.
//!
//! Seeds (TS-L2): a fixed seed plus one random seed per run (`QA_SEED` when set, else the clock); with
//! `QA_PROPERTY_SCALE` ≥ 100 (nightly) 10 seeds × 1,000 steps. Every seed is printed (`seed = N`).

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use chrono::NaiveDate;
use common::*;
use tegg_core::{Core, CoreOptions};
use tegg_format::nfc;

const FIXED_SEED: u64 = 20_261_016;
const DATES: [&str; 10] = ["2026-03-29", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-31", "2026-11-01", "2026-12-31", "2027-01-01", "2028-02-28", "2028-02-29"];

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
        30
    }
}

// ------------------------------------------------------------------------------------------------ setup (no AC assertions)

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("setup: create dir");
    for e in std::fs::read_dir(from).expect("setup: read_dir") {
        let e = e.expect("setup: entry");
        if e.file_type().expect("setup: type").is_dir() {
            copy_dir(&e.path(), &to.join(e.file_name()));
        } else {
            std::fs::copy(e.path(), to.join(e.file_name())).expect("setup: copy");
        }
    }
}
fn vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Vlastnost");
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"));
    root
}
fn open(root: &Path, sb: &Sandbox) -> Core {
    let core = match Core::open(root, &sb.dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => {
            assert!(false, "Core::open failed: {e:?}");
            unreachable!()
        }
    };
    assert!(core.wait_idle(Duration::from_secs(60)), "idle");
    core
}
fn day(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").expect("setup: date")
}
/// First-write bytes as the UI builds them (D-324), without a template; `body` is the typed text.
fn bytes(date: &str, body: &str) -> String {
    format!("---\nid: 01JB4B0000000000000000P{:03}\ntype: daily-note\ntitle: \"{date}\"\ndate: {date}\nreview: unreviewed\ncreated: {date}T12:00:00+02:00\nmodified: {date}T12:00:00+02:00\n---\n{body}", body.len() % 1000)
}
/// Every Daily Note file on disk for each date (outside dot-folders and `_templates/`).
fn on_disk(root: &Path) -> BTreeMap<String, BTreeSet<String>> {
    let mut out: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for (rel, b) in files_with_bytes(root) {
        if rel.starts_with('.') || rel.starts_with("_templates/") || !rel.ends_with(".md") {
            continue;
        }
        let t = String::from_utf8_lossy(&b).to_string();
        if !t.contains("\ntype: daily-note\n") {
            continue;
        }
        if let Some(d) = t.lines().find_map(|l| l.strip_prefix("date: ")) {
            out.entry(d.trim().to_string()).or_default().insert(nfc(&rel));
        }
    }
    out
}

#[derive(Debug, Clone)]
enum Op {
    Open(usize),
    Type,
    Undo,
    Away,
    ExtCreate(usize),
    ExtDelete(usize),
    Quit,
}

/// The UI's open note (ms4-daily §4.1).
struct Open {
    date: String,
    /// `Some(path)` once written or when `daily_view` showed a file; None while virtual.
    path: Option<String>,
    /// Typed text not yet saved; `None` = the document equals what is saved or the virtual content.
    pending: Option<String>,
    typed: usize,
}

struct Model {
    root: PathBuf,
    core: Option<Core>,
    open: Option<Open>,
    /// Files Tegg created, per date.
    tegg: BTreeMap<String, Vec<String>>,
    /// Files another program created and hasn't deleted, per date.
    external: BTreeMap<String, BTreeSet<String>>,
    /// Dates on which a keystroke changed the document.
    typed_on: BTreeSet<String>,
    n: usize,
}

impl Model {
    fn core(&self) -> &Core {
        self.core.as_ref().expect("setup: core open")
    }
    /// Autosave / flush (FR-EDT-09): nothing while the document equals its saved or virtual content (D-323).
    fn flush(&mut self) {
        let Some(o) = self.open.as_mut() else { return };
        let Some(text) = o.pending.take() else { return };
        match &o.path {
            None => {
                let r = self.core.as_ref().expect("setup: core").daily_create(day(&o.date), bytes(&o.date, &text).as_bytes());
                // The flush of a changed virtual note is its first write (FR-DLY-02 AC-2, AC-4): it must succeed.
                assert!(r.is_ok(), "the first save of a changed virtual note for {} creates its file: {r:?}", o.date);
                if let Ok(made) = r {
                    self.tegg.entry(o.date.clone()).or_default().push(nfc(&made.path));
                    o.path = Some(nfc(&made.path));
                }
            }
            Some(p) => {
                let core = self.core.as_ref().expect("setup: core");
                if let Ok((b, v)) = core.read_note(p, SystemTime::now()) {
                    let mut t = String::from_utf8_lossy(&b).to_string();
                    t.push_str(&text);
                    let _ = core.write_note(p, t.as_bytes(), Some(&v));
                }
            }
        }
    }
    fn apply(&mut self, op: &Op) {
        match op {
            Op::Open(i) => {
                self.flush();
                let date = DATES[*i].to_string();
                let path = self.core().daily_view(day(&date)).path.map(|p| nfc(&p));
                self.open = Some(Open { date, path, pending: None, typed: 0 });
            }
            Op::Type => {
                if let Some(o) = self.open.as_mut() {
                    o.typed += 1;
                    o.pending = Some(format!("{}Žluťoučký kůň {}.\n", o.pending.clone().unwrap_or_default(), o.typed));
                    self.typed_on.insert(o.date.clone());
                }
            }
            Op::Undo => {
                // Undo everything typed since the last save: the document is back to its saved or virtual content.
                if let Some(o) = self.open.as_mut() {
                    if o.pending.take().is_some() && o.path.is_none() && !self.tegg.contains_key(&o.date) {
                        self.typed_on.remove(&o.date);
                    }
                }
            }
            Op::Away => {
                self.flush();
                self.open = None;
            }
            Op::ExtCreate(i) => {
                let date = DATES[*i].to_string();
                self.n += 1;
                let rel = format!("Jinde/{date} cizí {}.md", self.n);
                write_raw(&self.root, &rel, bytes(&date, "Cizí zápis.\n").as_bytes());
                self.core().notify_changed(&[rel.clone()]);
                assert!(self.core().wait_idle(Duration::from_secs(10)), "idle");
                self.external.entry(date.clone()).or_default().insert(rel);
                // D-326: an untouched virtual note shows the arrived file.
                if let Some(o) = self.open.as_mut() {
                    if o.date == date && o.path.is_none() && o.pending.is_none() {
                        o.path = self.core.as_ref().expect("setup").daily_view(day(&date)).path.map(|p| nfc(&p));
                    }
                }
            }
            Op::ExtDelete(i) => {
                let date = DATES[*i].to_string();
                let open_path = self.open.as_ref().and_then(|o| o.path.clone());
                let victim = self.external.get(&date).and_then(|s| s.iter().find(|p| Some((*p).clone()) != open_path).cloned());
                if let Some(rel) = victim {
                    std::fs::remove_file(self.root.join(&rel)).expect("setup: delete");
                    self.core().notify_changed(&[rel.clone()]);
                    assert!(self.core().wait_idle(Duration::from_secs(10)), "idle");
                    if let Some(s) = self.external.get_mut(&date) {
                        s.remove(&rel);
                    }
                }
            }
            Op::Quit => {
                self.flush();
                self.open = None;
                self.core = None;
            }
        }
    }
    fn check(&self, seed: u64, step: usize, op: &Op) {
        let disk = on_disk(&self.root);
        for d in DATES {
            let files = disk.get(d).cloned().unwrap_or_default();
            let ext = self.external.get(d).cloned().unwrap_or_default();
            let mine: BTreeSet<String> = files.iter().filter(|p| !ext.contains(*p)).cloned().collect();
            assert!(mine.len() <= 1, "seed = {seed}, step {step} ({op:?}): Tegg wrote {} files for {d}: {mine:?}", mine.len());
            let should_have_mine = self.tegg.get(d).is_some_and(|v| !v.is_empty());
            assert_eq!(!mine.is_empty(), should_have_mine, "seed = {seed}, step {step} ({op:?}): a Tegg file for {d} exists only after a keystroke changed it (have {mine:?})");
            if !mine.is_empty() {
                assert!(self.typed_on.contains(d), "seed = {seed}, step {step}: {d} written without a keystroke");
            }
            for e in &ext {
                assert!(files.contains(e), "seed = {seed}, step {step}: the external file {e} is never removed by Tegg");
            }
            assert!(files.len() == mine.len() + ext.len(), "seed = {seed}, step {step}: no other file for {d}: {files:?}");
        }
        assert_eq!(self.tegg.values().map(|v| v.len()).max().unwrap_or(0) <= 1, true, "seed = {seed}, step {step}: at most one create per date: {:?}", self.tegg);
    }
}

#[test]
fn fr_dly_02_ac10_virtual_until_a_keystroke_changes_the_document() {
    for seed in seeds() {
        println!("seed = {seed}");
        let sb = sandbox();
        let root = vault(&sb);
        let mut m = Model { root: root.clone(), core: Some(open(&root, &sb)), open: None, tegg: BTreeMap::new(), external: BTreeMap::new(), typed_on: BTreeSet::new(), n: 0 };
        let mut rng = Rng::new(seed);
        let mut ops: Vec<Op> = vec![Op::Open(1), Op::Away, Op::Open(2), Op::Type, Op::Away];
        for _ in 0..steps() {
            let i = rng.below(DATES.len());
            ops.push(match rng.below(10) {
                0 | 1 => Op::Open(i),
                2 | 3 | 4 => Op::Type,
                5 => Op::Undo,
                6 => Op::Away,
                7 => Op::ExtCreate(i),
                8 => Op::ExtDelete(i),
                _ => Op::Quit,
            });
        }
        for (step, op) in ops.iter().enumerate() {
            if m.core.is_none() {
                m.core = Some(open(&root, &sb));
            }
            m.apply(op);
            m.check(seed, step, op);
        }
    }
}
