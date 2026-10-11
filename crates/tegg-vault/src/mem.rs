//! In-memory `VaultFs` for tests (AR-04 AC-2): same results as `LocalFs` on APFS for the same operations.
//! Names keep their spelling but compare like APFS: normalization- and case-insensitive.

use std::collections::BTreeMap;
use std::io;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{version_of, FileVersion, FsEntry, VaultFs};

enum Node {
    Dir,
    File { bytes: Vec<u8>, mtime_ns: i128 },
}

/// Folded key → (path as spelled when created, node).
pub struct MemFs {
    nodes: Mutex<BTreeMap<String, (String, Node)>>,
    clock: Mutex<i128>,
}

impl Default for MemFs {
    fn default() -> Self {
        // Wall-clock start, so age-based rules (temp clean-up, FR-SYN-02 AC-4) behave as on disk.
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as i128).unwrap_or(0);
        MemFs { nodes: Mutex::new(BTreeMap::new()), clock: Mutex::new(now) }
    }
}

impl MemFs {
    pub fn new() -> MemFs {
        MemFs::default()
    }

    fn tick(&self) -> i128 {
        let mut c = self.clock.lock().expect("clock");
        *c += 1;
        *c
    }
}

fn spelled(path: &str) -> String {
    tegg_format::nfc(path.trim_matches('/'))
}

fn fold(path: &str) -> String {
    spelled(path).to_lowercase()
}

fn parent(path: &str) -> Option<&str> {
    path.rsplit_once('/').map(|(p, _)| p)
}

fn not_found(path: &str) -> io::Error {
    io::Error::new(io::ErrorKind::NotFound, format!("{path}: not found"))
}

type Nodes = BTreeMap<String, (String, Node)>;

impl MemFs {
    fn check_parent(nodes: &Nodes, path: &str) -> io::Result<()> {
        match parent(path) {
            None => Ok(()),
            Some(p) if matches!(nodes.get(&fold(p)), Some((_, Node::Dir))) => Ok(()),
            Some(p) => Err(not_found(p)),
        }
    }

    fn put(&self, path: &str, bytes: &[u8], must_be_new: bool) -> io::Result<FileVersion> {
        let (name, k) = (spelled(path), fold(path));
        let mtime_ns = self.tick();
        let mut nodes = self.nodes.lock().expect("nodes");
        Self::check_parent(&nodes, &name)?;
        // Replacing keeps the existing spelling unless the new one differs, as a rename-over does.
        match nodes.get(&k) {
            Some((_, Node::Dir)) => return Err(io::Error::other(format!("{name}: is a directory"))),
            Some((_, Node::File { .. })) if must_be_new => return Err(io::Error::new(io::ErrorKind::AlreadyExists, name)),
            _ => {}
        }
        nodes.insert(k, (name, Node::File { bytes: bytes.to_vec(), mtime_ns }));
        Ok(version_of(bytes, mtime_ns))
    }
}

impl VaultFs for MemFs {
    fn list(&self) -> io::Result<Vec<FsEntry>> {
        let nodes = self.nodes.lock().expect("nodes");
        Ok(nodes
            .values()
            .map(|(p, n)| match n {
                Node::Dir => FsEntry::Dir { path: p.clone() },
                Node::File { .. } => FsEntry::File { path: p.clone() },
            })
            .collect())
    }

    fn read(&self, path: &str) -> io::Result<(Vec<u8>, FileVersion)> {
        let nodes = self.nodes.lock().expect("nodes");
        match nodes.get(&fold(path)) {
            Some((_, Node::File { bytes, mtime_ns })) => Ok((bytes.clone(), version_of(bytes, *mtime_ns))),
            Some((_, Node::Dir)) => Err(io::Error::other(format!("{path}: is a directory"))),
            None => Err(not_found(path)),
        }
    }

    fn version(&self, path: &str) -> io::Result<Option<FileVersion>> {
        match self.read(path) {
            Ok((_, v)) => Ok(Some(v)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    fn replace(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        self.put(path, bytes, false)
    }

    fn create_new(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        self.put(path, bytes, true)
    }

    fn rename_no_replace(&self, from: &str, to: &str) -> io::Result<()> {
        let (to_name, f, t) = (spelled(to), fold(from), fold(to));
        let mut nodes = self.nodes.lock().expect("nodes");
        Self::check_parent(&nodes, &to_name)?;
        if nodes.contains_key(&t) {
            return Err(io::Error::new(io::ErrorKind::AlreadyExists, to_name));
        }
        match nodes.remove(&f) {
            Some((_, n @ Node::File { .. })) => {
                nodes.insert(t, (to_name, n));
                Ok(())
            }
            Some(entry) => {
                nodes.insert(f, entry);
                Err(io::Error::other("renaming folders is not supported"))
            }
            None => Err(not_found(from)),
        }
    }

    fn create_dir_all(&self, path: &str) -> io::Result<()> {
        let name = spelled(path);
        let mut nodes = self.nodes.lock().expect("nodes");
        let mut acc = String::new();
        for part in name.split('/').filter(|p| !p.is_empty()) {
            if !acc.is_empty() {
                acc.push('/');
            }
            acc.push_str(part);
            match nodes.get(&fold(&acc)) {
                Some((_, Node::File { .. })) => return Err(io::Error::new(io::ErrorKind::AlreadyExists, acc)),
                Some((_, Node::Dir)) => {}
                None => {
                    nodes.insert(fold(&acc), (acc.clone(), Node::Dir));
                }
            }
        }
        Ok(())
    }

    fn remove_file(&self, path: &str) -> io::Result<()> {
        let k = fold(path);
        let mut nodes = self.nodes.lock().expect("nodes");
        match nodes.get(&k) {
            Some((_, Node::File { .. })) => {
                nodes.remove(&k);
                Ok(())
            }
            _ => Err(not_found(path)),
        }
    }
}
