//! RED-PHASE STUBS for ms3-shell §14.2 (slice 3D). Placeholder bodies only; never panic.
use std::collections::BTreeMap;

use crate::{Core, CoreError, FileVersion, LinkTarget};

#[derive(Debug, Clone, PartialEq)]
pub struct TypeInfo {
    pub key: String,
    pub name: String,
    pub plural: String,
    pub folder: String,
    pub icon: String,
    pub color: String,
    pub system: bool,
    pub invalid: bool,
    pub exists: bool,
    pub version: Option<FileVersion>,
    pub readability: tegg_schema::Readability,
    pub def: tegg_schema::TypeFile,
    pub preview_ignored: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct TypeRow {
    pub path: String,
    pub id: Option<String>,
    pub title: String,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub values: serde_json::Map<String, serde_json::Value>,
    pub links: Vec<LinkTarget>,
    pub type_single: bool,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct TypeUsage {
    pub objects: usize,
    pub values: BTreeMap<String, usize>,
    pub options: BTreeMap<String, BTreeMap<String, usize>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StarterSkip {
    NameExists,
    FolderUsed { folder: String },
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StarterPlan {
    pub add: Vec<String>,
    pub skip: Vec<(String, StarterSkip)>,
    pub skip_templates: Vec<String>,
}

impl Core {
    pub fn type_get(&self, _key: &str) -> Option<TypeInfo> {
        None
    }
    pub fn type_create(&self, _name: &str, _plural: &str) -> Result<TypeInfo, CoreError> {
        Err(CoreError::NotImplemented)
    }
    pub fn type_patch(&self, _key: &str, _base: Option<&FileVersion>, _ops: &[tegg_schema::TypeOp]) -> Result<TypeInfo, CoreError> {
        Err(CoreError::NotImplemented)
    }
    pub fn type_delete(&self, _key: &str, _base: &FileVersion) -> Result<Vec<String>, CoreError> {
        Err(CoreError::NotImplemented)
    }
    pub fn type_template(&self, _key: &str) -> Result<Option<(String, Vec<u8>)>, CoreError> {
        Err(CoreError::NotImplemented)
    }
    pub fn create_object(&self, _type_key: &str, _title: &str, _bytes: &[u8]) -> Result<String, CoreError> {
        Err(CoreError::NotImplemented)
    }
    pub fn type_rows(&self, _key: &str) -> Vec<TypeRow> {
        Vec::new()
    }
    pub fn type_usage(&self, _key: &str) -> TypeUsage {
        TypeUsage::default()
    }
    pub fn count_misfits(&self, _key: &str, _attr: &str, _as_attr: &tegg_schema::AttrDef) -> usize {
        usize::MAX
    }
    pub fn starter_plan(&self) -> StarterPlan {
        StarterPlan::default()
    }
    pub fn starter_add(&self) -> Result<StarterPlan, CoreError> {
        Err(CoreError::NotImplemented)
    }
}
