//! The index: a disposable SQLite cache of what the vault's files say (AR-01, NFR-POR-03).
//! Rebuilding from scratch and updating incrementally must give the same state (S4-QA AC-5).

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use rayon::prelude::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::extract::{extract, nfc, Extracted};
use crate::switcher::Switcher;

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

/// Folders that aren't objects or aren't searched (FR-STO: templates, trash, settings).
const SKIP_DIRS: &[&str] = &[".tegg", ".trash", ".git", ".obsidian", "_templates", "_attachments"];

pub struct Index {
    pub conn: Connection,
    pub vault: PathBuf,
    pub switcher: Switcher,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Hit {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

/// Vault-relative path with `/`, NFC (FR-FMT-12).
pub fn rel(vault: &Path, p: &Path) -> Option<String> {
    Some(nfc(&p.strip_prefix(vault).ok()?.to_string_lossy()))
}

pub fn is_note(vault: &Path, p: &Path) -> bool {
    p.extension().is_some_and(|e| e == "md")
        && p.strip_prefix(vault).is_ok_and(|r| {
            !r.components().any(|c| {
                let s = c.as_os_str().to_string_lossy();
                SKIP_DIRS.contains(&s.as_ref()) || (s.starts_with('.') && s.len() > 1 && !s.ends_with(".md"))
            })
        })
}

pub fn walk_notes(vault: &Path) -> Vec<PathBuf> {
    fn go(vault: &Path, dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(rd) = fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name();
            let name = name.to_string_lossy();
            match e.file_type() {
                Ok(t) if t.is_dir() => {
                    if !SKIP_DIRS.contains(&name.as_ref()) && !name.starts_with('.') {
                        go(vault, &p, out)
                    }
                }
                Ok(t) if t.is_file() && is_note(vault, &p) => out.push(p),
                _ => {}
            }
        }
    }
    let mut out = Vec::new();
    go(vault, vault, &mut out);
    out.sort();
    out
}

struct Parsed {
    rel: String,
    mtime: i64,
    size: i64,
    x: Extracted,
}

fn read_note(vault: &Path, p: &Path) -> Option<Parsed> {
    let meta = fs::metadata(p).ok()?;
    let bytes = fs::read(p).ok()?;
    // Invalid UTF-8 is indexed lossily; the file itself is never touched.
    let text = String::from_utf8(bytes).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned());
    let stem = p.file_stem()?.to_string_lossy();
    Some(Parsed {
        rel: rel(vault, p)?,
        mtime: meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_nanos() as i64,
        size: meta.len() as i64,
        x: extract(&text, &stem),
    })
}

/// Lower case, NFC, trimmed: the key links match on (dialect §6, FR-FMT-12).
pub fn name_key(s: &str) -> String {
    nfc(s.trim()).to_lowercase()
}

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = OFF;
CREATE TABLE IF NOT EXISTS notes (
  rowid INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name_key TEXT NOT NULL,
  id TEXT, type TEXT, title TEXT NOT NULL, created TEXT,
  attrs TEXT, fm_error INTEGER NOT NULL,
  mtime INTEGER NOT NULL, size INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_type ON notes(type, created);
CREATE INDEX IF NOT EXISTS notes_name ON notes(name_key);
CREATE INDEX IF NOT EXISTS notes_id ON notes(id);
CREATE TABLE IF NOT EXISTS attrs (note INTEGER NOT NULL, key TEXT NOT NULL, value TEXT, num REAL);
CREATE INDEX IF NOT EXISTS attrs_note ON attrs(note);
CREATE INDEX IF NOT EXISTS attrs_kv ON attrs(key, value);
CREATE TABLE IF NOT EXISTS links (note INTEGER NOT NULL, target_key TEXT NOT NULL, target TEXT NOT NULL,
  subpath TEXT, alias TEXT, embed INTEGER NOT NULL, in_fm INTEGER NOT NULL, ord INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS links_note ON links(note);
CREATE INDEX IF NOT EXISTS links_target ON links(target_key);
CREATE TABLE IF NOT EXISTS tags (note INTEGER NOT NULL, key TEXT NOT NULL, ord INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS tags_note ON tags(note);
CREATE INDEX IF NOT EXISTS tags_key ON tags(key);
-- Diacritics-insensitive full text (Czech: "caj" finds "čaj"), prefix indexes for type-ahead.
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(title, body, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3');
"#;

impl Index {
    /// Opens (or creates) the index database at `db` for `vault`. Nothing is written to the vault.
    pub fn open(vault: &Path, db: &Path) -> Result<Self> {
        let conn = Connection::open(db)?;
        conn.execute_batch(SCHEMA)?;
        let mut ix = Index { conn, vault: vault.to_path_buf(), switcher: Switcher::default() };
        ix.load_switcher()?;
        Ok(ix)
    }

    fn load_switcher(&mut self) -> Result<()> {
        let mut st = self.conn.prepare("SELECT path, title, attrs FROM notes")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?)))?;
        let mut sw = Switcher::default();
        for row in rows {
            let (path, title, attrs) = row?;
            sw.upsert(&path, &title, &aliases_of(attrs.as_deref()));
        }
        self.switcher = sw;
        Ok(())
    }

    /// Full rebuild from the files (NFR-PERF-02). Parsing is parallel; writing is one transaction.
    pub fn rebuild(&mut self) -> Result<usize> {
        let files = walk_notes(&self.vault);
        let vault = self.vault.clone();
        let parsed: Vec<Parsed> = files.par_iter().filter_map(|p| read_note(&vault, p)).collect();
        let tx = self.conn.transaction()?;
        tx.execute_batch("DELETE FROM notes; DELETE FROM attrs; DELETE FROM links; DELETE FROM tags; DELETE FROM fts;")?;
        for p in &parsed {
            insert(&tx, p)?;
        }
        tx.commit()?;
        self.load_switcher()?;
        Ok(parsed.len())
    }

    /// Re-index one file after a change: create, edit, delete (gone) or one side of a rename.
    pub fn update_path(&mut self, abs: &Path) -> Result<()> {
        let Some(rel) = rel(&self.vault, abs) else { return Ok(()) };
        if abs.is_dir() {
            // A folder changed (created, renamed into place, or replaced by a new folder of the
            // same name): reconcile both ways, dropping what's gone and indexing what's there.
            self.remove_prefix(abs)?;
            for p in walk_notes(abs) {
                self.update_path(&p)?;
            }
            return Ok(());
        }
        if !is_note(&self.vault, abs) {
            return Ok(());
        }
        let parsed = if abs.is_file() { read_note(&self.vault, abs) } else { None };
        let tx = self.conn.transaction()?;
        delete(&tx, &rel)?;
        if let Some(p) = &parsed {
            insert(&tx, p)?;
        }
        tx.commit()?;
        match parsed {
            Some(p) => self.switcher.upsert(&p.rel, &p.x.title, &aliases_of_map(p.x.attributes.as_ref())),
            None => self.switcher.remove(&rel),
        }
        Ok(())
    }

    /// Removes every note under a vanished folder (a folder renamed away or deleted).
    pub fn remove_prefix(&mut self, abs: &Path) -> Result<()> {
        let Some(rel) = rel(&self.vault, abs) else { return Ok(()) };
        let prefix = format!("{rel}/");
        let paths: Vec<String> = {
            let mut st = self.conn.prepare("SELECT path FROM notes WHERE substr(path, 1, ?2) = ?1")?;
            let v = st.query_map(params![prefix, prefix.chars().count() as i64], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
            v
        };
        for p in paths {
            self.update_path(&self.vault.join(&p))?;
        }
        Ok(())
    }

    /// Catch up with changes made while the app was closed (NFR-PERF-02/AC-2): compares
    /// (mtime, size) with the files and re-indexes only what differs. Returns files touched.
    pub fn sync(&mut self) -> Result<usize> {
        let known: BTreeMap<String, (i64, i64)> = {
            let mut st = self.conn.prepare("SELECT path, mtime, size FROM notes")?;
            let v = st.query_map([], |r| Ok((r.get(0)?, (r.get(1)?, r.get(2)?))))?.collect::<rusqlite::Result<_>>()?;
            v
        };
        let mut seen = BTreeSet::new();
        let mut changed = Vec::new();
        for p in walk_notes(&self.vault) {
            let Some(r) = rel(&self.vault, &p) else { continue };
            let Ok(m) = fs::metadata(&p) else { continue };
            let stat = (
                m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos() as i64),
                m.len() as i64,
            );
            if known.get(&r) != Some(&stat) {
                changed.push(p);
            }
            seen.insert(r);
        }
        let gone: Vec<PathBuf> = known.keys().filter(|k| !seen.contains(*k)).map(|k| self.vault.join(k)).collect();
        let vault = self.vault.clone();
        let parsed: Vec<Parsed> = changed.par_iter().filter_map(|p| read_note(&vault, p)).collect();
        let tx = self.conn.transaction()?;
        for p in &parsed {
            delete(&tx, &p.rel)?;
            insert(&tx, p)?;
        }
        for g in &gone {
            delete(&tx, &rel(&self.vault, g).unwrap())?;
        }
        tx.commit()?;
        if !(parsed.is_empty() && gone.is_empty()) {
            self.load_switcher()?;
        }
        Ok(parsed.len() + gone.len())
    }

    /// Full-text search (NFR-PERF-04): first 50 hits with snippets, best first; optional type filter.
    /// Words are prefix-matched and ANDed; `"quoted text"` is a phrase.
    pub fn search(&self, query: &str, type_filter: Option<&str>) -> Result<Vec<Hit>> {
        let q = fts_query(query);
        if q.is_empty() {
            return Ok(vec![]);
        }
        let sql = "SELECT n.path, n.title, snippet(fts, 1, '[', ']', '…', 12) FROM fts JOIN notes n ON n.rowid = fts.rowid \
                   WHERE fts MATCH ?1 AND (?2 IS NULL OR n.type = ?2) ORDER BY bm25(fts, 5.0, 1.0) LIMIT 50";
        let mut st = self.conn.prepare_cached(sql)?;
        let rows = st.query_map(params![q, type_filter], |r| Ok(Hit { path: r.get(0)?, title: r.get(1)?, snippet: r.get(2)? }))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// A query view (NFR-PERF-07, core part): up to `limit` objects of the given types, newest
    /// first, with all attributes for the table columns.
    pub fn query_view(&self, types: &[&str], limit: usize) -> Result<Vec<(String, String, Option<String>)>> {
        let placeholders = vec!["?"; types.len()].join(",");
        let sql = format!("SELECT path, title, attrs FROM notes WHERE type IN ({placeholders}) ORDER BY created DESC, path LIMIT {limit}");
        let mut st = self.conn.prepare_cached(&sql)?;
        let rows = st.query_map(rusqlite::params_from_iter(types), |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Backlinks: notes linking to `target` by file name (FR-LNK).
    pub fn backlinks(&self, target_name: &str) -> Result<Vec<String>> {
        let mut st = self.conn.prepare_cached(
            "SELECT DISTINCT n.path FROM links l JOIN notes n ON n.rowid = l.note WHERE l.target_key = ?1 ORDER BY n.path",
        )?;
        let rows = st.query_map([name_key(target_name)], |r| r.get(0))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn title_of(&self, rel: &str) -> Result<Option<String>> {
        Ok(self.conn.query_row("SELECT title FROM notes WHERE path = ?1", [rel], |r| r.get(0)).optional()?)
    }

    pub fn count(&self) -> Result<i64> {
        Ok(self.conn.query_row("SELECT count(*) FROM notes", [], |r| r.get(0))?)
    }

    /// Everything the index knows, in a canonical text form (row ids excluded), for comparing
    /// a rebuilt index with an incrementally updated one (S4-QA AC-5).
    pub fn dump(&self) -> Result<String> {
        let mut out = String::new();
        let mut q = |sql: &str| -> Result<()> {
            let mut st = self.conn.prepare(sql)?;
            let n = st.column_count();
            let mut rows = st.query([])?;
            while let Some(r) = rows.next()? {
                let cols: Vec<String> = (0..n)
                    .map(|i| match r.get_ref(i).unwrap() {
                        rusqlite::types::ValueRef::Text(t) => format!("{:?}", String::from_utf8_lossy(t)),
                        v => format!("{v:?}"),
                    })
                    .collect();
                out.push_str(&cols.join("\t"));
                out.push('\n');
            }
            out.push_str("--\n");
            Ok(())
        };
        q("SELECT path, name_key, id, type, title, created, attrs, fm_error, size FROM notes ORDER BY path")?;
        q("SELECT n.path, a.key, a.value, a.num FROM attrs a JOIN notes n ON n.rowid = a.note ORDER BY n.path, a.key")?;
        q("SELECT n.path, l.ord, l.target_key, l.target, l.subpath, l.alias, l.embed, l.in_fm FROM links l JOIN notes n ON n.rowid = l.note ORDER BY n.path, l.ord")?;
        q("SELECT n.path, t.ord, t.key FROM tags t JOIN notes n ON n.rowid = t.note ORDER BY n.path, t.ord")?;
        q("SELECT n.path, f.title, f.body FROM fts f JOIN notes n ON n.rowid = f.rowid ORDER BY n.path")?;
        q("SELECT count(*) FROM fts")?;
        out.push_str(&format!("{:?}\n", self.switcher.entries()));
        Ok(out)
    }

    /// FTS5's own consistency check.
    pub fn fts_integrity(&self) -> Result<()> {
        self.conn.execute("INSERT INTO fts(fts) VALUES('integrity-check')", [])?;
        Ok(())
    }
}

fn aliases_of(attrs: Option<&str>) -> Vec<String> {
    let v: Option<serde_json::Map<String, Value>> = attrs.and_then(|a| serde_json::from_str(a).ok());
    aliases_of_map(v.as_ref())
}

fn aliases_of_map(attrs: Option<&serde_json::Map<String, Value>>) -> Vec<String> {
    match attrs.and_then(|a| a.get("aliases")) {
        Some(Value::Array(a)) => a.iter().filter_map(|v| v.as_str().map(String::from)).collect(),
        Some(Value::String(s)) => vec![s.clone()],
        _ => vec![],
    }
}

fn delete(tx: &rusqlite::Transaction, rel: &str) -> Result<()> {
    let id: Option<i64> = tx.query_row("SELECT rowid FROM notes WHERE path = ?1", [rel], |r| r.get(0)).optional()?;
    if let Some(id) = id {
        tx.execute("DELETE FROM notes WHERE rowid = ?1", [id])?;
        tx.execute("DELETE FROM attrs WHERE note = ?1", [id])?;
        tx.execute("DELETE FROM links WHERE note = ?1", [id])?;
        tx.execute("DELETE FROM tags WHERE note = ?1", [id])?;
        tx.execute("DELETE FROM fts WHERE rowid = ?1", [id])?;
    }
    Ok(())
}

fn insert(tx: &rusqlite::Transaction, p: &Parsed) -> Result<()> {
    let x = &p.x;
    let stem = p.rel.rsplit('/').next().unwrap_or(&p.rel).trim_end_matches(".md");
    let created = x.attributes.as_ref().and_then(|a| a.get("created")).and_then(|v| v.as_str()).map(String::from);
    let attrs = x.attributes.as_ref().map(|a| serde_json::to_string(a).unwrap());
    tx.prepare_cached(
        "INSERT INTO notes (path, name_key, id, type, title, created, attrs, fm_error, mtime, size) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
    )?
    .execute(params![p.rel, name_key(stem), x.id, x.kind, x.title, created, attrs, x.frontmatter_error as i64, p.mtime, p.size])?;
    let id = tx.last_insert_rowid();
    if let Some(a) = &x.attributes {
        let mut st = tx.prepare_cached("INSERT INTO attrs (note, key, value, num) VALUES (?1,?2,?3,?4)")?;
        for (k, v) in a {
            let (text, num) = match v {
                Value::String(s) => (Some(s.clone()), None),
                Value::Number(n) => (Some(n.to_string()), n.as_f64()),
                Value::Null => (None, None),
                other => (Some(other.to_string()), None),
            };
            st.execute(params![id, k, text, num])?;
        }
    }
    let mut st = tx.prepare_cached("INSERT INTO links (note, target_key, target, subpath, alias, embed, in_fm, ord) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)")?;
    for (i, l) in x.links.iter().enumerate() {
        let key = name_key(l.target.trim_end_matches(".md"));
        st.execute(params![id, key, l.target, l.subpath, l.alias, l.embed as i64, l.in_frontmatter as i64, i as i64])?;
    }
    let mut st = tx.prepare_cached("INSERT INTO tags (note, key, ord) VALUES (?1,?2,?3)")?;
    for (i, t) in x.tags.iter().enumerate() {
        st.execute(params![id, t, i as i64])?;
    }
    tx.prepare_cached("INSERT INTO fts (rowid, title, body) VALUES (?1,?2,?3)")?.execute(params![id, x.title, x.body])?;
    Ok(())
}

/// User text → FTS5 query: quoted parts are phrases, other words become prefix terms; all ANDed.
pub fn fts_query(q: &str) -> String {
    let mut parts = Vec::new();
    for (i, chunk) in q.split('"').enumerate() {
        if i % 2 == 1 {
            let words: Vec<&str> = chunk.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
            if !words.is_empty() {
                parts.push(format!("\"{}\"", words.join(" ")));
            }
        } else {
            for w in chunk.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()) {
                parts.push(format!("\"{w}\"*"));
            }
        }
    }
    parts.join(" AND ")
}
