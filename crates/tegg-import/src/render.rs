//! §7: what the run hands to `@tegg/doc` and to `tegg-schema`, built from the `Plan` alone (plus a fresh
//! `import-scan` of each note, whose link numbers are the plan's). Rust decides values, names, outcomes and the order
//! of keys; it never builds a note's text (ADR 0003). Also `start`'s validation of a plan (§9).

use std::collections::{BTreeMap, HashSet};

use serde_json::{json, Value};
use tegg_schema::{AttrDef, AttrType, OptionDef, PatchContext, TypeOp};

use crate::note::{base_name, fold, ScanDto};
use crate::planner::{link_stem, Paths};
use crate::*;

/// The vault paths D-184 needs: the plan's, and the target's existing files.
pub(crate) fn plan_paths(plan: &Plan, existing: &[String]) -> Paths {
    let mut paths = Paths::default();
    existing.iter().for_each(|p| paths.add(p));
    plan.objects.iter().filter_map(|o| o.path.as_ref()).for_each(|p| paths.add(p));
    plan.attachments.iter().filter_map(|a| a.path.as_ref()).for_each(|p| paths.add(p));
    paths.add(&plan.report_path);
    paths
}

/// R149's whole frontmatter: `id` first, and the import time where the source gave no `created` / `modified`.
fn frontmatter(planned: &[(String, FmValue)], id: &str, now: &str) -> Value {
    let mut fm: Vec<(String, FmValue)> = vec![("id".to_string(), FmValue::Text(id.to_string()))];
    fm.extend(planned.iter().cloned());
    let time = || FmValue::Datetime { datetime: now.to_string() };
    if !fm.iter().any(|(k, _)| k == "created") {
        let at = fm.iter().position(|(k, _)| k == "modified").unwrap_or(fm.len());
        fm.insert(at, ("created".to_string(), time()));
    }
    if !fm.iter().any(|(k, _)| k == "modified") {
        fm.push(("modified".to_string(), time()));
    }
    Value::Array(fm.into_iter().map(|(k, v)| json!([k, v])).collect())
}

/// `ImportNoteSpec` of one source note (§7.1, §8). `Err`: the note's links aren't the plan's any more.
pub(crate) fn note_spec(plan: &Plan, o: &PlannedObject, scan: &ScanDto, id: &str, now: &str, paths: &Paths, strings: &ReportStrings) -> Result<Value, ()> {
    let mut edits: Vec<Value> = Vec::new();
    let mut stems: Vec<&str> = Vec::new();
    let stub = o.kind == ObjectKind::QueryStub;
    for l in plan.links.iter().filter(|l| l.note == o.source) {
        let fresh = scan.links.iter().find(|s| s.n == l.n).filter(|s| s.written == l.written).ok_or(())?;
        if stub || l.place != LinkPlace::Body {
            continue;
        }
        let embed = matches!(l.form, LinkForm::Image | LinkForm::Embed);
        match (&l.outcome, &l.to) {
            (LinkOutcome::Attachment, Some(to)) if embed => edits.push(json!({ "n": l.n, "do": "embed", "file": base_name(to) })),
            (LinkOutcome::Resolved | LinkOutcome::Ambiguous | LinkOutcome::CaseMismatch { confirmed: true } | LinkOutcome::Attachment, Some(to)) => {
                stems.push(to);
                edits.push(json!({ "n": l.n, "do": "link", "toPath": to, "shown": fresh.text }));
            }
            (LinkOutcome::DateMention, _) => {
                let t = l.target.trim();
                edits.push(json!({ "n": l.n, "do": "date", "date": t.strip_prefix("Date/").unwrap_or(t) }));
            }
            (LinkOutcome::MissingFile, _) => edits.push(json!({ "n": l.n, "do": "drop" })),
            _ => {}
        }
    }
    if scan.links.len() != plan.links.iter().filter(|l| l.note == o.source).count() {
        return Err(());
    }
    let mut same: Vec<&String> = stems.iter().flat_map(|to| paths.same_stem(to)).collect();
    same.sort();
    same.dedup();
    let mut spec = json!({ "frontmatter": frontmatter(&o.frontmatter, id, now), "links": edits, "paths": same });
    if stub {
        spec["stub"] = json!({ "note": strings.word("stub.note") });
    }
    Ok(spec)
}

/// `ImportNewSpec` of a made Image or PDF object (D-77).
pub(crate) fn media_spec(o: &PlannedObject, id: &str, now: &str) -> Value {
    let file = o.frontmatter.iter().find_map(|(k, v)| if let ("file", FmValue::Link { link }) = (k.as_str(), v) { Some(link.clone()) } else { None }).unwrap_or_default();
    json!({ "kind": "media", "frontmatter": frontmatter(&o.frontmatter, id, now), "file": file })
}

/// `ImportNewSpec` of the report Page (§7.4). `objects`: a row's source path → the planned path of its object.
pub(crate) fn report_spec(plan: &Plan, data: &ReportData, id: &str, now: &str, paths: &Paths, strings: &ReportStrings) -> Value {
    let title = link_stem(&plan.report_path).to_string();
    let fm = vec![("type".to_string(), FmValue::Text("page".into())), ("title".to_string(), FmValue::Text(title))];
    let mut objects: BTreeMap<&str, &str> = BTreeMap::new();
    for o in plan.objects.iter().filter(|o| o.outcome == ObjectOutcome::Imported) {
        if let Some(p) = &o.path {
            objects.insert(&o.source, p);
        }
    }
    for a in &plan.attachments {
        let object = a.object.as_ref().and_then(|s| plan.objects.iter().find(|o| o.source == *s)).and_then(|o| o.path.as_deref());
        if let Some(p) = object {
            objects.insert(&a.source, p);
        }
    }
    let mut all: Vec<&String> = objects.values().flat_map(|p| paths.same_stem(p)).collect();
    all.sort();
    all.dedup();
    json!({ "kind": "report", "frontmatter": frontmatter(&fm, id, now), "data": data, "strings": strings.0, "paths": all, "objects": objects })
}

/// A type file the run writes.
pub(crate) struct TypeWrite {
    /// The target type's key (the existing-vault sink reads and stamps its file by it).
    #[allow(dead_code)]
    pub key: String,
    pub path: String,
    pub text: String,
    /// A new type (created), or an existing one that gains attributes (`false`).
    pub new: bool,
}

/// §7.2: the new type files and the extended ones, in the plan's type order. `base`: the text of an existing type
/// file (a new vault: `EMPTY_VAULT`'s).
pub(crate) fn type_files(plan: &Plan, base: &dyn Fn(&str) -> Option<String>) -> Result<Vec<TypeWrite>, String> {
    let mut out: Vec<TypeWrite> = Vec::new();
    let mut done: HashSet<&str> = HashSet::new();
    for t in &plan.types {
        let Some(key) = t.key.as_deref() else { continue };
        if !done.insert(key) {
            continue;
        }
        let mut attrs: Vec<AttrDef> = Vec::new();
        for (owner, a) in plan.types.iter().filter(|x| x.key.as_deref() == Some(key)).flat_map(|x| x.attributes.iter().map(move |a| (x, a))).filter(|(_, a)| a.action == AttrAction::New) {
            let (Some(k), Some(kind)) = (&a.key, &a.r#type) else { continue };
            let kind = AttrType::parse(kind);
            let split = a.split.as_ref().filter(|s| s.on);
            let to = split.and_then(|s| s.to.as_ref()).and_then(|st| plan.types.iter().find(|x| x.source_type == *st)).and_then(|x| x.key.clone());
            let many = plan.objects.iter().filter(|o| o.source_type.as_deref() == Some(owner.source_type.as_str())).any(|o| o.frontmatter.iter().any(|(fk, v)| fk == k && matches!(v, FmValue::Links { .. } | FmValue::List(_))));
            attrs.push(AttrDef {
                key: k.clone(),
                name: a.name.clone().unwrap_or_else(|| k.clone()),
                options: if kind.has_options() { a.options.iter().map(|label| OptionDef { label: label.clone(), color: None, extra: Vec::new() }).collect() } else { Vec::new() },
                to: if kind == AttrType::Relation { to.map(|t| vec![t]) } else { None },
                multiple: kind == AttrType::Relation && (split.is_some() || many),
                r#type: kind,
                default: None,
                required: false,
                description: None,
                built_in: false,
            });
        }
        let path = format!(".tegg/types/{key}.yml");
        if t.new {
            let (name, plural, folder) = (t.name.as_deref().unwrap_or(key), t.plural.as_deref().unwrap_or(key), t.folder.as_deref());
            let mut def = tegg_schema::parse(key, &tegg_schema::new_type_file_in(name, plural, folder)).def;
            def.attributes = attrs;
            out.push(TypeWrite { key: key.to_string(), path, text: tegg_schema::serialize(&def), new: true });
        } else if !attrs.is_empty() {
            let text = base(key).ok_or_else(|| format!("the type file of `{key}` can't be read"))?;
            let ops: Vec<TypeOp> = attrs.into_iter().map(TypeOp::AddAttribute).collect();
            let patched = tegg_schema::patch(key, &text, &ops, &PatchContext { others: &[] }).map_err(|e| format!("{key}: {e:?}"))?;
            out.push(TypeWrite { key: key.to_string(), path, text: patched.unwrap_or(text), new: false });
        }
    }
    Ok(out)
}

// ------------------------------------------------------------------------------------------------ §9: a plan is never trusted

fn path_ok(path: &str) -> bool {
    !path.is_empty()
        && tegg_format::nfc(path) == path
        && !path.contains(['\\', '\0'])
        && path.split('/').all(|part| !part.is_empty() && part != "." && part != ".." && !part.starts_with('.') && part.len() <= 204 && !part.contains([':', '*', '?', '"', '<', '>', '|']) && !part.ends_with([' ', '.']) && !part.starts_with(' '))
}

/// §9's table. `folder_of`: the folder of a target type key.
pub(crate) fn validate(plan: &Plan, scan: &Scan, target: &Target<'_>, folder_of: &dyn Fn(&str) -> Option<String>) -> Result<(), ImportError> {
    let bad = |path: Option<&str>, reason| Err(ImportError::InvalidPlan { path: path.map(str::to_string), reason });
    if plan.version != 1 {
        return bad(None, PlanReason::Version);
    }
    let target_ok = match (&plan.target, target) {
        (PlanTarget::NewVault { parent, name }, Target::NewVault { parent: p, name: n }) => *parent == p.to_string_lossy() && name == n && !n.is_empty() && tegg_format::sanitize_file_stem(n) == *n,
        (PlanTarget::Existing { name, .. }, Target::Existing(core)) => core.vault().root().file_name().is_some_and(|f| tegg_format::nfc(&f.to_string_lossy()) == *name),
        _ => false,
    };
    if !target_ok || !scan.info.spaces.iter().any(|s| s.name == plan.space) {
        return bad(None, PlanReason::Target);
    }
    let mut all: Vec<&str> = plan.objects.iter().filter_map(|o| o.path.as_deref()).chain(plan.attachments.iter().filter_map(|a| a.path.as_deref())).collect();
    all.push(&plan.report_path);
    for p in all.iter().copied().chain(plan.links.iter().filter_map(|l| l.to.as_deref())) {
        if !path_ok(p) {
            return bad(Some(p), PlanReason::Path);
        }
    }
    let in_folder = |path: &str, folder: &str, ext: &str| path.strip_prefix(folder).and_then(|r| r.strip_prefix('/')).is_some_and(|name| !name.contains('/') && name.ends_with(ext) && name.len() > ext.len());
    for t in &plan.types {
        if let Some(k) = &t.key {
            if tegg_format::type_key(k) != *k || k.contains(['/', '\\']) || k.starts_with('.') {
                return bad(Some(k), PlanReason::TypeKey);
            }
        }
    }
    for o in &plan.objects {
        let Some(p) = o.path.as_deref() else { continue };
        let folder = o.r#type.as_deref().and_then(|k| plan.types.iter().find(|t| t.key.as_deref() == Some(k)).and_then(|t| t.folder.clone()).or_else(|| folder_of(k)));
        if !folder.is_some_and(|f| in_folder(p, &f, ".md")) || p.starts_with("_templates/") {
            return bad(Some(p), PlanReason::Place);
        }
    }
    for p in plan.attachments.iter().filter_map(|a| a.path.as_deref()) {
        if !in_folder(p, "_attachments", "") {
            return bad(Some(p), PlanReason::Place);
        }
    }
    if !folder_of("page").is_some_and(|f| in_folder(&plan.report_path, &f, ".md")) {
        return bad(Some(&plan.report_path), PlanReason::Place);
    }
    let mut seen = HashSet::new();
    for p in &all {
        if !seen.insert(fold(p)) {
            return bad(Some(p), PlanReason::Duplicate);
        }
    }
    let entries: HashSet<&str> = scan.source.space_entries(&plan.space).map(|(inner, _)| inner).collect();
    for (source, id) in plan.objects.iter().map(|o| (&o.source, Some(&o.import_id))).chain(plan.attachments.iter().map(|a| (&a.source, None))) {
        if !entries.contains(source.as_str()) || id.is_some_and(|id| *id != format!("capacities:{}/{source}", plan.space)) {
            return bad(Some(source), PlanReason::Unknown);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_gets_the_id_and_the_import_time() {
        let now = "2026-11-12T10:00:00+01:00";
        let keys = |planned: &[(String, FmValue)]| frontmatter(planned, "ID", now).as_array().map(|a| a.iter().map(|p| p[0].as_str().unwrap_or("").to_string()).collect::<Vec<_>>()).unwrap_or_default();
        let t = |k: &str| (k.to_string(), FmValue::Text("x".into()));
        assert_eq!(keys(&[t("type"), t("title"), t("import-id")]), ["id", "type", "title", "import-id", "created", "modified"]);
        assert_eq!(keys(&[t("type"), t("import-id"), t("modified")]), ["id", "type", "import-id", "created", "modified"]);
        assert_eq!(keys(&[t("type"), t("import-id"), t("created")]), ["id", "type", "import-id", "created", "modified"]);
        let v = frontmatter(&[("pages".into(), FmValue::Raw { raw: "0123".into() }), ("tags".into(), FmValue::List(vec![]))], "ID", now);
        assert_eq!(v[1], json!(["pages", { "raw": "0123" }]));
        assert_eq!(v[2], json!(["tags", []]));
    }

    #[test]
    fn planned_paths() {
        assert!(path_ok("Pages/Plán.md") && path_ok("_attachments/Mapa řeky (2).jpeg"));
        for bad in ["", "/abs.md", "Pages/../x.md", ".tegg/types/x.yml", ".trash/x.md", "Pages//x.md", "Pages\\x.md", "Pages/x?.md"] {
            assert!(!path_ok(bad), "{bad}");
        }
    }
}
