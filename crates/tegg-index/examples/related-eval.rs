//! The Related evaluation command (docs/contracts/v1-related.md §1.12; D-1690, FR-LNK-15 AC-35):
//!
//!   cargo run -p tegg-index --example related-eval -- <vault>
//!
//! Reads the vault's indexable `.md` files read-only (`tegg_vault::LocalFs`), builds an index in a new temporary
//! directory (removed at the end) and prints nine numeric lines, nothing else: no path, title or stem leaves it. Pairs
//! are the links of A that resolve to a note B ≠ A whose type is not `tag`, `image` or `pdf`. Not a `./verify` step.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::Instant;

use tegg_index::related::by_code_point;
use tegg_index::{Index, RelatedParams};
use tegg_vault::{FsEntry, LocalFs, VaultFs};

fn usage(msg: &str) -> ! {
    eprintln!("usage: related-eval <vault> ({msg})");
    std::process::exit(2)
}

fn temp_dir() -> PathBuf {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    std::env::temp_dir().join(format!("tegg-related-eval-{}-{nanos}", std::process::id()))
}

fn ms(d: std::time::Duration) -> f64 {
    d.as_secs_f64() * 1e3
}

fn quantile(v: &mut [f64], q: f64) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(f64::total_cmp);
    let i = ((v.len() as f64) * q).ceil() as usize;
    v[i.saturating_sub(1).min(v.len() - 1)]
}

fn run(root: &Path, dir: &Path) -> Result<Vec<String>, String> {
    let fs = LocalFs::new(root);
    let entries = fs.list().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut idx = Index::open(&dir.join("index.sqlite")).map_err(|e| format!("{e:?}"))?;
    let t0 = Instant::now();
    let mut batch = Vec::new();
    for e in entries {
        let FsEntry::File { path } = e else { continue };
        if !tegg_index::is_indexable(&path) {
            continue;
        }
        let (bytes, version) = fs.read(&path).map_err(|e| e.to_string())?;
        if let Some(p) = tegg_index::prepare(&path, &bytes, &version) {
            batch.push(p);
        }
    }
    idx.apply(batch).map_err(|e| format!("{e:?}"))?;
    let index_ms = ms(t0.elapsed());

    let p = RelatedParams::default();
    let objects: Vec<String> = idx.objects().into_iter().map(|o| o.path).collect();
    let excluded = |path: &str| idx.object(path).is_none_or(|o| matches!(o.r#type.as_str(), "tag" | "image" | "pdf"));
    let mut pairs: BTreeSet<(String, String)> = BTreeSet::new();
    for a in &objects {
        for l in idx.note_links(a).map(|n| n.links).unwrap_or_default() {
            if !matches!(l.resolved.kind, tegg_format::TargetKind::Note | tegg_format::TargetKind::Daily) {
                continue;
            }
            if let Some(b) = l.resolved.path {
                if b != *a && !excluded(&b) {
                    pairs.insert((a.clone(), b));
                }
            }
        }
    }
    let (mut found, mut rr) = (0usize, 0.0f64);
    for (a, b) in &pairs {
        let list = idx.related(a, true, &p, &[], &by_code_point).unwrap_or_default();
        let want = tegg_format::nfc(b);
        if let Some(i) = list.entries.iter().position(|e| e.path == want) {
            found += 1;
            rr += 1.0 / (i + 1) as f64;
        }
    }
    let mut lengths = Vec::new();
    let mut times = Vec::new();
    for a in &objects {
        let t = Instant::now();
        let list = idx.related(a, false, &p, &[], &by_code_point).unwrap_or_default();
        times.push(ms(t.elapsed()));
        lengths.push(list.entries.len());
    }
    let n = objects.len();
    let empty = lengths.iter().filter(|l| **l == 0).count();
    lengths.sort();
    let median = if lengths.is_empty() { 0 } else { lengths[(lengths.len() - 1) / 2] };
    let ratio = |x: f64, d: usize| if d == 0 { "n/a".to_string() } else { format!("{:.3}", x / d as f64) };
    Ok(vec![
        format!("objects: {n}"),
        format!("pairs: {}", pairs.len()),
        format!("recall@10: {}", ratio(found as f64, pairs.len())),
        format!("mrr: {}", if pairs.is_empty() { "n/a".to_string() } else { format!("{:.3}", rr / pairs.len() as f64) }),
        format!("empty_share: {}", if n == 0 { "0.000".to_string() } else { format!("{:.3}", empty as f64 / n as f64) }),
        format!("median_length: {median}"),
        format!("index_ms: {}", index_ms.round() as u64),
        format!("query_p50_ms: {:.1}", quantile(&mut times.clone(), 0.5)),
        format!("query_p95_ms: {:.1}", quantile(&mut times, 0.95)),
    ])
}

fn main() {
    let arg = std::env::args().nth(1).unwrap_or_else(|| usage("no vault given"));
    let root = PathBuf::from(arg);
    if !root.is_dir() || std::fs::read_dir(&root).is_err() {
        usage("the vault folder can't be read");
    }
    let dir = temp_dir();
    let result = run(&root, &dir);
    let _ = std::fs::remove_dir_all(&dir);
    match result {
        Ok(lines) => {
            for l in lines {
                println!("{l}");
            }
        }
        Err(e) => {
            eprintln!("related-eval: {e}");
            std::process::exit(1)
        }
    }
}
