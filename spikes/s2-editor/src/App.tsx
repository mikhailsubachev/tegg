// Spike S2 playground: open a fixture (or your own Markdown) in the block editor and watch what
// a save would write. The "file output" panel shows the patched file, a line diff and timings.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { decode, encode } from '@core/parse'
import { getCore } from './core'
import { teggExtensions } from './schema'
import { attach, loadDoc, reconcile, type Loaded } from './sourceDoc'
import { hunks, lineDiff } from './ui/diff'
import { largeNote } from './ui/largeNote'
import { linkSuggest, slashCommands, tagSuggest } from './ui/suggest'

type Output = { text: string; changed: boolean; changedBlocks: number; ms: number } | { error: string; ms: number }

const core = getCore()
const LARGE = '⚡ Generated 5,000-word note'
const OWN = '✎ Paste your own Markdown…'

export function App() {
  const [files, setFiles] = useState<string[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [original, setOriginal] = useState('')
  const [output, setOutput] = useState<Output | null>(null)
  const [openMs, setOpenMs] = useState<number | null>(null)
  const [fallbacks, setFallbacks] = useState(0)
  const [latency, setLatency] = useState<number[]>([])
  const [showFull, setShowFull] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const pathRef = useRef<string | null>(null)
  const loadedRef = useRef<Loaded | null>(null)
  const keyAt = useRef<number | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const names = useMemo(() => files.map((f) => f.split('/').pop()!.replace(/\.md$/, '').normalize('NFC')), [files])
  const namesRef = useRef(names)
  namesRef.current = names
  const tagsRef = useRef<string[]>([])

  const editor = useEditor({
    extensions: teggExtensions([slashCommands, linkSuggest(() => namesRef.current), tagSuggest(() => tagsRef.current)]),
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: { attributes: { class: 'tegg-editor', spellcheck: 'false' } },
  })

  useEffect(() => {
    core.list().then(setFiles)
  }, [])

  // Save preview: what reconcile would write (debounced like autosave, FR-EDT-08).
  const computeOutput = useCallback((ed: Editor) => {
    const loaded = loadedRef.current
    if (!loaded) return
    const t0 = performance.now()
    try {
      const r = reconcile(loaded, ed.state.doc)
      setOutput({ ...r, ms: performance.now() - t0 })
      // Autosave (FR-EDT-08): write only when the bytes differ; never on open (FR-FMT-07 AC-2).
      const path = pathRef.current
      if (r.changed && path) {
        const at = new Date().toLocaleTimeString()
        core.write(path, encode(r.text)).then(() => setSaved(`${core.kind === 'ipc' ? 'Saved' : 'Would save (dev, read-only)'} · ${at}`))
      }
    } catch (e) {
      setOutput({ error: (e as Error).message, ms: performance.now() - t0 })
    }
  }, [])

  useEffect(() => {
    if (!editor) return
    const onUpdate = () => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => computeOutput(editor), 300)
    }
    // Typing latency (NFR-PERF-06): keydown → transaction applied → next frame painted.
    const onKey = () => { keyAt.current = performance.now() }
    const onTx = () => {
      const t = keyAt.current
      if (t === null) return
      keyAt.current = null
      requestAnimationFrame(() => {
        const ms = performance.now() - t
        ;((window as unknown as { __teggLatency?: number[] }).__teggLatency ??= []).push(ms) // read by perf probes
        setLatency((l) => [...l.slice(-199), ms])
      })
    }
    editor.on('update', onUpdate)
    editor.on('transaction', onTx)
    editor.view.dom.addEventListener('keydown', onKey, true)
    return () => {
      editor.off('update', onUpdate)
      editor.off('transaction', onTx)
      editor.view.dom.removeEventListener('keydown', onKey, true)
    }
  }, [editor, computeOutput])

  const openText = useCallback((text: string, label: string) => {
    if (!editor) return
    const t0 = performance.now()
    const loaded = loadDoc(text, editor.schema)
    attach(editor, loaded)
    loadedRef.current = loaded
    requestAnimationFrame(() => setOpenMs(performance.now() - t0)) // NFR-PERF-05: open → painted
    pathRef.current = label === LARGE || label === OWN ? null : label
    setSaved(null)
    tagsRef.current = [...new Set([...text.matchAll(/(?<=^|\s)#([\p{L}\p{N}_\-/]+)/gmu)].map((m) => m[1]))]
    setOriginal(text)
    setFallbacks(loaded.rawFallbacks)
    setLatency([])
    setCurrent(label)
    computeOutput(editor)
  }, [editor, computeOutput])

  const openFile = useCallback(async (rel: string) => {
    if (rel === LARGE) return openText(largeNote(5000), LARGE)
    if (rel === OWN) return setPasteOpen(true)
    openText(decode(await core.read(rel)), rel)
  }, [openText])

  const p = (q: number) => {
    if (!latency.length) return null
    const s = [...latency].sort((a, b) => a - b)
    return s[Math.min(s.length - 1, Math.floor(q * s.length))]
  }

  const diff = output && 'text' in output && output.changed ? hunks(lineDiff(original, output.text)) : []

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Tegg · S2 editor spike</h1>
        <button className={current === LARGE ? 'file active' : 'file'} onClick={() => openFile(LARGE)}>{LARGE}</button>
        <button className="file" onClick={() => openFile(OWN)}>{OWN}</button>
        {groupBy(files).map(([group, list]) => (
          <section key={group}>
            <h2>{group}</h2>
            {list.map((f) => (
              <button key={f} className={current === f ? 'file active' : 'file'} onClick={() => openFile(f)} title={f}>
                {f.slice(group.length + 1).replace(/\.md$/, '').normalize('NFC')}
              </button>
            ))}
          </section>
        ))}
      </aside>

      <main className="editor-pane">
        {!current && <p className="empty">Pick a note on the left. Type <kbd>/</kbd> for blocks, <kbd>[[</kbd> for links, <kbd>#</kbd> for tags; drag blocks by the ⠿ handle.</p>}
        {editor && (
          <>
            <DragHandle editor={editor}>
              <div className="drag-handle" title="Drag to move">⠿</div>
            </DragHandle>
            <BubbleMenu editor={editor} className="bubble">
              <button onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive('bold') ? 'on' : ''}><b>B</b></button>
              <button onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive('italic') ? 'on' : ''}><i>I</i></button>
              <button onClick={() => editor.chain().focus().toggleStrike().run()} className={editor.isActive('strike') ? 'on' : ''}><s>S</s></button>
              <button onClick={() => editor.chain().focus().toggleMark('highlight').run()} className={editor.isActive('highlight') ? 'on' : ''}>==</button>
              <button onClick={() => editor.chain().focus().toggleCode().run()} className={editor.isActive('code') ? 'on' : ''}>{'<>'}</button>
            </BubbleMenu>
          </>
        )}
        <EditorContent editor={editor} style={{ display: current ? 'block' : 'none' }} />
      </main>

      <aside className="output">
        <h2>File output</h2>
        {output && 'error' in output && <div className="badge bad">Save refused: {output.error}</div>}
        {output && 'text' in output && (output.changed
          ? <div className="badge warn">{output.changedBlocks} block{output.changedBlocks === 1 ? '' : 's'} rendered · only the lines below change</div>
          : <div className="badge good">✓ Byte-identical to the file: nothing to save</div>)}
        <dl className="metrics">
          <dt>Open (parse → painted)</dt><dd className={openMs !== null && openMs > 150 ? 'over' : ''}>{openMs?.toFixed(1) ?? '–'} ms <small>target &lt; 150</small></dd>
          <dt>Typing p50 / p95 / max</dt><dd className={(p(0.95) ?? 0) > 16 ? 'over' : ''}>{p(0.5)?.toFixed(1) ?? '–'} / {p(0.95)?.toFixed(1) ?? '–'} / {latency.length ? Math.max(...latency).toFixed(1) : '–'} ms <small>target &lt; 16 · n={latency.length}</small></dd>
          <dt>Save (reconcile + verify)</dt><dd>{output ? output.ms.toFixed(1) : '–'} ms</dd>
          <dt>Read-only blocks</dt><dd>{fallbacks}</dd>
          <dt>Last save</dt><dd data-testid="saved">{saved ?? '–'}</dd>
        </dl>
        {diff.length > 0 && (
          <pre className="diff">
            {diff.map((l, i) => (l === null ? <div key={i} className="gap">⋯</div> : <div key={i} className={`l${l.kind === '+' ? 'add' : l.kind === '-' ? 'del' : ''}`}>{l.kind} {visible(l.text)}</div>))}
          </pre>
        )}
        {output && 'text' in output && (
          <>
            <button className="toggle" onClick={() => setShowFull(!showFull)}>{showFull ? 'Hide' : 'Show'} full file</button>
            {showFull && <pre className="full">{visible(output.text)}</pre>}
          </>
        )}
      </aside>

      {pasteOpen && <PasteDialog onClose={() => setPasteOpen(false)} onOpen={(t) => { setPasteOpen(false); openText(t, OWN) }} />}
    </div>
  )
}

function PasteDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (text: string) => void }) {
  const [text, setText] = useState('')
  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Open your own Markdown</h2>
        <p>Stays in this browser tab; nothing is saved or sent anywhere.</p>
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a note here…" />
        <div className="actions"><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => onOpen(text)}>Open in editor</button></div>
      </div>
    </div>
  )
}

const visible = (s: string) => s.replace(/\r/g, '␍').replace(/﻿/g, '⟨BOM⟩').replace(/​/g, '⟨ZWSP⟩')

function groupBy(files: string[]): [string, string[]][] {
  const m = new Map<string, string[]>()
  for (const f of files) {
    const g = f.split('/')[0]
    m.set(g, [...(m.get(g) ?? []), f])
  }
  return [...m]
}
