//! S5-QA AC-4 / FR-IMP-07 AC-4 / FR-IMP-05 AC-4 [real-export]: local-only dry run against `test exports/`.
//! Runs only with TEGG_REAL_EXPORTS=1, started by the owner (D-62); skipped otherwise (and when the folder is missing).
//! PRIVACY (TS-P2): prints counts and indexes only, never names, titles or content; the output format is asserted.

use s5_capacities_import::{accounting, plan, report, source};
use std::path::Path;

#[test]
fn s5_qa_ac4_real_capacities_export_dry_run() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test exports");
    if std::env::var("TEGG_REAL_EXPORTS").as_deref() != Ok("1") || !dir.exists() {
        eprintln!("skipped: set TEGG_REAL_EXPORTS=1 (owner only, D-62)");
        return;
    }
    let mut zips: Vec<_> = std::fs::read_dir(&dir).expect("cannot list the export folder").filter_map(|e| e.ok()).map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "zip")).collect();
    zips.sort();
    let mut capacities = 0;
    let mut failures = 0;
    for (zi, zip) in zips.iter().enumerate() {
        let src = source::read(zip).unwrap_or_else(|_| panic!("export #{zi}: cannot open"));
        // A Capacities export has typed frontmatter (`type:`); other exports (Notion) are skipped.
        let typed = src.entries.iter().filter(|e| e.path.ends_with(".md"))
            .filter(|e| plan::split_frontmatter(&String::from_utf8_lossy(&e.bytes)).0.is_some_and(|f| f.lines().any(|l| l.starts_with("type:"))))
            .count();
        if typed == 0 { println!("export.{zi}.capacities: 0"); continue }
        capacities += 1;
        let spaces = plan::spaces(&src);
        let mut out = format!("export.{zi}.capacities: 1\nexport.{zi}.spaces: {}\nexport.{zi}.unreadable: {}\n", spaces.len(), src.stats.unreadable);
        let in_spaces: usize = spaces.iter().map(|s| s.files).sum();
        out += &format!("export.{zi}.files_outside_spaces: {}\n", src.stats.entries - src.stats.unreadable - in_spaces);
        for (si, s) in spaces.iter().enumerate() {
            let r = plan::dry_run(&src, &s.name, &plan::Options::default());
            out += &report::counts_only(si, &r);
            let errs = accounting::check(&src, &r);
            out += &format!("space.{si}.accounting_errors: {}\n", errs.len());
            out += &accounting::violation_counts(&format!("space.{si}"), &errs);
            let (n, a, b) = accounting::link_count_disagreements(&src, &s.name);
            out += &format!("space.{si}.diag.link_disagreement_notes: {n}\nspace.{si}.diag.link_independent: {a}\nspace.{si}.diag.link_scanner: {b}\n");
            failures += errs.len();
        }
        assert!(report::is_counts_only(&out), "counts-only format violated (TS-P2)");
        print!("{out}");
        assert_eq!(src.stats.unreadable, 0, "export #{zi}: unreadable zip entries");
    }
    assert!(capacities > 0, "no Capacities export found");
    assert_eq!(failures, 0, "imported + reported != total (see accounting_errors lines)");
}
