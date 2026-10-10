//! BRD §11.1 / S5-QA AC-3: "every object, attachment and link is either imported or listed in the report".
//! The totals are recomputed from the raw entries with deliberately simple rules of their own: no planner
//! code (layout detection, file classes) and not the link scanner. A planner or scanner that loses
//! something therefore makes the check fail. Used by the fixture tests, the CLI and the real-export run.

use crate::plan::{DropKind, Report, FLAT_SPACE};
use crate::source::Source;
use regex::Regex;
use std::sync::LazyLock;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Totals { pub files: usize, pub objects: usize, pub attachments: usize, pub links: usize, pub other: usize }

/// Space membership by path alone: a space is a folder of that name with notes two levels below it
/// (`…/<space>/<type>/<note>`); in a flat export every entry belongs to the one space.
fn in_space(path: &str, space: &str) -> bool {
    if space == FLAT_SPACE { return true }
    let parts: Vec<&str> = path.split('/').collect();
    parts.len() >= 3 && parts[..parts.len() - 2].contains(&space)
}

static FENCE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?ms)^[ \t]*(```|~~~).*?^[ \t]*(```|~~~)[^\n]*$").unwrap());
static CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"`[^`\n]*`").unwrap());
static WIKI: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[\[[^\[\]\n]+\]\]").unwrap());
static MD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\]\(\s*<?([^)\s>]*)").unwrap());

/// Independent link count: wikilinks plus Markdown links whose destination isn't a URL or an anchor,
/// outside fenced and inline code.
pub fn count_links(text: &str) -> usize {
    let t = FENCE.replace_all(text, "");
    let t = CODE.replace_all(&t, "");
    let wiki = WIKI.find_iter(&t).filter(|m| !m.as_str()[2..m.len() - 2].trim().is_empty()
        && !m.as_str()[2..].split(['|', '#']).next().unwrap().trim().is_empty()).count();
    let t = WIKI.replace_all(&t, "");
    let md = MD.captures_iter(&t).filter(|c| {
        let d = c[1].to_ascii_lowercase();
        !d.is_empty() && !d.contains("://") && !d.starts_with('#') && !d.starts_with("mailto:") && !d.starts_with("tel:")
    }).count();
    wiki + md
}

pub fn totals(src: &Source, space: &str) -> Totals {
    let mut t = Totals { files: 0, objects: 0, attachments: 0, links: 0, other: 0 };
    for e in src.entries.iter().filter(|e| in_space(&e.path, space)) {
        t.files += 1;
        let name = e.path.rsplit('/').next().unwrap();
        let hidden = e.path.split('/').any(|p| p.starts_with('.'));
        if hidden || name.ends_with(".csv") { t.other += 1 }
        else if name.ends_with(".md") { t.objects += 1; t.links += count_links(&String::from_utf8_lossy(&e.bytes)) }
        else { t.attachments += 1 }
    }
    t
}

/// Returns every violated rule; empty means the report accounts for the whole space.
pub fn check(src: &Source, r: &Report) -> Vec<String> {
    let t = totals(src, &r.space);
    let mut errs = Vec::new();
    let mut eq = |what: &str, a: usize, b: usize| if a != b { errs.push(format!("{what}: {a} != {b}")) };
    eq("space files: report = export", r.objects.total + r.attachments.total + r.other_files.total, t.files);
    for (name, tally, total) in [("objects", &r.objects, t.objects), ("attachments", &r.attachments, t.attachments),
                                 ("links", &r.links, t.links), ("other files", &r.other_files, t.other)] {
        eq(&format!("{name}: total = export"), tally.total, total);
        eq(&format!("{name}: imported + reported = total"), tally.imported + tally.reported, tally.total);
    }
    eq("objects reported = skipped list", r.objects.reported, r.skipped_objects.len());
    eq("objects imported = planned list", r.objects.imported, r.planned.len());
    eq("links: one row per link", r.link_rows.len(), r.links.total);
    eq("links reported = reported rows", r.links.reported, r.link_rows.iter().filter(|l| !l.outcome.imported()).count());
    eq("other files reported = dropped list", r.other_files.reported, r.dropped_files.iter().filter(|f| f.kind == DropKind::File).count());
    errs
}

/// Panics with the violated rules (for tests).
pub fn assert_accounted(src: &Source, r: &Report) {
    let errs = check(src, r);
    assert!(errs.is_empty(), "imported + reported != total:\n{}", errs.join("\n"));
}
