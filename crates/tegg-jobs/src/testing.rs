//! Transformers for Rust tests (ms4-jobs §2.2). `NodeTransformer` runs the real `@tegg/doc` engine in one persistent
//! `node packages/doc/dist/transform-cli.js` process (JSON lines on stdin/stdout; built by
//! `npm run build --prefix packages/doc`), so L2/L4 bytes come from the one text engine (D-82).
//! `FailingTransformer` covers the error paths.

use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;

use serde_json::{json, Value};

use crate::{Edit, TextOp, TransformError, Transformed, Transformer};

/// The transform CLI of a checkout: `<repo>/packages/doc/dist/transform-cli.js`.
pub fn transform_cli(repo_root: &Path) -> PathBuf {
    repo_root.join("packages/doc/dist/transform-cli.js")
}

struct Proc {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next: u64,
}

pub struct NodeTransformer {
    proc: Mutex<Proc>,
}

impl NodeTransformer {
    /// Starts `node <script>`. Fails when Node or the script is missing.
    pub fn start(script: &Path) -> io::Result<NodeTransformer> {
        NodeTransformer::spawn(script, Stdio::inherit())
    }
    /// v1-import §12.1, §13: as `start`, with the child's stderr sent to the null device instead of inherited (the
    /// real-export run must print nothing of a note's content).
    pub fn start_quiet(script: &Path) -> io::Result<NodeTransformer> {
        NodeTransformer::spawn(script, Stdio::null())
    }
    fn spawn(script: &Path, stderr: Stdio) -> io::Result<NodeTransformer> {
        if !script.is_file() {
            return Err(io::Error::new(io::ErrorKind::NotFound, format!("{} (run `npm run build` in packages/doc)", script.display())));
        }
        let mut child = Command::new("node").arg(script).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(stderr).spawn()?;
        let stdin = child.stdin.take().ok_or_else(|| io::Error::other("no stdin"))?;
        let stdout = BufReader::new(child.stdout.take().ok_or_else(|| io::Error::other("no stdout"))?);
        Ok(NodeTransformer { proc: Mutex::new(Proc { child, stdin, stdout, next: 1 }) })
    }
    /// v1-import §2.1, §12.1: the Node process's id (the tests sample its sockets with `lsof`).
    pub fn pid(&self) -> u32 {
        self.proc.lock().unwrap_or_else(|e| e.into_inner()).child.id()
    }
    /// `start(transform_cli(repo_root))`.
    pub fn from_repo(repo_root: &Path) -> io::Result<NodeTransformer> {
        NodeTransformer::start(&transform_cli(repo_root))
    }
}

impl Drop for NodeTransformer {
    fn drop(&mut self) {
        let p = self.proc.get_mut().unwrap_or_else(|e| e.into_inner());
        let _ = p.child.kill();
        let _ = p.child.wait();
    }
}

pub use crate::ops::op_json;

/// A `Transformed` from its JSON shape (`{ kind: 'bytes', text, edits } | { kind: 'unchanged' }`).
pub fn transformed_from_json(v: &Value) -> Result<Transformed, TransformError> {
    match v["kind"].as_str() {
        Some("unchanged") => Ok(Transformed::Unchanged),
        Some("bytes") => {
            let text = v["text"].as_str().ok_or_else(|| TransformError::Engine("no text".into()))?;
            let edits = v["edits"]
                .as_array()
                .map(|a| a.iter().map(|e| Edit { start: e["start"].as_u64().unwrap_or(0) as usize, end: e["end"].as_u64().unwrap_or(0) as usize }).collect())
                .unwrap_or_default();
            Ok(Transformed::Bytes(text.as_bytes().to_vec(), edits))
        }
        _ => Err(TransformError::Engine(format!("unexpected result {v}"))),
    }
}

impl Transformer for NodeTransformer {
    fn transform(&self, source: &str, bytes: &[u8], ops: &[TextOp]) -> Result<Transformed, TransformError> {
        let text = std::str::from_utf8(bytes).map_err(|_| TransformError::Engine("not UTF-8".into()))?;
        let mut p = self.proc.lock().unwrap_or_else(|e| e.into_inner());
        let id = p.next;
        p.next += 1;
        let req = json!({ "id": id, "source": source, "text": text, "ops": ops.iter().map(op_json).collect::<Vec<_>>() });
        writeln!(p.stdin, "{req}").and_then(|_| p.stdin.flush()).map_err(|_| TransformError::Unavailable)?;
        let mut line = String::new();
        if p.stdout.read_line(&mut line).map_err(|_| TransformError::Unavailable)? == 0 {
            return Err(TransformError::Unavailable);
        }
        let v: Value = serde_json::from_str(&line).map_err(|e| TransformError::Engine(e.to_string()))?;
        if v["id"].as_u64() != Some(id) {
            return Err(TransformError::Engine(format!("reply for another request: {line}")));
        }
        if let Some(e) = v["error"].as_str() {
            return Err(TransformError::Engine(e.to_string()));
        }
        transformed_from_json(&v["result"])
    }
}

/// Always fails with the given error.
pub struct FailingTransformer(pub TransformError);

impl Transformer for FailingTransformer {
    fn transform(&self, _source: &str, _bytes: &[u8], _ops: &[TextOp]) -> Result<Transformed, TransformError> {
        Err(self.0.clone())
    }
}
