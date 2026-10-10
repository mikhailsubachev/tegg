//! `capacities-dryrun <export.zip|folder> [--space NAME] [--tz ZONE] [--vault DIR] [--json | --counts-only]`
//! Without `--space` it lists the spaces (FR-IMP-22 AC-1). Never writes anything.

use s5_capacities_import::{accounting, plan, report, source};
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let flag = |n: &str| args.iter().position(|a| a == n).and_then(|i| args.get(i + 1)).cloned();
    let Some(input) = args.first().filter(|a| !a.starts_with("--")) else {
        eprintln!("usage: capacities-dryrun <export.zip|folder> [--space NAME] [--tz ZONE] [--vault DIR] [--json|--counts-only]");
        std::process::exit(2)
    };
    let src = source::read(&PathBuf::from(input)).unwrap_or_else(|e| { eprintln!("cannot read export: {e}"); std::process::exit(1) });
    let counts_only = args.iter().any(|a| a == "--counts-only");
    let spaces = plan::spaces(&src);
    let Some(space) = flag("--space") else {
        for (i, s) in spaces.iter().enumerate() {
            if counts_only { println!("space.{i}.files: {}\nspace.{i}.objects: {}", s.files, s.objects) }
            else { println!("{}\t{} objects\t{} files", s.name, s.objects, s.files) }
        }
        return;
    };
    let mut opts = plan::Options::default();
    if let Some(tz) = flag("--tz") { opts.tz = tz.parse().unwrap_or_else(|_| { eprintln!("unknown time zone"); std::process::exit(2) }) }
    if let Some(v) = flag("--vault") { opts.existing_import_ids = existing_import_ids(&PathBuf::from(v)) }
    let r = plan::dry_run(&src, &space, &opts);
    if counts_only {
        let i = spaces.iter().position(|s| s.name == space).unwrap_or(usize::MAX);
        print!("{}", report::counts_only(i, &r));
    } else if args.iter().any(|a| a == "--json") {
        println!("{}", serde_json::to_string_pretty(&r).unwrap());
    } else {
        print!("{}", report::markdown(&r));
    }
    let errs = accounting::check(&src, &r);
    if !errs.is_empty() { eprintln!("accounting failed:\n{}", errs.join("\n")); std::process::exit(1) }
}

/// FR-IMP-20: `import-id` values already in the target vault (read-only scan).
fn existing_import_ids(vault: &std::path::Path) -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    let Ok(src) = source::read_dir(vault) else { return out };
    for e in src.entries.iter().filter(|e| e.path.ends_with(".md") && !e.path.starts_with('.')) {
        let text = String::from_utf8_lossy(&e.bytes);
        if let (Some(fm), _) = plan::split_frontmatter(&text) {
            for l in fm.lines() {
                if let Some(v) = l.strip_prefix("import-id:") { out.insert(v.trim().trim_matches(['"', '\'']).to_string()); }
            }
        }
    }
    out
}
