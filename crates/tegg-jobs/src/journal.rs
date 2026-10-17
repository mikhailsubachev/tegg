//! Crash recovery for note renames (§8, D-387): while a rename writes, `<app>/jobs/<vault>/<job>.json` holds the
//! rename, the planned files with their pre-job bytes, and `<job>.log` lists each file once it is done. Both are
//! removed when the job ends. A journal left behind is offered on the next open as Finish or Undo.

use std::path::PathBuf;

use serde_json::{json, Value};
use tegg_format::nfc;

use crate::host::{Host, Wrote};
use crate::{
    Interrupted, JobError, JobId, JobPlan, ResolveChoice, TextOp, Transformed, Transformer,
};

fn dir(host: &dyn Host) -> PathBuf {
    host.app_dir().join("jobs").join(host.vault_key())
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
fn unhex(s: &str) -> Vec<u8> {
    (0..s.len() / 2)
        .filter_map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).ok())
        .collect()
}

/// Called before the first write of a note rename.
pub(crate) fn begin(host: &dyn Host, job: JobId, plan: &JobPlan) {
    let Some(TextOp::RetargetLinks {
        from_path,
        from_stem,
        from_title,
        to_path,
        to_stem,
        to_title,
        ..
    }) = plan.files.first().and_then(|f| f.ops.get(1))
    else {
        return;
    };
    let files: Vec<Value> = plan
        .files
        .iter()
        .filter_map(|f| {
            host.read(&f.path)
                .ok()
                .map(|(b, _)| json!({ "path": f.path, "pre": hex(&b) }))
        })
        .collect();
    let v = json!({
        "job": job, "fromPath": from_path, "fromStem": from_stem, "fromTitle": from_title,
        "toPath": to_path, "toStem": to_stem, "toTitle": to_title, "files": files,
    });
    let d = dir(host);
    let _ = host.local_write(&d.join(format!("{job}.json")), v.to_string().as_bytes());
    let _ = host.local_write(&d.join(format!("{job}.log")), b"");
}

pub(crate) fn progress(host: &dyn Host, job: JobId, path: &str) {
    let log = dir(host).join(format!("{job}.log"));
    let mut b = host.local_read(&log).unwrap_or_default();
    b.extend_from_slice(path.as_bytes());
    b.push(b'\n');
    let _ = host.local_write(&log, &b);
}

pub(crate) fn finish(host: &dyn Host, job: JobId) {
    let d = dir(host);
    host.local_remove(&d.join(format!("{job}.json")));
    host.local_remove(&d.join(format!("{job}.log")));
}

fn load(host: &dyn Host, job: JobId) -> Option<(Value, Vec<String>)> {
    let d = dir(host);
    let v: Value = serde_json::from_slice(&host.local_read(&d.join(format!("{job}.json")))?).ok()?;
    let log = String::from_utf8(host.local_read(&d.join(format!("{job}.log"))).unwrap_or_default()).unwrap_or_default();
    Some((v, log.lines().map(str::to_string).collect()))
}

pub(crate) fn interrupted(host: &dyn Host) -> Vec<Interrupted> {
    let mut out: Vec<Interrupted> = host
        .local_list(&dir(host))
        .into_iter()
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .filter_map(|p| p.file_stem()?.to_str()?.parse::<JobId>().ok())
        .filter_map(|job| {
            let (v, log) = load(host, job)?;
            let total = v["files"].as_array().map(|a| a.len()).unwrap_or(0);
            Some(Interrupted { job, from: v["fromPath"].as_str()?.to_string(), to: v["toPath"].as_str()?.to_string(), done: (log.len() + 1).min(total), total })
        })
        .collect();
    out.sort_by_key(|i| i.job);
    out
}

/// Finish: rewrite the links of the files not done yet (from their current bytes). Undo: every file back to its
/// pre-job bytes, the note back to its old name. Removes the journal.
pub(crate) fn resolve(
    host: &dyn Host,
    transformer: &dyn Transformer,
    job: JobId,
    choice: ResolveChoice,
) -> Result<(), JobError> {
    let (v, log) = load(host, job).ok_or(JobError::NotFound)?;
    let s = |k: &str| v[k].as_str().unwrap_or_default().to_string();
    let (from, to) = (s("fromPath"), s("toPath"));
    let files: Vec<(String, Vec<u8>)> = v["files"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|f| {
                    (
                        f["path"].as_str().unwrap_or_default().to_string(),
                        unhex(f["pre"].as_str().unwrap_or_default()),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    let renamed = from != to && host.version(&to).is_some() && host.version(&from).is_none();
    match choice {
        ResolveChoice::Undo => {
            for (path, pre) in &files {
                let at = if *path == from && renamed {
                    to.clone()
                } else {
                    path.clone()
                };
                let Ok((_, cur)) = host.read(&at) else {
                    continue;
                };
                if at != *path {
                    let _ = host.rename(&at, path, pre, &cur);
                } else {
                    let _ = host.write(path, pre, &cur);
                }
            }
        }
        ResolveChoice::Finish => {
            let mut paths = host.note_paths();
            if !paths.iter().any(|p| nfc(p) == nfc(&from)) {
                paths.push(from.clone());
            }
            let op = TextOp::RetargetLinks {
                from_path: from.clone(),
                from_stem: s("fromStem"),
                from_title: s("fromTitle"),
                to_path: to.clone(),
                to_stem: s("toStem"),
                to_title: s("toTitle"),
                paths,
            };
            for (path, _) in files.iter().skip(1).filter(|(p, _)| !log.contains(p)) {
                let Ok((bytes, cur)) = host.read(path) else {
                    continue;
                };
                if let Ok(Transformed::Bytes(out, _)) =
                    transformer.transform(path, &bytes, std::slice::from_ref(&op))
                {
                    let _ = matches!(host.write(path, &out, &cur), Ok(Wrote::Written(_)));
                }
            }
        }
    }
    finish(host, job);
    Ok(())
}
