// D-606 (AP-528; FR-EDT-02 AC-22): tables the editor can't edit losslessly are still shown as tables. `tableCells`
// splits a GFM table more leniently than GFM: a bare `|` inside `[[…]]` (an alias written without `\|`), a code span,
// an HTML tag or an escape doesn't end a cell. `displayTable` rewrites such a table, for display only, into a table every row of
// which has the header's width, with `\|` inside links; the line count is kept. The file is never changed by this.

export type TableAlign = 'left' | 'center' | 'right' | null
export type TableCells = { align: TableAlign[]; rows: string[][] }

const DELIM = /^\s*:?-+:?\s*$/

/** The cells of one table line, trimmed; leading and trailing pipes are optional. */
export function splitRow(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let link = 0
  let code = 0
  let tag = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    // An HTML tag (`<span title="a|b">`) is one piece.
    if (tag) { cur += c; if (c === '>') tag = false; continue }
    if (code === 0 && c === '<' && /[A-Za-z/!]/.test(line[i + 1] ?? '')) { tag = true; cur += c; continue }
    if (c === '\\' && i + 1 < line.length) { cur += c + line[i + 1]; i++; continue }
    if (code === 0 && c === '[' && line[i + 1] === '[') { link++; cur += '[['; i++; continue }
    if (code === 0 && link > 0 && c === ']' && line[i + 1] === ']') { link--; cur += ']]'; i++; continue }
    if (c === '`') {
      let n = 1
      while (line[i + n] === '`') n++
      if (code === 0) code = n
      else if (code === n) code = 0
      cur += '`'.repeat(n)
      i += n - 1
      continue
    }
    if (c === '|' && link === 0 && code === 0) { cells.push(cur); cur = ''; continue }
    cur += c
  }
  cells.push(cur)
  const t = line.trim()
  if (t.startsWith('|')) cells.shift()
  if (t.endsWith('|') && !t.endsWith('\\|') && cells.length > 0) cells.pop()
  return cells.map((x) => x.trim())
}

/** The table of `raw` (a block's source), or null when it isn't one (no delimiter row in line 2). */
export function tableCells(raw: string): TableCells | null {
  const lines = raw.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')
  if (lines.length < 2 || !lines[0].includes('|')) return null
  const delim = splitRow(lines[1])
  if (delim.length === 0 || !delim.every((d) => DELIM.test(d))) return null
  const align = delim.map((d): TableAlign => {
    const s = d.trim()
    const l = s.startsWith(':'), r = s.endsWith(':')
    return l && r ? 'center' : r ? 'right' : l ? 'left' : null
  })
  const rows = [lines[0], ...lines.slice(2)].map(splitRow)
  return { align, rows }
}

/** Every bare `|` left in a split cell (in a link, code span or tag) as `\|`, which GFM reads as part of the cell. */
const escapeLinks = (cell: string) => cell.replace(/\\?\|/g, (m) => (m === '|' ? '\\|' : m))

/** `raw` as a table GFM reads the same way `tableCells` does, or null when it isn't a table. */
export function displayTable(raw: string): string | null {
  const t = tableCells(raw)
  if (!t) return null
  const width = Math.max(t.align.length, ...t.rows.map((r) => r.length))
  const pad = (r: string[]) => [...r, ...Array.from({ length: width - r.length }, () => '')]
  const line = (r: string[]) => `| ${pad(r).map((c) => escapeLinks(c)).join(' | ')} |`
  const delim = pad(t.align.map((a) => (a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---'))).map((d) => d || '---')
  return [line(t.rows[0]), `| ${delim.join(' | ')} |`, ...t.rows.slice(1).map(line)].join('\n')
}

/** Whether GFM would read `raw` differently from `tableCells`: a bare `|` left in a cell (in a link, code span or tag),
 *  or a row whose width isn't the header's (the cases the editor can't edit losslessly). */
export function needsDisplayTable(raw: string): boolean {
  const t = tableCells(raw)
  if (!t) return false
  const w = t.align.length
  return t.rows.some((r) => r.length !== w || r.some((c) => /(^|[^\\])\|/.test(c)))
}

/** `text` with every table that `needsDisplayTable` rewritten by `displayTable`, for display; lines are kept. */
export function displayTables(text: string): string {
  return displayTablesAt(text).text
}

/** `displayTables`, with the 1-based first lines of the rewritten tables (the read view marks them read-only). */
export function displayTablesAt(text: string): { text: string; lines: number[] } {
  const at: number[] = []
  const lines = text.split('\n')
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i].includes('|')) continue
    let j = i + 2
    while (j < lines.length && lines[j].includes('|') && lines[j].trim() !== '') j++
    const raw = lines.slice(i, j).join('\n')
    if (!tableCells(raw)) continue
    if (needsDisplayTable(raw)) { lines.splice(i, j - i, ...displayTable(raw)!.split('\n')); at.push(i + 1) }
    i = j - 1
  }
  return { text: lines.join('\n'), lines: at }
}
