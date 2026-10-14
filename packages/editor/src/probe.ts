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
