//! Slice AND-3, L4 (Mac host): docs/acceptance/android-edit.md FR-SYN-04 AC-16 "The sync app's copies are found"
//! (AP-2066 → D-2501; T2), the pattern part, through docs/contracts/android-edit.md §3.4: OC-3 passed with the copy
//! pattern of §3.4 unchanged (D-2542), so the sync app's copy is Google Drive's `Plán (1).md` (data-safety FR-SYN-04
//! AC-2). A copy with Plán's `id` is listed as a pair with `Pages/Plán.md`; a file with that name pattern, its own `id`
//! and fewer than 90 % equal lines isn't listed. Fixture text: tests/fixtures/vaults/conflicts/Pages/Plán.md.
//! Written from the ACs and the contract only (D-61).

use std::path::PathBuf;

use tegg_index::{ConflictKind, Index};
use tegg_vault::FileVersion;

fn version(bytes: &[u8]) -> FileVersion {
    let mut hash = [0u8; 32];
    for (i, b) in bytes.iter().enumerate() {
        hash[i % 32] ^= *b;
    }
    FileVersion { mtime_ns: 1_790_000_000_000_000_000, size: bytes.len() as u64, hash }
}
fn fixture(rel: &str) -> String {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/vaults/conflicts").join(rel);
    std::fs::read_to_string(&p).unwrap_or_default()
}

#[test]
fn fr_syn_04_ac16_sync_app_copies_are_found() {
    let plan = fixture("Pages/Plán.md");
    assert!(plan.contains("id: 01JB0K0000000000000000K001"), "setup: the conflicts fixture's Plán");
    let dir = match tempfile::tempdir() {
        Ok(d) => d,
        Err(e) => panic!("setup: tempdir: {e}"),
    };
    let mut idx = match Index::open(&dir.path().join("index.sqlite")) {
        Ok(i) => i,
        Err(e) => panic!("setup: Index::open: {e:?}"),
    };
    let up = |idx: &mut Index, path: &str, text: &str| {
        let r = idx.upsert(path, text.as_bytes(), &version(text.as_bytes()));
        assert!(r.is_ok(), "upsert {path}: {:?}", r.err());
    };
    up(&mut idx, "Pages/Plán.md", &plan);
    // the sync app's copy: same id, one line changed on the phone
    let copy = plan.replace("Řádek 5 plánu.", "Řádek 5 změněný na telefonu.");
    up(&mut idx, "Pages/Plán (1).md", &copy);
    // the same name pattern, its own id, mostly other lines: not a copy
    let other = "---\nid: 01JBAN3000000000000000C099\ntype: page\ntitle: Zápis\n---\nÚplně jiný text.\nDruhý jiný řádek.\nTřetí.\n";
    up(&mut idx, "Pages/Zápis (1).md", other);
    up(&mut idx, "Pages/Zápis.md", "---\nid: 01JBAN3000000000000000C098\ntype: page\ntitle: Zápis\n---\nBod 1.\nBod 2.\nBod 3.\n");

    let rows = idx.conflicts();
    let plan_rows: Vec<_> = rows.iter().filter(|c| c.primary == "Pages/Plán.md" || c.others.iter().any(|o| o == "Pages/Plán.md")).collect();
    assert_eq!(plan_rows.len(), 1, "one row for Plán: {rows:?}");
    let mut pair: Vec<String> = std::iter::once(plan_rows[0].primary.clone()).chain(plan_rows[0].others.iter().cloned()).collect();
    pair.sort();
    assert_eq!(pair, vec!["Pages/Plán (1).md".to_string(), "Pages/Plán.md".to_string()], "the pair is Plán and its copy");
    assert_eq!(plan_rows[0].primary, "Pages/Plán.md", "the name without the copy suffix is the primary");
    assert!(matches!(plan_rows[0].kind, ConflictKind::DuplicateId | ConflictKind::PossibleCopy), "a duplicate id or a possible copy: {:?}", plan_rows[0].kind);
    let zapis: Vec<_> = rows.iter().filter(|c| c.primary.starts_with("Pages/Zápis") || c.others.iter().any(|o| o.starts_with("Pages/Zápis"))).collect();
    assert!(zapis.is_empty(), "Zápis (1).md with its own id and under 90 % equal lines isn't listed: {zapis:?}");
}
