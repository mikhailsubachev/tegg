//! MS3 slice 3D: types and attributes in the core (docs/contracts/ms3-shell.md §14.2). Type files are read, checked
//! and line-patched by `tegg-schema`; the core reads and writes them through the vault (atomic, with base versions,
//! never over an external change: FR-SYN-02, NFR-REL-02). Note bytes come only from `@tegg/doc` (D-82, D-245):
//! the core decides where a new object goes and indexes it, it never builds note frontmatter.
//!
//! Rows, counts and option use come from the index and the current definitions at query time; a type-file change
//! never reindexes or rewrites a note (AR-07 AC-7, FR-TYP-04 AC-5).

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value};
use tegg_format::{nfc, sanitize_file_stem, type_key};
use tegg_schema::{AttrDef, AttrType, PatchContext, Readability, SchemaError, TypeFile, TypeNames, TypeOp, Validity};

use crate::{lock, Core, CoreError, CoreEvent, FileVersion, LinkTarget, ObjectInfo, Shared, VaultError};

/// What `vault_types` / `type_get` return (ms3-shell §14.2.1). Superset of 3A's `TypeDef` (`TypeDef = TypeInfo`).
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
    /// False: a system type without a file, built-in defaults (D-90).
    pub exists: bool,
    /// The file's version as read; None when !exists.
    pub version: Option<FileVersion>,
    pub readability: Readability,
    pub def: TypeFile,
    pub preview_ignored: Vec<String>,
    /// D-417 (ms4-embeds §3): the effective default embed mode and the raw `embed` value.
    pub embed: tegg_schema::EmbedMode,
    pub embed_raw: Option<String>,
}

/// One row of a type page (FR-TYP-09 AC-2, ms3-shell §14.2.4).
#[derive(Debug, Clone)]
pub struct TypeRow {
    pub path: String,
    pub id: Option<String>,
    pub title: String,
    /// As written.
    pub created: Option<String>,
    pub modified: Option<String>,
    /// Preview keys; a date range as `<k>-start`, `<k>-end`; universal keys when previewed.
    pub values: Map<String, Value>,
    /// Resolved relation values of previewed keys (§11.1 rules, from = path).
    pub links: Vec<LinkTarget>,
    pub type_single: bool,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct TypeUsage {
    pub objects: usize,
    /// Per attribute: the number of objects with a non-empty value.
    pub values: BTreeMap<String, usize>,
    /// Per Select / Multi-select attribute: objects using each option label (exact, NFC).
    pub options: BTreeMap<String, BTreeMap<String, usize>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StarterSkip {
    NameExists,
    FolderUsed { folder: String },
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StarterPlan {
    /// Starter keys to add, R11 order.
    pub add: Vec<String>,
    pub skip: Vec<(String, StarterSkip)>,
    /// Template paths that exist and are kept.
    pub skip_templates: Vec<String>,
}

fn type_path(key: &str) -> String {
    format!("{}/{}.yml", tegg_schema::TYPES_DIR, nfc(key))
}

pub(crate) fn info(key: &str, text: Option<&[u8]>, version: Option<FileVersion>) -> TypeInfo {
    let exists = text.is_some();
    let parsed = match text {
        Some(bytes) => match std::str::from_utf8(bytes) {
            Ok(t) => tegg_schema::parse(key, t),
            // Not UTF-8: invalid at line 1, never written (NFR-REL-03).
            Err(_) => tegg_schema::Parsed {
                readability: Readability::Invalid { message: "The file isn't valid UTF-8 text.".into(), line: 1 },
                ..tegg_schema::parse(key, "")
            },
        },
        None => tegg_schema::parse(key, tegg_schema::builtin(key).unwrap_or("")),
    };
    let d = &parsed.def;
    TypeInfo {
        key: d.key.clone(),
        name: d.name.clone(),
        plural: d.plural.clone(),
        folder: d.folder.clone(),
        icon: d.icon.clone(),
        color: d.color.clone(),
        system: d.system,
        invalid: matches!(parsed.readability, Readability::Invalid { .. }),
        exists,
        version,
        readability: parsed.readability.clone(),
        def: parsed.def.clone(),
        preview_ignored: parsed.preview_ignored.clone(),
        embed: tegg_schema::effective_embed(&d.key, parsed.embed_raw.as_deref()),
        embed_raw: parsed.embed_raw.clone(),
    }
}

impl Shared {
    /// Keys of `.tegg/types/*.yml` files (NFC), one per key.
    fn type_file_keys(&self) -> Vec<String> {
        let prefix = format!("{}/", tegg_schema::TYPES_DIR);
        let mut keys: Vec<String> = Vec::new();
        for p in self.vault.list_files().unwrap_or_default() {
            let p = nfc(&p);
            let Some(file) = p.strip_prefix(&prefix) else { continue };
            let Some(key) = file.strip_suffix(".yml") else { continue };
            if key.is_empty() || key.contains('/') || key.starts_with('.') || keys.iter().any(|k| k == key) {
                continue;
            }
            keys.push(key.to_string());
        }
        keys
    }

    /// One type freshly read: its file, else the built-in defaults of a system key, else None.
    pub(crate) fn read_type(&self, key: &str) -> Option<TypeInfo> {
        let key = nfc(key);
        match self.vault.read(&type_path(&key)) {
            Ok((bytes, v)) => Some(info(&key, Some(&bytes), Some(v))),
            Err(_) if tegg_schema::SYSTEM_KEYS.contains(&key.as_str()) => Some(info(&key, None, None)),
            Err(_) => None,
        }
    }

    pub(crate) fn read_types(&self) -> Vec<TypeInfo> {
        let mut out: Vec<TypeInfo> = self.type_file_keys().into_iter().filter_map(|k| self.read_type(&k)).collect();
        for k in tegg_schema::SYSTEM_KEYS {
            if !out.iter().any(|t| t.key == k) {
                out.push(info(k, None, None));
            }
        }
        out
    }

    /// Re-reads the definitions the index queries use (at open, after own writes, on watched `.tegg/types/` changes).
    pub(crate) fn refresh_types(&self) {
        let defs: BTreeMap<String, TypeFile> = self.read_types().into_iter().map(|t| (t.key.clone(), t.def)).collect();
        *lock(&self.type_defs) = defs;
    }

    pub(crate) fn type_defs(&self) -> BTreeMap<String, TypeFile> {
        lock(&self.type_defs).clone()
    }
}

/// D-822 (ms4-jobs §14.5): the folder-move job's own write of `folder:` in the type file, after its zip. A line patch
/// against the file as it is now (D-235); `None` when it already names that folder.
pub(crate) fn write_folder(shared: &Shared, key: &str, folder: &str) -> Result<Option<String>, CoreError> {
    let key = nfc(key);
    let path = type_path(&key);
    let (text, base) = match shared.vault.read(&path) {
        Ok((bytes, v)) => (String::from_utf8(bytes).map_err(|_| schema(SchemaError::Invalid))?, Some(v)),
        Err(VaultError::NotFound) => (tegg_schema::builtin(&key).ok_or(CoreError::UnknownType)?.to_string(), None),
        Err(e) => return Err(e.into()),
    };
    let types = shared.read_types();
    let names = names_of(&types, &key);
    let others = as_names(&names);
    let Some(new) = tegg_schema::patch_with_usage(&key, &text, &[TypeOp::SetFolder(folder.into())], &PatchContext { others: &others }, &[]).map_err(schema)? else {
        return Ok(None);
    };
    match &base {
        Some(b) => {
            shared.vault.write(&path, new.as_bytes(), Some(b))?;
        }
        None => {
            shared.vault.create_exact(&path, new.as_bytes())?;
        }
    }
    shared.refresh_types();
    shared.load_default_type();
    shared.emit(CoreEvent::VaultChanged { paths: vec![path.clone()] });
    Ok(Some(path))
}

/// ms4-jobs §14.9.2 (4E-2): the type file of `key` without the attribute `attr` and its `preview` entry, written
/// against `base` (the version a `value-remove` read at planning). Returns the new version.
pub(crate) fn remove_attr(shared: &Shared, key: &str, attr: &str, base: &FileVersion) -> Result<FileVersion, CoreError> {
    let key = nfc(key);
    let path = type_path(&key);
    let (bytes, disk) = shared.vault.read(&path)?;
    if !base.same_content(&disk) {
        return Err(CoreError::Vault(VaultError::Conflict { disk }));
    }
    let text = String::from_utf8(bytes).map_err(|_| schema(SchemaError::Invalid))?;
    let types = shared.read_types();
    let names = names_of(&types, &key);
    let others = as_names(&names);
    let Some(new) = tegg_schema::patch_with_usage(&key, &text, &[TypeOp::RemoveAttribute(nfc(attr))], &PatchContext { others: &others }, &[]).map_err(schema)? else {
        return Ok(disk);
    };
    shared.vault.write(&path, new.as_bytes(), Some(base))?;
    shared.refresh_types();
    shared.load_default_type();
    shared.emit(CoreEvent::VaultChanged { paths: vec![path.clone()] });
    Ok(shared.vault.read(&path)?.1)
}

/// The names of all types for the rules of `tegg-schema` (`self_key` marks the edited type).
fn names_of(types: &[TypeInfo], self_key: &str) -> Vec<(String, String, String, bool)> {
    types.iter().map(|t| (t.key.clone(), t.name.clone(), t.folder.clone(), t.key == self_key)).collect()
}

fn as_names(v: &[(String, String, String, bool)]) -> Vec<TypeNames<'_>> {
    v.iter().map(|(k, n, f, s)| TypeNames { key: k, name: n, folder: f, is_self: *s }).collect()
}

fn schema(e: SchemaError) -> CoreError {
    CoreError::Schema(e)
}

fn attrs_of(o: &ObjectInfo) -> Map<String, Value> {
    match &o.attributes {
        Value::Object(m) => m.clone(),
        _ => Map::new(),
    }
}

/// `[[target]]`, `[[target|alias]]` → `target|alias` (the link text the resolver takes).
pub(crate) fn link_inner(v: &Value) -> Option<String> {
    let s = v.as_str()?.trim();
    s.strip_prefix("[[").and_then(|r| r.strip_suffix("]]")).map(str::to_string).filter(|s| !s.trim().is_empty())
}

impl Core {
    /// `vault_types` (3A, changed in 3D): one per type file plus every system key without a file (D-90). Fresh read.
    pub fn types(&self) -> Vec<TypeInfo> {
        self.shared.read_types()
    }

    /// `type_get`: one type, freshly read; None when it is neither a file nor a system key.
    pub fn type_get(&self, key: &str) -> Option<TypeInfo> {
        self.shared.read_type(key)
    }

    fn after_type_write(&self, paths: Vec<String>) {
        self.shared.refresh_types();
        self.shared.load_default_type();
        self.shared.emit(CoreEvent::VaultChanged { paths });
    }

    /// FR-TYP-01 AC-2, AC-3: the rules of §14.1.2 against `types()`, then a new file that never replaces one that
    /// appeared meanwhile (`NameTaken`). Writes no folder and no template.
    pub fn type_create(&self, name: &str, plural: &str) -> Result<TypeInfo, CoreError> {
        self.type_create_in(name, plural, None)
    }

    /// As `type_create`, with the folder for new objects (D-259; `None` = the plural). One write.
    pub fn type_create_in(&self, name: &str, plural: &str, folder: Option<&str>) -> Result<TypeInfo, CoreError> {
        let types = self.types();
        let names = names_of(&types, "");
        let key = tegg_schema::check_type_name(name, plural, &as_names(&names), true).map_err(|e| schema(SchemaError::Rule(e)))?;
        if let Some(f) = folder {
            tegg_schema::check_folder(f, &as_names(&names)).map_err(|e| schema(SchemaError::Rule(e)))?;
        }
        let path = type_path(&key);
        self.shared.vault.create_exact(&path, tegg_schema::new_type_file_in(name, plural, folder).as_bytes())?;
        self.after_type_write(vec![path]);
        self.type_get(&key).ok_or(CoreError::UnknownType)
    }

    /// AR-07 AC-5, FR-TYP-01 AC-4, AC-7 (D-235): refuses a file whose content differs from `base` (Conflict, nothing
    /// written), patches its lines and writes it atomically. `base: None` only for a system type without a file
    /// (FR-TYP-06 AC-4: created from the built-in default; a file that appeared meanwhile → Conflict).
    pub fn type_patch(&self, key: &str, base: Option<&FileVersion>, ops: &[TypeOp]) -> Result<TypeInfo, CoreError> {
        let key = nfc(key);
        let path = type_path(&key);
        let text = match (self.shared.vault.read(&path), base) {
            (Ok((bytes, disk)), Some(b)) => {
                if !b.same_content(&disk) {
                    return Err(CoreError::Vault(VaultError::Conflict { disk }));
                }
                String::from_utf8(bytes).map_err(|_| schema(SchemaError::Invalid))?
            }
            (Ok((_, disk)), None) => return Err(CoreError::Vault(VaultError::Conflict { disk })),
            (Err(VaultError::NotFound), None) => match tegg_schema::builtin(&key) {
                Some(t) => t.to_string(),
                None => return Err(CoreError::UnknownType),
            },
            (Err(VaultError::NotFound), Some(_)) => return Err(CoreError::Vault(VaultError::Gone)),
            (Err(e), _) => return Err(e.into()),
        };
        let types = self.types();
        let names = names_of(&types, &key);
        let others = as_names(&names);
        // D-501, D-502: option usage of the attributes a rename touches, counted here (FR-TSK-02 AC-5).
        let mut counts: Vec<(String, usize)> = Vec::new();
        let renamed: BTreeSet<String> = ops.iter().filter_map(|o| if let TypeOp::RenameOption { attr, .. } = o { Some(nfc(attr)) } else { None }).collect();
        if !renamed.is_empty() {
            let usage = self.type_usage(&key);
            for a in &renamed {
                counts.extend(usage.options.get(a).into_iter().flatten().map(|(l, n)| (l.clone(), *n)));
            }
        }
        let used: Vec<(&str, usize)> = counts.iter().map(|(l, n)| (l.as_str(), *n)).collect();
        if let Some(new) = tegg_schema::patch_with_usage(&key, &text, ops, &PatchContext { others: &others }, &used).map_err(schema)? {
            self.shared.vault.write(&path, new.as_bytes(), base)?;
            self.after_type_write(vec![path]);
        }
        self.type_get(&key).ok_or(CoreError::UnknownType)
    }

    /// FR-TYP-05 AC-1, AC-5 (D-225), FR-TYP-06 AC-1: refuses a system key, a changed file, a newer file and a type
    /// with objects (counted at the call). Moves the type file and `_templates/<Name>/` to `.trash/`.
    pub fn type_delete(&self, key: &str, base: &FileVersion) -> Result<Vec<String>, CoreError> {
        let key = nfc(key);
        if tegg_schema::SYSTEM_KEYS.contains(&key.as_str()) {
            return Err(CoreError::SystemType);
        }
        let path = type_path(&key);
        let (bytes, disk) = self.shared.vault.read(&path)?;
        if !base.same_content(&disk) {
            return Err(CoreError::Vault(VaultError::Conflict { disk }));
        }
        let t = info(&key, Some(&bytes), Some(disk));
        if let Readability::Newer(_) = t.readability {
            return Err(schema(SchemaError::NewerVersion)); // AR-07 AC-3: never written, never removed
        }
        let n = self.type_usage(&key).objects;
        if n > 0 {
            return Err(CoreError::HasObjects(n));
        }
        let mut paths = vec![path.clone()];
        let mut trashed = vec![self.shared.vault.trash_checked(&path, base)?];
        if !t.invalid {
            let dir = format!("_templates/{}", sanitize_file_stem(&t.name));
            match self.shared.vault.trash_dir(&dir) {
                Ok(moved) => {
                    paths.push(dir);
                    trashed.extend(moved);
                }
                Err(VaultError::NotFound) => {}
                Err(e) => return Err(e.into()),
            }
        }
        paths.extend(trashed.iter().cloned());
        self.after_type_write(paths);
        Ok(trashed)
    }

    /// The default template of a type (D-232): its `template` path; None when absent, missing or under `.trash/`.
    pub fn type_template(&self, key: &str) -> Result<Option<(String, Vec<u8>)>, CoreError> {
        let Some(t) = self.type_get(key) else { return Err(CoreError::UnknownType) };
        let Some(path) = t.def.template.map(|p| nfc(p.trim().trim_start_matches('/'))) else { return Ok(None) };
        if path.split('/').next() == Some(".trash") {
            return Ok(None);
        }
        match self.shared.vault.read(&path) {
            Ok((bytes, _)) => Ok(Some((path, bytes))),
            Err(VaultError::NotFound) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// The one creation path's write (D-232, FR-TYP-03 AC-12): the type's current folder (re-read now, FR-TYP-01
    /// AC-5), folders created as needed, a free file name from the title (FR-LNK-14); indexed at once. The bytes
    /// come from `@tegg/doc` `newObject` (D-82, D-245) and must carry this type (`UnknownType` otherwise).
    pub fn create_object(&self, type_key_: &str, title: &str, bytes: &[u8]) -> Result<String, CoreError> {
        let key = type_key(type_key_);
        if key == "daily-note" {
            return Err(CoreError::UseDailyNote); // D-318: only `daily_create` makes a Daily Note
        }
        let Some(t) = self.type_get(&key) else { return Err(CoreError::UnknownType) };
        let declared = match tegg_format::extract(bytes, "x").attributes {
            Some(Value::Object(m)) => m.get("type").cloned(),
            _ => None,
        };
        let matches = match declared {
            Some(Value::String(s)) if !s.trim().is_empty() => type_key(&s) == key,
            None => key == "page", // D-103: an untyped file is a Page
            Some(_) => false,
        };
        if !matches {
            return Err(CoreError::UnknownType);
        }
        let folder = if t.invalid { key.clone() } else { t.folder.trim_end_matches('/').to_string() };
        // D-291: a stem no other indexed file has anywhere in the vault.
        let stem = self.free_stem(&folder, &sanitize_file_stem(title));
        let (path, v) = self.shared.vault.create_file(&folder, &stem, "md", bytes)?;
        lock(&self.shared.index).upsert(&path, bytes, &v)?;
        self.shared.emit(CoreEvent::VaultChanged { paths: vec![path.clone()] });
        Ok(path)
    }

    /// Objects whose matched type key is `key` (FR-TYP-13); templates and `.trash/` are never indexed.
    fn objects_of(&self, key: &str) -> Vec<ObjectInfo> {
        let key = type_key(key);
        self.index().objects().into_iter().filter(|o| o.r#type == key).collect()
    }

    /// FR-TYP-09 AC-2: the rows of a type page from one index query, no note read (D-233). Unsorted.
    pub fn type_rows(&self, key: &str) -> Vec<TypeRow> {
        let key = type_key(key);
        let def = self.shared.type_defs().remove(&key);
        let attrs: Vec<AttrDef> = def.as_ref().map(|d| d.attributes.clone()).unwrap_or_default();
        let preview: Vec<String> = def.map(|d| d.preview).unwrap_or_default();
        let all = self.index().objects();
        let resolver = crate::Resolver::new(&all, &self.shared);
        all.iter()
            .filter(|o| o.r#type == key)
            .map(|o| {
                let fm = attrs_of(o);
                let mut values = Map::new();
                let mut targets: Vec<String> = Vec::new();
                for p in &preview {
                    let a = attrs.iter().find(|a| &a.key == p);
                    if a.is_some_and(|a| a.r#type == AttrType::DateRange) {
                        for half in [format!("{p}-start"), format!("{p}-end")] {
                            if let Some(v) = fm.get(&half) {
                                values.insert(half, v.clone());
                            }
                        }
                        continue;
                    }
                    if let Some(v) = fm.get(p) {
                        values.insert(p.clone(), v.clone());
                        if a.is_some_and(|a| a.r#type == AttrType::Relation) || p == "source" {
                            match v {
                                Value::Array(items) => targets.extend(items.iter().filter_map(link_inner)),
                                other => targets.extend(link_inner(other)),
                            }
                        }
                    }
                }
                let text = |k: &str| fm.get(k).and_then(|v| v.as_str()).map(str::to_string);
                TypeRow {
                    path: o.path.clone(),
                    id: o.id.clone(),
                    title: o.title.clone(),
                    created: text("created"),
                    modified: text("modified"),
                    values,
                    links: resolver.resolve(&o.path, &targets),
                    type_single: o.type_single,
                }
            })
            .collect()
    }

    /// FR-TYP-05 AC-2, FR-TYP-03 AC-5, FR-TYP-04 AC-4: object count, non-empty values per attribute, option use.
    pub fn type_usage(&self, key: &str) -> TypeUsage {
        let key = type_key(key);
        let objects = self.objects_of(&key);
        let attrs = self.shared.type_defs().remove(&key).map(|d| d.attributes).unwrap_or_default();
        let mut u = TypeUsage { objects: objects.len(), ..Default::default() };
        for a in &attrs {
            u.values.insert(a.key.clone(), 0);
            if a.r#type.has_options() {
                u.options.insert(a.key.clone(), a.options.iter().map(|o| (nfc(&o.label), 0)).collect());
            }
        }
        for o in &objects {
            let fm = attrs_of(o);
            for a in &attrs {
                if tegg_schema::validate(a, &fm) != Validity::Empty {
                    *u.values.entry(a.key.clone()).or_default() += 1;
                }
                if let Some(counts) = u.options.get_mut(&a.key) {
                    let used: Vec<String> = match fm.get(&a.key) {
                        Some(Value::String(s)) => vec![nfc(s)],
                        Some(Value::Array(items)) => items.iter().filter_map(|v| v.as_str()).map(nfc).collect(),
                        _ => Vec::new(),
                    };
                    for (label, n) in counts.iter_mut() {
                        if used.contains(label) {
                            *n += 1;
                        }
                    }
                }
            }
        }
        u
    }

    /// FR-TYP-03 AC-11: objects of the type whose value of `attr` is non-empty and not valid for `as_attr`.
    pub fn count_misfits(&self, key: &str, attr: &str, as_attr: &AttrDef) -> usize {
        let a = AttrDef { key: nfc(attr), ..as_attr.clone() };
        self.objects_of(key).iter().filter(|o| matches!(tegg_schema::validate(&a, &attrs_of(o)), Validity::Invalid { .. })).count()
    }

    /// FR-VLT-02 AC-9 (D-244): read-only plan of `Add starter types…`; a starter type is skipped when its key is a
    /// type's key or its folder a type's folder (case-insensitive, NFC; data-safety FR-VLT-02 AC-4).
    pub fn starter_plan(&self) -> StarterPlan {
        let types = self.types();
        let fold = |s: &str| nfc(s.trim()).trim_end_matches('/').to_lowercase();
        let mut plan = StarterPlan::default();
        for (path, bytes) in tegg_schema::STARTER_FILES.iter().filter(|(p, _)| p.starts_with(".tegg/types/")) {
            let key = path.trim_start_matches(".tegg/types/").trim_end_matches(".yml").to_string();
            let def = tegg_schema::parse(&key, &String::from_utf8_lossy(bytes)).def;
            if types.iter().any(|t| fold(&t.key) == fold(&key)) {
                plan.skip.push((key, StarterSkip::NameExists));
            } else if types.iter().any(|t| fold(&t.folder) == fold(&def.folder)) {
                plan.skip.push((key, StarterSkip::FolderUsed { folder: def.folder.clone() }));
            } else {
                if let Some(tpl) = &def.template {
                    if matches!(self.shared.vault.version(tpl), Ok(Some(_))) {
                        plan.skip_templates.push(tpl.clone());
                    }
                }
                plan.add.push(key);
            }
        }
        plan
    }

    /// Re-plans now and writes the planned type files and their templates as new files; never changes an existing
    /// file (a path that exists is skipped). Returns the plan it applied.
    pub fn starter_add(&self) -> Result<StarterPlan, CoreError> {
        let plan = self.starter_plan();
        let mut written: Vec<String> = Vec::new();
        for key in &plan.add {
            let path = type_path(key);
            let Some((_, bytes)) = tegg_schema::STARTER_FILES.iter().find(|(p, _)| *p == path) else { continue };
            match self.shared.vault.create_exact(&path, bytes) {
                Ok(_) => written.push(path.clone()),
                Err(VaultError::NameTaken) => continue,
                Err(e) => return Err(e.into()),
            }
            let def = tegg_schema::parse(key, &String::from_utf8_lossy(bytes)).def;
            if let Some(tpl) = def.template {
                if plan.skip_templates.contains(&tpl) {
                    continue;
                }
                if let Some((_, t)) = tegg_schema::STARTER_FILES.iter().find(|(p, _)| *p == tpl) {
                    match self.shared.vault.create_exact(&tpl, t) {
                        Ok(_) => written.push(tpl),
                        Err(VaultError::NameTaken) => {}
                        Err(e) => return Err(e.into()),
                    }
                }
            }
        }
        if !written.is_empty() {
            self.after_type_write(written);
        }
        Ok(plan)
    }
}
