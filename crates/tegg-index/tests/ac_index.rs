//! MS2 AC tests on `tegg-index` alone (docs/contracts/ms2-core.md §1, §2): folding, name-normalization
//! conflicts, rebuild of a corrupt or deleted database (AR-01). Written from the contract only (D-61).

use std::collections::BTreeSet;

use tegg_index::{fold, ConflictKind, Index, SearchQuery};
use tegg_vault::FileVersion;

const NFD_CTENI: &str = "C\u{30C}teni\u{301}";
const NFC_CTENI: &str = "\u{10C}ten\u{ED}";

macro_rules! ok {
    ($e:expr, $what:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => {
                assert!(false, "{} failed: {:?}", $what, e);
                unreachable!()
            }
        }
    };
}

fn version(bytes: &[u8]) -> FileVersion {
    let mut hash = [0u8; 32];
    for (i, b) in bytes.iter().enumerate() {
        hash[i % 32] ^= *b;
    }
    FileVersion { mtime_ns: 1_790_000_000_000_000_000, size: bytes.len() as u64, hash }
}

fn tmpdir() -> tempfile::TempDir {
    match tempfile::tempdir() {
        Ok(d) => d,
        Err(e) => panic!("setup: tempdir: {e}"),
    }
}

#[test]
fn fr_src_04_ac4_fold_removes_case_and_diacritics() {
    let got: Vec<String> = ["Čtení", NFD_CTENI, "ROZPOČET", "žluťoučký kůň", "Ďábelské ÓDY"].iter().map(|s| fold(s)).collect();
    assert_eq!(got, vec!["cteni", "cteni", "rozpocet", "zlutoucky kun", "dabelske ody"]);
}

#[test]
fn fr_fmt_12_ac4_fold_makes_cteni_equal_čtení() {
    assert_eq!(fold(NFC_CTENI), fold("cteni"));
    assert_eq!(fold(NFD_CTENI), fold(NFC_CTENI));
    assert_eq!(fold("cteni"), "cteni");
}

#[test]
fn fr_fmt_12_ac3_two_paths_equal_under_nfc_are_a_name_conflict() {
    let dir = tmpdir();
    let mut idx = ok!(Index::open(&dir.path().join("index.sqlite")), "Index::open");
    let a = "---\nid: 01JA0S0000000000000000S201\ntype: page\n---\nKniha A.\n";
    let b = "---\nid: 01JA0S0000000000000000S202\ntype: page\n---\nKniha B.\n";
    ok!(idx.upsert(&format!("Pages/{NFC_CTENI}.md"), a.as_bytes(), &version(a.as_bytes())), "upsert NFC");
    ok!(idx.upsert(&format!("Pages/{NFD_CTENI}.md"), b.as_bytes(), &version(b.as_bytes())), "upsert NFD");
    let c: Vec<_> = idx.conflicts().into_iter().filter(|c| c.kind == ConflictKind::NameNormalization).collect();
    assert_eq!(c.len(), 1, "{c:?}");
    let mut names: Vec<String> = std::iter::once(c[0].primary.clone()).chain(c[0].others.iter().cloned()).collect();
    names.sort();
    let mut want = vec![format!("Pages/{NFC_CTENI}.md"), format!("Pages/{NFD_CTENI}.md")];
    want.sort();
    assert_eq!(names, want);
}

#[test]
fn fr_sto_07_ac2_corrupt_index_file_is_rebuilt_not_trusted() {
    let dir = tmpdir();
    let db = dir.path().join("index.sqlite");
    std::fs::write(&db, b"this is not a sqlite database").unwrap_or(());
    let mut idx = ok!(Index::open(&db), "Index::open on a corrupt file");
    let text = "---\nid: 01JA0S0000000000000000S210\ntype: page\ntitle: Řeka\n---\nVltava teče Prahou.\n";
    ok!(idx.upsert("Pages/Řeka.md", text.as_bytes(), &version(text.as_bytes())), "upsert");
    let p = ok!(idx.search(&SearchQuery::text("vltava", chrono_tz::Europe::Prague)), "search");
    let got: BTreeSet<String> = p.results.into_iter().map(|r| r.path).collect();
    assert_eq!(got, BTreeSet::from(["Pages/Řeka.md".to_string()]));
}

#[test]
fn fr_sto_07_ac2_index_snapshot_is_reproducible_from_the_files() {
    let files = [
        ("Pages/Řeka.md", "---\nid: 01JA0S0000000000000000S220\ntype: page\ntitle: Řeka\ntags: [voda]\n---\nVltava, viz [[Most]].\n"),
        ("Pages/Most.md", "---\nid: 01JA0S0000000000000000S221\ntype: page\n---\nKarlův most přes [[Řeka]]. #Praha\n"),
        ("Tasks/Úkol.md", "---\nid: 01JA0S0000000000000000S222\ntype: task\npriority: High\n---\nZkontrolovat [[Most]].\n"),
    ];
    let build = |order: &[usize]| {
        let dir = tmpdir();
        let mut idx = ok!(Index::open(&dir.path().join("index.sqlite")), "Index::open");
        for &i in order {
            let (p, t) = files[i];
            ok!(idx.upsert(p, t.as_bytes(), &version(t.as_bytes())), "upsert");
        }
        (idx.snapshot(), idx.objects(), idx.backlinks("Pages/Most.md"))
    };
    let a = build(&[0, 1, 2]);
    let b = build(&[2, 0, 1]);
    assert_eq!(a.1.len(), 3, "positive control: {:?}", a.1);
    assert_eq!(a.2, vec!["Pages/Řeka.md".to_string(), "Tasks/Úkol.md".to_string()]);
    assert!(!a.0.is_empty());
    assert_eq!(a, b);
}

#[test]
fn fr_syn_02_ac2_index_ignores_temp_and_excluded_paths() {
    let dir = tmpdir();
    let mut idx = ok!(Index::open(&dir.path().join("index.sqlite")), "Index::open");
    let t = "Text o řece.\n";
    for p in ["Pages/Řeka.md", "Pages/.Řeka.md.tegg-tmp", "_templates/Page/Šablona.md", ".trash/Pages/Starý.md", ".obsidian/snippets/x.md", ".tegg/types/x.md"] {
        let r = idx.upsert(p, t.as_bytes(), &version(t.as_bytes()));
        assert!(r.is_ok(), "{p}: {r:?}");
    }
    let paths: Vec<String> = idx.objects().into_iter().map(|o| o.path).collect();
    assert_eq!(paths, vec!["Pages/Řeka.md".to_string()]);
}
