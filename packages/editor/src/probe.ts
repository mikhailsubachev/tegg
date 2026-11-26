// NFR-PERF-06 AC-3 (D-199): typing latency, counted in frames from the keydown to the frame that paints the change
// (D-66). The app logs one `{ mark: 'key', frame, ms }` per keystroke.
export function createLatencyProbe(o: { nextFrame: (f: (t: number) => void) => void; now?: () => number; log: (r: { frame: number; ms: number }) => void }) {
  const now = o.now ?? (() => performance.now())
  let pending: { t0: number } | null = null
  return {
    keydown() {
      pending = { t0: now() }
    },
    /** Call after the editor applied the keystroke's transaction. */
    painted() {
      const p = pending
      if (!p) return
      pending = null
      let frame = 0
      const tick = () => {
        frame++
        // The change is in the DOM; the first animation frame after it is the one that paints it.
        o.log({ frame, ms: now() - p.t0 })
      }
      o.nextFrame(() => tick())
    },
  }
}

/** Slice AND-3 (android-edit §5.3, NFR-PERF-06 AC-8): which events start a typing-latency measurement. A `keydown`
 *  with a one-character key (no ⌘/Ctrl, not composing, not keyCode 229) as before, and a `beforeinput` with
 *  `inputType` `insertText` or `insertCompositionText`, so keyboards that send `keydown` 229 (Gboard) are measured.
 *  One measurement per keystroke: a `beforeinput` right after a counted `keydown` belongs to it and is skipped. */
export function createProbeTrigger() {
  let keyPending = false
  return {
    starts(e: Event): boolean {
      if (e.type === 'keydown') {
        const k = e as KeyboardEvent
        keyPending = !k.metaKey && !k.ctrlKey && !k.isComposing && k.keyCode !== 229 && k.key.length === 1
        return keyPending
      }
      if (e.type === 'beforeinput') {
        const t = (e as InputEvent).inputType
        const counted = keyPending
        keyPending = false
        return !counted && (t === 'insertText' || t === 'insertCompositionText')
      }
      return false
    },
  }
}
