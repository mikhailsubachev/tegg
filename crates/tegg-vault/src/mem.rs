//! In-memory `VaultFs` for tests (AR-04 AC-2): same results as `LocalFs` for the same operations.

use std::collections::BTreeMap;
use std::io;
use std::sync::Mutex;

use crate::{version_of, FileVersion, FsEntry, VaultFs};

enum Node {
    Dir,
    File { bytes: Vec<u8>, mtime_ns: i128 },
}

#[derive(Default)]
pub struct MemFs {
    nodes: Mutex<BTreeMap<String, Node>>,
    clock: Mutex<i128>,
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

fn key(path: &str) -> String {
    tegg_format::nfc(path.trim_matches('/'))
}

fn parent(path: &str) -> Option<&str> {
    path.rsplit_once('/').map(|(p, _)| p)
}

fn not_found(path: &str) -> io::Error {
    io::Error::new(io::ErrorKind::NotFound, format!("{path}: not found"))
}

impl MemFs {
    fn check_parent(nodes: &BTreeMap<String, Node>, path: &str) -> io::Result<()> {
        match parent(path) {
            None => Ok(()),
            Some(p) if matches!(nodes.get(p), Some(Node::Dir)) => Ok(()),
            Some(p) => Err(not_found(p)),
        }
    }

    fn put(&self, path: &str, bytes: &[u8], must_be_new: bool) -> io::Result<FileVersion> {
        let k = key(path);
        let mtime_ns = self.tick();
        let mut nodes = self.nodes.lock().expect("nodes");
        Self::check_parent(&nodes, &k)?;
        match nodes.get(&k) {
            Some(Node::Dir) => return Err(io::Error::other(format!("{k}: is a directory"))),
            Some(Node::File { .. }) if must_be_new => return Err(io::Error::new(io::ErrorKind::AlreadyExists, k)),
            _ => {}
        }
        nodes.insert(k, Node::File { bytes: bytes.to_vec(), mtime_ns });
        Ok(version_of(bytes, mtime_ns))
    }
}

impl VaultFs for MemFs {
    fn list(&self) -> io::Result<Vec<FsEntry>> {
        let nodes = self.nodes.lock().expect("nodes");
        Ok(nodes
            .iter()
            .map(|(k, n)| match n {
                Node::Dir => FsEntry::Dir { path: k.clone() },
                Node::File { .. } => FsEntry::File { path: k.clone() },
            })
            .collect())
    }

    fn read(&self, path: &str) -> io::Result<(Vec<u8>, FileVersion)> {
        let nodes = self.nodes.lock().expect("nodes");
        match nodes.get(&key(path)) {
            Some(Node::File { bytes, mtime_ns }) => Ok((bytes.clone(), version_of(bytes, *mtime_ns))),
            _ => Err(not_found(path)),
        }
    }

    fn version(&self, path: &str) -> io::Result<Option<FileVersion>> {
        match self.read(path) {
            Ok((_, v)) => Ok(Some(v)),
            Err(_) => Ok(None),
        }
    }

    fn replace(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        self.put(path, bytes, false)
    }

    fn create_new(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        self.put(path, bytes, true)
    }

    fn rename_no_replace(&self, from: &str, to: &str) -> io::Result<()> {
        let (f, t) = (key(from), key(to));
        let mut nodes = self.nodes.lock().expect("nodes");
        Self::check_parent(&nodes, &t)?;
        if nodes.contains_key(&t) {
            return Err(io::Error::new(io::ErrorKind::AlreadyExists, t));
        }
        match nodes.remove(&f) {
            Some(n @ Node::File { .. }) => {
                nodes.insert(t, n);
                Ok(())
            }
            Some(n) => {
                nodes.insert(f, n);
                Err(io::Error::other("renaming folders is not supported"))
            }
            None => Err(not_found(from)),
        }
    }

    fn create_dir_all(&self, path: &str) -> io::Result<()> {
        let k = key(path);
        let mut nodes = self.nodes.lock().expect("nodes");
        let mut acc = String::new();
        for part in k.split('/').filter(|p| !p.is_empty()) {
            if !acc.is_empty() {
                acc.push('/');
            }
            acc.push_str(part);
            match nodes.get(&acc) {
                Some(Node::File { .. }) => return Err(io::Error::new(io::ErrorKind::AlreadyExists, acc)),
                Some(Node::Dir) => {}
                None => {
                    nodes.insert(acc.clone(), Node::Dir);
                }
            }
        }
        Ok(())
    }

    fn remove_file(&self, path: &str) -> io::Result<()> {
        let k = key(path);
        let mut nodes = self.nodes.lock().expect("nodes");
        match nodes.get(&k) {
            Some(Node::File { .. }) => {
                nodes.remove(&k);
                Ok(())
            }
            _ => Err(not_found(path)),
        }
    }
}
