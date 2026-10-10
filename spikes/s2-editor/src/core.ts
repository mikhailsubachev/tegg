// The editor's view of the Rust core: list, read and write notes as bytes. In the Tauri app this
// goes over IPC (`window.__TAURI_INTERNALS__.invoke`); tests replace that with a fake core
// (S2-QA AC-3). In a plain browser it falls back to the dev server's read-only fixtures.

export interface Core {
  list(): Promise<string[]>
  read(path: string): Promise<Uint8Array>
  /** Atomic write of the whole file (FR-SYN-02 is the core's job). */
  write(path: string, bytes: Uint8Array): Promise<void>
  readonly kind: 'ipc' | 'dev'
}

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

declare global {
  interface Window { __TAURI_INTERNALS__?: { invoke: Invoke } }
}

export function getCore(): Core {
  const ipc = typeof window !== 'undefined' ? window.__TAURI_INTERNALS__ : undefined
  if (ipc) {
    return {
      kind: 'ipc',
      list: async () => (await ipc.invoke('list_notes')) as string[],
      read: async (path) => new Uint8Array((await ipc.invoke('read_note', { path })) as number[]),
      write: async (path, bytes) => { await ipc.invoke('write_note', { path, bytes: Array.from(bytes) }) },
    }
  }
  return {
    kind: 'dev',
    list: async () => (await fetch('/fixtures')).json(),
    read: async (path) => new Uint8Array(await (await fetch(`/fixtures/${encodeURIComponent(path)}`)).arrayBuffer()),
    write: async () => { /* dev mode: fixtures are read-only, the output panel shows what would be written */ },
  }
}
