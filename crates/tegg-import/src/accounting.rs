//! §6 (R147, FR-IMP-05 AC-6): "every object, attachment and link is either imported or listed in the report".
//! The totals are recomputed from the raw entries with rules of this module's own: space membership by path alone,
//! classes by extension, and a line scanner for links (§6.5) that shares nothing with `@tegg/doc` or the plan's code.
//! Ported from the S5 spike's `accounting.rs`; it now counts external links and checks the written vault.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use regex::Regex;

use crate::{AttachmentOutcome, AttrChange, LinkOutcome, ObjectKind, ObjectOutcome, Plan, RawTotals, SkippedRow, Source, Tally};

#[derive(Clone, Debug, PartialEq)]
pub struct Violation {
    pub class: Class,
    pub code: ViolationCode,
    pub detail: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Class {
    Objects,
    Attachments,
    Links,
    OtherFiles,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ViolationCode {
    TotalMismatch,
    SumMismatch,
    MissingRow,
    ForeignItem,
    DuplicateItem,
    NotWritten,
    WrittenNotPlanned,
}

// ------------------------------------------------------------------------------------------------ membership, classes

/// The path inside `space`, by path alone: the first folder named as a space is the file's space.
fn inner<'a>(path: &'a str, space: &str, spaces: &[String], single: Option<&str>) -> Option<&'a str> {
    if let Some(only) = single {
        return (only == space).then_some(path);
    }
    let mut at = 0;
    let parts: Vec<&str> = path.split('/').collect();
    for (i, part) in parts.iter().enumerate() {
        if i + 1 < parts.len() && spaces.iter().any(|s| s == part) {
            return (*part == space).then(|| &path[at + part.len() + 1..]);
        }
        at += part.len() + 1;
    }
    None
}
fn in_any_space(path: &str, spaces: &[String], single: bool) -> bool {
    single || {
        let parts: Vec<&str> = path.split('/').collect();
        parts.iter().enumerate().any(|(i, p)| i + 1 < parts.len() && spaces.iter().any(|s| s == p))
    }
}
#[derive(PartialEq)]
enum Kind {
    Object,
    Attachment,
    Other,
}
fn kind(inner: &str) -> Kind {
    let hidden = inner.split('/').any(|p| p.starts_with('.'));
    if hidden || inner.to_ascii_lowercase().ends_with(".csv") {
        Kind::Other
    } else if inner.ends_with(".md") {
        Kind::Object
    } else {
        Kind::Attachment
    }
}

/// §6.2: the totals of a space, from the raw entries.
pub fn totals(source: &Source, space: &str) -> RawTotals {
    let raw = source.raw();
    let mut t = RawTotals { objects: 0, attachments: 0, links: 0, other_files: raw.nameless };
    for path in raw.paths() {
        let Some(inside) = inner(path, space, &raw.spaces, raw.single.as_deref()) else {
            if !in_any_space(path, &raw.spaces, raw.single.is_some()) {
                t.other_files += 1;
            }
            continue;
        };
        match kind(inside) {
            Kind::Other => t.other_files += 1,
            Kind::Attachment => t.attachments += 1,
            Kind::Object => {
                t.objects += 1;
                t.links += raw.text(path).map(|text| count_links(&text)).unwrap_or(0);
            }
        }
    }
    t
}

// ------------------------------------------------------------------------------------------------ the link counter (§6.5)

fn re(cell: &'static std::sync::OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("a constant pattern"))
}
fn fence_open(line: &str) -> Option<(char, usize)> {
    static FENCE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let m = re(&FENCE, r"^ {0,3}(`{3,}|~{3,})(.*)$").captures(line)?;
    let run = m.get(1)?.as_str();
    let c = run.chars().next()?;
    (c != '`' || !m.get(2).is_some_and(|rest| rest.as_str().contains('`'))).then_some((c, run.len()))
}
fn fence_close(line: &str, open: (char, usize)) -> bool {
    let t = line.trim_start_matches(' ');
    line.len() - t.len() <= 3 && t.trim_end().chars().all(|c| c == open.0) && t.trim_end().chars().count() >= open.1
}
fn html_start(line: &str) -> bool {
    static HTML: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    re(&HTML, r"^ {0,3}(<[A-Za-z][A-Za-z0-9-]*([\s/>]|$)|</|<!--|<\?)").is_match(line)
}
fn list_item(line: &str) -> bool {
    static ITEM: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    re(&ITEM, r"^\s*([-*+]|\d{1,9}[.)])(\s|$)").is_match(line)
}

/// §6.4: every `[[…]]` with a non-empty target and every `](destination)` with a non-empty destination whose `[` can
/// be paired, external ones included, outside code, HTML blocks, math and comments; frontmatter lines are text too.
pub fn count_links(text: &str) -> usize {
    let text = text.replace("\r\n", "\n");
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let mut count = 0;
    let mut lines = text.split('\n').peekable();
    // The frontmatter: each line is read on its own.
    if lines.peek().is_some_and(|l| l.trim_end() == "---") && text.split('\n').skip(1).any(|l| l.trim_end() == "---") {
        lines.next();
        for line in lines.by_ref() {
            if line.trim_end() == "---" {
                break;
            }
            count += inline(line);
        }
    }
    let mut paragraph = String::new();
    let mut fence: Option<(char, usize)> = None;
    let (mut html, mut list_open) = (false, false);
    for line in lines {
        if let Some(open) = fence {
            if fence_close(line, open) {
                fence = None;
            }
            continue;
        }
        if line.trim().is_empty() {
            count += inline(&paragraph);
            paragraph.clear();
            html = false;
            continue;
        }
        if html {
            continue;
        }
        if let Some(open) = fence_open(line) {
            count += inline(&paragraph);
            paragraph.clear();
            fence = Some(open);
            continue;
        }
        let indented = line.starts_with("    ") || line.starts_with('\t');
        if paragraph.is_empty() {
            if html_start(line) {
                html = true;
                continue;
            }
            if indented && !list_open {
                continue;
            }
        }
        if list_item(line) {
            list_open = true;
        } else if !line.starts_with([' ', '\t']) {
            list_open = false;
        }
        paragraph.push_str(line);
        paragraph.push('\n');
    }
    count + inline(&paragraph)
}

/// The links of one paragraph (or one frontmatter line).
fn inline(text: &str) -> usize {
    let c: Vec<char> = text.chars().collect();
    let n = c.len();
    let mut count = 0;
    // Open single brackets: (is an image, may still become a link).
    let mut stack: Vec<(bool, bool)> = Vec::new();
    let mut i = 0;
    let find = |from: usize, a: char, b: char| (from..n.saturating_sub(1)).find(|&j| c[j] == a && c[j + 1] == b);
    while i < n {
        match c[i] {
            '\\' => i += 2,
            '`' => {
                let run = c[i..].iter().take_while(|x| **x == '`').count();
                let mut j = i + run;
                let mut close = None;
                while j < n {
                    if c[j] == '`' {
                        let r = c[j..].iter().take_while(|x| **x == '`').count();
                        if r == run {
                            close = Some(j + r);
                            break;
                        }
                        j += r;
                    } else {
                        j += 1;
                    }
                }
                i = close.unwrap_or(i + run);
            }
            '$' if i + 1 < n && c[i + 1] == '$' => i = find(i + 2, '$', '$').map(|j| j + 2).unwrap_or(n),
            '%' if i + 1 < n && c[i + 1] == '%' => i = find(i + 2, '%', '%').map(|j| j + 2).unwrap_or(n),
            '[' if i + 1 < n && c[i + 1] == '[' => {
                // A wikilink: `]]` on the same line, no bracket inside, a non-empty target.
                let mut j = i + 2;
                while j < n && !matches!(c[j], '[' | ']' | '\n') {
                    j += 1;
                }
                if j + 1 < n && c[j] == ']' && c[j + 1] == ']' {
                    let inner: String = c[i + 2..j].iter().collect();
                    let target = inner.split('|').next().unwrap_or("").split('#').next().unwrap_or("");
                    if !target.trim().is_empty() {
                        count += 1;
                        i = j + 2;
                        continue;
                    }
                }
                stack.push((i > 0 && c[i - 1] == '!', true));
                i += 1;
            }
            '[' => {
                stack.push((i > 0 && c[i - 1] == '!', true));
                i += 1;
            }
            ']' => {
                let Some((image, active)) = stack.pop() else {
                    i += 1;
                    continue;
                };
                if active && i + 1 < n && c[i + 1] == '(' {
                    if let Some(end) = destination(&c, i + 2) {
                        count += 1;
                        if !image {
                            // A link can't hold a link: the brackets still open around it open nothing.
                            stack.iter_mut().for_each(|s| s.1 = false);
                        }
                        i = end;
                        continue;
                    }
                }
                i += 1;
            }
            _ => i += 1,
        }
    }
    count
}

/// From after `](`: the index after the closing `)` when a non-empty destination (and an optional title) is there.
fn destination(c: &[char], from: usize) -> Option<usize> {
    let n = c.len();
    let ws = |mut i: usize| {
        while i < n && c[i].is_whitespace() {
            i += 1;
        }
        i
    };
    let mut i = ws(from);
    let start = i;
    if i < n && c[i] == '<' {
        while i < n && c[i] != '>' && c[i] != '\n' {
            i += 1;
        }
        if i >= n || c[i] != '>' || i == start + 1 {
            return None;
        }
        i += 1;
    } else {
        let mut depth = 0;
        while i < n && !c[i].is_whitespace() {
            match c[i] {
                '\\' => i += 1,
                '(' => depth += 1,
                ')' if depth == 0 => break,
                ')' => depth -= 1,
                _ => {}
            }
            i += 1;
        }
        if i == start {
            return None;
        }
    }
    i = ws(i);
    if i < n && matches!(c[i], '"' | '\'' | '(') {
        let close = if c[i] == '(' { ')' } else { c[i] };
        i += 1;
        while i < n && c[i] != close {
            i += if c[i] == '\\' { 2 } else { 1 };
        }
        i = ws(i + 1);
    }
    (i < n && c[i] == ')').then_some(i + 1)
}

// ------------------------------------------------------------------------------------------------ the checks

fn violation(class: Class, code: ViolationCode, detail: impl Into<String>) -> Violation {
    Violation { class, code, detail: detail.into() }
}

/// §6.2: the plan against the raw entries.
pub fn check_plan(source: &Source, plan: &Plan) -> Vec<Violation> {
    let mut out = Vec::new();
    let raw = totals(source, &plan.space);
    let view = source.raw();
    let in_space: BTreeSet<&str> = view.paths().filter_map(|p| inner(p, &plan.space, &view.spaces, view.single.as_deref())).collect();
    let sums = |class: Class, tally: &Tally, total: usize, out: &mut Vec<Violation>| {
        if tally.total != total {
            out.push(violation(class, ViolationCode::TotalMismatch, format!("plan {} != export {total}", tally.total)));
        }
        if tally.imported + tally.reported != tally.total {
            out.push(violation(class, ViolationCode::SumMismatch, format!("{} + {} != {}", tally.imported, tally.reported, tally.total)));
        }
    };
    sums(Class::Objects, &plan.totals.objects, raw.objects, &mut out);
    sums(Class::Attachments, &plan.totals.attachments, raw.attachments, &mut out);
    sums(Class::Links, &plan.totals.links, raw.links, &mut out);
    sums(Class::OtherFiles, &plan.totals.other_files, raw.other_files, &mut out);

    let report = &plan.report;
    // Objects: every `.md` of the space once; a made media object stands on an imported attachment.
    let notes: Vec<_> = plan.objects.iter().filter(|o| o.kind != ObjectKind::OrphanMedia).collect();
    let (mut imported, mut reported) = (0, 0);
    let mut seen = BTreeSet::new();
    for o in &plan.objects {
        if !seen.insert(o.source.as_str()) {
            out.push(violation(Class::Objects, ViolationCode::DuplicateItem, o.source.clone()));
        }
        if o.kind == ObjectKind::OrphanMedia {
            if !plan.attachments.iter().any(|a| a.source == o.source && a.outcome == AttachmentOutcome::Imported) {
                out.push(violation(Class::Objects, ViolationCode::ForeignItem, o.source.clone()));
            }
            continue;
        }
        if !in_space.contains(o.source.as_str()) || kind(&o.source) != Kind::Object {
            out.push(violation(Class::Objects, ViolationCode::ForeignItem, o.source.clone()));
        }
        match &o.outcome {
            ObjectOutcome::Imported => imported += 1,
            ObjectOutcome::Skipped => {
                reported += 1;
                let row = report.skipped.iter().any(|r| matches!(r, SkippedRow::Type { source_type, .. } if Some(source_type) == o.source_type.as_ref()));
                if !row {
                    out.push(violation(Class::Objects, ViolationCode::MissingRow, o.source.clone()));
                }
            }
            ObjectOutcome::Unreadable { .. } => {
                reported += 1;
                if !report.skipped.iter().any(|r| matches!(r, SkippedRow::Note { source, .. } if *source == o.source)) {
                    out.push(violation(Class::Objects, ViolationCode::MissingRow, o.source.clone()));
                }
            }
        }
    }
    if notes.len() != raw.objects || imported != plan.totals.objects.imported || reported != plan.totals.objects.reported {
        out.push(violation(Class::Objects, ViolationCode::TotalMismatch, format!("{} planned, {imported} imported, {reported} reported; export {}", notes.len(), raw.objects)));
    }
    // Attachments.
    let (mut imported, mut reported) = (0, 0);
    let mut seen = BTreeSet::new();
    for a in &plan.attachments {
        if !seen.insert(a.source.as_str()) {
            out.push(violation(Class::Attachments, ViolationCode::DuplicateItem, a.source.clone()));
        }
        if !in_space.contains(a.source.as_str()) || kind(&a.source) != Kind::Attachment {
            out.push(violation(Class::Attachments, ViolationCode::ForeignItem, a.source.clone()));
        }
        match &a.outcome {
            AttachmentOutcome::Imported => imported += 1,
            AttachmentOutcome::Unreadable { .. } => {
                reported += 1;
                if !report.skipped.iter().any(|r| matches!(r, SkippedRow::Attachment { source, .. } if *source == a.source)) {
                    out.push(violation(Class::Attachments, ViolationCode::MissingRow, a.source.clone()));
                }
            }
        }
    }
    if plan.attachments.len() != raw.attachments || imported != plan.totals.attachments.imported || reported != plan.totals.attachments.reported {
        out.push(violation(Class::Attachments, ViolationCode::TotalMismatch, format!("{} planned; export {}", plan.attachments.len(), raw.attachments)));
    }
    // Links: one row per link; every reported one in a report list.
    let (mut imported, mut reported) = (0, 0);
    let mut seen = BTreeSet::new();
    let mut select: BTreeMap<&str, usize> = BTreeMap::new();
    for l in &plan.links {
        if !seen.insert((l.note.as_str(), l.n)) {
            out.push(violation(Class::Links, ViolationCode::DuplicateItem, format!("{} #{}", l.note, l.n)));
        }
        if !plan.objects.iter().any(|o| o.source == l.note) {
            out.push(violation(Class::Links, ViolationCode::ForeignItem, format!("{} #{}", l.note, l.n)));
        }
        if l.outcome.imported() {
            imported += 1;
            continue;
        }
        reported += 1;
        let at = |note: &str, n: u32| note == l.note && n == l.n;
        let listed = match &l.outcome {
            LinkOutcome::Ambiguous => report.ambiguous.iter().any(|r| at(&r.note, r.n)),
            LinkOutcome::CaseMismatch { .. } => report.case_links.iter().any(|r| at(&r.note, r.n)),
            LinkOutcome::SelectValue => {
                *select.entry(l.note.as_str()).or_default() += 1;
                report.attributes.iter().any(|r| matches!(r.change, AttrChange::SelectValues { .. }))
            }
            _ => report.unresolved.iter().any(|r| at(&r.note, r.n)),
        };
        if !listed {
            out.push(violation(Class::Links, ViolationCode::MissingRow, format!("{} #{}", l.note, l.n)));
        }
    }
    if plan.links.len() != raw.links || imported != plan.totals.links.imported || reported != plan.totals.links.reported {
        out.push(violation(Class::Links, ViolationCode::TotalMismatch, format!("{} planned, {imported} imported, {reported} reported; export {}", plan.links.len(), raw.links)));
    }
    // Other files: all reported, each with its row.
    if plan.other_files.len() != raw.other_files || plan.totals.other_files.reported != plan.other_files.len() {
        out.push(violation(Class::OtherFiles, ViolationCode::TotalMismatch, format!("{} planned; export {}", plan.other_files.len(), raw.other_files)));
    }
    let rows = report.skipped.iter().filter(|r| matches!(r, SkippedRow::Ignored { .. } | SkippedRow::Entry { .. })).count();
    if rows != plan.other_files.len() {
        out.push(violation(Class::OtherFiles, ViolationCode::MissingRow, format!("{rows} rows for {} files", plan.other_files.len())));
    }
    out
}

/// §6.3: `check_plan`, and the written vault: every imported object and attachment at its planned path, and no file
/// with an `import-id` of this run outside the plan.
pub fn check_vault(source: &Source, plan: &Plan, root: &Path) -> Vec<Violation> {
    let mut out = check_plan(source, plan);
    let vault = tegg_vault::ExternalFolder::new(root);
    let listed: Vec<String> = tegg_vault::ExternalRead::list(&vault).unwrap_or_default().into_iter().map(|(p, _, _)| p).collect();
    let on_disk: BTreeSet<String> = listed.iter().map(|p| tegg_format::nfc(p)).collect();
    let mut planned: BTreeSet<&str> = BTreeSet::new();
    for o in plan.objects.iter().filter(|o| o.outcome == ObjectOutcome::Imported) {
        match &o.path {
            Some(p) if on_disk.contains(p) => {
                planned.insert(p);
            }
            _ => out.push(violation(Class::Objects, ViolationCode::NotWritten, o.source.clone())),
        }
    }
    for a in plan.attachments.iter().filter(|a| a.outcome == AttachmentOutcome::Imported) {
        if !a.path.as_ref().is_some_and(|p| on_disk.contains(p)) {
            out.push(violation(Class::Attachments, ViolationCode::NotWritten, a.source.clone()));
        }
    }
    let ids: BTreeSet<&str> = plan.objects.iter().map(|o| o.import_id.as_str()).collect();
    let prefix = format!("capacities:{}/", plan.space);
    for raw in &listed {
        let path = tegg_format::nfc(raw);
        if !path.ends_with(".md") || path.starts_with('.') || path.starts_with("_templates/") || planned.contains(path.as_str()) {
            continue;
        }
        let Some(text) = read_text(&vault, raw) else { continue };
        if let Some(id) = import_id(&text) {
            // An earlier import's files carry the same ids (FR-IMP-20): they are the vault's, not this run's.
            let fresh = plan.already_imported == 0;
            if fresh && (ids.contains(id.as_str()) || (id.starts_with(&prefix) && matches!(plan.target, crate::PlanTarget::NewVault { .. }))) {
                out.push(violation(Class::Objects, ViolationCode::WrittenNotPlanned, path));
            }
        }
    }
    out
}

fn read_text(vault: &tegg_vault::ExternalFolder, rel: &str) -> Option<String> {
    use std::io::Read;
    let mut f = tegg_vault::ExternalRead::open(vault, rel).ok()?;
    let mut text = String::new();
    f.read_to_string(&mut text).ok()?;
    Some(text)
}

/// The `import-id` of a written file: its frontmatter line, unquoted.
fn import_id(text: &str) -> Option<String> {
    let rest = text.strip_prefix("---\n")?;
    for line in rest.lines() {
        if line == "---" {
            return None;
        }
        if let Some(v) = line.strip_prefix("import-id:") {
            let v = v.trim();
            let v = v.strip_prefix('"').and_then(|x| x.strip_suffix('"')).map(|x| x.replace("\\\"", "\"").replace("\\\\", "\\")).unwrap_or_else(|| v.trim_matches('\'').to_string());
            return Some(tegg_format::nfc(&v));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_counts_as_a_link() {
        assert_eq!(count_links("[[a]] [[a|b]] ![[f.png]] [[]] [[ |x]]"), 3);
        assert_eq!(count_links("[t](d) ![alt](d \"title\") [t](<d with spaces>) [t](a(b)c) [t]() [t] (d)"), 4);
        assert_eq!(count_links("[![logo](https://e.com/l.png)](../a.md)"), 2, "an image inside a link is a second link");
        assert_eq!(count_links("[první řádek\ndruhý řádek](a.md) [viz [poznámka] zde](a.md)"), 2);
        assert_eq!(count_links("[a [b](x) c](y)"), 1, "a link can't hold a link");
        assert_eq!(count_links("<https://e.com> https://e.com [text][ref] [ref][] [ref]\n\n[ref]: https://e.com\n"), 0);
        assert_eq!(count_links("`[[a]]` ``[t](d) ` `` \\[\\[a]] \\[t](d) $$[[a]]$$ %%[[a]]%%"), 0);
        assert_eq!(count_links("```\n[[a]]\n```\n\n~~~md\n[t](d)\n~~~\n\n    [[indented]]\n\n<div>\n[[html]]\n</div>\n\n[[b]]\n"), 1);
        assert_eq!(count_links("- položka\n\n    [[v seznamu]]\n\nText\n"), 1, "indented text under a list item is not code");
        assert_eq!(count_links("---\nstatus: '[[in progress]]'\nlidé: ['[[A]]', '[[B]]']\nurl: https://example.com\ntags: [a, b]\n---\n\nText.\n"), 3);
        assert_eq!(count_links("| A |\n| --- |\n| [[Plán\\|úkol]] |\n"), 1);
        assert_eq!(count_links("- [ ] úkol\n- [x] [[a]]\n"), 1);
    }

    #[test]
    fn membership_by_path() {
        let spaces = vec!["PKM".to_string(), "Work".to_string()];
        assert_eq!(inner("PKM/Pages/a.md", "PKM", &spaces, None), Some("Pages/a.md"));
        assert_eq!(inner("export/PKM/Pages/a.md", "PKM", &spaces, None), Some("Pages/a.md"));
        assert_eq!(inner("Work/Pages/a.md", "PKM", &spaces, None), None);
        assert_eq!(inner("Čti mě.txt", "PKM", &spaces, None), None);
        assert!(!in_any_space("export/Čti mě.txt", &spaces, false));
        assert_eq!(inner("Daily/a.md", "Deník", &[], Some("Deník")), Some("Daily/a.md"));
    }
}
