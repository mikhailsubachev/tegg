// Minimal line diff (LCS) for the "file output" panel: shows exactly which lines a save changes.

export interface Line { kind: ' ' | '-' | '+'; text: string }

export function lineDiff(a: string, b: string): Line[] {
  const x = a.split('\n')
  const y = b.split('\n')
  const n = x.length
  const m = y.length
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: Line[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ kind: ' ', text: x[i] }); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: '-', text: x[i++] })
    else out.push({ kind: '+', text: y[j++] })
  }
  while (i < n) out.push({ kind: '-', text: x[i++] })
  while (j < m) out.push({ kind: '+', text: y[j++] })
  return out
}

/** Changed lines with `context` unchanged lines around them; gaps marked by null. */
export function hunks(lines: Line[], context = 2): (Line | null)[] {
  const keep = new Set<number>()
  lines.forEach((l, i) => { if (l.kind !== ' ') for (let k = i - context; k <= i + context; k++) keep.add(k) })
  const out: (Line | null)[] = []
  let last = -2
  lines.forEach((l, i) => {
    if (!keep.has(i)) return
    if (i !== last + 1 && out.length) out.push(null)
    out.push(l)
    last = i
  })
  return out
}
