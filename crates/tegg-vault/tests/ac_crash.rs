//! FR-SYN-02 / NFR-REL-01 AC-3: a write interrupted by SIGKILL at random points during 1,000 save cycles
//! leaves the target as the complete old or the complete new version, never empty, truncated or mixed.
//!
//! The test re-runs its own test binary as the writer child (`TEGG_CRASH_CHILD` set): the child opens the
//! vault and saves new versions through `Vault::write` in a loop until the parent kills it with SIGKILL
//! after a random, seeded delay. Written from the AC and docs/contracts/ms1-core.md §3.2 only (D-61).

mod common;

use common::*;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tegg_vault::*;

const TEST_NAME: &str = "fr_syn_02_ac3_sigkill_during_1000_save_cycles_never_leaves_a_partial_file";
const NOTE: &str = "Pages/Poznámka.md";
const CYCLES: usize = 1000;

/// Version `k` of the note: a header and ~128 KiB of Czech filler that depends on `k`, so any mix of
/// two versions or a truncation is detectable.
fn version_bytes(k: u64) -> Vec<u8> {
    let mut s = format!("---\ntype: page\nverze: {k}\n---\n");
    let line = format!("Žluťoučký kůň úpěl ďábelské ódy, verze {k}.\n");
    while s.len() < 128 * 1024 {
        s.push_str(&line);
    }
    s.push_str(&format!("konec verze {k}\n"));
    s.into_bytes()
}

fn version_of(bytes: &[u8]) -> Option<u64> {
    let text = std::str::from_utf8(bytes).ok()?;
    let k: u64 = text.strip_prefix("---\ntype: page\nverze: ")?.split('\n').next()?.parse().ok()?;
    (version_bytes(k) == bytes).then_some(k)
}

/// Child mode: write versions forever (bounded to 20 s) until killed. Exits 3 if the vault API fails.
fn run_child(root: &Path, app: &Path, ready: &Path) -> ! {
    let dirs = AppDirs { root: app.to_path_buf() };
    let Ok(vault) = Vault::open(root, &dirs) else { std::process::exit(3) };
    let Ok((bytes, mut base)) = vault.read(NOTE) else { std::process::exit(3) };
    let Some(mut k) = version_of(&bytes) else { std::process::exit(4) };
    std::fs::write(ready, b"ready").ok();
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(20) {
        k += 1;
        match vault.write(NOTE, &version_bytes(k), Some(&base)) {
            Ok(WriteOutcome::Written(v)) => base = v,
            _ => std::process::exit(3),
        }
    }
    std::process::exit(0)
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}

#[test]
fn fr_syn_02_ac3_sigkill_during_1000_save_cycles_never_leaves_a_partial_file() {
    if let Ok(dir) = std::env::var("TEGG_CRASH_CHILD") {
        let dir = PathBuf::from(dir);
        let ready = PathBuf::from(std::env::var("TEGG_CRASH_READY").expect("ready path"));
        run_child(&dir.join("vault"), &dir.join("app"), &ready);
    }

    let sb = sandbox();
    let work = sb.base.join("crash");
    let root = work.join("vault");
    manual_vault(&root);
    write_raw(&root, NOTE, &version_bytes(0));
    std::fs::create_dir_all(work.join("app")).expect("app dir");
    let exe = std::env::current_exe().expect("test binary");

    let mut rng = Rng(0x5eed_2026_1011);
    let mut last = 0u64;
    let mut advanced = 0usize;
    let mut bad: Vec<String> = Vec::new();
    for cycle in 0..CYCLES {
        let ready = work.join(format!("ready-{cycle}"));
        let mut child = Command::new(&exe)
            .args(["--exact", TEST_NAME, "--nocapture", "--test-threads=1"])
            .env("TEGG_CRASH_CHILD", &work)
            .env("TEGG_CRASH_READY", &ready)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn writer child");
        // Wait until the child has opened the vault (or gave up).
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut exited = None;
        while !ready.exists() && Instant::now() < deadline {
            if let Some(status) = child.try_wait().expect("try_wait") {
                exited = Some(status);
                break;
            }
            std::thread::sleep(Duration::from_micros(200));
        }
        if !ready.exists() {
            let _ = child.kill();
            let _ = child.wait();
            assert!(false, "cycle {cycle}: the writer could not open the vault and start saving (exit {exited:?})");
        }
        std::thread::sleep(Duration::from_micros(rng.next() % 30_000));
        let _ = child.kill(); // SIGKILL on Unix
        let _ = child.wait();

        let bytes = std::fs::read(root.join(NOTE));
        match bytes.as_deref().ok().and_then(version_of) {
            Some(k) if k >= last => {
                if k > last {
                    advanced += 1;
                }
                last = k;
            }
            Some(k) => bad.push(format!("cycle {cycle}: went back from version {last} to {k}")),
            None => bad.push(format!(
                "cycle {cycle}: target is not a complete version ({} bytes)",
                bytes.as_ref().map(|b| b.len()).unwrap_or(0)
            )),
        }
        // Anything else left in the folder must be the hidden temporary file (FR-SYN-02 AC-2).
        for name in std::fs::read_dir(root.join("Pages")).expect("read Pages") {
            let name = name.expect("entry").file_name().to_string_lossy().into_owned();
            if name != "Poznámka.md" && name != ".Poznámka.md.tegg-tmp" {
                bad.push(format!("cycle {cycle}: unexpected file {name:?}"));
            }
        }
        if bad.len() > 10 {
            break;
        }
    }
    assert_eq!(bad, Vec::<String>::new());
    assert!(advanced >= CYCLES / 20, "only {advanced} of {CYCLES} cycles saved a new version; the harness did not exercise writes");
}
