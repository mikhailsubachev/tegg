//! Slice 4D-lite (docs/contracts/ms4-tags.md §4, §5): the tag-rename, tag-delete, merge and restore jobs and the
//! backup manifest. Planned and written like the 4C jobs: every file is re-read and version-checked at write time
//! (NFR-REL-02), every byte change comes from the `@tegg/doc` transform (D-82).

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;

use serde_json::{json, Value};
use tegg_format::{extract, nfc, sanitize_file_stem, tag_key, tag_name, TagNameError};

use super::{folder_of, join, key, lock, read_reason, stem_of, write_reason, Inner, Run};
use crate::host::{Host, HostTag, ReadError, WriteError, Wrote};
use crate::zip::{read_zip, sha256_hex, write_zip};
use crate::{
    JobError, JobId, JobKind, JobOp, JobPlan, JobPoint, MergeOther, PlanCounts, PlanWarning, PlannedFile, SkipReason,
    TextOp, Transformed,
};

/// The manifest's entry name, first in every 4D-lite zip (§5.1, D-724).
pub(crate) const MANIFEST: &str = "tegg-backup.json";

/// What a job really moved or created, for the manifest's `done` (§5.1) and a later restore (§5.3, D-725).
#[derive(Debug, Clone, Default)]
pub(crate) struct Moved {
    pub renames: Vec<(String, String, String)>,
    pub creates: Vec<(String, String)>,
    pub trashes: Vec<(String, String)>,
}

fn find<'a>(tags: &'a [HostTag], k: &str) -> Option<&'a HostTag> {
    tags.iter().find(|t| t.key == k)
}

fn invalid(e: TagNameError) -> JobError {
    let char = match e {
        TagNameError::Char(c) => Some(c.to_string()),
        _ => None,
    };
    JobError::InvalidName { error: e.as_str().to_string(), char }
}

/// The written spellings of `key` in `paths` (holders and templates), read from disk.
fn spellings(host: &dyn Host, key: &str, paths: &[String]) -> HashSet<String> {
    let mut out = HashSet::new();
    for p in paths {
        if let Ok((b, _)) = host.read(p) {
            let x = extract(&b, &stem_of(p));
            for (i, k) in x.tags.iter().enumerate() {
                if k == key {
                    out.insert(x.tag_spellings.get(i).cloned().unwrap_or_else(|| k.clone()));
                }
            }
        }
    }
    out
}

fn templates_with(host: &dyn Host, key: &str) -> Vec<String> {
    let mut v: Vec<String> = host
        .template_paths()
        .into_iter()
        .filter(|p| host.read(p).is_ok_and(|(b, _)| extract(&b, &stem_of(p)).tags.iter().any(|k| k == key)))
        .collect();
    v.sort();
    v
}

/// §4.1 start-time refusals of a rename (D-699, D-712, D-738).
pub(crate) fn check_rename(host: &dyn Host, from: &str, to: &str) -> Result<JobKind, JobError> {
    let name = tag_name(to).map_err(invalid)?;
    let tags = host.tags();
    let from = find(&tags, &tag_key(from)).ok_or(JobError::NotFound)?;
    if name.key != from.key {
        if let Some(other) = find(&tags, &name.key) {
            return Err(JobError::TagExists { name: other.name.clone() });
        }
    }
    // Nothing to do: every written spelling (and the Tag file's title) is already the new one.
    let mut paths = from.holders.clone();
    paths.extend(templates_with(host, &from.key));
    let same_title = from.name == name.name || from.file.is_none();
    let sp = spellings(host, &from.key, &paths);
    if same_title && sp.iter().all(|s| *s == name.name) {
        return Err(JobError::NothingToDo);
    }
    Ok(JobKind::TagRename)
}

pub(crate) fn check_delete(host: &dyn Host, tag: &str) -> Result<JobKind, JobError> {
    find(&host.tags(), &tag_key(tag)).ok_or(JobError::NotFound)?;
    Ok(JobKind::TagDelete)
}

pub(crate) fn check_merge(host: &dyn Host, keep: &str, others: &[String]) -> Result<JobKind, JobError> {
    if others.is_empty() || host.version(&nfc(keep)).is_none() || others.iter().any(|o| host.version(&nfc(o)).is_none() || nfc(o) == nfc(keep)) {
        return Err(JobError::NotFound);
    }
    Ok(JobKind::Merge)
}

fn zip_path(host: &dyn Host, name: &str) -> PathBuf {
    host.app_dir().join("backups").join(host.vault_key()).join(name)
}

pub(crate) fn check_restore(host: &dyn Host, name: &str) -> Result<JobKind, JobError> {
    if name.contains('/') || name.contains("..") || host.local_read(&zip_path(host, name)).is_none() {
        return Err(JobError::NotFound);
    }
    Ok(JobKind::Restore)
}

fn manifest_of(entries: &[(String, Vec<u8>)]) -> Option<Value> {
    entries.iter().find(|(n, _)| n == MANIFEST).and_then(|(_, b)| serde_json::from_slice(b).ok())
}

fn title_of(text: &[u8], path: &str) -> String {
    extract(text, &stem_of(path)).title
}

impl Inner {
    fn plan_of(&self, id: JobId, kind: JobKind, files: Vec<PlannedFile>, renames: Vec<(String, String)>, trashes: Vec<String>, warnings: Vec<PlanWarning>) -> JobPlan {
        let n = files.len();
        JobPlan { job: id, kind, files, renames, creates: Vec::new(), trashes, counts: PlanCounts { files: n, links: 0 }, warnings }
    }

    fn tag(&self, k: &str) -> Result<HostTag, String> {
        find(&self.host().tags(), &tag_key(k)).cloned().ok_or_else(|| "NotFound".to_string())
    }

    /// The retarget op from `from` to `to` (a renamed Tag file, or a merged object into the kept one).
    fn retarget(&self, from: &str, from_title: &str, to: &str, to_title: &str) -> TextOp {
        TextOp::RetargetLinks {
            from_path: from.to_string(),
            from_stem: stem_of(from),
            from_title: from_title.to_string(),
            to_path: to.to_string(),
            to_stem: stem_of(to),
            to_title: to_title.to_string(),
            paths: self.host().note_paths(),
        }
    }

    // -------------------------------------------------------------------------------------------- plans (§4.1)

    pub(super) fn plan_tag_rename(&self, id: JobId, from: &str, to: &str) -> Result<JobPlan, String> {
        let host = self.host();
        let t = self.tag(from)?;
        let to = tag_name(to).map_err(|e| e.as_str().to_string())?.name;
        let mut ops: BTreeMap<String, Vec<TextOp>> = BTreeMap::new();
        for p in t.holders.iter().chain(templates_with(host.as_ref(), &t.key).iter()) {
            ops.entry(nfc(p)).or_default().push(TextOp::RenameTag { key: t.key.clone(), to: to.clone() });
        }
        let mut files = Vec::new();
        let mut renames = Vec::new();
        if let Some(f) = t.file.as_ref().map(|f| nfc(f)) {
            let wanted = nfc(&sanitize_file_stem(&to));
            let stem = stem_of(&f);
            let folder = folder_of(&f);
            let new_stem = if key(&wanted) == key(&stem) { wanted } else { host.free_stem(&folder, &wanted) };
            let to_path = join(&folder, &new_stem);
            let (bytes, version) = host.read(&f).map_err(|e| format!("{e:?}"))?;
            let old_title = title_of(&bytes, &f);
            let mut fops = vec![TextOp::SetTitle { title: to.clone(), now: host.now() }];
            fops.extend(ops.remove(&f).unwrap_or_default());
            if to_path != f {
                // D-714: links to the Tag file follow it in the same job.
                let rt = self.retarget(&f, &old_title, &to_path, &to);
                for l in host.linking(&f) {
                    if nfc(&l) != f {
                        ops.entry(nfc(&l)).or_default().push(rt.clone());
                    }
                }
                renames.push((f.clone(), to_path));
            }
            files.push(PlannedFile { path: f, version, ops: fops });
        }
        for (p, o) in ops {
            if let Some(v) = host.version(&p) {
                files.push(PlannedFile { path: p, version: v, ops: o });
            }
        }
        let warnings = t.losers.iter().map(|p| PlanWarning::DuplicateTagFile { path: p.clone() }).collect();
        Ok(self.plan_of(id, JobKind::TagRename, files, renames, Vec::new(), warnings))
    }

    pub(super) fn plan_tag_delete(&self, id: JobId, tag: &str) -> Result<JobPlan, String> {
        let host = self.host();
        let t = self.tag(tag)?;
        let file = t.file.as_ref().map(|f| nfc(f));
        let mut paths: Vec<String> = t.holders.iter().map(|p| nfc(p)).filter(|p| Some(p) != file.as_ref()).collect();
        paths.extend(templates_with(host.as_ref(), &t.key));
        paths.sort();
        paths.dedup();
        let files = paths
            .into_iter()
            .filter_map(|p| host.version(&p).map(|v| PlannedFile { path: p, version: v, ops: vec![TextOp::RemoveTag { key: t.key.clone() }] }))
            .collect();
        let warnings = t.losers.iter().map(|p| PlanWarning::DuplicateTagFile { path: p.clone() }).collect();
        Ok(self.plan_of(id, JobKind::TagDelete, files, Vec::new(), file.into_iter().collect(), warnings))
    }

    pub(super) fn plan_merge(&self, id: JobId, keep: &str, others: &[String]) -> Result<JobPlan, String> {
        let host = self.host();
        let keep = nfc(keep);
        let (kb, kv) = host.read(&keep).map_err(|e| format!("{e:?}"))?;
        let keep_title = title_of(&kb, &keep);
        // D-727: the others in the group's order, `created` ascending (then path).
        let mut rows = Vec::new();
        for o in others.iter().map(|o| nfc(o)) {
            let (b, _) = host.read(&o).map_err(|e| format!("{e:?}"))?;
            let x = extract(&b, &stem_of(&o));
            let created = x.attributes.as_ref().and_then(|a| a.get("created")).and_then(Value::as_str).and_then(|s| chrono::DateTime::parse_from_rfc3339(s.trim()).ok());
            rows.push((created, o, x.title, String::from_utf8_lossy(&b).into_owned()));
        }
        rows.sort_by(|a, b| match (a.0, b.0) {
            (Some(x), Some(y)) => x.cmp(&y).then_with(|| a.1.cmp(&b.1)),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.1.cmp(&b.1),
        });
        let gone: HashSet<String> = rows.iter().map(|r| r.1.clone()).collect();
        let mut ops: BTreeMap<String, Vec<TextOp>> = BTreeMap::new();
        for (_, o, title, _) in &rows {
            let rt = self.retarget(o, title, &keep, &keep_title);
            for l in host.linking(o) {
                let l = nfc(&l);
                if l != keep && !gone.contains(&l) {
                    ops.entry(l).or_default().push(rt.clone());
                }
            }
        }
        let merge = TextOp::MergeInto {
            others: rows.iter().map(|(_, p, t, text)| MergeOther { path: p.clone(), title: t.clone(), text: text.clone() }).collect(),
            now: host.now(),
        };
        let mut files = vec![PlannedFile { path: keep.clone(), version: kv, ops: vec![merge] }];
        for (p, o) in ops {
            if let Some(v) = host.version(&p) {
                files.push(PlannedFile { path: p, version: v, ops: o });
            }
        }
        Ok(self.plan_of(id, JobKind::Merge, files, Vec::new(), rows.into_iter().map(|r| r.1).collect(), Vec::new()))
    }

    pub(super) fn plan_restore(&self, id: JobId, name: &str) -> Result<JobPlan, String> {
        let host = self.host();
        let data = host.local_read(&zip_path(host.as_ref(), name)).ok_or("NotFound")?;
        let entries = read_zip(&data).map_err(|e| e.to_string())?;
        let mut files = Vec::new();
        for (p, b) in entries.iter().filter(|(n, _)| n != MANIFEST && !n.ends_with('/') && !n.starts_with(".trash/")) {
            match host.read(p) {
                Ok((cur, v)) if cur != *b => files.push(PlannedFile { path: nfc(p), version: v, ops: vec![TextOp::Replace { text: String::from_utf8_lossy(b).into_owned() }] }),
                Ok(_) => {}
                Err(_) => files.push(PlannedFile { path: nfc(p), version: crate::FileVersion { mtime_ns: 0, size: 0, hash: [0; 32] }, ops: vec![TextOp::Replace { text: String::from_utf8_lossy(b).into_owned() }] }),
            }
        }
        Ok(self.plan_of(id, JobKind::Restore, files, Vec::new(), Vec::new(), Vec::new()))
    }

    // -------------------------------------------------------------------------------------------- writes

    /// Tag rename and delete: the Tag file first (rename), then every other file, then the trash move (delete).
    pub(super) fn write_tag_job(&self, run: &mut Run, plan: &JobPlan) {
        let host = self.host().clone();
        let mut files = plan.files.clone();
        let mut start = 0;
        if let Some((from, to)) = plan.renames.first().cloned() {
            start = 1;
            let f = files[0].clone();
            self.point(run.id, JobPoint::AfterRead { path: f.path.clone() });
            match host.read(&f.path) {
                Err(e) => run.skip(&f.path, read_reason(&e)),
                Ok((pre, v)) if !v.same_content(&f.version) => {
                    let _ = pre;
                    run.skip(&f.path, SkipReason::Changed)
                }
                Ok((pre, v)) => {
                    let out = match self.transform(&f.path, &pre, &f.ops) {
                        Ok(Transformed::Bytes(b, _)) => b,
                        Ok(Transformed::Unchanged) => pre.clone(),
                        Err(_) => {
                            run.skip(&f.path, SkipReason::Io);
                            return;
                        }
                    };
                    let mut target = to.clone();
                    let mut tries = 0;
                    loop {
                        match host.rename(&from, &target, &out, &v) {
                            Ok(_) => {
                                run.renamed = Some((from.clone(), target.clone()));
                                run.written.push(target.clone());
                                run.moved.renames.push((from.clone(), target.clone(), sha256_hex(&out)));
                                break;
                            }
                            Err(WriteError::NameTaken) if tries < 50 => {
                                tries += 1;
                                let wanted = nfc(&sanitize_file_stem(&stem_of(&to)));
                                target = join(&folder_of(&from), &host.free_stem(&folder_of(&from), &wanted));
                            }
                            Err(e) => {
                                run.skip(&from, write_reason(&e));
                                break;
                            }
                        }
                    }
                    // The links follow the name the Tag file really took.
                    if target != to {
                        for g in files.iter_mut().skip(1) {
                            g.ops = std::mem::take(&mut g.ops).into_iter().map(|o| super::retarget_to(o, &stem_of(&target), &target)).collect();
                        }
                    }
                }
            }
            self.step(run.id, 1);
        } else if files.first().is_some_and(|f| f.ops.iter().any(|o| matches!(o, TextOp::SetTitle { .. }))) {
            // A Tag file whose name doesn't change (same stem): written in place.
            start = 1;
            self.write_one(run, &files[0]);
            self.step(run.id, 1);
        }
        for (i, f) in files.iter().enumerate().skip(start) {
            self.write_one(run, f);
            self.step(run.id, i + 1);
        }
        for p in &plan.trashes {
            self.trash_one(run, p);
        }
    }

    fn trash_one(&self, run: &mut Run, path: &str) {
        let host = self.host();
        match host.read(path) {
            Ok((_, v)) => match host.trash(path, &v) {
                Ok(to) => run.moved.trashes.push((path.to_string(), to)),
                Err(e) => run.skip(path, write_reason(&e)),
            },
            Err(e) => run.skip(path, read_reason(&e)),
        }
    }

    /// D-727: the kept and merged files are checked before any write; a change to one of them stops the job.
    pub(super) fn write_merge(&self, run: &mut Run, plan: &JobPlan) -> Result<(), String> {
        let host = self.host().clone();
        let keep = &plan.files[0];
        self.point(run.id, JobPoint::AfterRead { path: keep.path.clone() });
        let changed = |p: &str, base: Option<&crate::FileVersion>| match (host.version(p), base) {
            (Some(now), Some(b)) => !now.same_content(b),
            (None, _) => true,
            _ => false,
        };
        if changed(&keep.path, Some(&keep.version)) {
            return Err(format!("changed:{}", keep.path));
        }
        if let Some(TextOp::MergeInto { others, .. }) = keep.ops.first() {
            for o in others {
                let now = host.read(&o.path).map(|(b, _)| b).ok();
                if now.as_deref() != Some(o.text.as_bytes()) {
                    return Err(format!("changed:{}", o.path));
                }
            }
        }
        for (i, f) in plan.files.iter().enumerate() {
            self.write_one(run, f);
            self.step(run.id, i + 1);
        }
        for p in &plan.trashes {
            self.trash_one(run, p);
        }
        Ok(())
    }

    /// §5.3: reverse the restored job's moves, then give every other file its zipped bytes.
    pub(super) fn write_restore(&self, run: &mut Run, name: &str, plan: &JobPlan) {
        let host = self.host().clone();
        let Some(data) = host.local_read(&zip_path(host.as_ref(), name)) else { return };
        let Ok(entries) = read_zip(&data) else { return };
        let zipped: BTreeMap<String, Vec<u8>> = entries.iter().filter(|(n, _)| n != MANIFEST).map(|(n, b)| (nfc(n), b.clone())).collect();
        let m = manifest_of(&entries).unwrap_or(Value::Null);
        let part = if m["done"].is_object() { &m["done"] } else { &m["planned"] };
        let s = |v: &Value| v.as_str().map(nfc);
        let current_sha = |p: &str| host.read(p).ok().map(|(b, _)| sha256_hex(&b));
        let mut handled: HashSet<String> = HashSet::new();
        for r in part["renames"].as_array().cloned().unwrap_or_default() {
            let (Some(from), Some(to)) = (s(&r[0]), s(&r[1])) else { continue };
            if host.version(&to).is_none() || host.version(&from).is_some() {
                continue;
            }
            if let Some(sha) = r[2].as_str() {
                if current_sha(&to).as_deref() != Some(sha) {
                    run.skip(&to, SkipReason::Changed);
                    handled.insert(from.clone());
                    continue;
                }
            }
            let Ok((cur, v)) = host.read(&to) else { continue };
            let bytes = zipped.get(&from).cloned().unwrap_or(cur);
            match host.rename(&to, &from, &bytes, &v) {
                Ok(_) => {
                    run.written.push(from.clone());
                    run.moved.renames.push((to.clone(), from.clone(), sha256_hex(&bytes)));
                }
                Err(e) => run.skip(&to, write_reason(&e)),
            }
            handled.insert(from);
        }
        for c in part["creates"].as_array().cloned().unwrap_or_default() {
            let Some(p) = s(&c[0]) else { continue };
            if zipped.contains_key(&p) {
                continue;
            }
            if let Some(sha) = c[1].as_str() {
                if current_sha(&p).as_deref() != Some(sha) {
                    continue;
                }
            }
            self.trash_one(run, &p);
        }
        for t in part["trashes"].as_array().cloned().unwrap_or_default() {
            let (Some(from), Some(to)) = (s(&t[0]), s(&t[1])) else { continue };
            if host.version(&to).is_some() && host.version(&from).is_none() {
                match host.untrash(&to, &from) {
                    Ok(()) => {
                        let sha = current_sha(&from).unwrap_or_default();
                        run.moved.creates.push((from.clone(), sha));
                        run.written.push(from.clone());
                    }
                    Err(e) => run.skip(&to, write_reason(&e)),
                }
                handled.insert(from);
            }
        }
        for (i, f) in plan.files.iter().enumerate() {
            if handled.contains(&f.path) {
                continue;
            }
            let Some(bytes) = zipped.get(&f.path) else { continue };
            match host.read(&f.path) {
                Ok((cur, v)) => {
                    if cur == *bytes {
                        run.unchanged.push(f.path.clone());
                    } else if !v.same_content(&f.version) {
                        run.skip(&f.path, SkipReason::Changed);
                    } else {
                        self.point(run.id, JobPoint::AfterRead { path: f.path.clone() });
                        if lock(&self.editors).contains(&nfc(&f.path)) {
                            self.write_live(run, &f.path, &cur, &v, &f.ops);
                        } else {
                            self.point(run.id, JobPoint::TempWritten { path: f.path.clone() });
                            match host.write(&f.path, bytes, &v) {
                                Ok(Wrote::Written(_)) => run.written.push(f.path.clone()),
                                Ok(Wrote::Unchanged) => run.unchanged.push(f.path.clone()),
                                Err(e) => run.skip(&f.path, write_reason(&e)),
                            }
                        }
                    }
                }
                Err(ReadError::Missing) => match host.create(&f.path, bytes) {
                    Ok(_) => {
                        run.written.push(f.path.clone());
                        run.moved.creates.push((f.path.clone(), sha256_hex(bytes)));
                    }
                    Err(e) => run.skip(&f.path, write_reason(&e)),
                },
                Err(e) => run.skip(&f.path, read_reason(&e)),
            }
            self.step(run.id, i + 1);
        }
    }

    // -------------------------------------------------------------------------------------------- manifest (§5.1)

    /// The manifest of a 4D-lite job's zip (none for the 4C and 5B kinds) and, for a restore, the zip exempt from
    /// the rotation (D-725).
    pub(super) fn manifest_for(&self, run: &Run, op: &JobOp, plan: &JobPlan) -> (Option<Value>, Option<PathBuf>) {
        let host = self.host();
        let tags = || host.tags();
        let (label, keep) = match op {
            JobOp::TagRename { from, to } => {
                let from_name = find(&tags(), &tag_key(from)).map(|t| t.name.clone()).unwrap_or_else(|| from.clone());
                let to_name = tag_name(to).map(|n| n.name).unwrap_or_else(|_| to.clone());
                (json!({ "key": "backups.label.tagRename", "args": { "from": from_name, "to": to_name } }), None)
            }
            JobOp::TagDelete { tag, .. } => {
                let t = find(&tags(), &tag_key(tag)).cloned().unwrap_or_default();
                (json!({ "key": "backups.label.tagDelete", "args": { "tag": t.name, "count": t.holders.len() } }), None)
            }
            JobOp::Merge { .. } => {
                let title = plan.files.first().and_then(|f| host.read(&f.path).ok().map(|(b, _)| title_of(&b, &f.path))).unwrap_or_default();
                (json!({ "key": "backups.label.merge", "args": { "count": plan.trashes.len() + 1, "title": title } }), None)
            }
            JobOp::Restore { name } => {
                let p = zip_path(host.as_ref(), name);
                let time = host.local_read(&p).and_then(|d| read_zip(&d).ok()).and_then(|e| manifest_of(&e)).and_then(|m| m["time"].as_str().map(str::to_string));
                (json!({ "key": "backups.label.restore", "args": { "time": time.unwrap_or_else(|| name.clone()) } }), Some(p))
            }
            _ => return (None, None),
        };
        let m = json!({
            "version": 1,
            "kind": run.kind.as_str(),
            "label": label,
            "vault": host.vault_name(),
            "time": chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
            "job": run.id,
            "planned": {
                "renames": plan.renames.iter().map(|(a, b)| json!([a, b])).collect::<Vec<_>>(),
                "creates": plan.creates.clone(),
                "trashes": plan.trashes.iter().map(|p| json!([p, format!(".trash/{p}")])).collect::<Vec<_>>(),
            },
            "done": Value::Null,
        });
        (Some(m), keep)
    }

    /// When the job has finished: the zip is rewritten with `done` (the real outcome, with hashes).
    pub(super) fn finish_manifest(&self, run: &Run) {
        let Some((path, m)) = &run.zip else { return };
        let host = self.host();
        let Some(data) = host.local_read(path) else { return };
        let Ok(mut entries) = read_zip(&data) else { return };
        let written: Vec<Value> = run
            .written
            .iter()
            .filter_map(|p| host.read(p).ok().map(|(b, _)| json!([p, sha256_hex(&b)])))
            .collect();
        let mut m = m.clone();
        m["done"] = json!({
            "renames": run.moved.renames.iter().map(|(a, b, h)| json!([a, b, h])).collect::<Vec<_>>(),
            "creates": run.moved.creates.iter().map(|(a, h)| json!([a, h])).collect::<Vec<_>>(),
            "trashes": run.moved.trashes.iter().map(|(a, b)| json!([a, b])).collect::<Vec<_>>(),
            "written": written,
        });
        let Ok(bytes) = serde_json::to_vec_pretty(&m) else { return };
        match entries.iter_mut().find(|(n, _)| n == MANIFEST) {
            Some(e) => e.1 = bytes,
            None => entries.insert(0, (MANIFEST.to_string(), bytes)),
        }
        let mut zip = Vec::new();
        if write_zip(&mut zip, &entries).is_ok() {
            let _ = host.local_write(path, &zip);
        }
    }
}

/// §5.2: every zip of the vault's backup folder, newest first.
pub(crate) fn backups(host: &dyn Host) -> Vec<crate::BackupInfo> {
    let dir = host.app_dir().join("backups").join(host.vault_key());
    let mut zips: Vec<PathBuf> = host.local_list(&dir).into_iter().filter(|p| p.extension().is_some_and(|x| x == "zip")).collect();
    zips.sort();
    zips.reverse();
    zips.into_iter()
        .filter_map(|p| {
            let name = p.file_name()?.to_string_lossy().into_owned();
            let stem = name.strip_suffix(".zip")?;
            let kind = stem.get(16..).unwrap_or("").to_string();
            let entries = host.local_read(&p).and_then(|d| read_zip(&d).ok()).unwrap_or_default();
            let m = manifest_of(&entries);
            let from_name = chrono::NaiveDateTime::parse_from_str(stem.get(..15).unwrap_or(""), "%Y%m%d-%H%M%S").ok().map(|t| t.and_utc().format("%Y-%m-%dT%H:%M:%SZ").to_string());
            let time = m.as_ref().and_then(|m| m["time"].as_str().map(str::to_string)).or(from_name).unwrap_or_default();
            let label = match m.as_ref().filter(|m| m["label"]["key"].is_string()) {
                Some(m) => crate::BackupLabel { key: m["label"]["key"].as_str().unwrap_or_default().to_string(), args: m["label"]["args"].clone() },
                None => crate::BackupLabel { key: "backups.label.unknown".into(), args: json!({ "kind": kind }) },
            };
            let files = entries.iter().filter(|(n, _)| n != MANIFEST && !n.ends_with('/')).count();
            Some(crate::BackupInfo { name, kind, time, label, files })
        })
        .collect()
}
