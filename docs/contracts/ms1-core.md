# MS1 Core Interface Contract

- **Status:** draft for MS1 (2026-10-11). The public interfaces of the MS1 core that the acceptance tests use (D-61: tests are written from the ACs and this contract only).
- **Scope:** BRD §11.2 MS1: vault core and file format. Architecture: `docs/architecture.md` §3, §4, §5.3.
- **Packages:** Rust crates `tegg-format` and `tegg-vault` (`crates/`), TypeScript package `@tegg/doc` (`packages/doc/`).

Until a function is implemented it exists as a stub that compiles and returns a deliberately wrong result (an empty value, or `Err(NotImplemented)`), so a test fails on its **assertion**, never on a build error (TS-I1). Tests must not depend on stub behaviour.

---

## 1. Conventions

- **Paths** inside a vault are vault-relative, `/`-separated, NFC (FR-FMT-12), e.g. `Books/Čtení.md`. Absolute paths are `std::path::Path` (Rust) or strings (TS).
- **Note content** crosses every interface as **bytes** (`Vec<u8>` / `Uint8Array`). BOM and CRLF are content (ADR 0001).
- **Time** is injected: functions that need "now" take it as a parameter (`now: DateTime<FixedOffset>` / ISO string), and time zones are parameters, never the process time zone.
- **Ids** are injected through an `IdSource` (Rust) / `newId` callback (TS), so tests are deterministic.

## 2. `tegg-format` (Rust, pure functions, no I/O)

```rust
/// D-51, D-52, D-68, D-80, FR-FMT-08, NFR-POR-02. Title → file stem (no extension):
/// forbidden characters `/ : \ * ? " < > | # ^ [ ]` and control characters → space; spaces collapsed;
/// leading/trailing spaces and dots trimmed; NFC; cut to ≤ 200 UTF-8 bytes at a character boundary;
/// a Windows-reserved stem (CON, PRN, AUX, NUL, COM1–9, LPT1–9, any case) gets "_" appended;
/// an empty result is "Untitled".
pub fn sanitize_file_stem(title: &str) -> String;

/// FR-LNK-14, FR-STO-05: a free name in `taken` (compared case-insensitively and in NFC):
/// "stem.ext", then "stem (2).ext", "stem (3).ext", …
pub fn unique_file_name(stem: &str, ext: &str, taken: &dyn Fn(&str) -> bool) -> String;

/// FR-FMT-09: daily note file name for `date` with a format of tokens YYYY, MM, DD (default "YYYY-MM-DD").
pub fn daily_note_file_name(date: chrono::NaiveDate, format: &str) -> String; // "2026-10-09.md"

/// FR-FMT-12
pub fn nfc(s: &str) -> String;
/// Same object name under Unicode normalization (NFC compare); used for the name-conflict rule.
pub fn same_name(a: &str, b: &str) -> bool;

/// FR-FMT-11: attribute values as written in frontmatter.
pub fn format_date(d: chrono::NaiveDate) -> String;                          // "2026-10-09"
pub fn format_date_time(t: chrono::DateTime<chrono::FixedOffset>) -> String; // "2026-10-09T14:30:00+02:00"
/// Reads a date-only frontmatter value; never shifts the day, whatever `tz` is.
pub fn parse_date(value: &str) -> Option<chrono::NaiveDate>;

/// FR-TYP-15: reserved frontmatter keys.
pub const RESERVED_KEYS: &[&str]; // id, type, title, description, aliases, tags, created, modified,
                                  // source, review, icon, cover, previous, file, import-id, captured
pub fn is_reserved_key(key: &str) -> bool;

/// Read-only extraction (the index's view of a note; equal to `@tegg/doc` `extract`, conformance L3).
pub struct Extracted {
    pub title: String,               // `title:` if set, else the file stem (FR-FMT-08)
    pub id: Option<String>,
    pub r#type: Option<String>,      // None for untyped files (shown as Page, FR-TYP-10)
    pub attributes: Option<serde_json::Value>, // None when there is no or invalid frontmatter
    pub frontmatter_error: Option<FrontmatterError>, // NFR-REL-03; unclosed `---` → line 1 (D-97)
    pub links: Vec<Link>,
    pub tags: Vec<String>,           // tag keys: NFC + lower case, frontmatter first (FR-FMT-10)
}
pub struct FrontmatterError { pub message: String, pub line: usize } // 1-based line in the file
pub struct Link { pub target: String, pub subpath: Option<String>, pub alias: Option<String>,
                  pub embed: bool, pub in_frontmatter: bool }
pub fn extract(bytes: &[u8], stem: &str) -> Extracted;
```

## 3. `tegg-vault` (Rust, all vault I/O)

### 3.1 File system seam (AR-04)

```rust
pub struct FileVersion { pub mtime_ns: i128, pub size: u64, pub hash: [u8; 32] } // BLAKE3 of the bytes
pub enum FsEntry { File { path: String }, Dir { path: String } }

/// All vault file access goes through this trait (AR-04 AC-1).
pub trait VaultFs: Send + Sync {
    fn list(&self) -> io::Result<Vec<FsEntry>>;                  // recursive, vault-relative, NFC
    fn read(&self, path: &str) -> io::Result<(Vec<u8>, FileVersion)>;
    fn version(&self, path: &str) -> io::Result<Option<FileVersion>>; // None = missing
    /// Atomic replace or create: `.<name>.tegg-tmp` in the same folder → fsync → rename (FR-SYN-02).
    fn replace(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion>;
    /// Atomic create that fails with `AlreadyExists` instead of replacing (RENAME_EXCL).
    fn create_new(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion>;
    fn rename_no_replace(&self, from: &str, to: &str) -> io::Result<()>;
    fn create_dir_all(&self, path: &str) -> io::Result<()>;
}
pub struct LocalFs; impl LocalFs { pub fn new(root: &Path) -> LocalFs }
pub struct MemFs;   impl MemFs   { pub fn new() -> MemFs }   // in-memory, for tests (AR-04 AC-2)

/// AR-04 AC-3: remote changes enter through this trait; Phase 1 has a no-op folder adapter.
pub trait SyncAdapter: Send + Sync { fn name(&self) -> &str; }
pub struct FolderSync;
```

### 3.2 Vault

```rust
pub struct AppDirs { pub root: PathBuf }        // ~/Library/Application Support/Tegg, injected (FR-STO-07)
pub enum VaultKind { Empty }                    // Starter: MS3 (D-92)
pub enum OpenError { NotATeggVault, Missing, Io(io::Error), NotImplemented }
pub enum CreateError { NotEmpty, Io(io::Error), NotImplemented }

pub struct Vault { /* … */ }
impl Vault {
    /// FR-VLT-01 AC-2, FR-VLT-02 AC-1: creates `<parent>/<sanitized name>/` with `.tegg/vault.yml`
    /// and one `.tegg/types/<type>.yml` per system type (D-89, D-90). Nothing else.
    pub fn create(parent: &Path, name: &str, kind: VaultKind, dirs: &AppDirs) -> Result<Vault, CreateError>;
    /// FR-VLT-01 AC-4/AC-5: zero writes; a folder without `.tegg/vault.yml` → `NotATeggVault` (D-91).
    pub fn open(root: &Path, dirs: &AppDirs) -> Result<Vault, OpenError>;
    pub fn open_with(fs: Box<dyn VaultFs>, dirs: &AppDirs) -> Result<Vault, OpenError>; // any VaultFs
    pub fn root(&self) -> &Path;

    /// FR-VLT-01 AC-7, D-98: the remembered vault path (stored under `dirs` by `create` and `open`)
    /// and whether that folder still exists, so the app can name a missing vault.
    pub fn last_opened(dirs: &AppDirs) -> Option<(PathBuf, bool)>;

    pub fn read(&self, path: &str) -> Result<(Vec<u8>, FileVersion), VaultError>;

    /// §5.3, the one write function. Unchanged bytes → `Unchanged`, nothing written (FR-SYN-06).
    /// Disk differs from `base` → `Conflict` (FR-SYN-03 AC-7); file gone while `base` is Some → `Gone`.
    pub fn write(&self, path: &str, bytes: &[u8], base: Option<&FileVersion>) -> Result<WriteOutcome, VaultError>;

    /// New file with a free name in `dir` (FR-LNK-14, FR-STO-05 AC-3): returns the path it got.
    pub fn create_file(&self, dir: &str, stem: &str, ext: &str, bytes: &[u8]) -> Result<(String, FileVersion), VaultError>;

    /// FR-STO-08, FR-STO-01 AC-5: move to `.trash/<same relative path>` (suffix if taken); restore back
    /// to the original path, or with a suffix if that is taken. Returns the new path.
    pub fn trash(&self, path: &str) -> Result<String, VaultError>;
    pub fn restore(&self, trashed: &str) -> Result<String, VaultError>;

    /// FR-SYN-02 AC-4: deletes `.tegg-tmp` files older than 1 minute; returns how many.
    pub fn clean_temp_files(&self, now: SystemTime) -> Result<usize, VaultError>;

    /// FR-STO-09, FR-STO-01 AC-6: files the app manages (Markdown + recognized attachments + `.tegg/`);
    /// everything else (`.docx`, `.obsidian/`, `.git/`) is never listed for modification.
    pub fn managed_files(&self) -> Result<Vec<String>, VaultError>;

    /// FR-STO-07: machine-local directory for this vault, under `dirs.root/vaults/<vault-key>/`.
    pub fn local_dir(&self) -> PathBuf;
}
pub enum WriteOutcome { Unchanged, Written(FileVersion) }
pub enum VaultError { Conflict { disk: FileVersion }, Gone, NotFound, NameTaken, Io(io::Error), NotImplemented }

pub const SYSTEM_TYPES: &[&str] = &["Page", "Task", "Quick Note", "Daily Note", "Tag", "Image", "PDF"]; // D-89
```

**Type definition file** (`.tegg/types/<file>.yml`, FR-STO-06, D-90): exact content of a new vault is the approved fixture `tests/fixtures/vaults/new-empty/` (D-99). YAML with at least `name`, `plural`, `folder`, `system: true|false`, `version` (AR-07), `attributes: []`. File names are the sanitized type name, lower case, spaces as `-` (`quick-note.yml`). Default folders: Page → `Pages`, Task → `Tasks`, Quick Note → `Quick Notes`, Daily Note → `Daily`, Tag → `Tags`, Image → `Images`, PDF → `PDFs` (BRD §5.1).

**`vault.yml`** (FR-STO-06): YAML with at least `version`, `default-type: Quick Note` (D-24, FR-VLT-05), `attachments: _attachments`, `daily-format: YYYY-MM-DD`.

**Write log for tests:** none. Tests detect writes through file modification times, inodes and `MemFs` contents.

## 4. `@tegg/doc` (TypeScript, pure, no DOM, no I/O)

```ts
export type Range = readonly [start: number, end: number]
export type BlockKind = 'paragraph' | 'heading' | 'list' | 'checklist' | 'quote' | 'callout'
  | 'code' | 'mindmap' | 'query' | 'divider' | 'table' | 'embed' | 'raw'
export interface Block { kind: BlockKind; range: Range; raw: string }
export interface FrontmatterEntry { key: string; range: Range }
export interface Frontmatter {
  range: Range; innerRange: Range
  data: Record<string, unknown> | null          // null when the YAML is invalid
  entries: FrontmatterEntry[]
  error: { message: string; line: number } | null // NFR-REL-03, 1-based line in the file
}
export interface Doc {
  text: string; bom: boolean; eol: '\n' | '\r\n'; finalNewline: boolean
  frontmatter: Frontmatter | null; bodyStart: number; blocks: Block[]
  /** D-97: set when an opening `---` is never closed (then `frontmatter` is null and the file is body):
   *  { message: 'frontmatter not closed', line: 1 }. Errors inside closed frontmatter are in `frontmatter.error`. */
  frontmatterError: { message: string; line: number } | null
}

export function decode(bytes: Uint8Array): string   // UTF-8, keeps a BOM as U+FEFF
export function encode(text: string): Uint8Array
export function parse(text: string): Doc
export function serialize(doc: Doc): string          // === doc.text, always (FR-FMT-07)

// Edits return the new file text; nothing outside the patched range changes (ADR 0001).
export function editBlock(doc: Doc, index: number, markdown: string): string
export type Value = string | number | boolean | null
  | { date: string } | { datetime: string } | { link: string } | Value[]
export function setAttribute(doc: Doc, key: string, value: Value): string
export function setDateRange(doc: Doc, key: string, start: string, end: string): string // <key>-start / -end
export function removeAttribute(doc: Doc, key: string): string
export function renameLinkTarget(doc: Doc, from: string, to: string): string

export interface WikiLink { embed: boolean; range: Range; target: string; subpath: string | null
  alias: string | null; escapedPipe: boolean; inFrontmatter: boolean }
export function wikilinks(doc: Doc): WikiLink[]
export interface Tag { name: string; key: string; range: Range | null }
export function tags(doc: Doc): Tag[]
export const tagKey: (name: string) => string        // NFC + lower case

/** FR-FMT-02 AC-1, D-96: a new note's text: frontmatter keys `id, type, title, <attributes in the given
 *  order>, created, modified` (`title` always; `type` lower case with spaces as `-`: 'Quick Note' →
 *  `quick-note`), then the body. Canonical dialect style. */
export function newNote(opts: { type: string; title: string; attributes?: [string, Value][]
  body?: string; now: string; newId: () => string }): string

/** FR-FMT-02 AC-3, D-54: first edit of an untyped file adds `id` and `type: page` (and nothing else). */
export function ensureIdentity(doc: Doc, opts: { now: string; newId: () => string }): string

/** FR-FMT-02 AC-4, D-55: sets `modified` only when `before` and `after` differ in content or attributes. */
export function touchModified(before: string, after: string, now: string): string

export interface Extracted { title: string; id: string | null; type: string | null
  attributes: Record<string, unknown> | null; frontmatterError: boolean
  links: { target: string; subpath: string | null; alias: string | null; embed: boolean; inFrontmatter: boolean }[]
  tags: string[] }
export function extract(text: string, stem: string): Extracted
```

## 5. Test placement

- Rust AC tests: `crates/<crate>/tests/ac_<area>.rs`; TypeScript AC tests: `packages/doc/test/<area>.ac.test.ts` (Vitest).
- Shared fixtures: `tests/fixtures/` (round-trip corpus exists; vault fixtures go to `tests/fixtures/vaults/`).
- Red runs: `./verify check-red <commit>` uses the `acRunners` in `qa.config.json`.
