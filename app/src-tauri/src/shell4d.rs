//! Slice 4D-lite shell (docs/contracts/ms4-tags.md §3, §4.4, §5.2; D-690…D-740): the tag, merge and backup IPC
//! commands of the main window.

use tauri::State;
use tegg_core::tegg_jobs::{JobError, JobOp, PlanWarning, TextOp};
use tegg_core::TagRow;
use tegg_format::{nfc, sanitize_file_stem};

use crate::dto::*;
use crate::{core, err, job_err, version_dto, AppState};

pub(crate) fn tag_row_dto(r: TagRow) -> TagRowDto {
    TagRowDto {
        key: r.key,
        name: r.name,
        file: r.file.map(|f| TagFileDto { path: f.path, version: version_dto(&f.version) }),
        losers: r.losers,
        color: r.color,
        color_raw: r.color_raw,
        count: r.count as u32,
        last_used: r.last_used,
        last_used_ns: r.last_used_ns.map(|n| n.to_string()),
    }
}

#[tauri::command]
pub async fn tag_objects(state: State<'_, AppState>, key: String) -> Result<Vec<TagObjectRowDto>, IpcError> {
    let core = core(&state)?;
    Ok(core
        .tag_objects(&key)
        .into_iter()
        .map(|o| TagObjectRowDto {
            path: o.path,
            id: o.id,
            title: o.title,
            r#type: o.r#type,
            modified: o.modified,
            modified_ns: o.modified_ns.map(|n| n.to_string()),
            tags: o.tags,
            review: o.review,
            status: o.status,
            due: o.due,
            completed: o.completed,
        })
        .collect())
}

/// §1.6, §3 (D-784): All tags' `<m> tagged objects` in one read (bug v0.74: one `tag_objects` per tag stalled the core).
#[tauri::command]
pub async fn index_tagged_objects(state: State<'_, AppState>) -> Result<u32, IpcError> {
    Ok(core(&state)?.tagged_objects() as u32)
}

#[tauri::command]
pub async fn tag_usage(state: State<'_, AppState>, key: String) -> Result<TagUsageDto, IpcError> {
    let u = core(&state)?.tag_usage(&key);
    Ok(TagUsageDto { notes: u.notes as u32, templates: u.templates as u32, file: u.file, losers: u.losers })
}

/// `<Tag folder>/<free stem of the sanitized name>.md` (D-51, ms4-links §3.1, D-719).
#[tauri::command]
pub async fn tag_new_path(state: State<'_, AppState>, name: String) -> Result<TagNewPathDto, IpcError> {
    let core = core(&state)?;
    let folder = core.tag_folder();
    let stem = core.free_stem(&folder, &nfc(&sanitize_file_stem(&name)));
    Ok(TagNewPathDto { path: format!("{folder}/{stem}.md") })
}

fn started(r: Result<u64, JobError>) -> Result<JobStartDto, IpcError> {
    match r {
        Ok(id) => Ok(JobStartDto { job_id: Some(id as u32) }),
        Err(JobError::NothingToDo) => Ok(JobStartDto { job_id: None }),
        Err(e) => Err(job_err(e)),
    }
}

#[tauri::command]
pub async fn tag_rename(state: State<'_, AppState>, from: String, to: String) -> Result<JobStartDto, IpcError> {
    started(core(&state)?.jobs().start(JobOp::TagRename { from, to }))
}

#[tauri::command]
pub async fn tag_delete(state: State<'_, AppState>, key: String) -> Result<JobStartDto, IpcError> {
    started(core(&state)?.jobs().start(JobOp::TagDelete { tag: key, keep_text: false }))
}

#[tauri::command]
pub async fn merge_start(state: State<'_, AppState>, keep: String, others: Vec<String>) -> Result<JobStartDto, IpcError> {
    started(core(&state)?.jobs().start(JobOp::Merge { keep, others }))
}

/// The plan once the job waits in `confirm` (counts, warnings, merge conflicts; ms4-tags §4.4).
#[tauri::command]
pub async fn job_plan(state: State<'_, AppState>, job_id: u32) -> Result<Option<JobPlanDto>, IpcError> {
    let core = core(&state)?;
    let Some(p) = core.jobs().plan(job_id as u64) else { return Ok(None) };
    let templates = p.files.iter().filter(|f| f.path.starts_with("_templates/")).count();
    let mut conflicts = Vec::new();
    if let Some(TextOp::MergeInto { others, .. }) = p.files.first().and_then(|f| f.ops.first()) {
        let kept = core.vault().read(&p.files[0].path).ok().map(|(b, _)| attrs(&b, &p.files[0].path)).unwrap_or_default();
        let theirs: Vec<serde_json::Map<String, serde_json::Value>> = others.iter().map(|o| attrs(o.text.as_bytes(), &o.path)).collect();
        for (k, v) in &kept {
            if ["id", "type", "title", "tags", "aliases", "created", "modified", "review"].contains(&k.as_str()) {
                continue;
            }
            let diff: Vec<String> = theirs.iter().filter_map(|t| t.get(k)).filter(|x| *x != v).map(show).collect();
            if !diff.is_empty() {
                conflicts.push(MergeConflictDto { key: k.clone(), kept: show(v), others: diff });
            }
        }
    }
    Ok(Some(JobPlanDto {
        job_id,
        kind: p.kind.as_str().into(),
        files: (p.files.len() - templates) as u32,
        templates: templates as u32,
        empty: p.counts.empty as u32, // 4E-2 (ms4-jobs §14.9.6)
        renames: p.renames.into_iter().map(|(from, to)| RenamePairDto { from, to }).collect(),
        trashes: p.trashes,
        warnings: p.warnings.into_iter().map(|w| match w { PlanWarning::DuplicateTagFile { path } => PlanWarningDto { kind: "duplicateTagFile".into(), path } }).collect(),
        conflicts,
    }))
}

fn attrs(bytes: &[u8], path: &str) -> serde_json::Map<String, serde_json::Value> {
    let stem = path.rsplit('/').next().unwrap_or(path).trim_end_matches(".md");
    tegg_format::extract(bytes, stem).attributes.and_then(|a| a.as_object().cloned()).unwrap_or_default()
}

fn show(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// `Show in Finder` of a backup zip (`TEGG_TEST_REVEAL` records `reveal <path>`, ms6-trash-media §9.1).
#[tauri::command]
pub async fn backup_reveal(state: State<'_, AppState>, name: String) -> Result<(), IpcError> {
    let core = core(&state)?;
    let Some(b) = core.backups().into_iter().find(|b| b.name == name) else { return Err(err("NotFound", "no such backup")) };
    let abs = core.backup_dir().join(&b.name);
    if std::env::var("TEGG_TEST").as_deref() == Ok("1") {
        if let Ok(file) = std::env::var("TEGG_TEST_REVEAL") {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(file).map_err(|e| err("Io", e))?;
            return f.write_all(format!("reveal {}\n", abs.display()).as_bytes()).map_err(|e| err("Io", e));
        }
        return Ok(());
    }
    std::process::Command::new("/usr/bin/open").arg("-R").arg(&abs).spawn().map(|_| ()).map_err(|e| err("Io", e))
}
