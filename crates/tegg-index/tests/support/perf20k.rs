//! The 20,000-note generated vault of NFR-PERF-13 AC-1 (docs/contracts/v1-related.md §1.13): gen-vault `--seed 1 --notes
//! 20000 --small-images`, as tegg-core's `headroom_vault_20k` (tests/common/mod.rs), generated once per `target/`
//! directory and reused. Read-only for tests. No assertions here: a panic is a setup failure (tools/qa CONTRACT §5.2).
#![allow(dead_code)]

use std::path::PathBuf;
use std::time::Instant;

fn target_dir() -> PathBuf {
    if let Ok(t) = std::env::var("CARGO_TARGET_DIR") {
        return PathBuf::from(t);
    }
    let exe = std::env::current_exe().expect("setup: current exe");
    exe.parent().and_then(|p| p.parent()).and_then(|p| p.parent()).expect("setup: target dir").to_path_buf()
}

pub fn headroom_vault_20k() -> PathBuf {
    let dest = target_dir().join("tegg-ref-vault-seed1-20k-small");
    if dest.join(".tegg/vault.yml").exists() {
        return dest;
    }
    let tmp = target_dir().join(format!("tegg-ref-vault-20k.tmp-{}-{:?}", std::process::id(), std::thread::current().id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let o = gen_vault::Options { seed: 1, notes: 20_000, images: 8_000, tags: 800, full_images: false };
    let t0 = Instant::now();
    gen_vault::generate(&tmp, &o).expect("setup: generate 20k vault");
    println!("generated 20,000-note vault in {:.1} s", t0.elapsed().as_secs_f64());
    if std::fs::rename(&tmp, &dest).is_err() {
        let _ = std::fs::remove_dir_all(&tmp);
    }
    if !dest.join(".tegg/vault.yml").exists() {
        panic!("setup: 20k vault missing");
    }
    dest
}
