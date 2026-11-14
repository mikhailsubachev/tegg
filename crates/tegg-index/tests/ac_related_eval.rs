//! Slice REL L4 test of the evaluation command (docs/acceptance/related.md FR-LNK-15 AC-35; docs/contracts/v1-related.md
//! §1.12): `cargo run -p tegg-index --example related-eval -- <fixture copy>` prints the nine numeric lines of §1.12 and
//! nothing else: no path, title, file name or stem of 4 or more characters; it writes nothing in the vault. Written from
//! the ACs and the contract only (D-61); every check is an assertion in this file (tools/qa CONTRACT §5.2).

#[path = "support/related.rs"]
mod support;

use std::collections::BTreeMap;
use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::process::Command;

use support::*;

/// Every file and folder under `root`: (len, mtime ns, inode, bytes).
fn snap(root: &Path) -> BTreeMap<String, (u64, i128, u64, Vec<u8>)> {
    let mut out = BTreeMap::new();
    fn walk(root: &Path, d: &Path, out: &mut BTreeMap<String, (u64, i128, u64, Vec<u8>)>) {
        for e in std::fs::read_dir(d).expect("setup: read_dir") {
            let e = e.expect("setup: entry");
            let p = e.path();
            let md = std::fs::symlink_metadata(&p).expect("setup: metadata");
            let rel = p.strip_prefix(root).expect("setup: prefix").to_string_lossy().into_owned();
            if md.is_dir() {
                out.insert(format!("{rel}/"), (0, 0, md.ino(), Vec::new()));
                walk(root, &p, out);
            } else {
                out.insert(rel, (md.len(), md.mtime() as i128 * 1_000_000_000 + md.mtime_nsec() as i128, md.ino(), std::fs::read(&p).expect("setup: read")));
            }
        }
    }
    walk(root, root, &mut out);
    out
}

/// The README's stems of 4 or more characters (cluster tables).
const STEMS: &str = "teleskop komt meteor orbit galaxi mlhov asteroid planetk dalekohld zatmn spektr kratr mesik rovnik obloh paprsk vesmir druzik \
souhvezd hvezd pozorovan zapis hvezdarn naklad offsit ubytovan lisabon letenk rozpock navrh posl finank projit potrebuj dulezit term skoln vedn \
schval patk dodavatl zasl prihlask schuzk potvrd ctvrtk knih prah domk matk potok zeln plot zahon rajk paprik komposk zahrad vcelstv ramk plod \
delnik vosk propolis plastv medomt nastavk cesn krmn cukr zimovan hike plan mountain trail lake boot bubn kytar harmonik housl klavir";

#[test]
fn fr_lnk_15_ac35_evaluation_prints_numbers_only() {
    let v = related_vault();
    let before = snap(&v.root);
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_string());
    let ws = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let out = Command::new(cargo)
        .current_dir(&ws)
        .args(["run", "-p", "tegg-index", "--example", "related-eval", "--quiet", "--"])
        .arg(&v.root)
        .output();
    let out = match out {
        Ok(o) => o,
        Err(e) => {
            assert!(false, "cargo run could not start: {e}");
            unreachable!()
        }
    };
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    assert!(out.status.success(), "related-eval exits 0 (status {:?}; stderr {stderr})", out.status.code());
    assert_eq!(stderr, "", "nothing on stderr");
    let keys: Vec<String> = stdout.lines().map(|l| l.split(':').next().unwrap_or("").to_string()).collect();
    assert_eq!(
        keys,
        ["objects", "pairs", "recall@10", "mrr", "empty_share", "median_length", "index_ms", "query_p50_ms", "query_p95_ms"].map(String::from).to_vec(),
        "exactly the nine lines of §1.12, in order: {stdout}"
    );
    let num = regex::Regex::new(r"^[a-z_@0-9]+: (\d+|\d+\.\d+|n/a)$").expect("setup: regex");
    for l in stdout.lines() {
        assert!(num.is_match(l), "each line is `<key>: <number>`: {l:?}");
    }
    assert!(stdout.lines().any(|l| l == "objects: 39"), "objects: 39 (the fixture's rel rows): {stdout}");
    // No title, file name or stem of the fixture.
    let low = tegg_index::fold(&stdout);
    let mut words: Vec<String> = STEMS.split_whitespace().map(str::to_string).collect();
    for (rel, p) in files(&v.root) {
        if rel.starts_with(".tegg/") {
            continue;
        }
        words.push(tegg_index::fold(p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default().as_str()));
        if let Some(t) = std::fs::read_to_string(&p).ok().and_then(|t| t.lines().find(|l| l.starts_with("title: ")).map(|l| l[7..].to_string())) {
            words.push(tegg_index::fold(&t));
        }
    }
    let leaks: Vec<&String> = words.iter().filter(|w| w.chars().count() >= 4 && low.contains(w.as_str())).collect();
    assert_eq!(leaks, Vec::<&String>::new(), "the output holds no fixture title, file name or stem");
    assert!(snap(&v.root) == before, "the vault copy is untouched (bytes, mtime, inode; no file or folder created)");
}
