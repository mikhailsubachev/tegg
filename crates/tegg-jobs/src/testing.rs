//! Transformers for Rust tests (ms4-jobs §2.2). `NodeTransformer` runs the real `@tegg/doc` engine in one persistent
//! `node packages/doc/dist/transform-cli.js` process (JSON lines on stdin/stdout; built by
//! `npm run build --prefix packages/doc`), so L2/L4 bytes come from the one text engine (D-82).
//! `FailingTransformer` covers the error paths.
//!
//! **Stub (slice 4C red tests):** `NodeTransformer` starts no process yet and answers `Unchanged` for every file.

use std::io;
use std::path::{Path, PathBuf};

use crate::{TextOp, TransformError, Transformed, Transformer};

/// The transform CLI of a checkout: `<repo>/packages/doc/dist/transform-cli.js`.
pub fn transform_cli(repo_root: &Path) -> PathBuf {
    repo_root.join("packages/doc/dist/transform-cli.js")
}

pub struct NodeTransformer {
    #[allow(dead_code)]
    script: PathBuf,
}

impl NodeTransformer {
    /// Starts `node <script>`. Fails when Node or the script is missing.
    pub fn start(script: &Path) -> io::Result<NodeTransformer> {
        Ok(NodeTransformer { script: script.to_path_buf() })
    }
    /// `start(transform_cli(repo_root))`.
    pub fn from_repo(repo_root: &Path) -> io::Result<NodeTransformer> {
        NodeTransformer::start(&transform_cli(repo_root))
    }
}

impl Transformer for NodeTransformer {
    fn transform(&self, _source: &str, _bytes: &[u8], _ops: &[TextOp]) -> Result<Transformed, TransformError> {
        Ok(Transformed::Unchanged)
    }
}

/// Always fails with the given error.
pub struct FailingTransformer(pub TransformError);

impl Transformer for FailingTransformer {
    fn transform(&self, _source: &str, _bytes: &[u8], _ops: &[TextOp]) -> Result<Transformed, TransformError> {
        Err(self.0.clone())
    }
}
