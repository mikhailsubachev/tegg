//! The import journal (v1-import §9.6, D-1523, FR-IMP-03 AC-5): a write-ahead log of an import into an existing vault,
//! next to the rename journals (`<app>/jobs/<vault key>/<job>.json` and `<job>.log`), and the one roll-back procedure
//! that reads only that log: after a failure in `writing`, in the same process, and for `Undo` after a kill.
//!
//! **The rule (T1).** The roll-back removes a file only when the log *knows* the run created it (a `K` line, or a `T`
//! line whose file id is the id of the file now at the path) **and** the file still has the size and hash of its `C`
//! line. Equal bytes are never the proof. A path with an `N` line, or with no `T` line, is never touched. Nothing in
//! `.trash/` is looked at.
//!
//! Every line is appended with `Host::local_append` and is on disk (synced) before the function returns.

use std::io;
use std::path::PathBuf;

use serde_json::{json, Value};
use tegg_format::nfc;

use crate::host::{Host, WriteError, Wrote};
use crate::{FileVersion, Interrupted, JobId};

/// The header's `kind` and `Interrupted::kind`.
pub const KIND: &str = "import";

/// The tag of the run's temp files: `<folder>/.<file name>.i<job>.tegg-tmp` (§9.4).
pub fn temp_tag(job: JobId) -> String {
    format!("i{job}")
}

fn journal_dir(host: &dyn Host) -> PathBuf {
    host.app_dir().join("jobs").join(host.vault_key())
}
fn header_path(host: &dyn Host, job: JobId) -> PathBuf {
    journal_dir(host).join(format!("{job}.json"))
}
fn log_path(host: &dyn Host, job: JobId) -> PathBuf {
    journal_dir(host).join(format!("{job}.log"))
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
/// Strict: an odd length or a character that isn't a hex digit is no value at all.
fn unhex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    (0..s.len() / 2).map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).ok()).collect()
}
fn unhex32(s: &str) -> Option<[u8; 32]> {
    unhex(s)?.try_into().ok()
}

/// The header, written when `writing` starts and before the first vault write: `{ job, kind: "import", title: <space>,
/// source: <source name>, total: <files to create>, backup: <zip name> | null }`.
pub fn begin(host: &dyn Host, job: JobId, title: &str, source: &str, total: usize, backup: Option<&str>) -> io::Result<()> {
    let v = json!({ "job": job, "kind": KIND, "title": title, "source": source, "total": total, "backup": backup });
    host.local_write(&header_path(host, job), v.to_string().as_bytes())
}

/// One synced line. A field with a tab or a line break can't be logged: the caller's create then fails before it
/// touches the vault, instead of leaving a file the log can't name.
fn append(host: &dyn Host, job: JobId, fields: &[&str]) -> io::Result<()> {
    if fields.iter().any(|f| f.contains(['\t', '\n', '\r'])) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "a journal field holds a tab or a line break"));
    }
    host.local_append(&log_path(host, job), fields.join("\t").as_bytes())
}

/// `D`: before creating the folder `dir`, which doesn't exist: the run created it.
pub fn dir(host: &dyn Host, job: JobId, dir: &str) -> io::Result<()> {
    append(host, job, &["D", &nfc(dir.trim_matches('/'))])
}

/// `C`: the intent, before the temp file exists: the run may create `path` with exactly these bytes.
pub fn intent(host: &dyn Host, job: JobId, path: &str, size: u64, hash: &[u8; 32]) -> io::Result<()> {
    append(host, job, &["C", &nfc(path), &size.to_string(), &hex(hash)])
}

/// `T`: the temp file is complete and synced; `file_id` is what will be at `path` if the rename happens.
pub fn temp(host: &dyn Host, job: JobId, path: &str, file_id: u64) -> io::Result<()> {
    append(host, job, &["T", &nfc(path), &file_id.to_string()])
}

/// `K`: the no-replace rename succeeded: **the run created `path`**.
pub fn created(host: &dyn Host, job: JobId, path: &str) -> io::Result<()> {
    append(host, job, &["K", &nfc(path)])
}

/// `N`: the create failed and its temp file was removed: nothing at `path` is the run's.
pub fn not_created(host: &dyn Host, job: JobId, path: &str) -> io::Result<()> {
    append(host, job, &["N", &nfc(path)])
}

/// `R`: before replacing an extended type file: `post` is the version the run writes, `pre` / `pre_bytes` the file as
/// it is now (restored when the file is still the post version).
pub fn replace_intent(host: &dyn Host, job: JobId, path: &str, post: &FileVersion, pre: &FileVersion, pre_bytes: &[u8]) -> io::Result<()> {
    append(host, job, &["R", &nfc(path), &post.size.to_string(), &hex(&post.hash), &pre.size.to_string(), &hex(&pre.hash), &hex(pre_bytes)])
}

/// Removes both journal files (after a roll-back, and when an import finished). The backup zip stays.
pub fn finish(host: &dyn Host, job: JobId) {
    host.local_remove(&header_path(host, job));
    host.local_remove(&log_path(host, job));
}

// ------------------------------------------------------------------------------------------------ reading the log

#[derive(Debug, Clone, PartialEq, Eq)]
struct Create {
    path: String,
    size: u64,
    hash: [u8; 32],
    /// The `T` line's file id.
    temp_id: Option<u64>,
    /// A `K` line.
    created: bool,
    /// An `N` line.
    not_created: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Step {
    Dir(String),
    Create(Create),
    Replace { path: String, post: FileVersion, pre: FileVersion, pre_bytes: Vec<u8> },
}

/// The log's steps in the order they were written. Only whole lines count (a line a kill cut short has no line break
/// and is dropped), and a line that doesn't have exactly the form this module writes is ignored: a line that can't be
/// read proves nothing, so nothing is removed or restored because of it.
fn parse(log: &str) -> Vec<Step> {
    let mut steps: Vec<Step> = Vec::new();
    let Some((whole, _torn)) = log.rsplit_once('\n') else { return steps };
    for line in whole.split('\n') {
        let f: Vec<&str> = line.split('\t').collect();
        let last = |steps: &mut Vec<Step>, path: &str| -> Option<usize> {
            steps.iter().rposition(|s| matches!(s, Step::Create(c) if c.path == path))
        };
        match f.as_slice() {
            ["D", dir] if !dir.is_empty() => steps.push(Step::Dir(dir.to_string())),
            ["C", path, size, hash] if !path.is_empty() => {
                if let (Ok(size), Some(hash)) = (size.parse::<u64>(), unhex32(hash)) {
                    steps.push(Step::Create(Create { path: path.to_string(), size, hash, temp_id: None, created: false, not_created: false }));
                }
            }
            ["T", path, id] => {
                if let (Some(i), Ok(id)) = (last(&mut steps, path), id.parse::<u64>()) {
                    if let Step::Create(c) = &mut steps[i] {
                        c.temp_id = Some(id);
                    }
                }
            }
            ["K", path] => {
                if let Some(i) = last(&mut steps, path) {
                    if let Step::Create(c) = &mut steps[i] {
                        c.created = true;
                    }
                }
            }
            ["N", path] => {
                if let Some(i) = last(&mut steps, path) {
                    if let Step::Create(c) = &mut steps[i] {
                        c.not_created = true;
                    }
                }
            }
            ["R", path, post_size, post_hash, pre_size, pre_hash, pre_hex] if !path.is_empty() => {
                if let (Ok(ps), Some(ph), Ok(qs), Some(qh), Some(bytes)) = (post_size.parse::<u64>(), unhex32(post_hash), pre_size.parse::<u64>(), unhex32(pre_hash), unhex(pre_hex)) {
                    let pre = FileVersion { mtime_ns: 0, size: qs, hash: qh };
                    // The bytes to restore must be the bytes the line says they are.
                    if FileVersion::of(&bytes).same_content(&pre) {
                        steps.push(Step::Replace { path: path.to_string(), post: FileVersion { mtime_ns: 0, size: ps, hash: ph }, pre, pre_bytes: bytes });
                    }
                }
            }
            _ => {}
        }
    }
    steps
}

fn header(host: &dyn Host, job: JobId) -> Option<Value> {
    let v: Value = serde_json::from_slice(&host.local_read(&header_path(host, job))?).ok()?;
    (v["kind"].as_str() == Some(KIND)).then_some(v)
}

fn steps(host: &dyn Host, job: JobId) -> Vec<Step> {
    parse(&String::from_utf8_lossy(&host.local_read(&log_path(host, job)).unwrap_or_default()))
}

/// Whether `job` has an import journal on disk.
pub fn exists(host: &dyn Host, job: JobId) -> bool {
    header(host, job).is_some()
}

/// The import journals a kill left behind (§9.6): `kind: "import"`, `title` the space, `from` the source's name, `to`
/// empty, `done` the number of `K` lines, `total` the header's.
pub fn interrupted(host: &dyn Host) -> Vec<Interrupted> {
    let mut out: Vec<Interrupted> = host
        .local_list(&journal_dir(host))
        .into_iter()
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .filter_map(|p| p.file_stem()?.to_str()?.parse::<JobId>().ok())
        .filter_map(|job| {
            let h = header(host, job)?;
            let done = steps(host, job).iter().filter(|s| matches!(s, Step::Create(c) if c.created)).count();
            Some(Interrupted {
                job,
                kind: KIND.to_string(),
                title: h["title"].as_str().map(str::to_string),
                from: h["source"].as_str().unwrap_or_default().to_string(),
                to: String::new(),
                done,
                total: h["total"].as_u64().unwrap_or(0) as usize,
            })
        })
        .collect();
    out.sort_by_key(|i| i.job);
    out
}

// ------------------------------------------------------------------------------------------------ roll-back

/// §9.6: the roll-back, from the log alone, walking it backwards. Returns the `kept` paths in the order the run wrote
/// them: files of the run (and the extended type file) left in place because they are no longer what the run wrote.
/// Removes the run's temp files and the folders it created that are empty again. Does **not** remove the journal
/// (call [`finish`]).
pub fn roll_back(host: &dyn Host, job: JobId) -> Vec<String> {
    let tag = temp_tag(job);
    let mut kept: Vec<String> = Vec::new();
    let mut types_changed = false;
    let is_type_file = |p: &str| p.starts_with(".tegg/types/");
    for step in steps(host, job).iter().rev() {
        match step {
            Step::Create(c) => {
                // In every case of a `C` line the run's own temp file goes (its name is unique to the run).
                host.remove_temp(&c.path, Some(&tag));
                // `N`: nothing at the path is the run's, whatever is there (a file that arrived is never rolled back).
                if c.not_created {
                    continue;
                }
                // `K`: the run created it. `T` only: the run's file only if the file there has the logged file id (a
                // rename keeps it). Neither: the temp file was never complete; the path is not touched.
                let ours = c.created || c.temp_id.is_some_and(|id| host.file_id(&c.path) == Some(id));
                if !ours {
                    continue;
                }
                // The checked delete: only while the file still has the logged size and hash.
                match host.discard(&c.path, &FileVersion { mtime_ns: 0, size: c.size, hash: c.hash }) {
                    Ok(()) => types_changed |= is_type_file(&c.path),
                    // Absent (moved to `.trash/` or deleted meanwhile): nothing; the roll-back never looks further.
                    Err(WriteError::Missing) => {}
                    // Other bytes (or it can't be read or removed): the run's file stays, and is listed.
                    Err(_) => kept.push(c.path.clone()),
                }
            }
            Step::Replace { path, post, pre_bytes, .. } => {
                host.remove_temp(path, None);
                // The restore is the base-checked write; its outcome is the answer.
                match host.write(path, pre_bytes, post) {
                    Ok(Wrote::Written(_)) => types_changed |= is_type_file(path),
                    // Still the pre bytes: the replace never happened, or someone put them back.
                    Ok(Wrote::Unchanged) => {}
                    // A deleted type file is not brought back.
                    Err(WriteError::Missing) => {}
                    // Neither pre nor post: kept and listed.
                    Err(_) => kept.push(path.clone()),
                }
            }
            // A folder that existed before never has a `D` line; one that holds anything stays (D-1549 (7)).
            Step::Dir(d) => {
                host.remove_empty_dir(d);
            }
        }
    }
    if types_changed {
        host.types_changed();
    }
    kept.reverse();
    kept
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h(n: u8) -> String {
        hex(&[n; 32])
    }

    #[test]
    fn unhex_is_strict() {
        assert_eq!(unhex("00ff10"), Some(vec![0, 255, 16]));
        assert_eq!(unhex(""), Some(Vec::new()));
        assert_eq!(unhex("0"), None);
        assert_eq!(unhex("0g"), None);
        assert_eq!(unhex("+1"), None, "from_str_radix would take a sign");
        assert_eq!(unhex32(&h(7)), Some([7; 32]));
        assert_eq!(unhex32(&h(7)[2..]), None, "31 bytes are no hash");
    }

    #[test]
    fn parse_builds_the_state_of_each_create() {
        let log = format!(
            "D\tBooks\nC\tBooks/A.md\t3\t{a}\nT\tBooks/A.md\t41\nK\tBooks/A.md\nC\tBooks/B.md\t4\t{b}\nT\tBooks/B.md\t42\nC\tBooks/C.md\t5\t{c}\nN\tBooks/C.md\nC\tBooks/D.md\t6\t{d}\n",
            a = h(1),
            b = h(2),
            c = h(3),
            d = h(4)
        );
        let c = |path: &str, size, n, temp_id, created, not_created| Step::Create(Create { path: path.into(), size, hash: [n; 32], temp_id, created, not_created });
        assert_eq!(
            parse(&log),
            vec![
                Step::Dir("Books".into()),
                c("Books/A.md", 3, 1, Some(41), true, false),
                c("Books/B.md", 4, 2, Some(42), false, false),
                c("Books/C.md", 5, 3, None, false, true),
                c("Books/D.md", 6, 4, None, false, false),
            ]
        );
    }

    #[test]
    fn a_torn_or_malformed_line_proves_nothing() {
        // The last line has no line break (a kill mid-append): it is dropped, so `A.md` has no `K`.
        let log = format!("C\tA.md\t3\t{}\nT\tA.md\t9\nK\tA.md", h(1));
        assert_eq!(parse(&log), vec![Step::Create(Create { path: "A.md".into(), size: 3, hash: [1; 32], temp_id: Some(9), created: false, not_created: false })]);
        assert_eq!(parse("K\tA.md"), Vec::new());
        assert_eq!(parse(""), Vec::new());
        // A `C` line with a short hash, a size that isn't a number, extra fields; `T` / `K` / `N` for a path with no
        // `C` line; an unknown letter; an `R` line whose bytes aren't the bytes its hash names.
        let bad = format!(
            "C\tA.md\t3\t{short}\nC\tB.md\tx\t{ok}\nC\tC.md\t3\t{ok}\textra\nT\tZ.md\t1\nK\tZ.md\nN\tZ.md\nX\tA.md\nT\tA.md\tnot-a-number\nR\tt.yml\t1\t{ok}\t2\t{ok}\t6162\n\n",
            short = &h(1)[..62],
            ok = h(1)
        );
        assert_eq!(parse(&bad), Vec::new());
    }

    #[test]
    fn parse_reads_a_replace_line_and_checks_its_bytes() {
        let pre = FileVersion::of(b"name: Book\n");
        let post = FileVersion::of(b"name: Book\nattributes: []\n");
        let line = format!("R\t.tegg/types/book.yml\t{}\t{}\t{}\t{}\t{}\n", post.size, hex(&post.hash), pre.size, hex(&pre.hash), hex(b"name: Book\n"));
        assert_eq!(parse(&line), vec![Step::Replace { path: ".tegg/types/book.yml".into(), post, pre, pre_bytes: b"name: Book\n".to_vec() }]);
    }

    #[test]
    fn a_later_create_of_the_same_path_gets_the_later_lines() {
        let log = format!("C\tA.md\t3\t{a}\nN\tA.md\nC\tA.md\t3\t{a}\nT\tA.md\t5\nK\tA.md\n", a = h(1));
        let got = parse(&log);
        assert!(matches!(&got[0], Step::Create(c) if c.not_created && !c.created && c.temp_id.is_none()));
        assert!(matches!(&got[1], Step::Create(c) if !c.not_created && c.created && c.temp_id == Some(5)));
    }
}
