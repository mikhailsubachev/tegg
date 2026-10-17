// The transform CLI for Rust tests (docs/contracts/ms4-jobs.md §2.2, `tegg_jobs::testing::NodeTransformer`): one
// persistent process reading JSON lines on stdin and answering one JSON line per request on stdout.
//
//   request:  {"id": <n>, "source": "<vault path>", "text": "<file text>", "ops": [TextOp, …]}
//   answer:   {"id": <n>, "result": Transformed}  or  {"id": <n>, "error": "<message>"}
//
// Built into dist/transform-cli.js by `npm run build` (scripts/build-transform-cli.mjs).
import { createInterface } from 'node:readline'
import { transform, type TextOp } from './transform.js'

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  if (line.trim() === '') return
  let id: unknown = null
  try {
    const req = JSON.parse(line) as { id: unknown; source: string; text: string; ops: TextOp[] }
    id = req.id
    process.stdout.write(JSON.stringify({ id, result: transform(req.source, req.text, req.ops) }) + '\n')
  } catch (e) {
    process.stdout.write(JSON.stringify({ id, error: String((e as Error)?.message ?? e) }) + '\n')
  }
})
