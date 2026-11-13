//! §5: `plan`. Read-only and deterministic: from a scanned source, a space, a target and a mapping to the `Plan`.
//! Rewritten from the S5 spike's `dry_run` around the mapping as data (§4); links come from `@tegg/doc` (D-1551).

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use tegg_jobs::{TextOp, TransformError, Transformed};
use tegg_schema::{AttrDef, AttrType, OptionDef, RuleError, TypeFile};

use crate::dates::{self, DateValue};
use crate::layout;
use crate::mapping::{self, candidate_key, consumed_key, default_target, CLOSED_TARGETS};
use crate::note::{self, base_name, fold, folder_of, split_ext, FmError, ScanDto, ScannedLink, Val};
use crate::source::{Entry, Progress, ReadFail, Source};
use crate::*;

// ------------------------------------------------------------------------------------------------ the target

/// What `plan` reads of the target.
pub(crate) struct TargetInfo {
    pub plan_target: PlanTarget,
    /// The target's type definitions (a new vault: the seven system types).
    pub types: Vec<TypeFile>,
    pub type_stamps: Vec<TypeFileStamp>,
    /// Every file of an existing vault outside `_templates/` and `.trash/` (D-1558).
    pub files: Vec<String>,
    pub import_ids: HashSet<String>,
    pub backup: Option<BackupPlan>,
    /// Where free space is asked for.
    pub place: std::path::PathBuf,
}

/// The seven system types as a new vault has them.
pub(crate) fn empty_vault_types() -> Vec<TypeFile> {
    tegg_vault::EMPTY_VAULT
        .iter()
        .filter_map(|(path, text)| path.strip_prefix(".tegg/types/").and_then(|f| f.strip_suffix(".yml")).map(|key| tegg_schema::parse(key, text).def))
        .collect()
}

/// §5: the running runs of this process, by temporary folder (§9.5): the run id.
pub(crate) fn running() -> &'static std::sync::Mutex<HashMap<std::path::PathBuf, String>> {
    static RUNS: std::sync::OnceLock<std::sync::Mutex<HashMap<std::path::PathBuf, String>>> = std::sync::OnceLock::new();
    RUNS.get_or_init(Default::default)
}
pub(crate) fn is_running(temp: &std::path::Path) -> bool {
    running().lock().unwrap_or_else(|e| e.into_inner()).contains_key(temp)
}

/// What is at `<name>.tegg-importing` when a new-vault import may go on there (§5, §9.5 step 1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Leftover {
    /// Nothing.
    None,
    /// A dead run's folder with the marker: it goes to the system Trash, whole (D-1559).
    Marked,
    /// CP-8 (D-1562): a dead run's folder without the marker that is empty or holds only the marker's own temp file
    /// (`..tegg-import.i<job>.tegg-tmp`, named here): that one file is removed, then the empty folder.
    Unmarked(Option<String>),
}

/// CP-8 (D-1562): the marker's own temp file, as `stage_new` names it for the run's tag `i<job id>` (§9.4).
fn is_marker_temp(name: &str) -> bool {
    name.strip_prefix("..tegg-import.i").and_then(|r| r.strip_suffix(".tegg-tmp")).is_some_and(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()))
}

/// CP-8 (D-1562): `Some` when the folder without the marker is a dead run's (empty, or only the marker's temp file).
fn dead_unmarked(temp: &std::path::Path) -> Option<Option<String>> {
    use tegg_vault::{FsEntry, VaultFs};
    let entries = tegg_vault::LocalFs::new(temp).list().ok()?;
    match entries.as_slice() {
        [] => Some(None),
        [FsEntry::File { path }] if is_marker_temp(path) => Some(Some(path.clone())),
        _ => None,
    }
}

/// The target refusals of a new vault, by reading only (§5), and the leftover at the temporary folder's name.
pub(crate) fn probe_new(parent: &std::path::Path, name: &str, source: &Source) -> Result<Leftover, ImportError> {
    if name.is_empty() || tegg_format::sanitize_file_stem(name) != name {
        return Err(ImportError::InvalidPlan { path: None, reason: PlanReason::Target });
    }
    let p = tegg_vault::probe_new_vault(parent, name).map_err(|_| ImportError::TargetNotWritable)?;
    if !p.parent_is_dir || !p.writable {
        return Err(ImportError::TargetNotWritable);
    }
    if p.inside_vault {
        return Err(ImportError::TargetInsideVault);
    }
    if source.kind == SourceKind::Folder && tegg_vault::is_inside(&p.parent, &source.path).unwrap_or(false) {
        return Err(ImportError::TargetInsideSource);
    }
    let temp = p.parent.join(format!("{name}.tegg-importing"));
    if p.final_exists || is_running(&temp) {
        return Err(ImportError::TargetExists);
    }
    if !p.temp_exists {
        return Ok(Leftover::None);
    }
    if p.marker.is_some() {
        return Ok(Leftover::Marked);
    }
    // A folder without the marker is the user's (never removed or written into, FR-IMP-03 AC-14) unless CP-8 applies.
    dead_unmarked(&temp).map(Leftover::Unmarked).ok_or(ImportError::TargetExists)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
pub(crate) fn content_stamp(v: &tegg_vault::FileVersion) -> ContentStamp {
    ContentStamp { size: v.size, hash: hex(&v.hash) }
}
pub(crate) fn outside_objects(path: &str) -> bool {
    path.starts_with("_templates/") || path.starts_with(".trash/")
}

fn target_info(target: &Target<'_>, source: &Source) -> Result<TargetInfo, ImportError> {
    match target {
        Target::NewVault { parent, name } => {
            probe_new(parent, name, source)?;
            Ok(TargetInfo {
                plan_target: PlanTarget::NewVault { parent: parent.to_string_lossy().into_owned(), name: name.clone() },
                types: empty_vault_types(),
                type_stamps: Vec::new(),
                files: Vec::new(),
                import_ids: HashSet::new(),
                backup: None,
                place: parent.clone(),
            })
        }
        Target::Existing(core) => {
            if !core.index_ready() {
                return Err(ImportError::IndexNotReady);
            }
            let vault = core.vault();
            let all: Vec<String> = vault.list_files().map_err(|e| ImportError::Io { reason: format!("{e:?}") })?.into_iter().map(|p| tegg_format::nfc(&p)).collect();
            let mut types = Vec::new();
            let mut type_stamps = Vec::new();
            for t in core.types() {
                type_stamps.push(TypeFileStamp { path: format!(".tegg/types/{}.yml", t.key), version: t.version.as_ref().map(content_stamp) });
                types.push(t.def);
            }
            type_stamps.sort_by(|a, b| a.path.cmp(&b.path));
            let objects = core.objects();
            let import_ids = objects.iter().filter_map(|o| o.attributes.get("import-id").and_then(|v| v.as_str()).map(tegg_format::nfc)).collect();
            let in_backup: Vec<&String> = all.iter().filter(|p| !p.ends_with(".tegg-tmp") && (p.ends_with(".md") || p.starts_with(".tegg/"))).collect();
            let has_notes = all.iter().any(|p| p.ends_with(".md") && !p.starts_with(".tegg/"));
            let bytes = in_backup.iter().filter_map(|p| vault.stat(p).ok().flatten()).map(|(_, size)| size).sum();
            let name = vault.root().file_name().map(|n| tegg_format::nfc(&n.to_string_lossy())).unwrap_or_default();
            Ok(TargetInfo {
                plan_target: PlanTarget::Existing { name, notes: objects.len() },
                types,
                type_stamps,
                import_ids,
                // Decided again below: a run that extends a type file needs a backup too (D-1549 (5)).
                backup: has_notes.then_some(BackupPlan { files: in_backup.len(), bytes }),
                files: all.into_iter().filter(|p| !outside_objects(p)).collect(),
                place: vault.root().to_path_buf(),
            })
        }
    }
}

// ------------------------------------------------------------------------------------------------ names and D-184

/// Vault paths by folded stem: what D-184 needs (ms4-links §1).
#[derive(Default)]
pub(crate) struct Paths {
    by_stem: HashMap<String, Vec<String>>,
}
/// The link stem of a vault path: without `.md`; another file keeps its extension.
pub(crate) fn link_stem(path: &str) -> &str {
    let name = base_name(path);
    name.strip_suffix(".md").unwrap_or(name)
}
/// `@tegg/doc`'s `relPath`: `to` relative to the folder `from` (both vault paths).
fn rel_path(from: &str, to: &str) -> String {
    let a: Vec<&str> = if from.is_empty() { Vec::new() } else { from.split('/').collect() };
    let b: Vec<&str> = to.split('/').collect();
    let mut i = 0;
    while i < a.len() && i + 1 < b.len() && fold(a[i]) == fold(b[i]) {
        i += 1;
    }
    "../".repeat(a.len() - i) + &b[i..].join("/")
}
/// `@tegg/doc`'s `encodeDestination` (D-825): spaces and parentheses encoded, a `%` that would read as an escape too.
fn encode_destination(rel: &str) -> String {
    let mut out = String::new();
    let chars: Vec<char> = rel.chars().collect();
    for (i, c) in chars.iter().enumerate() {
        match c {
            '%' if chars.len() > i + 2 && chars[i + 1].is_ascii_hexdigit() && chars[i + 2].is_ascii_hexdigit() => out.push_str("%25"),
            ' ' => out.push_str("%20"),
            '(' => out.push_str("%28"),
            ')' => out.push_str("%29"),
            '<' => out.push_str("%3C"),
            '>' => out.push_str("%3E"),
            c => out.push(*c),
        }
    }
    out
}
/// The byte range of the destination in an inline Markdown link or image `[text](dest "title")`.
fn markdown_destination(written: &str) -> Option<(usize, usize)> {
    let open = written.rfind("](")? + 2;
    let rest = &written[open..];
    let (start, len) = if let Some(r) = rest.strip_prefix('<') { (open + 1, r.find('>')?) } else { (open, rest.find(|c: char| c.is_whitespace() || c == ')')?) };
    Some((start, start + len))
}
impl Paths {
    pub fn add(&mut self, path: &str) {
        if !outside_objects(path) {
            let v = self.by_stem.entry(fold(link_stem(path))).or_default();
            if !v.iter().any(|p| p == path) {
                v.push(path.to_string());
            }
        }
    }
    /// The paths that share `path`'s stem (itself included).
    pub fn same_stem(&self, path: &str) -> &[String] {
        self.by_stem.get(&fold(link_stem(path))).map(Vec::as_slice).unwrap_or(&[])
    }
    /// D-184: the text inside `[[…]]` for `to`, written in `from`, shown as `shown`.
    pub fn d184(&self, from: &str, to: &str, shown: &str) -> String {
        let stem = link_stem(to);
        let hits = self.same_stem(to);
        let here: Vec<&String> = hits.iter().filter(|p| fold(folder_of(p)) == fold(folder_of(from))).collect();
        let mut pool: Vec<&String> = if here.is_empty() { hits.iter().collect() } else { here };
        pool.sort_by(|a, b| a.len().cmp(&b.len()).then_with(|| a.cmp(b)));
        let target = if pool.first().is_none_or(|p| fold(p) == fold(to)) { stem.to_string() } else { to.strip_suffix(".md").unwrap_or(to).to_string() };
        let shown = tegg_format::nfc(shown.trim());
        if shown.is_empty() || shown == target {
            target
        } else {
            format!("{target}|{shown}")
        }
    }
}

/// §5.2: free names, per folder among the run's files and against every existing file of the vault.
pub(crate) struct Names {
    existing: HashSet<String>,
    taken: HashSet<(String, String)>,
}
impl Names {
    pub fn new(existing_files: &[String]) -> Names {
        Names { existing: existing_files.iter().map(|p| fold(base_name(p))).collect(), taken: HashSet::new() }
    }
    pub fn is_taken(&self, folder: &str, name: &str) -> bool {
        self.existing.contains(&fold(name)) || self.taken.contains(&(fold(folder), fold(name)))
    }
    pub fn take(&mut self, folder: &str, name: &str) {
        self.taken.insert((fold(folder), fold(name)));
    }
    /// The first free `<stem><ext>`, `<stem> (2)<ext>`…; `true` when a suffix was needed.
    pub fn free(&mut self, folder: &str, stem: &str, ext: &str) -> (String, bool) {
        let first = format!("{}{ext}", tegg_format::nfc(stem));
        let name = tegg_format::unique_file_name(stem, ext, &|n| self.is_taken(folder, n));
        self.take(folder, &name);
        let suffixed = name != first;
        (name, suffixed)
    }
}

// ------------------------------------------------------------------------------------------------ notes

struct Note {
    source: String,
    /// `Some`: the note can't be imported.
    unreadable: Option<(ObjectUnreadable, Option<u32>)>,
    ctype: Option<String>,
    title: String,
    fm: Vec<(String, Val)>,
    scan: ScanDto,
    stem: String,
}
impl Note {
    fn get(&self, key: &str) -> Option<&Val> {
        self.fm.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }
}

/// CP-9 (D-1563): the note's `key` has a value but loses its target key to `winner`, which has one too.
fn lost_key(n: &Note, key: &str, winner: &str) -> bool {
    n.get(key).is_some_and(|v| !v.is_null()) && n.get(winner).is_some_and(|v| !v.is_null())
}

/// `import-scan` of one note (§7.1).
pub(crate) fn import_scan(env: &ImportEnv, source: &str, text: &str) -> Result<ScanDto, TransformError> {
    match env.transformer.transform(source, text.as_bytes(), &[TextOp::ImportScan])? {
        Transformed::Bytes(json, _) => serde_json::from_slice(&json).map_err(|e| TransformError::Engine(e.to_string())),
        Transformed::Unchanged => Err(TransformError::Engine("no scan".into())),
    }
}

fn read_note(source: &Source, env: &ImportEnv, inner: &str, e: &Entry) -> Result<Note, ImportError> {
    let stem = base_name(inner).strip_suffix(".md").unwrap_or(inner).to_string();
    let mut n = Note { source: inner.to_string(), unreadable: None, ctype: e.meta.as_ref().and_then(|m| m.ctype.clone()), title: note::clean_title(&stem), fm: Vec::new(), scan: ScanDto::default(), stem };
    let bytes = match source.read(e) {
        Ok(b) => b,
        Err(ReadFail::Gone) => return Err(ImportError::SourceGone { entry: Some(inner.to_string()) }),
        Err(ReadFail::Changed) => return Err(ImportError::SourceChanged { entry: Some(inner.to_string()) }),
        Err(ReadFail::Encrypted) => {
            n.unreadable = Some((ObjectUnreadable::Encrypted, None));
            return Ok(n);
        }
        Err(ReadFail::Read) => {
            n.unreadable = Some((ObjectUnreadable::Read, None));
            return Ok(n);
        }
    };
    let Ok(text) = String::from_utf8(bytes) else {
        n.unreadable = Some((ObjectUnreadable::NotUtf8, None));
        return Ok(n);
    };
    match import_scan(env, inner, &text) {
        Ok(scan) => n.scan = scan,
        Err(TransformError::Unavailable) => return Err(ImportError::Transform { note: Some(inner.to_string()), reason: TransformReason::Unavailable }),
        Err(_) => {
            n.unreadable = Some((ObjectUnreadable::Engine, None));
            return Ok(n);
        }
    }
    match note::frontmatter(&text, Some(&n.scan)) {
        Ok(fm) if n.scan.frontmatter.ok => {
            n.ctype = fm.iter().find(|(k, _)| k == "type").and_then(|(_, v)| v.scalar()).map(|t| tegg_format::nfc(t.trim())).filter(|t| !t.is_empty());
            if let Some(t) = fm.iter().find(|(k, _)| k == "title").and_then(|(_, v)| v.scalar()).map(|t| note::clean_title(&t)).filter(|t| !t.is_empty()) {
                n.title = t;
            }
            n.fm = fm;
            if n.ctype.is_none() {
                n.unreadable = Some((ObjectUnreadable::NoType, None));
            }
        }
        Err(FmError::None) if n.scan.frontmatter.ok => n.unreadable = Some((ObjectUnreadable::NoType, None)),
        other => {
            let line = if !n.scan.frontmatter.ok && n.scan.frontmatter.line > 0 {
                n.scan.frontmatter.line
            } else if let Err(FmError::Yaml(l)) = other {
                l
            } else {
                1
            };
            n.ctype = note::type_line(&text);
            n.unreadable = Some((ObjectUnreadable::Yaml, Some(line)));
        }
    }
    Ok(n)
}

// ------------------------------------------------------------------------------------------------ types and attributes

/// How a source key's values are written.
#[derive(Clone, Debug)]
enum Rule {
    /// Written by the object's own rows (type, title, description, aliases, tags, created, modified).
    Own,
    Review,
    Icon,
    Cover,
    Status(BTreeMap<String, String>),
    /// `due` from `deadline` (true) or `date`.
    Due(bool),
    DailyDate,
    Drop,
    Attr(AttrRule),
}
#[derive(Clone, Debug)]
struct AttrRule {
    key: String,
    kind: AttrType,
    /// Folded value → the spelling written (merges applied).
    kept: BTreeMap<String, String>,
    split: Option<Split>,
    link_select: bool,
    /// Some value is a date: one that isn't is reported (D-1545 (3)).
    datey: bool,
    /// The existing options a value is checked against (Task `priority`).
    options: Option<Vec<String>>,
}

/// The rows of a type's attributes and how each source key is written.
type AttrPlan = (Vec<PlannedAttr>, Vec<(String, Rule)>);

struct TypePlan {
    row: PlannedType,
    /// Index into `defs` (the planned definition of the target type); `None` for `Skip`.
    def: Option<usize>,
    rules: Vec<(String, Rule)>,
    stub: bool,
}
impl TypePlan {
    fn rule(&self, key: &str) -> Option<&Rule> {
        self.rules.iter().find(|(k, _)| k == key).map(|(_, r)| r)
    }
}
struct Def {
    file: TypeFile,
    new: bool,
}

fn invalid(source_type: &str, attribute: Option<&str>, reason: MappingReason) -> ImportError {
    ImportError::InvalidMapping { entry: MappingEntry { source_type: source_type.to_string(), attribute: attribute.map(str::to_string) }, reason }
}

fn new_def(name: &str, folder: &str) -> TypeFile {
    tegg_schema::parse(&tegg_format::type_key(name), &tegg_schema::new_type_file_in(name, folder, Some(folder))).def
}

fn attr_def(key: &str, name: &str, kind: AttrType) -> AttrDef {
    AttrDef { key: key.to_string(), name: name.to_string(), r#type: kind, default: None, required: false, options: Vec::new(), to: None, multiple: false, description: None, built_in: false }
}

/// §4.1 "Key of a new attribute": the final key of a default name, with the reason when it differs.
fn default_key(name: &str, def: &TypeFile, kind: &AttrType, reserved: &BTreeSet<String>) -> (String, Option<KeyReason>) {
    let mut probe = def.clone();
    probe.attributes.extend(reserved.iter().map(|k| attr_def(k, k, AttrType::Text)));
    let mut key = tegg_format::nfc(name.trim());
    let mut reason = None;
    let mut base: Option<String> = None;
    for round in 0..10_000 {
        match tegg_schema::check_attr_key(&key, &probe, kind) {
            Ok(()) => break,
            Err(RuleError::AttrKeyInvalid) | Err(RuleError::Empty { .. }) if base.is_none() && round < 3 => {
                let derived = tegg_schema::derive_attr_key(&key);
                if derived.is_empty() || derived == key {
                    let kept: String = tegg_format::type_key(name).chars().filter(|c| c.is_alphabetic() || c.is_numeric() || *c == '-' || *c == '_').collect();
                    key = if kept.is_empty() { "attr".to_string() } else { format!("attr-{kept}") };
                    base = Some(key.clone());
                } else {
                    key = derived;
                }
                reason = Some(KeyReason::InvalidKey);
            }
            Err(e) => {
                let why = match e {
                    RuleError::RangeCollision => KeyReason::RangeClash,
                    RuleError::ReservedKey { .. } => KeyReason::Reserved,
                    _ => KeyReason::KeyTaken,
                };
                reason = reason.or(Some(why));
                let b = base.get_or_insert_with(|| key.clone()).clone();
                let n = key.strip_prefix(&format!("{b}-")).and_then(|x| x.parse::<u32>().ok()).unwrap_or(1) + 1;
                key = format!("{b}-{n}");
            }
        }
    }
    (key, reason)
}

struct AttrCtx<'a> {
    zone: chrono_tz::Tz,
    /// Per note of the type: (note index, its links' outcomes are unresolved for this key, the first link target).
    notes: &'a [&'a Note],
    /// Unresolved frontmatter links by (note source, key): every link there is `unresolved`.
    unbound: &'a dyn Fn(&str, &str) -> bool,
}

/// Plans the attributes of one source type (§4.1, §4.2). `def`: the target's planned definition, which gains the new
/// attributes (a skipped type plans against a copy).
#[allow(clippy::too_many_lines)]
fn plan_attrs(source_type: &str, target: Option<&str>, given: Option<&TypeMapping>, def: &mut TypeFile, ctx: &AttrCtx<'_>, report: &mut Rows, skip: bool) -> Result<AttrPlan, ImportError> {
    let no_attrs = BTreeMap::new();
    let given_attrs = given.map(|g| &g.attributes).unwrap_or(&no_attrs);
    // The rows: every top-level key a readable note of the type has, first seen by source path.
    let mut keys: Vec<String> = Vec::new();
    for n in ctx.notes {
        for (k, _) in &n.fm {
            if !keys.contains(k) {
                keys.push(k.clone());
            }
        }
    }
    if let Some(unknown) = given_attrs.keys().find(|k| !keys.contains(&tegg_format::nfc(k))) {
        return Err(invalid(source_type, Some(unknown), MappingReason::UnknownSourceAttribute));
    }
    let values_of = |key: &str| -> Vec<&Val> { ctx.notes.iter().filter_map(|n| n.get(key)).filter(|v| !v.is_null()).collect() };
    let nulls_of = |key: &str| ctx.notes.iter().filter_map(|n| n.get(key)).filter(|v| v.is_null()).count();

    enum Pick {
        Consumed(&'static str),
        Drop,
        NotCreated,
        Existing(String),
        New { name: String, kind: Option<AttrType>, given: bool, reserved: bool },
    }
    let mut picks: Vec<Pick> = Vec::new();
    for key in &keys {
        let g = given_attrs.get(key);
        let values = values_of(key);
        let bad = |reason| Err(invalid(source_type, Some(key), reason));
        let pick = if let Some(written) = consumed_key(source_type, target, key) {
            match g.and_then(|g| g.to.as_ref()) {
                None => {}
                Some(AttrTarget::Existing { key: k }) if k == written => {}
                Some(_) => return bad(MappingReason::UnknownTargetAttribute),
            }
            if key == "status" && written == "status" {
                let labels: Vec<&str> = def.attributes.iter().find(|a| a.key == "status").map(|a| a.options.iter().map(|o| o.label.as_str()).collect()).unwrap_or_default();
                if g.is_some_and(|g| g.values.values().any(|v| !labels.contains(&v.as_str()))) {
                    return bad(MappingReason::UnknownStatus);
                }
            }
            Pick::Consumed(written)
        } else {
            match g.and_then(|g| g.to.as_ref()) {
                Some(AttrTarget::Drop) => Pick::Drop,
                Some(AttrTarget::Existing { key: k }) => {
                    let Some(attr) = def.attributes.iter().find(|a| a.key == *k) else { return bad(MappingReason::UnknownTargetAttribute) };
                    if !mapping::fits(attr, &values, ctx.zone) || (attr.r#type != AttrType::Text && attr.r#type != AttrType::LongText && values.iter().any(|v| matches!(v, Val::Nested))) {
                        return bad(MappingReason::KindMismatch);
                    }
                    Pick::Existing(k.clone())
                }
                Some(AttrTarget::New { name, r#type }) => {
                    let cand = candidate_key(name);
                    if name.trim().is_empty() || cand.is_empty() {
                        return bad(MappingReason::EmptyName);
                    }
                    if tegg_format::is_reserved_key(&cand.to_lowercase()) {
                        return bad(MappingReason::ReservedKey);
                    }
                    let kind = match r#type {
                        Some(t) => {
                            let k = AttrType::parse(t);
                            if !AttrType::OFFERED.contains(&k) {
                                return bad(MappingReason::KindMismatch);
                            }
                            Some(k)
                        }
                        None => None,
                    };
                    if kind.is_none() && values.is_empty() {
                        Pick::NotCreated
                    } else {
                        Pick::New { name: name.trim().to_string(), kind, given: true, reserved: false }
                    }
                }
                None if mapping::dropped_by_default(source_type, key) => Pick::Drop,
                None if tegg_format::is_reserved_key(key) => {
                    let name = format!("{key}-text");
                    match def.attributes.iter().find(|a| a.key == name) {
                        Some(a) if mapping::fits(a, &values, ctx.zone) => Pick::Existing(name),
                        _ if values.is_empty() => Pick::NotCreated,
                        _ => Pick::New { name, kind: Some(AttrType::Text), given: false, reserved: true },
                    }
                }
                None if values.is_empty() => Pick::NotCreated,
                None => match def.attributes.iter().find(|a| a.key == *key) {
                    Some(a) if mapping::fits(a, &values, ctx.zone) && !values.iter().any(|v| matches!(v, Val::Nested) && a.r#type != AttrType::Text) => Pick::Existing(key.clone()),
                    _ => Pick::New { name: key.clone(), kind: None, given: false, reserved: false },
                },
            }
        };
        picks.push(pick);
    }
    // `DuplicateTarget`: two targets given by the mapping onto one key; the later one is named.
    let mut seen: Vec<String> = Vec::new();
    for (key, pick) in keys.iter().zip(&picks) {
        let target_key = match pick {
            Pick::Existing(k) if given_attrs.get(key).is_some_and(|g| g.to.is_some()) => k.clone(),
            Pick::New { name, given: true, .. } => candidate_key(name),
            _ => continue,
        };
        if seen.contains(&target_key) {
            return Err(invalid(source_type, Some(key), MappingReason::DuplicateTarget));
        }
        seen.push(target_key);
    }
    // `KeyTaken` / `RangeCollision`: a given name against the type's attributes and every default key.
    let mut reserved: BTreeSet<String> = BTreeSet::new();
    for (key, pick) in keys.iter().zip(&picks) {
        let Pick::New { name, kind, given: true, .. } = pick else { continue };
        let cand = candidate_key(name);
        let kind = kind.clone().or_else(|| mapping::infer(&values_of(key), ctx.zone).map(|k| k.0)).unwrap_or(AttrType::Text);
        let defaults = keys.iter().zip(&picks).any(|(k, p)| k != key && matches!(p, Pick::New { name: other, given: false, .. } if candidate_key(other) == cand));
        match tegg_schema::check_attr_key(&cand, def, &kind) {
            Ok(()) if !defaults => {}
            Err(RuleError::RangeCollision) => return Err(invalid(source_type, Some(key), MappingReason::RangeCollision)),
            Err(RuleError::ReservedKey { .. }) => return Err(invalid(source_type, Some(key), MappingReason::ReservedKey)),
            Err(RuleError::Empty { .. }) | Err(RuleError::AttrKeyInvalid) => return Err(invalid(source_type, Some(key), MappingReason::EmptyName)),
            _ => return Err(invalid(source_type, Some(key), MappingReason::KeyTaken)),
        }
        reserved.insert(cand);
    }

    // The rows and the rules, in source order.
    let mut rows = Vec::new();
    let mut rules = Vec::new();
    for (key, pick) in keys.iter().zip(picks) {
        let g = given_attrs.get(key);
        let values = values_of(key);
        let nulls = nulls_of(key);
        let mut row = PlannedAttr { source_key: key.clone(), action: AttrAction::Consumed, key: None, name: None, r#type: None, values: values.len(), nulls, options: Vec::new(), merges: Vec::new(), statuses: Vec::new(), split: g.and_then(|g| g.split.clone()), needs_look: false };
        let strings: Vec<&str> = ctx.notes.iter().filter_map(|n| n.get(key)).filter_map(|v| if let Val::Str(s) = v { Some(s.as_str()) } else { None }).collect();
        let attr_row = |change: AttrChange, report: &mut Rows| {
            if !skip {
                report.attributes.push(AttributeRow { source_type: source_type.to_string(), source_key: key.clone(), change });
            }
        };
        let rule = match pick {
            Pick::Consumed(written) => {
                row.key = Some(written.to_string());
                match (key.as_str(), written) {
                    ("status", "status") => {
                        let status = def.attributes.iter().find(|a| a.key == "status");
                        let options: Vec<&OptionDef> = status.map(|a| a.options.iter().collect()).unwrap_or_default();
                        let state = |label: &str| options.iter().find(|o| o.label == label).and_then(|o| tegg_schema::option_state(o)).unwrap_or("open").replace('-', " ");
                        let fallback = options.iter().find(|o| o.label == "To do").or_else(|| options.iter().find(|o| tegg_schema::option_state(o) == Some("open"))).or(options.first()).map(|o| o.label.clone()).unwrap_or_else(|| "To do".to_string());
                        let mut map = BTreeMap::new();
                        for n in ctx.notes {
                            let Some(v) = n.get(key) else { continue };
                            let value = v.scalar().unwrap_or_default();
                            if let Some(s) = row.statuses.iter_mut().find(|s| s.value == value) {
                                s.count += 1;
                                continue;
                            }
                            let by_mapping = g.and_then(|g| g.values.get(&value)).cloned();
                            let by_name = options.iter().find(|o| fold(&o.label) == fold(value.trim())).map(|o| o.label.clone());
                            let is_fallback = by_mapping.is_none() && by_name.is_none();
                            let to = by_mapping.or(by_name).unwrap_or_else(|| fallback.clone());
                            map.insert(value.clone(), to.clone());
                            if !row.options.contains(&to) {
                                row.options.push(to.clone());
                            }
                            row.statuses.push(StatusMap { value, state: state(&to), to, count: 1, fallback: is_fallback });
                        }
                        row.needs_look = row.statuses.iter().any(|s| s.fallback);
                        Rule::Status(map)
                    }
                    ("priority", "priority") => {
                        let options: Vec<String> = def.attributes.iter().find(|a| a.key == "priority").map(|a| a.options.iter().map(|o| o.label.clone()).collect()).unwrap_or_default();
                        let (merges, kept) = mapping::merges(&strings, &options, g.and_then(|g| g.merge.as_ref()));
                        let mut unknown: Vec<(String, usize)> = Vec::new();
                        for s in &strings {
                            let written = kept.get(&fold(s.trim())).cloned().unwrap_or_else(|| s.trim().to_string());
                            if !row.options.contains(&written) {
                                row.options.push(written.clone());
                            }
                            if !options.contains(&written) {
                                match unknown.iter_mut().find(|(v, _)| *v == written) {
                                    Some(x) => x.1 += 1,
                                    None => unknown.push((written, 1)),
                                }
                            }
                        }
                        for (value, objects) in unknown {
                            attr_row(AttrChange::ValueNotInOptions { value, objects }, report);
                        }
                        merged_rows(source_type, "priority", &merges, report, skip);
                        row.needs_look = !merges.is_empty() && g.is_none_or(|g| g.merge.is_none());
                        row.merges = merges;
                        Rule::Attr(AttrRule { key: "priority".into(), kind: AttrType::Select, kept, split: None, link_select: false, datey: false, options: Some(options) })
                    }
                    ("deadline", "due") => Rule::Due(true),
                    ("date", "due") => {
                        // CP-9 (D-1563): a `date` beside a `deadline` with a value loses its key (`due` is the
                        // deadline's): it is kept as text under the undeclared key `date-text`, and reported.
                        if ctx.notes.iter().any(|n| lost_key(n, "date", "deadline")) {
                            attr_row(AttrChange::Renamed { key: "date-text".into(), reason: KeyReason::KeyTaken }, report);
                        }
                        Rule::Due(false)
                    }
                    ("completed", _) => Rule::Attr(AttrRule { key: "completed".into(), kind: AttrType::DateTime, kept: BTreeMap::new(), split: None, link_select: false, datey: true, options: None }),
                    ("date", "date") => Rule::DailyDate,
                    ("reviewed", _) => Rule::Review,
                    ("icon", _) => Rule::Icon,
                    ("previewImage", _) => {
                        // CP-9 (D-1563): a Weblink's `previewImage` beside a `coverImage` with a value loses its key
                        // (`cover` is the coverImage's): kept as text under `previewImage-text`, and reported.
                        if ctx.notes.iter().any(|n| lost_key(n, "previewImage", "coverImage")) {
                            attr_row(AttrChange::Renamed { key: "previewImage-text".into(), reason: KeyReason::KeyTaken }, report);
                        }
                        Rule::Cover
                    }
                    ("coverImage", _) => Rule::Cover,
                    _ => Rule::Own,
                }
            }
            Pick::Drop => {
                row.action = AttrAction::Drop;
                attr_row(AttrChange::Dropped { values: values.len() }, report);
                Rule::Drop
            }
            Pick::NotCreated => {
                row.action = AttrAction::NotCreated;
                attr_row(AttrChange::NotCreated { nulls }, report);
                Rule::Drop
            }
            Pick::Existing(k) => {
                let attr = def.attributes.iter().find(|a| a.key == k).cloned().unwrap_or_else(|| attr_def(&k, &k, AttrType::Text));
                row.action = if k == *key { AttrAction::Keep } else { AttrAction::Rename };
                (row.key, row.name, row.r#type) = (Some(k.clone()), Some(attr.name.clone()), Some(attr.r#type.as_str().to_string()));
                if k != *key && tegg_format::is_reserved_key(key) && g.is_none_or(|g| g.to.is_none()) {
                    attr_row(AttrChange::Renamed { key: k.clone(), reason: KeyReason::Reserved }, report);
                }
                let mut rule = AttrRule { key: k, kind: attr.r#type.clone(), kept: BTreeMap::new(), split: row.split.clone().filter(|s| s.on), link_select: false, datey: false, options: None };
                finish_attr(&mut row, &mut rule, &values, &strings, &attr, g, ctx, source_type, report, skip, key);
                Rule::Attr(rule)
            }
            Pick::New { name, kind, given, reserved: reserved_key } => {
                let split = row.split.clone().filter(|s| s.on);
                let (kind, multi) = match kind {
                    Some(k) => (k.clone(), split.is_some() || matches!(mapping::infer(&values, ctx.zone), Some((_, true)))),
                    None => mapping::infer(&values, ctx.zone).unwrap_or((AttrType::Text, false)),
                };
                let (final_key, reason) = if given {
                    reserved.remove(&candidate_key(&name));
                    (candidate_key(&name), None)
                } else {
                    default_key(&name, def, &kind, &reserved)
                };
                let reason = if reserved_key { Some(KeyReason::Reserved) } else { reason };
                if let Some(reason) = reason.filter(|_| final_key != *key) {
                    attr_row(AttrChange::Renamed { key: final_key.clone(), reason }, report);
                }
                attr_row(AttrChange::New { key: final_key.clone(), r#type: kind.as_str().to_string() }, report);
                row.action = AttrAction::New;
                (row.key, row.name, row.r#type) = (Some(final_key.clone()), Some(name.clone()), Some(kind.as_str().to_string()));
                let mut attr = attr_def(&final_key, &name, kind.clone());
                attr.multiple = multi && kind == AttrType::Relation;
                let link_select = kind == AttrType::Select && !values.is_empty() && values.iter().all(|v| matches!(v, Val::Str(s) if mapping::only_links(s)));
                let mut rule = AttrRule { key: final_key, kind, kept: BTreeMap::new(), split, link_select, datey: false, options: None };
                finish_attr(&mut row, &mut rule, &values, &strings, &attr, g, ctx, source_type, report, skip, key);
                attr.options = row.options.iter().map(|label| OptionDef { label: label.clone(), color: None, extra: Vec::new() }).collect();
                row.needs_look |= g.is_none_or(|g| g.to.is_none());
                def.attributes.push(attr);
                Rule::Attr(rule)
            }
        };
        rows.push(row);
        rules.push((key.clone(), rule));
    }
    Ok((rows, rules))
}

fn merged_rows(source_type: &str, key: &str, merges: &[ValueMerge], report: &mut Rows, skip: bool) {
    if skip {
        return;
    }
    for m in merges.iter().filter(|m| m.applied) {
        report.merged.push(MergedRow { source_type: source_type.to_string(), key: key.to_string(), variants: m.variants.clone(), kept: m.kept.clone() });
    }
}

/// The parts of an attribute row that depend on its kind: merges, options, split, candidates, the look flag.
#[allow(clippy::too_many_arguments)]
fn finish_attr(row: &mut PlannedAttr, rule: &mut AttrRule, values: &[&Val], strings: &[&str], attr: &AttrDef, g: Option<&AttrMapping>, ctx: &AttrCtx<'_>, source_type: &str, report: &mut Rows, skip: bool, source_key: &str) {
    let text = matches!(rule.kind, AttrType::Text | AttrType::LongText);
    rule.datey = matches!(rule.kind, AttrType::Date | AttrType::DateTime | AttrType::DateRange) || strings.iter().any(|s| s.trim().len() != 10 && dates::parse(s, ctx.zone).is_some());
    if rule.kind == AttrType::Select {
        let shown: Vec<String> = if rule.link_select { strings.iter().map(|s| mapping::wikilinks(s).first().map(|(_, inner)| inner.split('|').next().unwrap_or("").trim().to_string()).unwrap_or_default()).collect() } else { strings.iter().map(|s| s.to_string()).collect() };
        let shown_refs: Vec<&str> = shown.iter().map(String::as_str).collect();
        let options: Vec<String> = attr.options.iter().map(|o| o.label.clone()).collect();
        let (merges, kept) = mapping::merges(&shown_refs, &options, g.and_then(|g| g.merge.as_ref()));
        for s in &shown_refs {
            let written = kept.get(&fold(s.trim())).cloned().unwrap_or_else(|| s.trim().to_string());
            if !row.options.contains(&written) {
                row.options.push(written);
            }
        }
        merged_rows(source_type, row.key.as_deref().unwrap_or(source_key), &merges, report, skip);
        row.needs_look |= !merges.is_empty() && g.is_none_or(|g| g.merge.is_none());
        row.merges = merges;
        rule.kept = kept;
        if rule.link_select && !skip {
            report.attributes.push(AttributeRow { source_type: source_type.to_string(), source_key: source_key.to_string(), change: AttrChange::SelectValues { values: strings.len() } });
        }
    }
    let nested = values.iter().filter(|v| matches!(v, Val::Nested)).count();
    if nested > 0 && !skip {
        report.attributes.push(AttributeRow { source_type: source_type.to_string(), source_key: source_key.to_string(), change: AttrChange::AsStored { values: nested } });
    }
    if text && strings.iter().any(|s| mapping::splittable(s)) && g.is_none_or(|g| g.split.is_none()) {
        row.needs_look = true;
    }
    let _ = ctx.unbound;
}

// ------------------------------------------------------------------------------------------------ links

#[derive(Clone, Debug, PartialEq)]
enum Bound {
    None,
    Note(usize),
    Attachment(usize),
}

struct Att {
    source: String,
    entry_fail: Option<AttachmentUnreadable>,
    bytes: u64,
    /// The index of its own Image or PDF note.
    own: Option<usize>,
    /// The first imported note that links to it.
    owner: Option<usize>,
    referenced: bool,
    path: Option<String>,
    generic: bool,
}

/// The report's lists while they are collected.
#[derive(Default)]
struct Rows {
    attributes: Vec<AttributeRow>,
    merged: Vec<MergedRow>,
    dates: Vec<DateRow>,
    files: Vec<FileRow>,
}

fn valid_day(s: &str) -> bool {
    s.len() == 10 && tegg_format::parse_date(s).is_some()
}

// ------------------------------------------------------------------------------------------------ plan

#[allow(clippy::too_many_lines, clippy::needless_range_loop)]
pub(crate) fn plan(scan: &Scan, space: &str, target: &Target<'_>, given: &Mapping, env: &ImportEnv, ctl: &Control) -> Result<Plan, ImportError> {
    let source = &*scan.source;
    if given.version > 1 {
        return Err(invalid("", None, MappingReason::UnknownVersion));
    }
    if let Target::NewVault { name, .. } = target {
        if name.is_empty() || tegg_format::sanitize_file_stem(name) != *name {
            return Err(ImportError::InvalidPlan { path: None, reason: PlanReason::Target });
        }
    }
    if !scan.info.spaces.iter().any(|s| s.name == space) {
        return Err(ImportError::UnknownSpace { space: space.to_string() });
    }
    source.check_space(space)?;
    let mut tinfo = target_info(target, source)?;
    let zone = env.zone;
    let now = (env.clock)();
    let date = now.with_timezone(&zone).format("%Y-%m-%d").to_string();

    // ---- the space's files by class (D-79)
    let entries: Vec<(&str, &Entry)> = source.space_entries(space).collect();
    let note_entries: Vec<&(&str, &Entry)> = entries.iter().filter(|(p, _)| layout::is_object(p)).collect();
    let mut progress = Progress::new(ctl, ImportPhase::Planning, note_entries.len());
    let mut notes: Vec<Note> = Vec::new();
    for (i, (inner, e)) in note_entries.iter().enumerate() {
        progress.step(i)?;
        notes.push(read_note(source, env, inner, e)?);
    }
    let mut atts: Vec<Att> = entries
        .iter()
        .filter(|(p, _)| layout::is_attachment(p))
        .map(|(p, e)| Att {
            source: p.to_string(),
            entry_fail: e.fail.as_ref().map(|f| if *f == UnreadableReason::Encrypted { AttachmentUnreadable::Encrypted } else { AttachmentUnreadable::Read }),
            bytes: e.size,
            own: None,
            owner: None,
            referenced: false,
            path: None,
            generic: false,
        })
        .collect();
    let mut other_files: Vec<OtherFile> = Vec::new();
    for (p, e) in entries.iter().filter(|(p, _)| !layout::is_object(p) && !layout::is_attachment(p)) {
        let kind = if layout::is_hidden(p) {
            OtherKind::Dotfile
        } else {
            // A tag collection is a CSV with at most its header line (FR-IMP-21 AC-2).
            let lines = source.read(e).ok().map(|b| String::from_utf8_lossy(&b).trim_start_matches('\u{feff}').lines().filter(|l| !l.trim().is_empty()).count());
            if lines.is_some_and(|n| n <= 1) {
                OtherKind::TagCollection
            } else {
                OtherKind::Csv
            }
        };
        other_files.push(OtherFile { source: p.to_string(), kind });
    }
    other_files.extend(source.entries.iter().filter(|e| source.layout.space_of(&e.path).is_none()).map(|e| OtherFile { source: source.layout.outside_name(&e.path).to_string(), kind: OtherKind::OutsideSpace }));
    other_files.extend(source.bad.iter().map(|u| OtherFile { source: u.entry.clone(), kind: OtherKind::UnreadableEntry }));

    // ---- types (R148's first table, §4.2)
    let mut source_types: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, n) in notes.iter().enumerate() {
        if let Some(t) = &n.ctype {
            source_types.entry(t.clone()).or_default().push(i);
        }
    }
    let mut defs: Vec<Def> = tinfo.types.iter().cloned().map(|file| Def { file, new: false }).collect();
    let mut type_names: BTreeSet<String> = BTreeSet::new();
    for t in source_types.keys().chain(given.types.keys()) {
        type_names.insert(t.clone());
    }
    let existing_keys: Vec<(String, String, String)> = tinfo.types.iter().map(|t| (t.key.clone(), fold(&t.name), fold(&t.plural))).collect();
    let default_new: BTreeMap<String, String> = source_types.keys().filter(|t| !given.types.get(*t).is_some_and(|g| g.to.is_some())).filter_map(|t| if let TypeTarget::New { name } = default_target(t, &tinfo.types) { Some((t.clone(), tegg_format::type_key(&name))) } else { None }).collect();
    let mut given_new: Vec<String> = Vec::new();
    let mut plans: Vec<TypePlan> = Vec::new();
    for t in &type_names {
        let Some(members) = source_types.get(t) else { return Err(invalid(t, None, MappingReason::UnknownSourceType)) };
        let default = default_target(t, &tinfo.types);
        let default_key = if let TypeTarget::Existing { key } = &default { Some(key.clone()) } else { None };
        let effective = given.types.get(t).and_then(|g| g.to.clone()).unwrap_or_else(|| default.clone());
        let first = &notes[members[0]].source;
        let source_folder = if first.contains('/') { first.split('/').next().unwrap_or("").to_string() } else { t.clone() };
        let pinned = matches!(t.as_str(), "Image" | "PDF");
        let mut row = PlannedType { source_type: t.clone(), source_folder: source_folder.clone(), objects: members.len(), target: effective.clone(), key: None, name: None, plural: None, folder: None, new: false, attributes: Vec::new() };
        let def = match &effective {
            TypeTarget::Skip => None,
            TypeTarget::Existing { key } => {
                let Some(at) = defs.iter().position(|d| d.file.key == *key && !d.new) else { return Err(invalid(t, None, MappingReason::UnknownTargetType)) };
                if (CLOSED_TARGETS.contains(&key.as_str()) || pinned) && default_key.as_deref() != Some(key.as_str()) {
                    return Err(invalid(t, None, MappingReason::TypeNotAllowed));
                }
                Some(at)
            }
            TypeTarget::New { name } => {
                if pinned || fixed_closed(t) {
                    return Err(invalid(t, None, MappingReason::TypeNotAllowed));
                }
                let name = tegg_format::nfc(name.trim());
                let key = tegg_format::type_key(&name);
                let is_given = given.types.get(t).is_some_and(|g| g.to.is_some());
                if is_given {
                    let stem = tegg_format::sanitize_file_stem(&name);
                    if name.is_empty() || (stem == "Untitled" && fold(&name) != "untitled") || tegg_schema::check_type_name(&name, &name, &[], true).is_err() {
                        return Err(invalid(t, None, MappingReason::EmptyName));
                    }
                    let folded = fold(&name);
                    let taken = existing_keys.iter().any(|(k, n, p)| *k == key || *n == folded || *p == folded) || given_new.contains(&key) || default_new.iter().any(|(other, k)| other != t && *k == key);
                    if taken {
                        return Err(invalid(t, None, MappingReason::NameTaken));
                    }
                    given_new.push(key.clone());
                }
                row.new = true;
                defs.push(Def { file: new_def(&name, &source_folder), new: true });
                tinfo.type_stamps.push(TypeFileStamp { path: format!(".tegg/types/{key}.yml"), version: None });
                Some(defs.len() - 1)
            }
        };
        if let Some(at) = def {
            let f = &defs[at].file;
            (row.key, row.name, row.plural, row.folder) = (Some(f.key.clone()), Some(f.name.clone()), Some(f.plural.clone()), Some(f.folder.clone()));
        }
        plans.push(TypePlan { row, def, rules: Vec::new(), stub: t == "Query" });
    }
    let type_index: HashMap<String, usize> = plans.iter().enumerate().map(|(i, p)| (p.row.source_type.clone(), i)).collect();
    let plan_of = |n: &Note| n.ctype.as_ref().and_then(|t| type_index.get(t).copied());

    // ---- objects: which notes are imported, and as which type
    let imported: Vec<bool> = notes.iter().map(|n| n.unreadable.is_none() && plan_of(n).is_some_and(|p| plans[p].def.is_some())).collect();
    let page_def = defs.iter().position(|d| d.file.key == "page");
    // A Daily Note's day (§4.1): `date:`, else the title, else the file stem. None: a Page (D-1561).
    let days: Vec<Option<String>> = notes
        .iter()
        .enumerate()
        .map(|(i, n)| {
            let daily = imported[i] && plan_of(n).and_then(|p| plans[p].def).is_some_and(|d| defs[d].file.key == "daily-note");
            if !daily {
                return None;
            }
            n.get("date").and_then(|v| v.scalar()).and_then(|s| dates::day(&s, zone)).or_else(|| Some(n.title.clone()).filter(|t| valid_day(t))).or_else(|| Some(n.stem.clone()).filter(|t| valid_day(t)))
        })
        .collect();
    let note_def: Vec<Option<usize>> = notes
        .iter()
        .enumerate()
        .map(|(i, n)| {
            let d = plan_of(n).and_then(|p| plans[p].def).filter(|_| imported[i])?;
            if defs[d].file.key == "daily-note" && days[i].is_none() {
                return page_def;
            }
            Some(d)
        })
        .collect();
    let titles: Vec<String> = notes.iter().enumerate().map(|(i, n)| days[i].clone().unwrap_or_else(|| n.title.clone())).collect();

    // ---- links (§8 (1)): bound by source file
    let by_path: HashMap<&str, usize> = notes.iter().enumerate().map(|(i, n)| (n.source.as_str(), i)).collect();
    let att_by_path: HashMap<String, usize> = atts.iter().enumerate().map(|(i, a)| (a.source.clone(), i)).collect();
    let mut by_title: HashMap<&str, Vec<usize>> = HashMap::new();
    let mut by_folded: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, n) in notes.iter().enumerate().filter(|(_, n)| n.unreadable.is_none()) {
        by_title.entry(titles[i].as_str()).or_default().push(i);
        by_folded.entry(fold(&titles[i])).or_default().push(i);
        let _ = n;
    }
    // Other spaces: titles and paths, for `other-space`.
    let mut other_titles: BTreeMap<&str, HashSet<String>> = BTreeMap::new();
    let mut other_paths: HashMap<&str, &str> = HashMap::new();
    for e in &source.entries {
        if let Some((s, inner)) = source.layout.space_of(&e.path).filter(|(s, _)| *s != space) {
            other_paths.insert(e.path.as_str(), s);
            if let Some(title) = e.meta.as_ref().and_then(|m| m.title.clone()).or_else(|| layout::is_object(inner).then(|| note::clean_title(base_name(inner).strip_suffix(".md").unwrap_or(inner)))) {
                other_titles.entry(s).or_default().insert(title);
            }
        }
    }
    let space_prefix = entries.first().map(|(inner, e)| e.path[..e.path.len() - inner.len()].to_string()).unwrap_or_default();
    let confirmed = |note: &str, target: &str| given.case_links.iter().any(|c| c.r#use && tegg_format::nfc(&c.note) == note && tegg_format::nfc(&c.target) == target);
    let pick = |hits: &[usize]| -> Option<usize> { hits.iter().copied().find(|i| imported[*i]) };
    struct Res {
        outcome: LinkOutcome,
        bound: Bound,
        candidates: Vec<usize>,
    }
    let mut resolved: Vec<Vec<Res>> = Vec::new();
    for (i, n) in notes.iter().enumerate() {
        let mut out = Vec::new();
        for l in &n.scan.links {
            let res = |outcome, bound| Res { outcome, bound, candidates: Vec::new() };
            let r = if !imported[i] {
                res(LinkOutcome::InSkippedNote, Bound::None)
            } else if l.external {
                res(LinkOutcome::External, Bound::None)
            } else if matches!(l.form, LinkForm::Wikilink | LinkForm::Embed) {
                let t = tegg_format::nfc(l.target.trim());
                let day = t.strip_prefix("Date/").unwrap_or(&t);
                if valid_day(day) {
                    res(LinkOutcome::DateMention, Bound::None)
                } else if let Some(hits) = by_title.get(t.as_str()) {
                    match (hits.len(), pick(hits)) {
                        (_, None) => res(LinkOutcome::TargetNotImported, Bound::None),
                        (1, Some(to)) => res(LinkOutcome::Resolved, Bound::Note(to)),
                        (_, Some(to)) => Res { outcome: LinkOutcome::Ambiguous, bound: Bound::Note(to), candidates: hits.clone() },
                    }
                } else if let Some(hits) = by_folded.get(&fold(&t)) {
                    let yes = confirmed(&n.source, &t);
                    match pick(hits) {
                        Some(to) => Res { outcome: LinkOutcome::CaseMismatch { confirmed: yes }, bound: if yes { Bound::Note(to) } else { Bound::None }, candidates: vec![to] },
                        None => res(LinkOutcome::TargetNotImported, Bound::None),
                    }
                } else if let Some((s, _)) = other_titles.iter().find(|(_, titles)| titles.contains(&t)) {
                    res(LinkOutcome::OtherSpace { space: s.to_string() }, Bound::None)
                } else {
                    res(LinkOutcome::Unresolved, Bound::None)
                }
            } else {
                let dest = note::destination_path(&l.target);
                match note::join_relative(&n.source, dest) {
                    Some(p) if att_by_path.contains_key(&p) => {
                        let a = att_by_path[&p];
                        if atts[a].entry_fail.is_some() {
                            res(LinkOutcome::MissingFile, Bound::None)
                        } else {
                            res(LinkOutcome::Attachment, Bound::Attachment(a))
                        }
                    }
                    Some(p) if by_path.contains_key(p.as_str()) => {
                        let to = by_path[p.as_str()];
                        if imported[to] {
                            res(LinkOutcome::Resolved, Bound::Note(to))
                        } else {
                            res(LinkOutcome::TargetNotImported, Bound::None)
                        }
                    }
                    Some(p) if l.form == LinkForm::Image || p.split('/').any(|part| part == "Media") => res(LinkOutcome::MissingFile, Bound::None),
                    Some(_) => res(LinkOutcome::Unresolved, Bound::None),
                    None => {
                        // The destination leaves the space: another space's file?
                        let full = note::join_relative(&format!("{space_prefix}{}", n.source), dest);
                        match full.as_deref().and_then(|p| other_paths.get(p)) {
                            Some(s) => res(LinkOutcome::OtherSpace { space: s.to_string() }, Bound::None),
                            None => res(LinkOutcome::Unresolved, Bound::None),
                        }
                    }
                }
            };
            out.push(r);
        }
        resolved.push(out);
    }

    // ---- attributes (R148's second table, §4.1, §4.2)
    let mut rows = Rows::default();
    for p in 0..plans.len() {
        let t = plans[p].row.source_type.clone();
        let members: Vec<&Note> = source_types[&t].iter().map(|i| &notes[*i]).filter(|n| n.unreadable.is_none()).collect();
        let unbound = |_: &str, _: &str| true;
        let ctx = AttrCtx { zone, notes: &members, unbound: &unbound };
        let skip = plans[p].def.is_none();
        let mut scratch;
        let (def, target_key): (&mut TypeFile, Option<String>) = match plans[p].def {
            Some(d) => {
                let key = defs[d].file.key.clone();
                (&mut defs[d].file, Some(key))
            }
            None => {
                // A skipped type is planned against its default target, and creates nothing.
                let key = if let TypeTarget::Existing { key } = default_target(&t, &tinfo.types) { Some(key) } else { None };
                scratch = key.as_ref().and_then(|k| tinfo.types.iter().find(|f| f.key == *k).cloned()).unwrap_or_else(|| new_def(&t, &plans[p].row.source_folder));
                (&mut scratch, key)
            }
        };
        let (attrs, rules) = plan_attrs(&t, target_key.as_deref(), given.types.get(&t), def, &ctx, &mut rows, skip)?;
        plans[p].row.attributes = attrs;
        plans[p].rules = rules;
    }
    // A link in a select attribute is a select value (FR-IMP-21).
    for (i, n) in notes.iter().enumerate().filter(|(i, _)| imported[*i]) {
        let Some(p) = plan_of(n) else { continue };
        for (l, r) in n.scan.links.iter().zip(resolved[i].iter_mut()) {
            if let LinkPlace::Frontmatter { key } = &l.place {
                if matches!(plans[p].rule(&tegg_format::nfc(key)), Some(Rule::Attr(a)) if a.link_select) {
                    *r = Res { outcome: LinkOutcome::SelectValue, bound: Bound::None, candidates: Vec::new() };
                }
            }
        }
    }
    // Step 4c's tag-like candidates: every value a link, none with a matching object.
    let mut tag_like: Vec<TagLikeAttr> = Vec::new();
    for p in plans.iter().filter(|p| p.def.is_some()) {
        for (key, rule) in &p.rules {
            let Rule::Attr(a) = rule else { continue };
            if a.kind != AttrType::Relation && !a.link_select {
                continue;
            }
            let mut cand = TagLikeAttr { source_type: p.row.source_type.clone(), source_key: key.clone(), objects: 0, values: Vec::new(), example: String::new(), selected: a.link_select };
            let mut all = true;
            for i in source_types[&p.row.source_type].iter().filter(|i| imported[**i]) {
                let Some(v) = notes[*i].get(key).filter(|v| !v.is_null()) else { continue };
                cand.objects += 1;
                if cand.example.is_empty() {
                    cand.example = v.scalar().unwrap_or_default();
                }
                for (l, r) in notes[*i].scan.links.iter().zip(&resolved[*i]) {
                    if matches!(&l.place, LinkPlace::Frontmatter { key: k } if tegg_format::nfc(k) == *key) {
                        all &= matches!(r.outcome, LinkOutcome::Unresolved | LinkOutcome::SelectValue);
                        if !cand.values.contains(&l.target) {
                            cand.values.push(l.target.clone());
                        }
                    }
                }
            }
            if all && cand.objects > 0 && !cand.values.is_empty() {
                tag_like.push(cand);
            }
        }
    }

    // ---- attachments: their notes, their names (§5.2)
    for (i, n) in notes.iter().enumerate().filter(|(i, _)| imported[*i]) {
        let media = note_def[i].is_some_and(|d| matches!(defs[d].file.key.as_str(), "image" | "pdf"));
        for (l, r) in n.scan.links.iter().zip(&resolved[i]) {
            let Bound::Attachment(a) = r.bound else { continue };
            atts[a].referenced = true;
            atts[a].owner.get_or_insert(i);
            if media && l.place == LinkPlace::Body && atts[a].own.is_none() && !atts.iter().any(|x| x.own == Some(i)) {
                atts[a].own = Some(i);
            }
        }
    }
    let mut names = Names::new(&tinfo.files);
    for a in 0..atts.len() {
        if atts[a].entry_fail.is_some() {
            continue;
        }
        let file = tegg_format::nfc(base_name(&atts[a].source));
        let (stem, ext) = split_ext(&file);
        let owner = atts[a].own.or(atts[a].owner);
        let name = match owner {
            Some(o) if mapping::generic_name(stem) => {
                let mut n = 1;
                let name = loop {
                    let candidate = format!("{}{ext}", tegg_format::sanitize_file_stem(&format!("{} {n}", titles[o])));
                    if !names.is_taken("_attachments", &candidate) {
                        break candidate;
                    }
                    n += 1;
                };
                names.take("_attachments", &name);
                atts[a].generic = true;
                rows.files.push(FileRow { source: atts[a].source.clone(), change: FileChange::GenericName { name: name.clone() } });
                name
            }
            _ => {
                let clean = tegg_format::sanitize_file_stem(stem);
                let (name, suffixed) = names.free("_attachments", &clean, ext);
                let mut reasons = if clean == stem { Vec::new() } else { vec![NameChange::Characters] };
                if suffixed {
                    reasons.insert(0, NameChange::Suffix);
                }
                if !reasons.is_empty() {
                    rows.files.push(FileRow { source: atts[a].source.clone(), change: FileChange::NameChanged { name: name.clone(), reasons } });
                }
                name
            }
        };
        if !atts[a].referenced {
            rows.files.push(FileRow { source: atts[a].source.clone(), change: FileChange::Unreferenced });
        }
        atts[a].path = Some(format!("_attachments/{name}"));
    }

    // ---- objects in source-path order, made media objects among them: names and paths
    enum Slot {
        Note(usize),
        Made(usize),
    }
    let mut slots: Vec<(String, Slot)> = notes.iter().enumerate().map(|(i, n)| (n.source.clone(), Slot::Note(i))).collect();
    slots.extend(atts.iter().enumerate().filter(|(_, a)| a.path.is_some() && a.own.is_none()).map(|(i, a)| (a.source.clone(), Slot::Made(i))));
    slots.sort_by(|a, b| a.0.cmp(&b.0));
    let folder_of_key = |key: &str| defs.iter().find(|d| d.file.key == key).map(|d| d.file.folder.clone()).unwrap_or_else(|| key.to_string());
    let mut note_path: Vec<Option<String>> = vec![None; notes.len()];
    let mut note_changes: Vec<Vec<NameChange>> = vec![Vec::new(); notes.len()];
    let mut made: HashMap<usize, (String, String, String)> = HashMap::new(); // attachment → (type key, title, path)
    for (_, slot) in &slots {
        match slot {
            Slot::Note(i) => {
                let Some(d) = note_def[*i] else { continue };
                let folder = defs[d].file.folder.clone();
                let stem = tegg_format::sanitize_file_stem(&titles[*i]);
                let mut reasons = mapping::name_changes(&titles[*i], &stem);
                let (name, suffixed) = names.free(&folder, &stem, ".md");
                if suffixed {
                    reasons.push(NameChange::Suffix);
                }
                reasons.sort_by_key(|r| match r {
                    NameChange::Reserved => 0,
                    NameChange::Empty => 1,
                    NameChange::Cut => 2,
                    NameChange::Suffix => 3,
                    NameChange::Characters => 4,
                });
                if !reasons.is_empty() {
                    rows.files.push(FileRow { source: notes[*i].source.clone(), change: FileChange::NameChanged { name: name.clone(), reasons: reasons.clone() } });
                }
                note_changes[*i] = reasons;
                note_path[*i] = Some(format!("{folder}/{name}"));
            }
            Slot::Made(a) => {
                let file = atts[*a].path.clone().unwrap_or_default();
                let planned = base_name(&file).to_string();
                let key = if split_ext(&planned).1.eq_ignore_ascii_case(".pdf") { "pdf" } else { "image" };
                let source_name = tegg_format::nfc(base_name(&atts[*a].source));
                let title = if atts[*a].generic { split_ext(&planned).0.to_string() } else { split_ext(&source_name).0.to_string() };
                let folder = folder_of_key(key);
                let (name, _) = names.free(&folder, &tegg_format::sanitize_file_stem(&title), ".md");
                made.insert(*a, (key.to_string(), title, format!("{folder}/{name}")));
            }
        }
    }
    let page_folder = folder_of_key("page");
    let report_stem = tegg_format::sanitize_file_stem(&format!("Import report {date} {space}"));
    let (report_name, _) = names.free(&page_folder, &report_stem, ".md");
    let report_path = format!("{page_folder}/{report_name}");

    let mut paths = Paths::default();
    tinfo.files.iter().for_each(|p| paths.add(p));
    note_path.iter().flatten().for_each(|p| paths.add(p));
    atts.iter().filter_map(|a| a.path.as_ref()).for_each(|p| paths.add(p));
    made.values().for_each(|(_, _, p)| paths.add(p));
    paths.add(&report_path);
    // The Image or PDF object of an attachment: its own note, or the made one.
    let att_object = |a: usize| -> Option<String> { atts[a].own.and_then(|o| note_path[o].clone()).or_else(|| made.get(&a).map(|m| m.2.clone())) };

    // ---- planned links and their report rows
    let mut links: Vec<PlannedLink> = Vec::new();
    let mut report = ReportData {
        summary: ReportSummary { source: layout::without_zip(&scan.info.name).to_string(), space: space.to_string(), date: date.clone(), objects: Tally { total: 0, imported: 0, reported: 0 }, attachments: Tally { total: 0, imported: 0, reported: 0 }, links: Tally { total: 0, imported: 0, reported: 0 }, backup: None },
        types: Vec::new(),
        no_day: Vec::new(),
        unresolved: Vec::new(),
        ambiguous: Vec::new(),
        case_links: Vec::new(),
        simplified: Vec::new(),
        attributes: Vec::new(),
        merged: Vec::new(),
        dates: Vec::new(),
        files: Vec::new(),
        stubs: Vec::new(),
        skipped: Vec::new(),
        cleanup: Cleanup { u200b: 0, ufeff: 0, u200c: 0, u200d: 0, crlf_files: 0 },
        not_exported: vec![NotExported::QueryDefinitions, NotExported::TagColoursAndCollections, NotExported::Comments],
    };
    let mut decisions = Decisions { case_links: Vec::new(), ambiguous: Vec::new(), tag_like };
    for (i, n) in notes.iter().enumerate() {
        for (l, r) in n.scan.links.iter().zip(&resolved[i]) {
            let to = match r.bound {
                Bound::Note(t) => note_path[t].clone(),
                Bound::Attachment(a) => atts[a].path.clone(),
                Bound::None => None,
            };
            let as_link = to.is_some() && !(matches!(r.bound, Bound::Attachment(_)) && matches!(l.form, LinkForm::Image | LinkForm::Embed));
            let rewritten = as_link && l.place == LinkPlace::Body;
            let kept_as_markdown = rewritten && l.form == LinkForm::Markdown && !l.alias_safe;
            let simplified = rewritten && l.simplified && !kept_as_markdown;
            let row = |reason| UnresolvedRow { note: n.source.clone(), n: l.n, written: l.written.clone(), reason };
            match &r.outcome {
                LinkOutcome::Unresolved => report.unresolved.push(row(UnresolvedReason::NotInExport)),
                LinkOutcome::OtherSpace { space } => report.unresolved.push(row(UnresolvedReason::OtherSpace { space: space.clone() })),
                LinkOutcome::TargetNotImported => report.unresolved.push(row(UnresolvedReason::TargetNotImported)),
                LinkOutcome::InSkippedNote => report.unresolved.push(row(UnresolvedReason::InSkippedNote)),
                LinkOutcome::MissingFile => {
                    report.unresolved.push(row(UnresolvedReason::MissingFile));
                    rows.files.push(FileRow { source: n.source.clone(), change: FileChange::DroppedReference { n: l.n, written: l.written.clone() } });
                }
                LinkOutcome::Ambiguous => {
                    let chosen = if let Bound::Note(t) = r.bound { notes[t].source.clone() } else { String::new() };
                    report.ambiguous.push(AmbiguousRow { note: n.source.clone(), n: l.n, title: l.target.clone(), chosen: chosen.clone() });
                    decisions.ambiguous.push(AmbiguousLink { note: n.source.clone(), n: l.n, written: l.written.clone(), title: l.target.clone(), candidates: r.candidates.iter().map(|c| notes[*c].source.clone()).collect(), chosen });
                }
                LinkOutcome::CaseMismatch { confirmed } => {
                    let c = r.candidates.first().copied().unwrap_or(0);
                    report.case_links.push(CaseRow { note: n.source.clone(), n: l.n, written: l.written.clone(), candidate: notes[c].source.clone(), confirmed: *confirmed });
                    decisions.case_links.push(CaseLinkCandidate { note: n.source.clone(), n: l.n, written: l.written.clone(), target: tegg_format::nfc(l.target.trim()), candidate: notes[c].source.clone(), candidate_title: titles[c].clone(), confirmed: *confirmed });
                }
                _ => {}
            }
            if simplified {
                report.simplified.push(SimplifiedRow { note: n.source.clone(), n: l.n, written: l.written.clone(), kept: l.text.clone() });
            }
            links.push(PlannedLink { note: n.source.clone(), n: l.n, line: l.line, place: l.place.clone(), form: l.form.clone(), written: l.written.clone(), target: l.target.clone(), outcome: r.outcome.clone(), to, simplified, kept_as_markdown });
        }
    }

    // ---- the objects' frontmatter (§7.3)
    let import_id = |source: &str| format!("capacities:{space}/{source}");
    let mut objects: Vec<PlannedObject> = Vec::new();
    let mut no_created = 0usize;
    for (source_path, slot) in &slots {
        let i = match slot {
            Slot::Note(i) => *i,
            Slot::Made(a) => {
                let (key, title, path) = made[a].clone();
                let file = base_name(atts[*a].path.as_deref().unwrap_or_default()).to_string();
                objects.push(PlannedObject {
                    source: source_path.clone(),
                    import_id: import_id(source_path),
                    outcome: ObjectOutcome::Imported,
                    source_type: None,
                    r#type: Some(key.clone()),
                    title: Some(title.clone()),
                    path: Some(path),
                    kind: ObjectKind::OrphanMedia,
                    frontmatter: vec![("type".into(), FmValue::Text(key)), ("title".into(), FmValue::Text(title)), ("file".into(), FmValue::Link { link: file }), ("import-id".into(), FmValue::Text(import_id(source_path)))],
                    name_changes: Vec::new(),
                });
                continue;
            }
        };
        let n = &notes[i];
        let tp = plan_of(n);
        let mut o = PlannedObject { source: n.source.clone(), import_id: import_id(&n.source), outcome: ObjectOutcome::Imported, source_type: n.ctype.clone(), r#type: None, title: None, path: None, kind: ObjectKind::Note, frontmatter: Vec::new(), name_changes: note_changes[i].clone() };
        if let Some((reason, line)) = &n.unreadable {
            o.outcome = ObjectOutcome::Unreadable { reason: reason.clone(), line: *line };
            report.skipped.push(SkippedRow::Note { source: n.source.clone(), reason: reason.clone(), line: *line });
            objects.push(o);
            continue;
        }
        o.title = Some(titles[i].clone());
        let (Some(d), Some(tp)) = (note_def[i], tp) else {
            o.outcome = ObjectOutcome::Skipped;
            objects.push(o);
            continue;
        };
        let tp = &plans[tp];
        let key = defs[d].file.key.clone();
        let from = note_path[i].clone().unwrap_or_default();
        o.kind = if tp.stub { ObjectKind::QueryStub } else if matches!(key.as_str(), "image" | "pdf") { ObjectKind::Media } else { ObjectKind::Note };
        (o.r#type, o.path) = (Some(key.clone()), note_path[i].clone());
        if tp.stub {
            report.stubs.push(StubRow { note: n.source.clone() });
        }
        let daily_page = tp.def.is_some_and(|x| defs[x].file.key == "daily-note") && days[i].is_none();
        if daily_page {
            report.no_day.push(NoDayRow { note: n.source.clone() });
        }
        report.cleanup.u200b += n.scan.invisible.u200b;
        report.cleanup.ufeff += n.scan.invisible.ufeff;
        report.cleanup.u200c += n.scan.invisible.u200c;
        report.cleanup.u200d += n.scan.invisible.u200d;
        report.cleanup.crlf_files += n.scan.crlf as usize;

        let mut fm: Vec<(String, FmValue)> = vec![("type".into(), FmValue::Text(key.clone())), ("title".into(), FmValue::Text(titles[i].clone()))];
        if let Some(Val::Str(s)) = n.get("description").filter(|v| !matches!(v, Val::Str(s) if s.is_empty())) {
            fm.push(("description".into(), FmValue::Text(s.clone())));
        }
        match n.get("aliases") {
            Some(Val::List(items)) => fm.push(("aliases".into(), FmValue::List(items.clone()))),
            Some(Val::Str(s)) => fm.push(("aliases".into(), FmValue::List(vec![s.clone()]))),
            _ => {}
        }
        let push = |fm: &mut Vec<(String, FmValue)>, k: &str, v: FmValue| {
            if !fm.iter().any(|(x, _)| x == k) && !matches!(k, "tags" | "import-id" | "created" | "modified" | "id") {
                fm.push((k.to_string(), v));
            }
        };
        // Links of a frontmatter key, with their outcomes.
        let key_links = |k: &str| -> Vec<(&ScannedLink, &Res)> { n.scan.links.iter().zip(&resolved[i]).filter(|(l, _)| matches!(&l.place, LinkPlace::Frontmatter { key } if tegg_format::nfc(key) == k)).collect() };
        // A string value with its bound wikilinks rewritten to Tegg's link text.
        let relink = |k: &str, s: &str| -> String {
            let mut out = s.to_string();
            for (l, r) in key_links(k) {
                let to = match r.bound {
                    Bound::Note(t) => note_path[t].clone(),
                    Bound::Attachment(a) => atts[a].path.clone(),
                    Bound::None => None,
                };
                if let (Some(to), true) = (to, matches!(l.form, LinkForm::Wikilink)) {
                    out = out.replacen(&l.written, &format!("[[{}]]", paths.d184(&from, &to, &l.text)), 1);
                }
            }
            tegg_format::nfc(&out)
        };
        // D-1570: a value kept as text under `<key>-text` (CP-9, D-1563) has every bound link rewritten as the same link
        // in a body would be (§8): image syntax or an embed of an imported file → `![[file]]` (§8 (4), D-1560), a
        // wikilink or a Markdown link → the D-184 form (a Markdown link whose text can't be an alias keeps its form and
        // gets the new destination, D-1552). Unbound and external links stay as written. Spans are `import-scan`'s.
        let relink_text = |k: &str, s: &str| -> String {
            let mut out = s.to_string();
            for (l, r) in key_links(k) {
                let to = match r.bound {
                    Bound::Note(t) => note_path[t].clone(),
                    Bound::Attachment(a) => atts[a].path.clone(),
                    Bound::None => None,
                };
                let Some(to) = to else { continue };
                let shown = tegg_format::nfc(&note::strip_invisible(&l.text)).split_whitespace().collect::<Vec<_>>().join(" ");
                let new = match (&l.form, &r.bound) {
                    (LinkForm::Image | LinkForm::Embed, Bound::Attachment(_)) => format!("![[{}]]", base_name(&to)),
                    (LinkForm::Embed, _) => format!("![[{}]]", paths.d184(&from, &to, "")),
                    (LinkForm::Wikilink, _) => format!("[[{}]]", paths.d184(&from, &to, &l.text)),
                    (LinkForm::Markdown | LinkForm::Image, _) if l.alias_safe && !shown.contains(['[', ']', '|']) => format!("[[{}]]", paths.d184(&from, &to, &shown)),
                    (LinkForm::Markdown | LinkForm::Image, _) => match markdown_destination(&l.written) {
                        Some((a, b)) => format!("{}{}{}", &l.written[..a], encode_destination(&rel_path(folder_of(&from), &to)), &l.written[b..]),
                        None => continue,
                    },
                };
                out = out.replacen(&l.written, &new, 1);
            }
            tegg_format::nfc(&out)
        };
        let whole_link = |s: &str| -> Option<String> { s.trim().strip_prefix("[[").and_then(|x| x.strip_suffix("]]")).filter(|x| !x.contains("[[") && !x.contains("]]")).map(str::to_string) };
        let text_or_link = |s: String| match whole_link(&s) {
            Some(link) => FmValue::Link { link },
            None => FmValue::Text(s),
        };
        if o.kind == ObjectKind::Media {
            if let Some(a) = atts.iter().position(|a| a.own == Some(i)) {
                push(&mut fm, "file", FmValue::Link { link: base_name(atts[a].path.as_deref().unwrap_or_default()).to_string() });
            }
        }
        if let (Some(day), None) = (&days[i], n.get("date")) {
            push(&mut fm, "date", FmValue::Date { date: day.clone() });
        }
        let mut created: Option<String> = None;
        let mut modified: Option<String> = None;
        let mut cover_done = false;
        for (k, v) in &n.fm {
            let unreadable_date = |rows: &mut Rows, value: &str| rows.dates.push(DateRow::Unreadable { note: n.source.clone(), key: k.clone(), value: value.to_string() });
            match (k.as_str(), tp.rule(k)) {
                ("createdAt", Some(Rule::Own)) | ("lastUpdated", Some(Rule::Own)) => {
                    let Some(s) = v.scalar() else { continue };
                    match dates::instant(&s, zone) {
                        Some(t) if k == "createdAt" => created = Some(t),
                        Some(t) => modified = Some(t),
                        None => unreadable_date(&mut rows, &s),
                    }
                }
                (_, Some(Rule::Own)) | (_, Some(Rule::Drop)) | (_, None) => {}
                (_, Some(Rule::Review)) => {
                    if let Val::Bool(b) = v {
                        push(&mut fm, "review", FmValue::Text(if *b { "reviewed" } else { "unreviewed" }.to_string()));
                    }
                }
                (_, Some(Rule::Icon)) => {
                    if let Some(s) = v.scalar() {
                        push(&mut fm, "icon", FmValue::Text(s));
                    }
                }
                (_, Some(Rule::Cover)) => {
                    if v.is_null() {
                        continue;
                    }
                    // CP-9 (D-1563): `coverImage` gives `cover`; a `previewImage` beside it keeps its value as text
                    // under the undeclared key `previewImage-text` (not added to the type file).
                    if k == "previewImage" && lost_key(n, "previewImage", "coverImage") {
                        if let Some(s) = v.scalar() {
                            push(&mut fm, "previewImage-text", text_or_link(relink_text(k, &s)));
                        }
                        continue;
                    }
                    // §4.1: one link to a stored file gives `cover`; anything else is not written (CP-11, pending).
                    let ls = key_links(k);
                    let file = match ls.as_slice() {
                        [(_, r)] => match r.bound {
                            Bound::Attachment(a) => att_object(a),
                            _ => None,
                        },
                        _ => None,
                    };
                    match file {
                        Some(obj) if !cover_done => {
                            cover_done = true;
                            push(&mut fm, "cover", FmValue::Link { link: paths.d184(&from, &obj, "") });
                        }
                        _ if ls.iter().any(|(_, r)| r.outcome == LinkOutcome::MissingFile) => {}
                        _ => match rows.attributes.iter_mut().find(|r| r.source_type == tp.row.source_type && r.source_key == *k && matches!(r.change, AttrChange::Dropped { .. })) {
                            Some(AttributeRow { change: AttrChange::Dropped { values }, .. }) => *values += 1,
                            _ => rows.attributes.push(AttributeRow { source_type: tp.row.source_type.clone(), source_key: k.clone(), change: AttrChange::Dropped { values: 1 } }),
                        },
                    }
                }
                (_, Some(Rule::Status(map))) => {
                    let value = v.scalar().unwrap_or_default();
                    if let Some(label) = map.get(&value) {
                        push(&mut fm, "status", FmValue::Text(label.clone()));
                    }
                }
                (_, Some(Rule::Due(deadline))) => {
                    if v.is_null() {
                        continue;
                    }
                    let s = v.scalar().unwrap_or_default();
                    // CP-9 (D-1563): `due` is the deadline's; a `date` beside it is kept as text under the undeclared
                    // key `date-text` (its day, or the value as written when it is no date).
                    if !deadline && lost_key(n, "date", "deadline") {
                        push(&mut fm, "date-text", dates::day(&s, zone).map_or_else(|| text_or_link(relink_text(k, &s)), |date| FmValue::Date { date }));
                        continue;
                    }
                    match dates::day(&s, zone) {
                        Some(day) => push(&mut fm, "due", FmValue::Date { date: day }),
                        None => {
                            unreadable_date(&mut rows, &s);
                            push(&mut fm, "due", FmValue::Text(s));
                        }
                    }
                }
                (_, Some(Rule::DailyDate)) => {
                    if let Some(day) = &days[i] {
                        push(&mut fm, "date", FmValue::Date { date: day.clone() });
                    } else if let Some(s) = v.scalar() {
                        unreadable_date(&mut rows, &s);
                    }
                }
                (_, Some(Rule::Attr(a))) => {
                    let text_kind = !matches!(a.kind, AttrType::Number);
                    match v {
                        Val::Null => {}
                        Val::Nested => push(&mut fm, &a.key, FmValue::AsStored { as_stored: k.clone() }),
                        Val::Bool(b) => push(&mut fm, &a.key, FmValue::Bool(*b)),
                        Val::Num(raw) => push(&mut fm, &a.key, if text_kind && a.kind != AttrType::Checkbox { FmValue::Text(raw.clone()) } else { FmValue::Raw { raw: raw.clone() } }),
                        Val::List(items) => {
                            let items: Vec<String> = items.iter().map(|s| relink(k, s)).collect();
                            let all: Option<Vec<String>> = items.iter().map(|s| whole_link(s)).collect();
                            push(&mut fm, &a.key, match all.filter(|l| !l.is_empty()) {
                                Some(links) => FmValue::Links { links },
                                None => FmValue::List(items),
                            });
                        }
                        Val::Str(s) => {
                            let plain_date = s.trim().len() == 10;
                            let datelike = matches!(a.kind, AttrType::Date | AttrType::DateTime | AttrType::DateRange);
                            let as_fm = |d: DateValue| match d {
                                DateValue::Date(date) => FmValue::Date { date },
                                DateValue::DateTime(datetime) => FmValue::Datetime { datetime },
                                DateValue::Range(..) => FmValue::Text(s.clone()),
                            };
                            match dates::parse(s, zone) {
                                Some(DateValue::Range(start, end)) if a.kind == AttrType::DateRange => {
                                    push(&mut fm, &format!("{}-start", a.key), as_fm(*start));
                                    push(&mut fm, &format!("{}-end", a.key), as_fm(*end));
                                }
                                Some(d) if !matches!(d, DateValue::Range(..)) && (datelike || !plain_date) => push(&mut fm, &a.key, as_fm(d)),
                                parsed => {
                                    if parsed.is_none() && a.datey {
                                        unreadable_date(&mut rows, s);
                                    }
                                    let value = if a.link_select {
                                        let inner = mapping::wikilinks(s).first().map(|(_, inner)| inner.split('|').next().unwrap_or("").trim().to_string()).unwrap_or_else(|| s.trim().to_string());
                                        FmValue::Text(a.kept.get(&fold(&inner)).cloned().unwrap_or(inner))
                                    } else if a.kind == AttrType::Select || a.options.is_some() {
                                        FmValue::Text(a.kept.get(&fold(s.trim())).cloned().unwrap_or_else(|| s.trim().to_string()))
                                    } else if let Some(split) = &a.split {
                                        let mut list = Vec::new();
                                        for item in mapping::split_items(s) {
                                            if item.starts_with("[[") {
                                                list.push(relink(k, &item));
                                                continue;
                                            }
                                            let hit = split.to.as_ref().and_then(|t| by_title.get(item.as_str()).and_then(|hits| hits.iter().copied().find(|x| imported[*x] && notes[*x].ctype.as_deref() == Some(t.as_str()))));
                                            match (hit.and_then(|h| note_path[h].clone()), &split.to) {
                                                (Some(to), _) => list.push(format!("[[{}]]", paths.d184(&from, &to, &item))),
                                                (None, Some(_)) => {
                                                    match rows.attributes.iter_mut().find(|r| r.source_type == tp.row.source_type && r.source_key == *k && matches!(&r.change, AttrChange::SplitUnmatched { value, .. } if *value == item)) {
                                                        Some(AttributeRow { change: AttrChange::SplitUnmatched { objects, .. }, .. }) => *objects += 1,
                                                        _ => rows.attributes.push(AttributeRow { source_type: tp.row.source_type.clone(), source_key: k.clone(), change: AttrChange::SplitUnmatched { value: item.clone(), objects: 1 } }),
                                                    }
                                                    list.push(item);
                                                }
                                                (None, None) => list.push(item),
                                            }
                                        }
                                        FmValue::List(list)
                                    } else {
                                        text_or_link(relink(k, s))
                                    };
                                    push(&mut fm, &a.key, value);
                                }
                            }
                        }
                    }
                }
            }
        }
        let mut tags: Option<Vec<String>> = match n.get("tags") {
            Some(Val::List(items)) => Some(items.clone()),
            Some(Val::Str(s)) => Some(vec![s.clone()]),
            _ => None,
        };
        if tp.stub {
            let t = tags.get_or_insert_with(Vec::new);
            if !t.iter().any(|x| x == "needs-rebuilding") {
                t.push("needs-rebuilding".to_string());
            }
        }
        if let Some(t) = tags {
            fm.push(("tags".into(), FmValue::List(t)));
        }
        fm.push(("import-id".into(), FmValue::Text(o.import_id.clone())));
        if created.is_none() {
            no_created += 1;
        }
        if let Some(t) = created {
            fm.push(("created".into(), FmValue::Datetime { datetime: t }));
        }
        if let Some(t) = modified {
            fm.push(("modified".into(), FmValue::Datetime { datetime: t }));
        }
        o.frontmatter = fm;
        objects.push(o);
    }

    // ---- the report's rows, the effective mapping, the totals
    let type_order: HashMap<&str, usize> = plans.iter().enumerate().map(|(i, p)| (p.row.source_type.as_str(), i)).collect();
    let attr_order = |r: &AttributeRow| {
        let t = type_order.get(r.source_type.as_str()).copied().unwrap_or(usize::MAX);
        let a = plans.get(t).and_then(|p| p.row.attributes.iter().position(|x| x.source_key == r.source_key)).unwrap_or(usize::MAX);
        let c = match r.change {
            AttrChange::Renamed { .. } => 0,
            AttrChange::Dropped { .. } => 1,
            AttrChange::New { .. } => 2,
            AttrChange::NotCreated { .. } => 3,
            AttrChange::SelectValues { .. } => 4,
            AttrChange::ValueNotInOptions { .. } => 5,
            AttrChange::SplitUnmatched { .. } => 6,
            AttrChange::AsStored { .. } => 7,
        };
        (t, a, c)
    };
    rows.attributes.sort_by_key(attr_order);
    report.attributes = rows.attributes;
    report.merged = rows.merged;
    report.dates = rows.dates;
    if no_created > 0 {
        report.dates.push(DateRow::ImportTime { objects: no_created });
    }
    rows.files.sort_by_key(|r| {
        (r.source.clone(), match r.change {
            FileChange::DroppedReference { n, .. } => (0, n),
            FileChange::Unreferenced => (1, 0),
            FileChange::GenericName { .. } => (2, 0),
            FileChange::NameChanged { .. } => (3, 0),
        })
    });
    report.files = rows.files;
    for a in atts.iter() {
        if let Some(reason) = &a.entry_fail {
            report.skipped.push(SkippedRow::Attachment { source: a.source.clone(), reason: reason.clone() });
        }
    }
    report.skipped.extend(source.bad.iter().map(|u| SkippedRow::Entry { entry: u.entry.clone(), reason: u.reason.clone() }));
    report.skipped.extend(other_files.iter().filter(|f| f.kind != OtherKind::UnreadableEntry).map(|f| SkippedRow::Ignored { source: f.source.clone(), kind: f.kind.clone() }));
    report.skipped.extend(plans.iter().filter(|p| p.def.is_none()).map(|p| SkippedRow::Type { source_type: p.row.source_type.clone(), objects: p.row.objects }));
    report.types = plans.iter().map(|p| TypeRow { source_type: p.row.source_type.clone(), objects: p.row.objects, target: p.row.name.clone(), new: p.row.new }).collect();

    let mut effective = Mapping { version: 1, types: BTreeMap::new(), case_links: given.case_links.clone() };
    for p in &plans {
        let g = given.types.get(&p.row.source_type);
        let mut attributes = BTreeMap::new();
        for a in &p.row.attributes {
            let ga = g.and_then(|g| g.attributes.get(&a.source_key));
            let to = match a.action {
                AttrAction::Keep | AttrAction::Rename | AttrAction::Consumed => AttrTarget::Existing { key: a.key.clone().unwrap_or_default() },
                AttrAction::New => AttrTarget::New { name: a.name.clone().unwrap_or_default(), r#type: a.r#type.clone() },
                AttrAction::NotCreated => AttrTarget::New { name: a.source_key.clone(), r#type: None },
                AttrAction::Drop => AttrTarget::Drop,
            };
            attributes.insert(a.source_key.clone(), AttrMapping { to: Some(to), merge: ga.and_then(|x| x.merge.clone()), split: ga.and_then(|x| x.split.clone()), values: ga.map(|x| x.values.clone()).unwrap_or_default() });
        }
        effective.types.insert(p.row.source_type.clone(), TypeMapping { to: Some(p.row.target.clone()), attributes });
    }

    let tally = |total: usize, imported: usize| Tally { total, imported, reported: total - imported };
    let note_objects: Vec<&PlannedObject> = objects.iter().filter(|o| o.kind != ObjectKind::OrphanMedia).collect();
    let totals = Totals {
        objects: tally(note_objects.len(), note_objects.iter().filter(|o| o.outcome == ObjectOutcome::Imported).count()),
        attachments: tally(atts.len(), atts.iter().filter(|a| a.path.is_some()).count()),
        links: tally(links.len(), links.iter().filter(|l| l.outcome.imported()).count()),
        other_files: tally(other_files.len(), 0),
    };
    (report.summary.objects, report.summary.attachments, report.summary.links) = (totals.objects.clone(), totals.attachments.clone(), totals.links.clone());
    let attachments: Vec<PlannedAttachment> = atts
        .iter()
        .map(|a| PlannedAttachment {
            source: a.source.clone(),
            outcome: match &a.entry_fail {
                Some(reason) => AttachmentOutcome::Unreadable { reason: reason.clone() },
                None => AttachmentOutcome::Imported,
            },
            path: a.path.clone(),
            object: a.path.as_ref().map(|_| a.own.map(|o| notes[o].source.clone()).unwrap_or_else(|| a.source.clone())),
            bytes: a.bytes,
            renamed_from_generic: a.generic,
            referenced: a.referenced,
        })
        .collect();

    // ---- space, backup, stamps (§5.1)
    let space_bytes: u64 = entries.iter().map(|(_, e)| e.size).sum();
    let mut needed = (space_bytes * 11).div_ceil(10);
    let extends_type = plans.iter().any(|p| p.def.is_some_and(|d| !defs[d].new) && p.row.attributes.iter().any(|a| a.action == AttrAction::New));
    let mut backup = tinfo.backup.clone();
    if let (Target::Existing(core), None, true) = (target, &backup, extends_type) {
        let vault = core.vault();
        let all: Vec<String> = vault.list_files().unwrap_or_default().into_iter().filter(|p| !p.ends_with(".tegg-tmp") && (p.ends_with(".md") || p.starts_with(".tegg/"))).collect();
        backup = Some(BackupPlan { files: all.len(), bytes: all.iter().filter_map(|p| vault.stat(p).ok().flatten()).map(|(_, s)| s).sum() });
    }
    let free = |p: &std::path::Path| env.disk.free(p).map_err(|e| ImportError::Io { reason: e.to_string() });
    if let Some(b) = &backup {
        let dir = env.dirs.root.join("backups");
        let same = env.disk.volume(&dir).ok() == env.disk.volume(&tinfo.place).ok();
        if same {
            needed += b.bytes;
        } else {
            let f = free(&dir)?;
            if b.bytes > f {
                return Err(ImportError::NoSpace { needed: b.bytes, free: f });
            }
        }
    }
    let f = free(&tinfo.place)?;
    if needed > f {
        return Err(ImportError::NoSpace { needed, free: f });
    }
    let ids: HashSet<&str> = objects.iter().map(|o| o.import_id.as_str()).collect();
    let already_imported = tinfo.import_ids.iter().filter(|id| ids.contains(id.as_str())).count();
    tinfo.type_stamps.sort_by(|a, b| a.path.cmp(&b.path));
    progress.step(note_entries.len())?;
    Ok(Plan {
        version: 1,
        space: space.to_string(),
        source: scan.info.clone(),
        target: tinfo.plan_target,
        mapping: effective,
        types: plans.into_iter().map(|p| p.row).collect(),
        objects,
        attachments,
        other_files,
        links,
        report,
        totals,
        decisions,
        already_imported,
        report_path,
        space_bytes,
        backup,
        needed_bytes: needed,
        stamps: Stamps { source: source.stamp(space), type_files: tinfo.type_stamps },
    })
}

/// Source types whose default is one of D-1527 (6)'s closed targets: they can't become a new type.
fn fixed_closed(source_type: &str) -> bool {
    mapping::fixed_target(source_type).is_some_and(|k| CLOSED_TARGETS.contains(&k)) && matches!(source_type, "Image" | "PDF")
}
