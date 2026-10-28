//! Slice 4E-2 (docs/contracts/ms4-jobs.md §14.9): the `value-remove` job (delete a property and its values, D-807,
//! D-814) and the `type-delete` job (delete a type with its objects, D-809, D-815).

use serde_json::{json, Value};
use tegg_format::{extract, nfc};

use super::{stem_of, write_reason, Inner, Run, Written};
use crate::host::{Host, WriteError};
use crate::{JobError, JobId, JobKind, JobOp, JobPlan, PlanCounts, PlannedFile, SkipReason, TextOp};

/// `.tegg/types/<key>.yml` (NFC).
pub(super) fn type_path(r#type: &str) -> String {
    format!(".tegg/types/{}.yml", nfc(r#type))
}

/// §14.9.1 (D-853): the refusals of `value-remove`, before the job is queued.
pub(super) fn check_value_remove(host: &dyn Host, r#type: &str, key: &str) -> Result<JobKind, JobError> {
    if !host.defined_types().iter().any(|t| nfc(t) == nfc(r#type)) {
        return Err(JobError::UnknownType);
    }
    let prop = host.schema(r#type).into_iter().find(|p| nfc(&p.key) == nfc(key)).ok_or(JobError::UnknownProperty)?;
    if prop.built_in {
        return Err(JobError::BuiltIn); // FR-TYP-06 AC-2
    }
    Ok(JobKind::ValueRemove)
}

/// §14.9.1 (D-853): the refusals of `type-delete` (FR-TYP-06 AC-1: system types; no definition).
pub(super) fn check_type_delete(host: &dyn Host, r#type: &str) -> Result<JobKind, JobError> {
    // The system types (D-22, D-42; `tegg_schema::SYSTEM_KEYS`, which this crate doesn't depend on).
    if ["page", "task", "quick-note", "daily-note", "tag", "image", "pdf"].contains(&nfc(r#type).as_str()) {
        return Err(JobError::SystemType);
    }
    if !host.defined_types().iter().any(|t| nfc(t) == nfc(r#type)) {
        return Err(JobError::UnknownType);
    }
    Ok(JobKind::TypeDelete)
}

/// `_templates/<Name>/` of a type (D-232 folder name: the sanitized Name).
fn templates_dir(host: &dyn Host, r#type: &str) -> String {
    let name = host.type_names(r#type).map(|(n, _)| n).unwrap_or_else(|| r#type.to_string());
    format!("_templates/{}", tegg_format::sanitize_file_stem(&name))
}

/// D-814: no key, `key:` with nothing, `""`, a blank string, `[]` or `~` is no value.
fn has_value(v: Option<&Value>) -> Option<bool> {
    match v? {
        Value::Null => Some(false),
        Value::String(s) => Some(!s.trim().is_empty()),
        Value::Array(a) => Some(!a.is_empty()),
        _ => Some(true),
    }
}

impl Inner {
    /// §14.9.2: every object of the type with a non-empty value of `key` gets `remove-key`; `counts.empty` are the objects
    /// with the key and no value. The type file's version is kept for its write, last.
    pub(super) fn plan_value_remove(&self, id: JobId, run: &mut Run, r#type: &str, key_: &str) -> JobPlan {
        let host = self.host();
        let mut files = Vec::new();
        let mut empty = 0;
        let mut objects = host.objects_of(r#type);
        objects.sort();
        for p in objects.into_iter().map(|p| nfc(&p)) {
            if p.starts_with("_templates/") || p.starts_with(".trash/") {
                continue; // D-814: templates keep their line
            }
            let Ok((bytes, version)) = host.read(&p) else { continue };
            let attrs = extract(&bytes, &stem_of(&p)).attributes;
            let v = attrs.as_ref().and_then(|a| a.as_object()).and_then(|m| m.iter().find(|(k, _)| nfc(k) == nfc(key_)).map(|(_, v)| v));
            match has_value(v) {
                Some(true) => files.push(PlannedFile { path: p, version, ops: vec![TextOp::RemoveKey { key: nfc(key_) }] }),
                Some(false) => empty += 1,
                None => {}
            }
        }
        let tp = type_path(r#type);
        run.type_base = host.read(&tp).ok().map(|(_, v)| (tp, v));
        let n = files.len();
        JobPlan { job: id, kind: JobKind::ValueRemove, files, renames: Vec::new(), creates: Vec::new(), trashes: Vec::new(), counts: PlanCounts { files: n, links: 0, empty, ..Default::default() }, warnings: Vec::new() }
    }

    /// §14.9.2, §14.9.4: each object (through its editor when open, D-386), then the type file last (skipped objects
    /// too, FR-TYP-04 AC-9). Cancel between files reverses what was written (board D3) and never writes the type file.
    pub(super) fn write_value_remove(&self, run: &mut Run, plan: &JobPlan, r#type: &str, key_: &str) -> Result<bool, String> {
        let host = self.host();
        for (i, f) in plan.files.iter().enumerate() {
            if self.cancelled(run.id) {
                self.reverse_rows(run);
                return Ok(false);
            }
            self.write_one(run, f);
            self.step(run.id, i + 1);
        }
        if self.cancelled(run.id) {
            self.reverse_rows(run);
            return Ok(false);
        }
        // §14.9.4: a row written through an editor is undone with its bytes; the reverse of `remove-key` is not an op.
        for w in run.undo.files.iter_mut() {
            if w.via_op {
                w.via_op = false;
                w.direct = true;
            }
        }
        let Some((tp, base)) = run.type_base.clone() else { return Err(format!("{}: no type file", type_path(r#type))) };
        let pre = host.read(&tp).map_err(|e| format!("{tp}: {e:?}"))?;
        match host.remove_property(r#type, key_, &base) {
            Ok(post_v) => {
                let post = host.read(&tp).map(|(b, _)| b).unwrap_or_default();
                run.written.push(tp.clone());
                run.undo.files.push(Written { before: tp.clone(), after: tp, pre: pre.0, pre_v: pre.1, post, post_v, via_op: false, direct: false, trashed: None });
                Ok(true)
            }
            Err(e) => Err(format!("{tp}: {}", reason_text(&e))),
        }
    }

    /// Cancel during `writing` (§14.9.4): every row written so far, newest first, back to its pre-job state where the file
    /// is still what the job left (else left alone and listed `changed`); nothing then counts as written.
    pub(super) fn reverse_rows(&self, run: &mut Run) {
        let host = self.host();
        let rows = std::mem::take(&mut run.undo.files);
        for w in rows.iter().rev() {
            let r = if let Some(trashed) = w.trashed.as_ref() {
                host.untrash(trashed, &w.before)
            } else {
                host.write(&w.after, &w.pre, &w.post_v).map(|_| ())
            };
            if r.is_err() {
                run.skip(&w.before, SkipReason::Changed);
            }
        }
        run.written.clear();
        run.moved = Default::default();
    }

    /// §14.9.3: the objects (FR-TYP-05 AC-2) in path order, then the templates folder and the type file (`trashes`, in
    /// write order; `files` carry the objects' versions for the base check). `counts.templates`: files under the folder.
    pub(super) fn plan_type_delete(&self, id: JobId, r#type: &str) -> JobPlan {
        let host = self.host();
        let mut objects: Vec<String> = host.objects_of(r#type).into_iter().map(|p| nfc(&p)).filter(|p| !p.starts_with("_templates/") && !p.starts_with(".trash/")).collect();
        objects.sort();
        objects.dedup();
        let files: Vec<PlannedFile> = objects.iter().filter_map(|p| host.version(p).map(|version| PlannedFile { path: p.clone(), version, ops: Vec::new() })).collect();
        let dir = templates_dir(host.as_ref(), r#type);
        let templates = host.template_paths().iter().filter(|p| nfc(p).starts_with(&format!("{dir}/"))).count();
        let mut trashes: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
        if templates > 0 {
            trashes.push(dir);
        }
        trashes.push(type_path(r#type));
        let n = files.len();
        JobPlan { job: id, kind: JobKind::TypeDelete, files, renames: Vec::new(), creates: Vec::new(), trashes, counts: PlanCounts { files: n, links: 0, templates, ..Default::default() }, warnings: Vec::new() }
    }

    /// §14.9.3, §14.9.4: each object to the trash (base-checked, `AfterRead` right after the check, D-848), then, only
    /// when none was skipped (D-815), the templates folder and the type file last. Cancel between objects untrashes what
    /// was trashed and keeps the type. `Ok(false)`: cancelled.
    pub(super) fn write_type_delete(&self, run: &mut Run, plan: &JobPlan, r#type: &str) -> Result<bool, String> {
        let host = self.host();
        for (i, f) in plan.files.iter().enumerate() {
            if self.cancelled(run.id) {
                self.reverse_rows(run);
                return Ok(false);
            }
            if host.is_placeholder(&f.path) {
                run.skip(&f.path, SkipReason::Placeholder);
                continue;
            }
            if host.has_conflict(&f.path) {
                run.skip(&f.path, SkipReason::Changed);
                continue;
            }
            self.point(run.id, crate::JobPoint::AfterRead { path: f.path.clone() });
            if self.cancelled(run.id) {
                self.reverse_rows(run);
                return Ok(false);
            }
            match host.trash(&f.path, &f.version) {
                Ok(to) => self.trashed_row(run, &f.path, &to, f.version.clone()),
                Err(e) => run.skip(&f.path, write_reason(&e)),
            }
            self.step(run.id, i + 1);
        }
        if self.cancelled(run.id) {
            self.reverse_rows(run);
            return Ok(false);
        }
        if !run.skipped.is_empty() {
            run.kept_type = true; // D-815: the definition and templates stay
            return Ok(true);
        }
        if plan.counts.templates > 0 {
            let dir = templates_dir(host.as_ref(), r#type);
            if let Some(to) = host.trash_dir(&dir).map_err(|e| format!("{dir}: {}", reason_text(&e)))? {
                // A folder has no version of its own: its row is undone by moving it back as a whole.
                self.trashed_row(run, &dir, &to, crate::FileVersion { mtime_ns: 0, size: 0, hash: [0; 32] });
            }
        }
        let tp = type_path(r#type);
        let v = host.version(&tp).ok_or_else(|| format!("{tp}: missing"))?;
        let to = host.trash(&tp, &v).map_err(|e| format!("{tp}: {}", reason_text(&e)))?;
        self.trashed_row(run, &tp, &to, v);
        host.types_changed();
        Ok(true)
    }

    fn trashed_row(&self, run: &mut Run, from: &str, to: &str, v: crate::FileVersion) {
        run.written.push(from.to_string());
        run.moved.trashes.push((from.to_string(), to.to_string()));
        run.undo.files.push(Written { before: from.to_string(), after: to.to_string(), pre: Vec::new(), pre_v: v.clone(), post: Vec::new(), post_v: v, via_op: false, direct: false, trashed: Some(to.to_string()) });
    }

    /// §14.9.4: undo of a type delete moves the type file and templates back first, then the objects (newest row
    /// first); a path that exists again is skipped `taken` (D-849). Redo trashes them again in the job's order.
    pub(super) fn write_trash_rows(&self, run: &mut Run, rows: &[Written], undo: bool) {
        let host = self.host();
        let mut types = false;
        let order: Vec<&Written> = if undo { rows.iter().rev().collect() } else { rows.iter().collect() };
        for (i, w) in order.into_iter().enumerate() {
            let trashed = w.trashed.clone().unwrap_or_else(|| w.after.clone());
            let is_type = w.before.starts_with(".tegg/types/");
            if undo {
                match host.untrash(&trashed, &w.before) {
                    Ok(()) => {
                        run.written.push(w.before.clone());
                        run.undo.files.push(Written { trashed: Some(trashed.clone()), ..w.clone() });
                        types |= is_type;
                    }
                    Err(WriteError::NameTaken) => run.skip(&w.before, SkipReason::Taken),
                    Err(e) => run.skip(&w.before, write_reason(&e)),
                }
            } else {
                let r = match host.version(&w.before) {
                    Some(v) => host.trash(&w.before, &v).map(Some),
                    None => host.trash_dir(&w.before),
                };
                match r {
                    Ok(Some(to)) => {
                        run.written.push(w.before.clone());
                        run.undo.files.push(Written { after: to.clone(), trashed: Some(to), ..w.clone() });
                        types |= is_type;
                    }
                    Ok(None) => run.skip(&w.before, SkipReason::Missing),
                    Err(e) => run.skip(&w.before, write_reason(&e)),
                }
            }
            self.step(run.id, i + 1);
        }
        if types {
            host.types_changed();
        }
    }

    /// The backup label of a 4E-2 job (R99: `Delete property <Name>`, `Delete type <Name>`).
    pub(super) fn delete_label(&self, op: &JobOp) -> Value {
        let host = self.host();
        match op {
            JobOp::ValueRemove { r#type, key: k } => {
                let name = host.schema(r#type).into_iter().find(|p| nfc(&p.key) == nfc(k)).map(|p| p.name).unwrap_or_else(|| k.clone());
                json!({ "key": "backups.label.valueRemove", "args": { "name": name } })
            }
            JobOp::TypeDelete { r#type } => {
                let name = host.type_names(r#type).map(|(n, _)| n).unwrap_or_else(|| r#type.clone());
                json!({ "key": "backups.label.typeDelete", "args": { "name": name } })
            }
            _ => Value::Null,
        }
    }
}

fn reason_text(e: &WriteError) -> String {
    match e {
        WriteError::Io(s) => s.clone(),
        other => format!("{:?}", write_reason(other)),
    }
}
