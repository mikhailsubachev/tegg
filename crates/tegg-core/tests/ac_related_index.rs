//! Slice REL L4 crash test (docs/acceptance/related.md FR-LNK-15 AC-9 "Crashes"; docs/contracts/v1-related.md §1.5, §7):
//! SIGKILL at a random point while a 500-file burst (`Burst/`, generated notes) is indexed never leaves `fts` and `rel`
//! describing different sets of objects, and after reopening, `index_related` equals the freshly rebuilt answer for every
//! fixture object. D-1113's harness: the test binary re-runs itself as the child (`TEGG_REL_KILL_CHILD`), which opens the
//! core on the vault and indexes; the parent kills it after a random delay. 100 cycles per push, 1,000 with
//! `QA_PROPERTY_SCALE` ≥ 100 (nightly). The database is read with the system `sqlite3` (tables `notes`, `fts`, `rel`,
//! contract §1.5). Written from the ACs and the contract only (D-61); every check is an assertion in this file (tools/qa
//! CONTRACT §5.2).

mod common;
mod related_setup;

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use common::{fresh_dirs, sandbox};
use related_setup::*;
use tegg_core::{AppDirs, Core, CoreOptions};

const KILL_TEST: &str = "fr_lnk_15_ac9_index_version_rebuild_and_crash_safety_sigkill";

fn cycles() -> usize {
    let scale: u64 = std::env::var("QA_PROPERTY_SCALE").ok().and_then(|s| s.parse().ok()).unwrap_or(1);
    if scale >= 100 {
        1000
    } else {
        100
    }
}

/// Child mode: open the core (it indexes the burst), say ready, wait for idle (at most 30 s), exit.
fn kill_child(root: &Path, app: &Path, ready: &Path) -> ! {
    let dirs = AppDirs { root: app.to_path_buf() };
    let Ok(core) = Core::open(root, &dirs, CoreOptions { watch: false, sync: None }) else { std::process::exit(3) };
    std::fs::write(ready, b"ready").ok();
    let _ = core.wait_idle(Duration::from_secs(30));
    std::process::exit(0)
}

fn write_burst(root: &Path, cycle: usize) {
    let dir = root.join("Burst");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("setup: Burst/");
    for i in 0..500 {
        std::fs::write(dir.join(format!("Dávka {i:03}.md")), burst_note(i, cycle)).expect("setup: burst note");
    }
}

fn find_db(app: &Path) -> Option<PathBuf> {
    files(app).into_iter().map(|(_, p)| p).find(|p| p.file_name().is_some_and(|n| n == "index.sqlite"))
}

fn answers(core: &Core) -> Vec<String> {
    let mut out = Vec::new();
    for p in objects() {
        for shown in [false, true] {
            out.push(match core.related(&p, shown) {
                Ok(l) => format!(
                    "{p} {shown} {:?} {}",
                    l.reason,
                    l.entries.iter().map(|e| format!("{}|{}|{:?}|{:.9}|{}", nfc(&e.path), e.linked, e.excerpt, e.score, e.shared)).collect::<Vec<_>>().join(" ; ")
                ),
                Err(e) => format!("{p} {shown} error {e:?}"),
            });
        }
    }
    out
}

#[test]
fn fr_lnk_15_ac9_index_version_rebuild_and_crash_safety_sigkill() {
    if let Ok(dir) = std::env::var("TEGG_REL_KILL_CHILD") {
        let dir = PathBuf::from(dir);
        let ready = PathBuf::from(std::env::var("TEGG_REL_KILL_READY").expect("setup: ready path"));
        kill_child(&dir.join("Related"), &dir.join("app"), &ready);
    }
    let sb = sandbox();
    let work = sb.base.clone();
    let root = related_vault(&sb);
    let app = work.join("app");
    std::fs::create_dir_all(&app).expect("setup: app dir");
    let exe = std::env::current_exe().expect("setup: test binary");
    let mut seed: u64 = 0x5245_4c20_2026_1114;
    let mut bad: Vec<String> = Vec::new();
    for cycle in 0..cycles() {
        write_burst(&root, cycle);
        let ready = work.join(format!("ready-{cycle}"));
        let mut child = Command::new(&exe)
            .args(["--exact", KILL_TEST, "--nocapture", "--test-threads=1"])
            .env("TEGG_REL_KILL_CHILD", &work)
            .env("TEGG_REL_KILL_READY", &ready)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("setup: spawn the indexer");
        let deadline = Instant::now() + Duration::from_secs(30);
        while !ready.exists() && Instant::now() < deadline && child.try_wait().ok().flatten().is_none() {
            std::thread::sleep(Duration::from_micros(300));
        }
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        std::thread::sleep(Duration::from_micros(seed % 400_000));
        let _ = child.kill();
        let _ = child.wait();
        assert!(ready.exists(), "cycle {cycle}: the child opened the vault");
        let Some(db) = find_db(&app) else {
            bad.push(format!("cycle {cycle}: no index database"));
            break;
        };
        let q = |sql: &str| sqlite(&db, sql);
        match (q("SELECT count(*) FROM fts"), q("SELECT count(*) FROM rel"), q("SELECT count(*) FROM rel WHERE rowid NOT IN (SELECT rowid FROM notes)")) {
            (Ok(f), Ok(r), Ok(orphans)) => {
                if f != r || orphans != "0" {
                    bad.push(format!("cycle {cycle}: fts {f} rows, rel {r} rows, {orphans} rel rows without a note"));
                }
            }
            other => bad.push(format!("cycle {cycle}: the index can't be read: {other:?}")),
        }
        if bad.len() > 3 {
            break;
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "SIGKILL never leaves fts and rel describing different sets of objects");
    let _ = std::fs::remove_dir_all(root.join("Burst"));
    let dirs = AppDirs { root: app.clone() };
    let core = open(&root, &dirs, false);
    let after = answers(&core);
    let fresh = open(&root, &fresh_dirs(&sb, "Fresh"), false);
    assert_eq!(after, answers(&fresh), "after reopening, every answer equals the freshly rebuilt one");
    assert!(after.iter().any(|a| a.contains("Pages/Hvězda 03.md")), "the answers hold lists (Souhvězdí's)");
}
