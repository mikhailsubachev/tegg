//! BRD §11.1 / S5-QA AC-3: "every object, attachment and link is either imported or listed in the report".
//! The totals are recomputed from the raw export, independently of the planner, and every reported item
//! must appear in a report list. Used by the fixture tests and the real-export run.

use crate::plan::{is_attachment_file, is_object_file, space_files, Report};
use crate::scan;
use crate::source::Source;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Totals { pub files: usize, pub objects: usize, pub attachments: usize, pub links: usize, pub other: usize }

pub fn totals(src: &Source, space: &str) -> Totals {
    let mut t = Totals { files: 0, objects: 0, attachments: 0, links: 0, other: 0 };
    for (inner, e) in space_files(src, space) {
        t.files += 1;
        if is_object_file(inner) {
            t.objects += 1;
            t.links += scan::links(&String::from_utf8_lossy(&e.bytes)).len();
        } else if is_attachment_file(inner) { t.attachments += 1 } else { t.other += 1 }
    }
    t
}

/// Returns every violated rule; empty means the report accounts for the whole space.
pub fn check(src: &Source, r: &Report) -> Vec<String> {
    let t = totals(src, &r.space);
    let mut errs = Vec::new();
    let mut eq = |what: &str, a: usize, b: usize| if a != b { errs.push(format!("{what}: {a} != {b}")) };
    eq("files = objects + attachments + other", t.files, t.objects + t.attachments + t.other);
    for (name, tally, total) in [("objects", &r.objects, t.objects), ("attachments", &r.attachments, t.attachments),
                                 ("links", &r.links, t.links), ("other files", &r.other_files, t.other)] {
        eq(&format!("{name}: total = export"), tally.total, total);
        eq(&format!("{name}: imported + reported = total"), tally.imported + tally.reported, tally.total);
    }
    eq("objects reported = skipped list", r.objects.reported, r.skipped_objects.len());
    eq("objects imported = planned list", r.objects.imported, r.planned.len());
    eq("links: one row per link", r.link_rows.len(), r.links.total);
    eq("links reported = reported rows", r.links.reported, r.link_rows.iter().filter(|l| !l.outcome.imported()).count());
    let dropped_files = r.dropped_files.iter().filter(|f| !f.reason.starts_with("referenced from")).count();
    eq("other files reported = dropped list", r.other_files.reported, dropped_files);
    errs
}

/// Panics with the violated rules (for tests).
pub fn assert_accounted(src: &Source, r: &Report) {
    let errs = check(src, r);
    assert!(errs.is_empty(), "imported + reported != total:\n{}", errs.join("\n"));
}
