//! Slice OC IPC (docs/contracts/v1-cards.md §4; FR-TYP-11, FR-TYP-01): the card data every card surface reads
//! (`CardDataDto`, in query rows, task rows and embeds), the type settings' example card (`type_card_example`,
//! read-only: no vault write, no recency, no event) and resolved Lucide icons in the type DTOs (`ResolvedIconDto`). The
//! icon set itself is never sent over IPC (§5.4): the core resolves the names in use.

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::dto::LinkTargetDto;
use crate::{core, link_dto, AppState, IpcError};

/// §2.4: the canonical Lucide name and its drawing (Lucide's icon-node format: `[tag, attributes]`).
#[derive(Debug, Clone, Serialize, TS)]
pub struct ResolvedIconDto {
    pub name: String,
    #[ts(type = "[string, Record<string, string>][]")]
    pub node: Vec<(String, std::collections::BTreeMap<String, String>)>,
}

/// §3.2: what one ObjectCard draws besides its type's definition. Values are raw (the UI applies R212).
#[derive(Debug, Clone, Serialize, TS)]
pub struct CardDataDto {
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub type_key: String,
    pub title: String,
    pub keys: Vec<String>,
    #[ts(type = "Record<string, unknown>")]
    pub values: serde_json::Map<String, serde_json::Value>,
    pub excerpt: Option<String>,
    pub links: Vec<LinkTargetDto>,
    pub unreviewed: bool,
    pub file: Option<LinkTargetDto>,
}

/// §4.2: `type_card_example`'s answer.
#[derive(Debug, Clone, Serialize, TS)]
pub struct CardExampleDto {
    pub path: String,
    pub card: CardDataDto,
}

pub(crate) fn card_dto(c: tegg_core::cards::CardData) -> CardDataDto {
    CardDataDto {
        type_key: c.r#type,
        title: c.title,
        keys: c.keys,
        values: c.values,
        excerpt: c.excerpt,
        links: c.links.into_iter().map(link_dto).collect(),
        unreviewed: c.unreviewed,
        file: c.file.map(link_dto),
    }
}

/// §5.4: an icon name as written, resolved by the core (`None` for an unknown name or none).
pub(crate) fn icon_dto(name: Option<&str>) -> Option<ResolvedIconDto> {
    let r = tegg_schema::icons::resolve_icon(name?)?;
    Some(ResolvedIconDto { name: r.name.to_string(), node: r.node.iter().map(|e| (e.tag.clone(), e.attrs.iter().cloned().collect())).collect() })
}

/// §4.1 `type_card_example`: the type's most recently modified object with every candidate key (D-2096); null when the
/// type has no object.
#[tauri::command]
pub async fn type_card_example(state: State<'_, AppState>, key: String) -> Result<Option<CardExampleDto>, IpcError> {
    let core = core(&state)?;
    Ok(core.type_card_example(&tegg_format::nfc(&key)).map(|e| CardExampleDto { path: e.path, card: card_dto(e.card) }))
}
