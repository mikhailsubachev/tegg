//! Rendering: the import report page draft (FR-IMP-05 AC-1, FR-IMP-19) and the counts-only summary
//! for the real-export run (TS-P2: numbers and indexes only, never names, titles or content).

use crate::plan::{AttrAction, LinkOutcome, Report};
use std::fmt::Write;

pub fn markdown(r: &Report) -> String {
    let mut s = String::new();
    let _ = writeln!(s, "# Import preview: Capacities space {}\n", r.space);
    let _ = writeln!(s, "Time zone for date-times: {}\n", r.time_zone);
    let _ = writeln!(s, "| | Total | Imported | Reported |\n| --- | ---: | ---: | ---: |");
    for (n, t) in [("Objects", &r.objects), ("Attachments", &r.attachments), ("Links", &r.links), ("Other files", &r.other_files)] {
        let _ = writeln!(s, "| {n} | {} | {} | {} |", t.total, t.imported, t.reported);
    }
    if r.already_imported > 0 {
        let _ = writeln!(s, "\n> **Warning:** {} objects were already imported; importing again creates duplicates. Import into a new vault instead (FR-IMP-20).", r.already_imported);
    }
    let _ = writeln!(s, "\n## Types\n\n| Source type | Target type | Folder | Objects |\n| --- | --- | --- | ---: |");
    for t in &r.types { let _ = writeln!(s, "| {} | {} | {} | {} |", t.source, t.target, t.folder, t.count); }
    let _ = writeln!(s, "\n## Attributes\n\n| Type | Attribute | Mapping | Inferred | Values | Empty |\n| --- | --- | --- | --- | ---: | ---: |");
    for a in &r.attributes {
        let m = match &a.action { AttrAction::Keep => "keep".into(), AttrAction::Rename(t) => format!("→ `{t}`"), AttrAction::Drop => "drop".into(), AttrAction::Consumed => "used".into() };
        let _ = writeln!(s, "| {} | `{}` | {} | {} | {} | {} |", a.source_type, a.key, m, a.inferred, a.values, a.nulls);
    }
    let _ = writeln!(s, "\nDates: {} UTC-midnight values → date-only, {} date-times → local offset, {} ranges, {} unparsed.", r.dates.date_only, r.dates.date_times, r.dates.ranges, r.dates.unparsed);
    if !r.value_merges.is_empty() {
        let _ = writeln!(s, "\n## Values to merge\n");
        for m in &r.value_merges { let _ = writeln!(s, "- {} `{}`: {} → **{}**", m.source_type, m.key, m.variants.join(" / "), m.canonical); }
    }
    if !r.task_statuses.is_empty() {
        let _ = writeln!(s, "\n## Task statuses\n");
        for t in &r.task_statuses { let _ = writeln!(s, "- `{}` ({}) → {}", if t.value.is_empty() { "(empty)" } else { &t.value }, t.count, t.state); }
    }
    for (t, k, n) in &r.split_candidates { let _ = writeln!(s, "- Option: split comma-separated {t} `{k}` into a list ({n} values)"); }
    let reported: Vec<_> = r.link_rows.iter().filter(|l| !l.outcome.imported()).collect();
    if !reported.is_empty() {
        let _ = writeln!(s, "\n## Links that need attention\n\n| Note | Line | Target | Why |\n| --- | ---: | --- | --- |");
        for l in reported {
            let why = match &l.outcome {
                LinkOutcome::Unresolved => "not in the export".to_string(),
                LinkOutcome::OtherSpace(sp) => format!("in space {sp}"),
                LinkOutcome::Ambiguous => "several objects have this title".into(),
                LinkOutcome::SelectValue => "becomes a select value".into(),
                LinkOutcome::MissingFile => "file missing, dropped".into(),
                LinkOutcome::InSkippedNote => "note not imported".into(),
                _ => unreachable!(),
            };
            let _ = writeln!(s, "| {} | {} | `{}` | {} |", l.note, l.line, l.target, why);
        }
    }
    let _ = writeln!(s, "\nDate mentions → Daily Note links: {}", r.link_rows.iter().filter(|l| l.outcome == LinkOutcome::DateMention).count());
    for (title, list) in [("Duplicate titles", r.duplicate_titles.iter().map(|d| format!("{}: {}", d.title, d.targets.join(", "))).collect::<Vec<_>>()),
                          ("Query stubs (needs rebuilding)", r.query_stubs.clone()),
                          ("Skipped objects", r.skipped_objects.iter().map(|f| format!("{}: {}", f.path, f.reason)).collect()),
                          ("Dropped files", r.dropped_files.iter().map(|f| format!("{}: {}", f.path, f.reason)).collect()),
                          ("Renamed media", r.renamed_media.iter().map(|(a, b)| format!("{a} → {b}")).collect()),
                          ("Attachments not referenced by any note", r.orphan_attachments.clone()),
                          ("Not in the export (losses)", r.losses.clone())] {
        if list.is_empty() { continue }
        let _ = writeln!(s, "\n## {title}\n");
        for i in list { let _ = writeln!(s, "- {i}"); }
    }
    let _ = writeln!(s, "\n## Clean-up\n\n- Invisible characters removed: {}\n- Files with CRLF line endings: {}\n- Names converted to NFC: {}\n- Checklist items (kept as checklists, D-28): {}\n- Daily-note timestamp lines: {}",
        r.invisible_chars, r.crlf_files, r.read.non_nfc_names, r.checklist_items, r.daily_timestamps);
    s
}

/// TS-P2: one `key: number` line each; type names are replaced by their index.
pub fn counts_only(space_index: usize, r: &Report) -> String {
    let mut s = String::new();
    let mut kv = |k: String, v: usize| { let _ = writeln!(s, "{k}: {v}"); };
    let p = format!("space.{space_index}");
    kv(format!("{p}.read.entries"), r.read.entries);
    kv(format!("{p}.read.unreadable"), r.read.unreadable);
    kv(format!("{p}.read.non_utf8_names"), r.read.non_utf8_names);
    for (n, t) in [("objects", &r.objects), ("attachments", &r.attachments), ("links", &r.links), ("other_files", &r.other_files)] {
        kv(format!("{p}.{n}.total"), t.total);
        kv(format!("{p}.{n}.imported"), t.imported);
        kv(format!("{p}.{n}.reported"), t.reported);
    }
    for (i, t) in r.types.iter().enumerate() { kv(format!("{p}.type.{i}.objects"), t.count) }
    let outcome = |o: &LinkOutcome| r.link_rows.iter().filter(|l| std::mem::discriminant(&l.outcome) == std::mem::discriminant(o)).count();
    for (k, o) in [("resolved", LinkOutcome::Resolved), ("date_mention", LinkOutcome::DateMention), ("attachment", LinkOutcome::Attachment),
                   ("unresolved", LinkOutcome::Unresolved), ("other_space", LinkOutcome::OtherSpace(String::new())), ("ambiguous", LinkOutcome::Ambiguous),
                   ("select_value", LinkOutcome::SelectValue), ("missing_file", LinkOutcome::MissingFile), ("in_skipped_note", LinkOutcome::InSkippedNote)] {
        kv(format!("{p}.links.{k}"), outcome(&o));
    }
    for (k, v) in [("dates.date_only", r.dates.date_only), ("dates.date_times", r.dates.date_times), ("dates.ranges", r.dates.ranges),
                   ("dates.unparsed", r.dates.unparsed), ("duplicate_titles", r.duplicate_titles.len()), ("query_stubs", r.query_stubs.len()),
                   ("tag_collections", r.tag_collections.len()), ("renamed_media", r.renamed_media.len()), ("orphan_attachments", r.orphan_attachments.len()),
                   ("value_merges", r.value_merges.len()), ("split_candidates", r.split_candidates.len()), ("invisible_chars", r.invisible_chars),
                   ("crlf_files", r.crlf_files), ("checklist_items", r.checklist_items), ("daily_timestamps", r.daily_timestamps),
                   ("unknown_cover_values", r.unknown_cover_values), ("attributes", r.attributes.len()),
                   ("attributes_renamed", r.attributes.iter().filter(|a| matches!(a.action, AttrAction::Rename(_))).count()),
                   ("attributes_dropped", r.attributes.iter().filter(|a| a.action == AttrAction::Drop).count())] {
        kv(format!("{p}.{k}"), v);
    }
    s
}

/// TS-P2: the counts-only output must match this format, so a later change can't start printing names.
pub fn is_counts_only(s: &str) -> bool {
    let re = regex::Regex::new(r"^[a-z0-9_.]+: \d+$").unwrap();
    s.lines().all(|l| re.is_match(l))
}
