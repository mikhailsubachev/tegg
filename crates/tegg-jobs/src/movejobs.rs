//! Slice 4E-1 (ms4-jobs §14): the `type-move` and `folder-move` planners and their write step. A type move maps the
//! note's properties and moves it to its new type's folder (D-804, D-813, D-826); a folder move takes every object of a
//! type that is outside its folder there (the folder save and the tidy job, D-805, D-811). Linking notes get the 4C
//! retarget op, which changes only what a move breaks (D-810); the moved note gets `keep-targets`.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde_json::json;
use tegg_format::{extract, nfc};

use super::{folder_of, join, key, lock, read_reason, stem_of, write_reason, Inner, Run, Written};
use crate::host::{Host, WriteError};
use crate::zip::sha256_hex;
use crate::{JobError, JobId, JobKind, JobOp, JobPlan, JobPoint, PlanCounts, PlannedFile, PropertyMap, MapTarget, SkipReason, TextOp, Transformed};

/// Types whose objects are never moved, as sources or targets (board G): their paths mean something.
const FIXED: [&str; 4] = ["daily-note", "tag", "image", "pdf"];

fn fixed(t: &str) -> bool {
    FIXED.contains(&key(t).as_str())
}

fn excluded(p: &str) -> bool {
    let k = key(p);
    k.starts_with("_templates/") || k.starts_with(".trash/")
}

/// Whether `path` lies in `folder` or one of its subfolders (D-811).
fn inside(path: &str, folder: &str) -> bool {
    let f = key(folder.trim_end_matches('/'));
    f.is_empty() || key(path).starts_with(&format!("{f}/"))
}

pub(crate) fn check_type_move(host: &dyn Host, paths: &[String], to_type: &str) -> Result<JobKind, JobError> {
    let to = key(to_type);
    if fixed(&to) {
        return Err(JobError::NotMovable);
    }
    if !host.defined_types().iter().any(|t| key(t) == to) {
        return Err(JobError::UnknownType);
    }
    if paths.is_empty() {
        return Err(JobError::NoChange);
    }
    let mut same = 0;
    for p in paths.iter().map(|p| nfc(p)) {
        if key(&p).starts_with(".trash/") || !host.renamable(&p) {
            return Err(JobError::NotMovable);
        }
        // D-180: a file that isn't valid UTF-8 is never rewritten, so it can't change type either.
        if host.read(&p).is_ok_and(|(b, _)| std::str::from_utf8(&b).is_err()) {
            return Err(JobError::NotMovable);
        }
        let from = host.type_of(&p).map(|t| key(&t));
        if from.as_deref().is_some_and(fixed) {
            return Err(JobError::NotMovable);
        }
        if from.as_deref() == Some(to.as_str()) {
            same += 1;
        }
    }
    if same == paths.len() {
        return Err(JobError::NoChange);
    }
    Ok(JobKind::TypeMove)
}

impl Inner {
    /// The path a note moved to `folder` gets, at the folder's root (D-811): its stem, unless a note in that folder has
    /// it already, then the vault-wide free stem (D-291; a stem the note already shared elsewhere stays as it is).
    fn move_target(&self, path: &str, folder: &str, notes: &[String]) -> String {
        let stem = stem_of(path);
        let taken = notes.iter().any(|n| key(n) != key(path) && key(&folder_of(n)) == key(folder) && key(&stem_of(n)) == key(&stem));
        let stem = if taken { self.host().free_stem(folder, &stem) } else { stem };
        join(folder, &stem)
    }

    /// ms4-jobs §14.3: the moved notes first (in path order), then every linking note with one retarget op per moved
    /// note it links to.
    pub(super) fn plan_type_move(&self, id: JobId, run: &mut Run, paths: &[String], to_type: &str, mapping: &[PropertyMap], review: bool) -> JobPlan {
        let host = self.host();
        let notes = host.note_paths();
        let folder = host.type_folder(to_type).unwrap_or_default();
        let now = host.now();
        let mut files = Vec::new();
        let mut renames = Vec::new();
        let mut moved = Vec::new();
        let mut seen = BTreeSet::new();
        let mut sorted: Vec<String> = paths.iter().map(|p| nfc(p)).collect();
        sorted.sort();
        for p in sorted {
            if !seen.insert(key(&p)) {
                continue;
            }
            let Some(version) = host.version(&p) else {
                run.skip(&p, SkipReason::Missing);
                continue;
            };
            // D-829: a template gets only its type line; no mapping, no `modified`, no move.
            if excluded(&p) {
                files.push(PlannedFile { path: p, version, ops: vec![TextOp::ChangeType { r#type: to_type.to_string(), now: None, id: None }] });
                continue;
            }
            let schema = host.type_of(&p).map(|t| host.schema(&t)).unwrap_or_default();
            let order = |k: &str| schema.iter().position(|s| nfc(&s.key) == nfc(k)).unwrap_or(usize::MAX);
            // D-813: only the old type's schema properties are mapped, in its order.
            let mut map: Vec<&PropertyMap> = mapping.iter().filter(|m| schema.is_empty() || order(&m.from) != usize::MAX).collect();
            map.sort_by_key(|m| order(&m.from));
            let mut ops = Vec::new();
            if !map.is_empty() {
                ops.push(TextOp::MapProperties {
                    map: map.iter().map(|m| (m.from.clone(), match &m.to { MapTarget::Property(k) => k.clone(), MapTarget::Content => "content".into() })).collect(),
                    labels: schema.iter().map(|s| (s.key.clone(), s.name.clone())).collect(),
                });
            }
            // D-174: a file without an `id` (an Obsidian note) gets one with its type.
            let id = host.read(&p).ok().filter(|(b, _)| extract(b, &stem_of(&p)).id.is_none()).map(|_| host.new_id()).filter(|i| !i.is_empty());
            ops.push(TextOp::ChangeType { r#type: to_type.to_string(), now: Some(now.clone()), id });
            if review {
                ops.push(TextOp::SetReview { value: "reviewed".into(), now: now.clone() });
            }
            if !folder.is_empty() && !inside(&p, &folder) {
                let to = self.move_target(&p, &folder, &notes);
                ops.push(TextOp::KeepTargets { from_path: p.clone(), to_path: to.clone(), paths: notes.clone() });
                renames.push((p.clone(), to.clone()));
                moved.push((p.clone(), to));
            }
            files.push(PlannedFile { path: p, version, ops });
        }
        self.add_linking(&mut files, &moved, &notes);
        let n = files.len();
        JobPlan { job: id, kind: JobKind::TypeMove, files, renames, creates: Vec::new(), trashes: Vec::new(), counts: PlanCounts { files: n, links: 0 }, warnings: Vec::new() }
    }

    /// ms4-jobs §14.3: every object of the type(s) outside its folder and that folder's subfolders, to the folder's
    /// root. The tidy job (`r#type: None`) leaves exempt ids alone (§14.6) and never touches the FIXED types.
    pub(super) fn plan_folder_move(&self, id: JobId, run: &mut Run, r#type: Option<&str>, to_folder: Option<&str>) -> JobPlan {
        let host = self.host();
        let notes = host.note_paths();
        let types: Vec<String> = match r#type {
            Some(t) => vec![t.to_string()],
            None => host.defined_types().into_iter().filter(|t| !fixed(t)).collect(),
        };
        let exempt: BTreeSet<String> = if r#type.is_none() { host.local_exempt().into_iter().collect() } else { BTreeSet::new() };
        let mut files = Vec::new();
        let mut renames = Vec::new();
        let mut moved = Vec::new();
        for t in types {
            let folder = match (r#type, to_folder) {
                (Some(_), Some(f)) => nfc(f.trim_matches('/')),
                _ => host.type_folder(&t).unwrap_or_default(),
            };
            if folder.is_empty() {
                continue;
            }
            let mut objects = host.objects_of(&t);
            objects.sort();
            for p in objects.into_iter().map(|p| nfc(&p)) {
                if excluded(&p) || inside(&p, &folder) {
                    continue;
                }
                if host.is_placeholder(&p) {
                    run.skip(&p, SkipReason::Placeholder);
                    continue;
                }
                if host.has_conflict(&p) {
                    run.skip(&p, SkipReason::Changed); // tried again at the next quiet period (D-805)
                    continue;
                }
                let Ok((bytes, version)) = host.read(&p) else {
                    run.skip(&p, SkipReason::Missing);
                    continue;
                };
                if !exempt.is_empty() && extract(&bytes, &stem_of(&p)).id.is_some_and(|i| exempt.contains(&i)) {
                    continue;
                }
                let to = self.move_target(&p, &folder, &notes);
                files.push(PlannedFile { path: p.clone(), version, ops: vec![TextOp::KeepTargets { from_path: p.clone(), to_path: to.clone(), paths: notes.clone() }] });
                renames.push((p.clone(), to.clone()));
                moved.push((p, to));
            }
        }
        self.add_linking(&mut files, &moved, &notes);
        let n = files.len();
        JobPlan { job: id, kind: JobKind::FolderMove, files, renames, creates: Vec::new(), trashes: Vec::new(), counts: PlanCounts { files: n, links: 0 }, warnings: Vec::new() }
    }

    fn add_linking(&self, files: &mut Vec<PlannedFile>, moved: &[(String, String)], notes: &[String]) {
        let host = self.host();
        let mut linking: BTreeMap<String, Vec<TextOp>> = BTreeMap::new();
        for (from, to) in moved {
            let title = host.read(from).map(|(b, _)| extract(&b, &stem_of(from)).title).unwrap_or_else(|_| stem_of(from));
            let op = TextOp::RetargetLinks {
                from_path: from.clone(),
                from_stem: stem_of(from),
                from_title: title.clone(),
                to_path: to.clone(),
                to_stem: stem_of(to),
                to_title: title,
                paths: notes.to_vec(),
            };
            for l in host.linking(from) {
                let l = nfc(&l);
                match files.iter_mut().find(|f| key(&f.path) == key(&l)) {
                    // A moved note that links to another: the retarget comes before its own keep-targets.
                    Some(f) => {
                        let at = f.ops.iter().position(|o| matches!(o, TextOp::KeepTargets { .. })).unwrap_or(f.ops.len());
                        f.ops.insert(at, op.clone());
                    }
                    None => linking.entry(l).or_default().push(op.clone()),
                }
            }
        }
        for (path, ops) in linking {
            if let Some(version) = host.version(&path) {
                files.push(PlannedFile { path, version, ops });
            }
        }
    }

    /// The write step of both kinds: a folder save writes the type file's `folder:` first (D-822), then each moved note
    /// is renamed with its new bytes in one step (§14.5), then the linking notes follow the names the moves really took.
    pub(super) fn write_moves(&self, run: &mut Run, plan: &mut JobPlan, op: &JobOp) -> Result<(), String> {
        let host = self.host().clone();
        let id = run.id;
        if let JobOp::FolderMove { r#type: Some(t), to_folder: Some(f) } = op {
            match host.write_type_folder(t, f) {
                Ok(Some(p)) => run.written.push(p),
                Ok(None) => {}
                Err(e) => return Err(e),
            }
        }
        let single = matches!(op, JobOp::TypeMove { paths, .. } if paths.len() == 1);
        let moves: HashMap<String, String> = plan.renames.iter().cloned().collect();
        // The final destination of every moved note; `None` when it couldn't move (its linking ops are dropped).
        let mut done: HashMap<String, Option<String>> = HashMap::new();
        let total = plan.files.len();
        let mut step = 0;
        let notes: Vec<usize> = (0..plan.files.len()).filter(|&i| plan.files[i].ops.iter().any(|o| matches!(o, TextOp::ChangeType { .. } | TextOp::KeepTargets { .. }))).collect();
        for &i in &notes {
            let f = plan.files[i].clone();
            step += 1;
            let Some(to) = moves.get(&f.path).cloned() else {
                self.write_one(run, &f);
                self.step(id, step);
                continue;
            };
            let outcome = self.move_note(run, &f, &to, single, &plan.files);
            if let Some(final_to) = &outcome {
                if let Some((_, t)) = plan.renames.iter_mut().find(|(a, _)| *a == f.path) {
                    *t = final_to.clone();
                }
            }
            done.insert(f.path.clone(), outcome);
            self.step(id, step);
        }
        let retarget = |o: TextOp| -> Option<TextOp> {
            match o {
                TextOp::RetargetLinks { from_path, from_stem, from_title, to_title, paths, .. } => match done.get(&from_path) {
                    Some(Some(to)) => Some(TextOp::RetargetLinks { from_path, from_stem, from_title, to_stem: stem_of(to), to_path: to.clone(), to_title, paths }),
                    _ => None,
                },
                other => Some(other),
            }
        };
        for (i, f) in plan.files.iter_mut().enumerate() {
            if !notes.contains(&i) {
                f.ops = std::mem::take(&mut f.ops).into_iter().filter_map(&retarget).collect();
            }
        }
        if let Some(j) = lock(&self.state).jobs.get_mut(&id) {
            j.plan = Some(plan.clone());
        }
        let count_links = !matches!(op, JobOp::FolderMove { .. });
        for (i, f) in plan.files.iter().enumerate() {
            if notes.contains(&i) {
                continue;
            }
            if count_links {
                step += 1;
            }
            if f.ops.is_empty() {
                // Its note didn't move: nothing in it needs to follow (listed with the note's skip).
                self.step(id, step);
                continue;
            }
            let n = run.undo.files.len();
            self.write_one(run, f);
            if single {
                match run.undo.files.get(n) {
                    Some(w) => crate::journal::progress(host.as_ref(), id, &w.before, &w.after, &w.post_v),
                    None => crate::journal::progress_none(host.as_ref(), id, &f.path),
                }
            }
            self.step(id, step);
        }
        let _ = total;
        // D-812: a note whose type changed, or whose type's folder changed, is no longer exempt from tidying.
        let ids: BTreeSet<String> = run.undo.files.iter().filter(|w| w.before != w.after).filter_map(|w| extract(&w.post, &stem_of(&w.after)).id).collect();
        if !ids.is_empty() && !matches!(op, JobOp::FolderMove { r#type: None, .. }) {
            let left: Vec<String> = host.local_exempt().into_iter().filter(|i| !ids.contains(i)).collect();
            host.set_local_exempt(&left);
        }
        Ok(())
    }

    /// One moved note: base check, the new bytes, then the rename; a name taken since planning takes the next free
    /// stem. Returns the path it really took. A single move journals like a note rename (§14.6, D-387).
    fn move_note(&self, run: &mut Run, f: &PlannedFile, to: &str, single: bool, all: &[PlannedFile]) -> Option<String> {
        let host = self.host().clone();
        let id = run.id;
        self.point(id, JobPoint::AfterRead { path: f.path.clone() });
        if host.is_placeholder(&f.path) {
            run.skip(&f.path, SkipReason::Placeholder);
            return None;
        }
        let (pre, pre_v) = match host.read(&f.path) {
            Ok(x) => x,
            Err(e) => {
                run.skip(&f.path, read_reason(&e));
                return None;
            }
        };
        if !pre_v.same_content(&f.version) {
            run.skip(&f.path, SkipReason::Changed);
            return None;
        }
        if std::str::from_utf8(&pre).is_err() {
            run.skip(&f.path, SkipReason::ReadOnly);
            return None;
        }
        let mut to = to.to_string();
        let mut ops = f.ops.clone();
        let mut journaled = false;
        for _ in 0..50 {
            let out = match self.transform(&f.path, &pre, &ops) {
                Ok(Transformed::Bytes(b, _)) => b,
                Ok(Transformed::Unchanged) => pre.clone(),
                Err(_) => {
                    run.skip(&f.path, SkipReason::Io);
                    return None;
                }
            };
            if single && !journaled {
                self.journal_move(id, f, &to, &out, &pre, all);
                journaled = true;
            }
            self.point(id, JobPoint::TempWritten { path: f.path.clone() });
            match host.rename(&f.path, &to, &out, &pre_v) {
                Ok(post_v) => {
                    run.written.push(to.clone());
                    if single {
                        run.renamed = Some((f.path.clone(), to.clone()));
                        crate::journal::progress(host.as_ref(), id, &f.path, &to, &post_v);
                    }
                    run.moved.renames.push((f.path.clone(), to.clone(), sha256_hex(&out)));
                    let retarget = all.iter().flat_map(|x| x.ops.iter()).find(|o| matches!(o, TextOp::RetargetLinks { from_path, .. } if *from_path == f.path)).cloned();
                    if single {
                        run.undo.op = retarget.map(|o| match o {
                            TextOp::RetargetLinks { from_path, from_stem, from_title, to_title, paths, .. } => TextOp::RetargetLinks { from_path, from_stem, from_title, to_stem: stem_of(&to), to_path: to.clone(), to_title, paths },
                            o => o,
                        });
                    }
                    run.undo.files.push(Written { before: f.path.clone(), after: to.clone(), pre, pre_v, post: out, post_v, via_op: false });
                    return Some(to);
                }
                Err(WriteError::NameTaken) => {
                    let folder = folder_of(&to);
                    to = join(&folder, &host.free_stem(&folder, &stem_of(&to)));
                    ops = ops
                        .into_iter()
                        .map(|o| match o {
                            TextOp::KeepTargets { from_path, paths, .. } => TextOp::KeepTargets { from_path, to_path: to.clone(), paths },
                            o => o,
                        })
                        .collect();
                }
                Err(e) => {
                    run.skip(&f.path, write_reason(&e));
                    return None;
                }
            }
        }
        run.skip(&f.path, SkipReason::Io);
        None
    }

    /// The §8 journal of a single type move: the note with its new bytes as target, then each linking note.
    fn journal_move(&self, id: JobId, note: &PlannedFile, to: &str, out: &[u8], pre: &[u8], all: &[PlannedFile]) {
        let host = self.host();
        let op = all.iter().flat_map(|x| x.ops.iter()).find(|o| matches!(o, TextOp::RetargetLinks { from_path, .. } if *from_path == note.path)).cloned();
        let mut entries = vec![crate::journal::Entry { at: note.path.clone(), to: to.to_string(), pre: pre.to_vec(), target: Some(out.to_vec()) }];
        for f in all.iter().filter(|f| f.path != note.path) {
            if let Ok((b, _)) = host.read(&f.path) {
                entries.push(crate::journal::Entry { at: f.path.clone(), to: f.path.clone(), pre: b, target: None });
            }
        }
        let op = op.map(|o| match o {
            TextOp::RetargetLinks { from_path, from_stem, from_title, to_title, paths, .. } => TextOp::RetargetLinks { from_path, from_stem, from_title, to_stem: stem_of(to), to_path: to.to_string(), to_title, paths },
            o => o,
        });
        crate::journal::begin_entries(host.as_ref(), id, "type-move", op.as_ref(), &entries);
    }

    /// The backup label of a move (ms4-tags §5.1, R99).
    pub(super) fn move_label(&self, op: &JobOp, plan: &JobPlan) -> serde_json::Value {
        match op {
            JobOp::TypeMove { to_type, .. } => json!({ "key": "backups.label.typeMove", "args": { "count": plan.renames.len().max(1), "type": to_type } }),
            JobOp::FolderMove { r#type: Some(t), to_folder: Some(f) } => json!({ "key": "backups.label.folderMove", "args": { "type": t, "folder": f } }),
            _ => json!({ "key": "backups.label.tidy", "args": {} }),
        }
    }

    /// D-812: undoing a folder move exempts its notes from later tidy runs.
    pub(super) fn exempt_undone(&self, rec_files: &[Written]) {
        let host = self.host();
        let mut ids: BTreeSet<String> = host.local_exempt().into_iter().collect();
        for w in rec_files.iter().filter(|w| w.before != w.after) {
            if let Some(i) = extract(&w.pre, &stem_of(&w.before)).id {
                ids.insert(i);
            }
        }
        host.set_local_exempt(&ids.into_iter().collect::<Vec<_>>());
    }
}

