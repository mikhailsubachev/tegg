//! Crash recovery (§8, D-387): while a note rename, its undo or its redo writes, `<app>/jobs/<vault>/<job>.json`
//! holds the job's entries (path, target path, the bytes before, and the bytes to write when known in advance), and
//! `<job>.log` gets one line per entry once it is done: `W` with the version written (the base for a later Undo) or
//! `N` when nothing was written. Both are removed when the job ends. A journal left behind is offered on the next
//! open as Finish or Undo; both check every file before writing it (NFR-REL-02).

use std::path::PathBuf;

use serde_json::{json, Value};
use tegg_format::nfc;

use crate::host::{Host, Wrote};
use crate::ops::{op_from_json, op_json};
use crate::{FileVersion, Interrupted, JobError, JobId, JobPlan, ResolveChoice, TextOp, Transformed, Transformer};

/// One file of a journaled job.
pub(crate) struct Entry {
    /// Where the file is when the job starts, and where it ends (they differ only for the renamed note).
    pub at: String,
    pub to: String,
    /// Its bytes when the job started.
    pub pre: Vec<u8>,
    /// The bytes the job writes, when known in advance (undo, redo); `None`: computed by the job's op.
    pub target: Option<Vec<u8>>,
}

fn dir(host: &dyn Host) -> PathBuf {
    host.app_dir().join("jobs").join(host.vault_key())
}
fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
fn unhex(s: &str) -> Vec<u8> {
    (0..s.len() / 2).filter_map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).ok()).collect()
}

/// The highest job id with a journal on disk (0 when none): new ids start above it.
pub(crate) fn max_id(host: &dyn Host) -> JobId {
    host.local_list(&dir(host))
        .into_iter()
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .filter_map(|p| p.file_stem()?.to_str()?.parse::<JobId>().ok())
        .max()
        .unwrap_or(0)
}

/// A note rename, before its first write.
pub(crate) fn begin(host: &dyn Host, job: JobId, plan: &JobPlan) {
    let Some(note) = plan.files.first() else { return };
    let to = plan.renames.first().map(|(_, t)| t.clone()).unwrap_or_else(|| note.path.clone());
    let title = note.ops.iter().find_map(|o| match o {
        TextOp::SetTitle { title, .. } => Some(title.clone()),
        _ => None,
    });
    let op = note.ops.iter().find(|o| matches!(o, TextOp::RetargetLinks { .. }));
    let entries: Vec<Entry> = plan
        .files
        .iter()
        .filter_map(|f| {
            let pre = host.read(&f.path).ok()?.0;
            let target = if f.path == note.path { to.clone() } else { f.path.clone() };
            Some(Entry { at: f.path.clone(), to: target, pre, target: None })
        })
        .collect();
    write_header(host, job, "rename", op, title, &entries);
}

/// An undo or redo (`kind`), before its first write.
pub(crate) fn begin_entries(host: &dyn Host, job: JobId, kind: &str, op: Option<&TextOp>, entries: &[Entry]) {
    write_header(host, job, kind, op, None, entries);
}

fn write_header(host: &dyn Host, job: JobId, kind: &str, op: Option<&TextOp>, title: Option<String>, entries: &[Entry]) {
    let files: Vec<Value> = entries
        .iter()
        .map(|e| json!({ "at": e.at, "to": e.to, "pre": hex(&e.pre), "target": e.target.as_ref().map(|t| hex(t)) }))
        .collect();
    let v = json!({ "job": job, "kind": kind, "op": op.map(op_json), "title": title, "files": files });
    let d = dir(host);
    let _ = host.local_write(&d.join(format!("{job}.json")), v.to_string().as_bytes());
    let _ = host.local_write(&d.join(format!("{job}.log")), b"");
}

fn append(host: &dyn Host, job: JobId, line: String) {
    let log = dir(host).join(format!("{job}.log"));
    let mut b = host.local_read(&log).unwrap_or_default();
    b.extend_from_slice(line.as_bytes());
    b.push(b'\n');
    let _ = host.local_write(&log, &b);
}

/// The entry at `at` was written; it is now at `to` with version `v`.
pub(crate) fn progress(host: &dyn Host, job: JobId, at: &str, to: &str, v: &FileVersion) {
    append(host, job, format!("W\t{at}\t{to}\t{}\t{}", v.size, hex(&v.hash)));
}

/// The entry at `at` is done without a write (unchanged or skipped).
pub(crate) fn progress_none(host: &dyn Host, job: JobId, at: &str) {
    append(host, job, format!("N\t{at}"));
}

/// The note's rename took `to` (a free stem after a clash, FR-FMT-08 AC-10): the journal's op and the note's target
/// follow it, so Finish never moves links to the planned name another note took (D-433).
pub(crate) fn retarget(host: &dyn Host, job: JobId, op: &TextOp, note: &str, to: &str) {
    let path = dir(host).join(format!("{job}.json"));
    let Some(mut v) = host.local_read(&path).and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else { return };
    v["op"] = op_json(op);
    if let Some(files) = v["files"].as_array_mut() {
        for f in files.iter_mut().filter(|f| f["at"].as_str() == Some(note)) {
            f["to"] = json!(to);
        }
    }
    let _ = host.local_write(&path, v.to_string().as_bytes());
}

pub(crate) fn finish(host: &dyn Host, job: JobId) {
    let d = dir(host);
    host.local_remove(&d.join(format!("{job}.json")));
    host.local_remove(&d.join(format!("{job}.log")));
}

struct Loaded {
    kind: String,
    op: Option<TextOp>,
    title: Option<String>,
    entries: Vec<Entry>,
    /// at → (to, size, hash) for written entries.
    written: Vec<(String, String, u64, [u8; 32])>,
    done: Vec<String>,
}

fn load(host: &dyn Host, job: JobId) -> Option<Loaded> {
    let d = dir(host);
    let v: Value = serde_json::from_slice(&host.local_read(&d.join(format!("{job}.json")))?).ok()?;
    let log = String::from_utf8(host.local_read(&d.join(format!("{job}.log"))).unwrap_or_default()).unwrap_or_default();
    let s = |x: &Value| x.as_str().unwrap_or_default().to_string();
    let entries = v["files"]
        .as_array()?
        .iter()
        .map(|f| Entry { at: s(&f["at"]), to: s(&f["to"]), pre: unhex(&s(&f["pre"])), target: f["target"].as_str().map(unhex) })
        .collect();
    let mut written = Vec::new();
    let mut done = Vec::new();
    for line in log.lines() {
        let p: Vec<&str> = line.split('\t').collect();
        match p.as_slice() {
            ["W", at, to, size, hash] => {
                let mut h = [0u8; 32];
                h.copy_from_slice(&unhex(hash).into_iter().chain(std::iter::repeat(0)).take(32).collect::<Vec<_>>());
                written.push((at.to_string(), to.to_string(), size.parse().unwrap_or(0), h));
                done.push(at.to_string());
            }
            ["N", at] => done.push(at.to_string()),
            _ => {}
        }
    }
    Some(Loaded { kind: s(&v["kind"]), op: v.get("op").and_then(op_from_json), title: v["title"].as_str().map(str::to_string), entries, written, done })
}

pub(crate) fn interrupted(host: &dyn Host) -> Vec<Interrupted> {
    let mut out: Vec<Interrupted> = host
        .local_list(&dir(host))
        .into_iter()
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .filter_map(|p| p.file_stem()?.to_str()?.parse::<JobId>().ok())
        .filter_map(|job| {
            let l = load(host, job)?;
            let moved = l.entries.iter().find(|e| e.at != e.to).or(l.entries.first())?;
            // ms4-jobs §14.6: a type move counts its links only (`<done> of <total> links updated`).
            if l.kind == "type-move" {
                let links = l.entries.iter().filter(|e| e.at == e.to).count();
                let done = l.done.iter().filter(|d| l.entries.iter().any(|e| e.at == e.to && nfc(&e.at) == nfc(d))).count();
                return Some(Interrupted { job, from: moved.at.clone(), to: moved.to.clone(), done, total: links });
            }
            Some(Interrupted { job, from: moved.at.clone(), to: moved.to.clone(), done: l.done.len().min(l.entries.len()), total: l.entries.len() })
        })
        .collect();
    out.sort_by_key(|i| i.job);
    out
}

/// Undo: every file the job wrote and that is still exactly what it wrote gets its bytes from before the job (the
/// renamed note its old name too); anything changed since is left alone. Finish: the files not done yet get the job's
/// change from their current bytes, if they are still what the job found; a rename whose note wasn't renamed yet
/// renames it first. Removes the journal.
/// D-755: the renamed note when a kill came after its rename but before its log line: still pending, gone from its
/// old path, and at its target path with the same `id` (so the file there is the note, not another one).
fn moved_unlogged<'a>(host: &dyn Host, l: &'a Loaded) -> Option<(&'a Entry, FileVersion)> {
    let note = l.entries.iter().find(|e| e.at != e.to)?;
    if l.done.iter().any(|d| nfc(d) == nfc(&note.at)) || host.read(&note.at).is_ok() {
        return None;
    }
    let (now, v) = host.read(&note.to).ok()?;
    // The frontmatter's `id:` line (between the opening and the closing `---`).
    let id = |b: &[u8]| String::from_utf8_lossy(b).lines().skip(1).take_while(|x| x.trim_end() != "---").find(|x| x.starts_with("id:")).map(|x| x.trim().to_string());
    (id(&note.pre).is_some() && id(&note.pre) == id(&now)).then_some((note, v))
}

pub(crate) fn resolve(host: &dyn Host, transformer: &dyn Transformer, job: JobId, choice: ResolveChoice) -> Result<(), JobError> {
    let l = load(host, job).ok_or(JobError::NotFound)?;
    match choice {
        ResolveChoice::Undo => {
            // D-755: the note was renamed but not logged (no link was written yet): move it back with its old bytes.
            if let Some((note, v)) = moved_unlogged(host, &l) {
                let _ = host.rename(&note.to, &note.at, &note.pre, &v);
            }
            // The note first (D-433): if it can't move back, no link is changed.
            let mut written = l.written.clone();
            written.sort_by_key(|(at, to, _, _)| nfc(at) == nfc(to));
            for (at, to, size, hash) in &written {
                let Some(e) = l.entries.iter().find(|e| nfc(&e.at) == nfc(at)) else { continue };
                let is_note = nfc(to) != nfc(at);
                let Ok((_, cur)) = host.read(to) else {
                    if is_note {
                        break;
                    }
                    continue;
                };
                if cur.size != *size || cur.hash != *hash {
                    // Changed since the crash: never overwritten (NFR-REL-02); the note staying means its links stay.
                    if is_note {
                        break;
                    }
                    continue;
                }
                if nfc(to) != nfc(at) {
                    let taken = host.version(at).is_some() && nfc(at).to_lowercase() != nfc(to).to_lowercase();
                    if taken || host.rename(to, at, &e.pre, &cur).is_err() {
                        break;
                    }
                } else {
                    let _ = host.write(at, &e.pre, &cur);
                }
            }
        }
        ResolveChoice::Finish => finish_rest(host, transformer, &l),
    }
    finish(host, job);
    Ok(())
}

fn finish_rest(host: &dyn Host, transformer: &dyn Transformer, l: &Loaded) {
    let pending = |e: &Entry| !l.done.iter().any(|d| nfc(d) == nfc(&e.at));
    // The current bytes of a pending entry, if still what the job found and valid UTF-8 (D-180).
    let unchanged = |e: &Entry| -> Option<(Vec<u8>, FileVersion)> {
        let (b, v) = host.read(&e.at).ok()?;
        (b == e.pre && std::str::from_utf8(&b).is_ok()).then_some((b, v))
    };
    let apply = |path: &str, bytes: &[u8], ops: &[TextOp]| match transformer.transform(path, bytes, ops) {
        Ok(Transformed::Bytes(out, _)) => Some(out),
        _ => None,
    };
    if l.kind == "rename" {
        let Some(op) = l.op.clone() else { return };
        // The note first: links may only move to a name that exists.
        if let Some(note) = l.entries.iter().find(|e| e.at != e.to) {
            // D-755: renamed before the kill but not logged: the note is where it should be, so only the links remain.
            if pending(note) && moved_unlogged(host, l).is_none() {
                let Some((b, v)) = unchanged(note) else { return };
                let mut ops = Vec::new();
                if let Some(t) = &l.title {
                    ops.push(TextOp::SetTitle { title: t.clone(), now: host.now() });
                }
                ops.push(op.clone());
                let Some(out) = apply(&note.at, &b, &ops) else { return };
                if host.rename(&note.at, &note.to, &out, &v).is_err() {
                    return; // the links stay with the note where it is
                }
            }
        }
        for e in l.entries.iter().filter(|e| e.at == e.to && pending(e)) {
            if let Some((b, v)) = unchanged(e) {
                if let Some(out) = apply(&e.at, &b, std::slice::from_ref(&op)) {
                    let _ = matches!(host.write(&e.at, &out, &v), Ok(Wrote::Written(_)));
                }
            }
        }
    } else {
        for e in l.entries.iter().filter(|e| pending(e)) {
            let Some((b, v)) = unchanged(e) else { continue };
            let out = match (&e.target, &l.op) {
                (Some(t), _) => t.clone(),
                (None, Some(op)) => match apply(&e.at, &b, std::slice::from_ref(op)) {
                    Some(o) => o,
                    None => continue,
                },
                (None, None) => continue,
            };
            if e.at != e.to {
                let _ = host.rename(&e.at, &e.to, &out, &v);
            } else {
                let _ = host.write(&e.at, &out, &v);
            }
        }
    }
}
