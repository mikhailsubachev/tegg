//! Slice 4E-1 (ms4-jobs §14): the `type-move` and `folder-move` planners and their write step. A type move maps the
//! note's properties and moves it to its new type's folder (D-804, D-813, D-826); a folder move takes every object of a
//! type that is outside its folder there (the folder save and the tidy job, D-805, D-811). Linking notes get the 4C
//! retarget op, which changes only what a move breaks (D-810); the moved note gets `keep-targets`.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;

use serde_json::json;
use tegg_format::{extract, nfc};

use super::{folder_of, join, key, lock, read_reason, stem_of, write_reason, Inner, Run, Written};
use crate::host::{Host, WriteError, Wrote};
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

/// Board E2 (D-808): every value of `a` stays valid as written under `b`.
fn widens(a: &crate::host::HostProperty, b: &crate::host::HostProperty) -> bool {
    let (x, y) = (a.kind.as_str(), b.kind.as_str());
    if x == y {
        return x != "relation" || b.to.is_empty() || (!a.to.is_empty() && a.to.iter().all(|k| b.to.iter().any(|t| key(t) == key(k))));
    }
    let wide = ["number", "checkbox", "date", "date-time", "url", "email", "select", "multi-select", "relation", "text", "long-text"];
    matches!(y, "text" | "long-text") && wide.contains(&x) || (x == "date" && y == "date-time") || (x == "select" && y == "multi-select")
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
    fn move_target(&self, path: &str, folder: &str, notes: &[String], reserved: &mut BTreeSet<String>) -> String {
        let stem = stem_of(path);
        let own = join(folder, &stem);
        let taken = notes.iter().any(|n| key(n) != key(path) && key(&folder_of(n)) == key(folder) && key(&stem_of(n)) == key(&stem)) || reserved.contains(&key(&own));
        // QA B1: a name this job already gave out is taken too.
        let to = if taken { join(folder, &self.host().free_stem_avoiding(folder, &stem, reserved)) } else { own };
        reserved.insert(key(&to));
        to
    }

    /// ms4-jobs §14.3: the moved notes first (in path order), then every linking note with one retarget op per moved
    /// note it links to.
    pub(super) fn plan_type_move(&self, id: JobId, run: &mut Run, paths: &[String], to_type: &str, mapping: &[PropertyMap], review: bool) -> JobPlan {
        let host = self.host();
        let notes = host.note_paths();
        let folder = host.type_folder(to_type).unwrap_or_default();
        let now = host.now();
        let mut reserved = BTreeSet::new();
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
            // D-813, D-837: only the old type's schema properties are mapped, in its order (an untyped note: none).
            let mut map: Vec<&PropertyMap> = mapping.iter().filter(|m| order(&m.from) != usize::MAX).collect();
            map.sort_by_key(|m| order(&m.from));
            // D-808: a target of a narrower value type is never written; such a row goes into the content.
            let target_schema = host.schema(to_type);
            let target_of = |m: &PropertyMap| -> String {
                match &m.to {
                    MapTarget::Property(k) => {
                        let from = schema.iter().find(|s| nfc(&s.key) == nfc(&m.from));
                        let to = target_schema.iter().find(|s| nfc(&s.key) == nfc(k));
                        match (from, to) {
                            (Some(a), Some(b)) if widens(a, b) => k.clone(),
                            _ => "content".into(),
                        }
                    }
                    MapTarget::Content => "content".into(),
                }
            };
            let mut ops = Vec::new();
            if !map.is_empty() {
                ops.push(TextOp::MapProperties {
                    map: map.iter().map(|m| (m.from.clone(), target_of(m))).collect(),
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
                let to = self.move_target(&p, &folder, &notes, &mut reserved);
                ops.push(TextOp::KeepTargets { from_path: p.clone(), to_path: to.clone(), paths: Vec::new() }); // a marker: the write step gives every file one relink (§14.3a)
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
        let exempt_paths: BTreeSet<String> = if r#type.is_none() { host.local_exempt_paths().into_iter().map(|p| key(&p)).collect() } else { BTreeSet::new() };
        let mut files = Vec::new();
        let mut renames = Vec::new();
        let mut moved = Vec::new();
        let mut reserved = BTreeSet::new();
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
                if extract(&bytes, &stem_of(&p)).id.is_some_and(|i| exempt.contains(&i)) || exempt_paths.contains(&key(&p)) {
                    continue;
                }
                let to = self.move_target(&p, &folder, &notes, &mut reserved);
                files.push(PlannedFile { path: p.clone(), version, ops: vec![TextOp::KeepTargets { from_path: p.clone(), to_path: to.clone(), paths: Vec::new() }] });
                renames.push((p.clone(), to.clone()));
                moved.push((p, to));
            }
        }
        self.add_linking(&mut files, &moved, &notes);
        let n = files.len();
        JobPlan { job: id, kind: JobKind::FolderMove, files, renames, creates: Vec::new(), trashes: Vec::new(), counts: PlanCounts { files: n, links: 0 }, warnings: Vec::new() }
    }

    /// D-838: every note whose links could change target when a note moves: those linking to the moved note, and
    /// those linking to another note with the moved note's new stem (a duplicate, which the move could take over).
    fn add_linking(&self, files: &mut Vec<PlannedFile>, moved: &[(String, String)], notes: &[String]) {
        let host = self.host();
        let mut linking: BTreeMap<String, Vec<TextOp>> = BTreeMap::new();
        // QA N10: one stem map for the whole job, not a scan of every note per moved note.
        let mut by_stem: HashMap<String, Vec<&String>> = HashMap::new();
        for n in notes.iter().filter(|n| !excluded(n)) {
            by_stem.entry(key(&stem_of(n))).or_default().push(n);
        }
        for (from, to) in moved {
            let op = TextOp::HoldTargets { from_path: from.clone(), to_path: to.clone(), paths: Vec::new() }; // a marker (§14.3a)
            let mut sources: BTreeSet<String> = host.linking(from).into_iter().map(|l| nfc(&l)).collect();
            for other in by_stem.get(&key(&stem_of(to))).into_iter().flatten().filter(|n| key(n) != key(from)) {
                sources.extend(host.linking(other).into_iter().map(|l| nfc(&l)));
            }
            for l in sources {
                if key(&l) == key(from) {
                    continue;
                }
                match files.iter_mut().find(|f| key(&f.path) == key(&l)) {
                    // A moved note that links to another: the hold comes before its own keep-targets.
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
            let path = format!(".tegg/types/{}.yml", nfc(t));
            let pre = host.read(&path).ok();
            match host.write_type_folder(t, f) {
                Ok(Some(p)) => {
                    // D-840: Undo of a folder save restores the previous `folder:` too.
                    if let (Some((pre, pre_v)), Ok((post, post_v))) = (pre, host.read(&p)) {
                        run.undo.files.push(Written { before: p.clone(), after: p.clone(), pre, pre_v, post, post_v, via_op: false, direct: false });
                    }
                    run.written.push(p);
                }
                Ok(None) => {}
                Err(e) => return Err(e),
            }
        }
        run.undo.exempt = matches!(op, JobOp::FolderMove { r#type: None, .. });
        let single = matches!(op, JobOp::TypeMove { paths, .. } if paths.len() == 1);
        // QA 4 M7′: the vault's lists once per job, shared by every file's relink.
        let paths_before = Arc::new(host.note_paths());
        let files = Arc::new(host.vault_files());
        let is_link_op = |o: &TextOp| matches!(o, TextOp::KeepTargets { .. } | TextOp::HoldTargets { .. } | TextOp::RetargetLinks { .. } | TextOp::Relink { .. });
        // QA N1: which notes can move, and where, is settled before the first rename, so every file's links are judged
        // against the moves that really happen (skips and taken names included).
        let mut done: HashMap<String, Option<String>> = HashMap::new();
        let mut ready: Vec<(usize, Vec<u8>, crate::FileVersion, String)> = Vec::new();
        let mut taken: BTreeSet<String> = BTreeSet::new();
        for (i, f) in plan.files.iter().enumerate() {
            let Some(to) = plan.renames.iter().find(|(a, _)| *a == f.path).map(|(_, t)| t.clone()) else { continue };
            self.point(id, JobPoint::AfterRead { path: f.path.clone() });
            let checked = if host.is_placeholder(&f.path) {
                Err(SkipReason::Placeholder)
            } else {
                match host.read(&f.path) {
                    Err(e) => Err(read_reason(&e)),
                    Ok((b, _)) if std::str::from_utf8(&b).is_err() => Err(SkipReason::ReadOnly),
                    Ok((_, v)) if !v.same_content(&f.version) => Err(SkipReason::Changed),
                    Ok((b, v)) => Ok((b, v)),
                }
            };
            match checked {
                Err(reason) => {
                    run.skip(&f.path, reason);
                    done.insert(f.path.clone(), None);
                }
                Ok((b, v)) => {
                    let folder = folder_of(&to);
                    let mut to = to;
                    // Taken since planning (or by an earlier move of this job): one free name from the note's own stem
                    // that avoids every file and every name this job gave out (QA B1: no loop).
                    if host.version(&to).is_some_and(|_| key(&to) != key(&f.path)) || taken.contains(&key(&to)) {
                        to = join(&folder, &host.free_stem_avoiding(&folder, &stem_of(&f.path), &taken));
                    }
                    taken.insert(key(&to));
                    done.insert(f.path.clone(), Some(to.clone()));
                    ready.push((i, b, v, to));
                }
            }
        }
        let moves: Vec<(String, String)> = ready.iter().map(|(i, _, _, to)| (plan.files[*i].path.clone(), to.clone())).collect();
        let relink = TextOp::Relink { moves: Arc::new(moves.clone()), paths: paths_before.clone(), files: files.clone() };
        // Every file gets one relink over the whole move set in place of its per-move link ops.
        for f in plan.files.iter_mut() {
            let had = f.ops.iter().any(is_link_op);
            f.ops.retain(|o| !is_link_op(o));
            if had || moves.iter().any(|(a, _)| *a == f.path) {
                f.ops.push(relink.clone());
            }
        }
        for (a, t) in plan.renames.iter_mut() {
            if let Some(Some(to)) = done.get(a) {
                *t = to.clone();
            }
        }
        let moving: BTreeSet<String> = plan.renames.iter().map(|(a, _)| a.clone()).collect();
        plan.renames.retain(|(a, _)| matches!(done.get(a), Some(Some(_))));
        if let Some(j) = lock(&self.state).jobs.get_mut(&id) {
            j.plan = Some(plan.clone());
        }
        let mut step = 0;
        // The moved notes: each renamed with its final bytes in one step (§14.5).
        let mut late: Vec<(String, String)> = Vec::new();
        for (i, pre, pre_v, to) in &ready {
            let f = plan.files[*i].clone();
            step += 1;
            match self.move_note(run, &f, to, pre.clone(), pre_v.clone(), single, &plan.files, &mut taken) {
                Some(actual) if actual != *to => {
                    late.push((to.clone(), actual.clone()));
                    done.insert(f.path.clone(), Some(actual));
                }
                Some(_) => {}
                None => {
                    done.insert(f.path.clone(), None);
                }
            }
            self.step(id, step);
        }
        // The moves that really happened (a rename can still fail or take another name at the last moment): every
        // other file is written with them (QA M3), and undo / redo of files written through an editor use them (M5).
        let real: Vec<(String, String)> = moves.iter().filter_map(|(a, _)| done.get(a).cloned().flatten().map(|t| (a.clone(), t))).collect();
        let relink_real = TextOp::Relink { moves: Arc::new(real.clone()), paths: paths_before.clone(), files: files.clone() };
        run.undo.op = Some(relink_real.clone());
        for f in plan.files.iter_mut().filter(|f| !moving.contains(&f.path)) {
            for o in f.ops.iter_mut() {
                if matches!(o, TextOp::Relink { .. }) {
                    *o = relink_real.clone();
                }
            }
        }
        // m1: the plan names the moves that happened (Retry reads it).
        plan.renames = real.clone();
        if let Some(j) = lock(&self.state).jobs.get_mut(&id) {
            j.plan = Some(plan.clone());
        }
        // Notes whose type changes in place (QA M2: never a note of the move set). Written directly, not through an open
        // editor (M1): the page that started the change holds its saver and reloads the note when the job ends.
        for f in plan.files.iter().filter(|f| !moving.contains(&f.path) && f.ops.iter().any(|o| matches!(o, TextOp::ChangeType { .. }))) {
            step += 1;
            self.write_direct(run, f);
            self.step(id, step);
        }
        let count_links = !matches!(op, JobOp::FolderMove { .. });
        // Every note of the move set (moved, skipped or changed in place) is done; the rest are linking notes.
        let skipped_notes: BTreeSet<String> = plan.files.iter().filter(|f| moving.contains(&f.path) || f.ops.iter().any(|o| matches!(o, TextOp::ChangeType { .. }))).map(|f| f.path.clone()).collect();
        for f in plan.files.iter().filter(|f| !skipped_notes.contains(&f.path)) {
            if count_links {
                step += 1;
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
        // A moved note already written with a link to a note that then took another name: corrected now.
        if !late.is_empty() || real.len() != moves.len() {
            let now = host.note_paths();
            for (from, to) in real.iter() {
                let Ok((b, v)) = host.read(to) else { continue };
                // The paths as this note's text assumed them: every planned destination in place.
                let assumed: Vec<String> = now.iter().map(|p| late.iter().find(|(_, act)| key(act) == key(p)).map(|(pl, _)| pl.clone()).unwrap_or_else(|| p.clone())).chain(moves.iter().filter(|(a, _)| real.iter().all(|(r, _)| r != a)).map(|(_, t)| t.clone())).collect();
                let mut fix: Vec<(String, String)> = late.clone();
                fix.extend(moves.iter().filter(|(a, _)| real.iter().all(|(r, _)| r != a)).map(|(a, t)| (t.clone(), a.clone())));
                let op = TextOp::Relink { moves: Arc::new(fix), paths: Arc::new(assumed), files: files.clone() };
                // QA M4: the note's own undo row and journal line are updated, never doubled.
                let Ok(Transformed::Bytes(out, _)) = self.transform(to, &b, std::slice::from_ref(&op)) else { continue };
                if let Ok(Wrote::Written(post_v)) = host.write(to, &out, &v) {
                    if let Some(w) = run.undo.files.iter_mut().find(|w| w.before == *from && w.after == *to) {
                        w.post = out;
                        w.post_v = post_v.clone();
                    }
                    if single {
                        crate::journal::progress(host.as_ref(), id, from, to, &post_v);
                    }
                }
            }
        }
        // D-812, D-839: a note whose type changed (moved or not), or whose type's folder changed, is no longer exempt.
        if !matches!(op, JobOp::FolderMove { r#type: None, .. }) {
            let mut ids = BTreeSet::new();
            let mut paths = BTreeSet::new();
            let changed: Vec<String> = match op {
                JobOp::FolderMove { r#type: Some(t), .. } => host.objects_of(t),
                // m4: only notes whose type really changed (moved, or written in place), not skipped ones.
                _ => plan.files.iter().filter(|f| f.ops.iter().any(|o| matches!(o, TextOp::ChangeType { .. }))).map(|f| f.path.clone()).filter(|p| !matches!(done.get(p), Some(None)) && !run.skipped.iter().any(|s| s.path == *p)).collect(),
            };
            // N4: the old paths of the moved notes too (the index already has them at their new paths).
            for (from, _) in &moves {
                paths.insert(key(from));
            }
            for p in changed {
                paths.insert(key(&p));
                let now = done.get(&p).cloned().flatten().unwrap_or_else(|| p.clone());
                paths.insert(key(&now));
                if let Ok((b, _)) = host.read(&now) {
                    if let Some(i) = extract(&b, &stem_of(&now)).id {
                        ids.insert(i);
                    }
                }
            }
            let left: Vec<String> = host.local_exempt().into_iter().filter(|i| !ids.contains(i)).collect();
            host.set_local_exempt(&left);
            let left: Vec<String> = host.local_exempt_paths().into_iter().filter(|p| !paths.contains(&key(p))).collect();
            host.set_local_exempt_paths(&left);
        }
        Ok(())
    }

    /// One moved note, already checked (QA N1): its new bytes, then the rename; a name taken at the last moment takes the
    /// next free stem. Returns the path it really took. A single move journals like a note rename (§14.6, D-387).
    #[allow(clippy::too_many_arguments)]
    fn move_note(&self, run: &mut Run, f: &PlannedFile, to: &str, pre: Vec<u8>, pre_v: crate::FileVersion, single: bool, all: &[PlannedFile], taken: &mut BTreeSet<String>) -> Option<String> {
        let host = self.host().clone();
        let id = run.id;
        let mut to = to.to_string();
        let ops = f.ops.clone();
        for _ in 0..50 {
            let out = match self.transform(&f.path, &pre, &ops) {
                Ok(Transformed::Bytes(b, _)) => b,
                Ok(Transformed::Unchanged) => pre.clone(),
                Err(_) => {
                    run.skip(&f.path, SkipReason::Io);
                    return None;
                }
            };
            if single {
                // §8: written again when a taken name moved the target, so Finish uses the name the move really takes.
                self.journal_move(id, f, &to, &out, &pre, all);
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
                    run.undo.files.push(Written { before: f.path.clone(), after: to.clone(), pre, pre_v, post: out, post_v, via_op: false, direct: false });
                    return Some(to);
                }
                Err(WriteError::NameTaken) => {
                    // Its own links were judged from the planned folder, which is the same: the bytes stay. The next name
                    // comes from the note's own stem and avoids this job's other names (QA 4 N3: never `Beta (2) (2)`).
                    let folder = folder_of(&to);
                    to = join(&folder, &host.free_stem_avoiding(&folder, &stem_of(&f.path), taken));
                    taken.insert(key(&to));
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
        let op = all.iter().flat_map(|x| x.ops.iter()).find(|o| matches!(o, TextOp::Relink { .. })).cloned();
        let mut entries = vec![crate::journal::Entry { at: note.path.clone(), to: to.to_string(), pre: pre.to_vec(), target: Some(out.to_vec()) }];
        for f in all.iter().filter(|f| f.path != note.path) {
            if let Ok((b, _)) = host.read(&f.path) {
                entries.push(crate::journal::Entry { at: f.path.clone(), to: f.path.clone(), pre: b, target: None });
            }
        }
        let op = op.map(|o| match o {
            TextOp::Relink { moves, paths, files } => TextOp::Relink { moves: Arc::new(moves.iter().map(|(a, t)| if *a == note.path { (a.clone(), to.to_string()) } else { (a.clone(), t.clone()) }).collect()), paths, files },
            o => o,
        });
        let title = extract(pre, &stem_of(&note.path)).title;
        crate::journal::begin_titled(host.as_ref(), id, "type-move", op.as_ref(), &title, &entries);
    }

    /// The backup label of a move (ms4-tags §5.1, R99).
    pub(super) fn move_label(&self, op: &JobOp, plan: &JobPlan) -> serde_json::Value {
        match op {
            JobOp::TypeMove { paths, to_type, .. } => {
                let name = self.host().type_names(to_type).map(|(n, _)| n).unwrap_or_else(|| to_type.clone());
                json!({ "key": "backups.label.typeMove", "args": { "count": paths.len().max(1), "type": name } })
            }
            JobOp::FolderMove { r#type: Some(t), to_folder: Some(f) } => {
                // R99: `Move <plural> to <folder>`, the type's Name for 1 and its plural otherwise, in lower case.
                let (name, plural) = self.host().type_names(t).unwrap_or_else(|| (t.clone(), t.clone()));
                let word = if plan.renames.len() == 1 { name } else { plural };
                json!({ "key": "backups.label.folderMove", "args": { "plural": word.to_lowercase(), "folder": f } })
            }
            _ => json!({ "key": "backups.label.tidy", "args": {} }),
        }
    }

    /// D-812: undoing a folder move exempts its notes from later tidy runs.
    pub(super) fn exempt_undone(&self, rec_files: &[Written]) {
        let host = self.host();
        let mut ids: BTreeSet<String> = host.local_exempt().into_iter().collect();
        let mut paths: BTreeSet<String> = host.local_exempt_paths().into_iter().collect();
        for w in rec_files.iter().filter(|w| w.before != w.after) {
            match extract(&w.pre, &stem_of(&w.before)).id {
                Some(i) => {
                    ids.insert(i);
                }
                // D-839: a note without an `id` is exempt by its (restored) path.
                None => {
                    paths.insert(nfc(&w.before));
                }
            }
        }
        host.set_local_exempt(&ids.into_iter().collect::<Vec<_>>());
        host.set_local_exempt_paths(&paths.into_iter().collect::<Vec<_>>());
    }
}

