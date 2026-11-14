//! Slice REL L4 benchmarks (nightly `core-perf-ac`, skipped by the push step's `--skip nfr_perf_`):
//! docs/acceptance/related.md NFR-PERF-13 AC-2 (the full index with the `rel` table on the 5,000-note reference vault in
//! under 18 s, 60 % of NFR-PERF-02's 30 s, D-59; the 20,000-note vault reported) and AC-3 (the index database's size with
//! and without `rel`, both vaults, reported). Docs/contracts/v1-related.md §1.13: `Core::open` on a copy, time to
//! `wait_idle`; size = `index.sqlite` + `-wal` after a checkpoint, and on a copy after `DROP TABLE rel; DROP TABLE
//! rel_vocab; VACUUM`. The 18 s target is asserted only when `VERIFY_GATE=release` (report-only before the v1.0 release
//! gate, as D-940). Written from the ACs and the contract only (D-61).

mod common;
mod related_setup;

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use common::{headroom_vault_20k, reference_vault_copy, sandbox, Sandbox};
use related_setup::{copy_dir, index_db, sqlite};
use tegg_core::{Core, CoreOptions};

fn timed_open(root: &Path, sb: &Sandbox) -> (Core, Duration) {
    let t0 = Instant::now();
    let core = match Core::open(root, &sb.dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => {
            assert!(false, "Core::open: {e:?}");
            unreachable!()
        }
    };
    assert!(core.wait_idle(Duration::from_secs(1200)), "indexing finishes");
    (core, t0.elapsed())
}
fn size(p: &Path) -> u64 {
    let wal = PathBuf::from(format!("{}-wal", p.display()));
    std::fs::metadata(p).map(|m| m.len()).unwrap_or(0) + std::fs::metadata(wal).map(|m| m.len()).unwrap_or(0)
}
/// (with rel, without rel) sizes in bytes; `Err` when the `rel` tables can't be dropped.
fn sizes(core: &Core, sb: &Sandbox) -> Result<(u64, u64), String> {
    let db = index_db(core);
    sqlite(&db, "PRAGMA wal_checkpoint(TRUNCATE)")?;
    let with = size(&db);
    let dir = sb.base.join("size-copy");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    copy_dir(db.parent().ok_or("no parent")?, &dir, &[]);
    let copy = dir.join("index.sqlite");
    sqlite(&copy, "DROP TABLE rel_vocab; DROP TABLE rel; VACUUM;")?;
    Ok((with, size(&copy)))
}

#[test]
fn nfr_perf_13_ac2_full_index_with_stems_within_perf_02() {
    let sb = sandbox();
    let root = reference_vault_copy(&sb);
    let (core, t) = timed_open(&root, &sb);
    println!("NFR-PERF-13 AC-2: full index of the 5,000-note vault with rel: {:.2} s (target 18 s)", t.as_secs_f64());
    assert!(core.rel_terms(&tegg_format::nfc("Pages/Neexistuje.md")).is_none(), "setup: hooks answer");
    assert!(core.related_computed() == 0 && sqlite(&index_db(&core), "SELECT count(*) FROM rel").is_ok(), "the full index builds the rel table");
    let sb2 = sandbox();
    let big = sb2.base.join("Vault20k");
    copy_dir(&headroom_vault_20k(), &big, &["_attachments"]);
    let (_c2, t2) = timed_open(&big, &sb2);
    println!("NFR-PERF-13 AC-2: full index of the 20,000-note vault with rel: {:.2} s (reported)", t2.as_secs_f64());
    if std::env::var("VERIFY_GATE").as_deref() == Ok("release") {
        assert!(t < Duration::from_secs(18), "the 5,000-note full index takes {t:?}, under 18 s (D-59)");
    }
}

#[test]
fn nfr_perf_13_ac3_index_size_reported() {
    for (name, src) in [("5,000", None), ("20,000", Some(headroom_vault_20k()))] {
        let sb = sandbox();
        let root = match &src {
            None => reference_vault_copy(&sb),
            Some(p) => {
                let r = sb.base.join("Vault20k");
                copy_dir(p, &r, &["_attachments"]);
                r
            }
        };
        let (core, _) = timed_open(&root, &sb);
        let s = sizes(&core, &sb);
        assert!(s.is_ok(), "{name}: the index has the rel tables to measure: {s:?}");
        let (with, without) = s.unwrap_or((0, 0));
        println!("NFR-PERF-13 AC-3: {name}-note vault index: {with} bytes with rel, {without} bytes without (reported)");
    }
}
