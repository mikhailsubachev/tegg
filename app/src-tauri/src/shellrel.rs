//! Slice REL IPC (docs/contracts/v1-related.md §2; FR-LNK-15): `index_related`, read-only (no vault write, no recency,
//! no event). The core computes the list on request (`Core::related`); `NotReady` while the first build of an empty
//! index runs.

use tauri::State;
use tegg_core::{RelatedError, RelatedList, RelatedReason};

use crate::dto::{RelatedDto, RelatedEntryDto};
use crate::{core, err, AppState, IpcError};

fn related_out(l: RelatedList) -> RelatedDto {
    RelatedDto {
        entries: l
            .entries
            .into_iter()
            .map(|e| RelatedEntryDto {
                path: e.path,
                title: e.title,
                type_key: e.r#type,
                review: e.review,
                status: e.status,
                due: e.due,
                completed: e.completed,
                linked: e.linked,
                excerpt: e.excerpt,
                score: e.score,
                shared: e.shared as u32,
            })
            .collect(),
        reason: l.reason.map(|r| match r {
            RelatedReason::Short => "short".to_string(),
        }),
    }
}

/// §2 `index_related`: the Related list of `path` (NFC) with linked objects hidden or shown.
#[cfg(desktop)]
#[tauri::command]
pub async fn index_related(state: State<'_, AppState>, path: String, show_linked: bool) -> Result<RelatedDto, IpcError> {
    let core = core(&state)?;
    core.related(&tegg_format::nfc(&path), show_linked).map(related_out).map_err(|e| match e {
        RelatedError::NotReady => err("NotReady", "the index is being built"),
    })
}
