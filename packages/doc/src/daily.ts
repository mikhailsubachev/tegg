// MS4 slice 4B (docs/contracts/ms4-daily.md §1, §5, §6, §12): dates, daily file names, the daily template, first-write
// bytes, the D-334 title fix and `@` date rows. The Rust twins are `tegg_format::date` and `tegg_format::daily`; both
// follow the shared corpora in tests/fixtures/format/dates/.

import { parseDocument } from 'yaml'

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const iso = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`

function validYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** §1: `YYYY-MM-DD` with a valid calendar day (D-332), else null. */
export function parseDate(s: string): string | null {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(s)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return validYmd(y, mo, d) ? s : null
}

/** §1: today's local calendar date of `nowMs` in `timeZone` (default: the current `Intl` zone). */
export function localDate(nowMs: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(nowMs))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return iso(get('year'), get('month'), get('day'))
}

/** §1: calendar-day arithmetic, no time involved (FR-DLY-03 AC-1). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

function format(date: string, fmt: string): { text: string; day: boolean } {
  const [y, m, d] = date.split('-').map(Number)
  const c = Array.from(fmt)
  let out = ''
  let day = false
  const at = (i: number, t: string) => Array.from(t).every((ch, k) => c[i + k] === ch)
  for (let i = 0; i < c.length; ) {
    if (c[i] === '\\') { if (i + 1 < c.length) out += c[i + 1]; i += 2 }
    else if (at(i, 'YYYY')) { out += pad(y, 4); i += 4 }
    else if (at(i, 'MM')) { out += pad(m); i += 2 }
    else if (at(i, 'M')) { out += String(m); i += 1 }
    else if (at(i, 'DD')) { out += pad(d); day = true; i += 2 }
    else if (at(i, 'D')) { out += String(d); day = true; i += 1 }
    else { out += c[i]; i += 1 }
  }
  return { text: out, day }
}

/** §6.1: `YYYY`, `MM`, `M`, `DD`, `D` (longest first); a backslash makes the next character literal (D-361). */
export function formatDate(date: string, fmt: string): string {
  return format(date, fmt).text
}

/** D-51, D-52: the file-stem sanitizer of `tegg_format::sanitize_file_stem`, for daily names. */
function sanitizeStem(title: string): string {
  let s = Array.from(title.normalize('NFC'), (ch) => ('/:\\*?"<>|#^[]'.includes(ch) || /\p{Cc}/u.test(ch) ? ' ' : ch)).join('')
  const trim = (x: string) => x.replace(/^[ .]+|[ .]+$/g, '')
  s = trim(s.split(' ').filter((w) => w !== '').join(' '))
  return s === '' ? 'Untitled' : s
}

/** §5: the daily file stem for `format`, or null when the format is bad (D-336, D-355). */
export function dailyFileStem(fmt: string, date: string): string | null {
  const { text, day } = format(date, fmt)
  if (!day || /[/\\:*?"<>|\p{Cc}]/u.test(text)) return null
  if (text.replace(/^[ .]+|[ .]+$/g, '') === '') return null
  return sanitizeStem(text)
}

/** D-346: the template keys the first write never takes from the template. */
const IGNORED = ['id', 'type', 'title', 'date', 'review', 'created', 'modified']

function expandVariables(text: string, date: string): string {
  return text.replace(/\{\{([^}]*)\}\}/g, (all, name: string) => {
    if (name === 'date') return date
    if (name === 'yesterday') return addDays(date, -1)
    if (name === 'tomorrow') return addDays(date, 1)
    if (name.startsWith('date:')) return formatDate(date, name.slice(5))
    return all
  })
}

const isFence = (line: string | undefined) => (line ?? '').replace(/\r?\n$/, '') === '---'

/** §6.1: the daily template expanded for `date` (D-270, D-325, D-346, D-362). */
export function expandDailyTemplate(templateText: string, date: string): { keys: [string, string][]; body: string; invalid: boolean } {
  const lines = templateText.match(/[^\n]*\n|[^\n]+$/g) ?? []
  if (lines.length === 0 || !isFence(lines[0])) return { keys: [], body: expandVariables(templateText, date), invalid: false }
  const close = lines.findIndex((l, i) => i > 0 && isFence(l))
  if (close < 0) return { keys: [], body: expandVariables(templateText, date), invalid: true }
  const fm = lines.slice(1, close).join('')
  const body = lines.slice(close + 1).join('')
  const doc = parseDocument(fm, { uniqueKeys: true })
  const top = doc.contents
  const valid = doc.errors.length === 0 && (top === null || (top as { items?: unknown }).items !== undefined && !Array.isArray(doc.toJS()))
  if (!valid) return { keys: [], body: expandVariables(body, date), invalid: true }
  const keys: [string, string][] = []
  for (const line of lines.slice(1, close)) {
    const isTop = !/^[ \t#\-\r\n]/.test(line) && line.includes(':')
    if (isTop) keys.push([line.slice(0, line.indexOf(':')).trim().replace(/^["']|["']$/g, ''), line])
    else if (keys.length > 0) keys[keys.length - 1][1] += line
  }
  return { keys: keys.filter(([k]) => !IGNORED.includes(k)), body: expandVariables(body, date), invalid: false }
}

/** §6.2: the bytes of a Daily Note's first write (D-324, D-347). */
export function newDailyNote(opts: { date: string; keys: [string, string][]; body: string; id: string; now: string }): string {
  const { date, keys, body, id, now } = opts
  let s = `---\nid: ${id}\ntype: daily-note\ntitle: "${date}"\ndate: ${date}\n`
  for (const [, lines] of keys) s += lines.endsWith('\n') ? lines : `${lines}\n`
  return `${s}review: unreviewed\ncreated: ${now}\nmodified: ${now}\n---\n${body}`
}

/** §6.3: sets `title: "<date>"` when the title differs from `date` (D-334); changes only that line. */
export function fixDailyTitle(text: string): string {
  const m = /^---\r?\n([\s\S]*?\r?\n)?---(\r?\n|$)/.exec(text)
  if (!m) return text
  const fm = m[1] ?? ''
  const dateLine = /^date:[ \t]*["']?([0-9]{4}-[0-9]{2}-[0-9]{2})/m.exec(fm)
  const date = dateLine && parseDate(dateLine[1])
  if (!date) return text
  const want = `title: "${date}"`
  const titleLine = /^title:.*$/m.exec(fm)
  let next: string
  if (titleLine) {
    const raw = titleLine[0].slice(6).trim().replace(/^["']|["']$/g, '')
    if (raw.normalize('NFC') === date) return text
    next = fm.slice(0, titleLine.index) + want + fm.slice(titleLine.index + titleLine[0].length)
  } else {
    const typeLine = /^type:.*\r?\n/m.exec(fm)
    const at = typeLine ? typeLine.index + typeLine[0].length : 0
    next = `${fm.slice(0, at)}${want}\n${fm.slice(at)}`
  }
  const start = text.indexOf('\n') + 1
  return text.slice(0, start) + next + text.slice(start + fm.length)
}

type Keyword = { word: string; n: number; label: string }
const KEYWORDS: Record<string, Keyword[]> = {
  en: [{ word: 'today', n: 0, label: 'Today' }, { word: 'tomorrow', n: 1, label: 'Tomorrow' }, { word: 'yesterday', n: -1, label: 'Yesterday' }],
  cs: [{ word: 'dnes', n: 0, label: 'Dnes' }, { word: 'zítra', n: 1, label: 'Zítra' }, { word: 'včera', n: -1, label: 'Včera' }],
}
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** §6.4: zero or one `@` date row (D-331, D-357). Locale tags match by language. */
export function dateRows(query: string, today: string, locale: string): { date: string; label: string; keyword: string | null }[] {
  const q = query.normalize('NFC').trim()
  if (q === '') return []
  const lang = locale.toLowerCase().split('-')[0]
  const words = [...KEYWORDS.en, ...(lang === 'cs' ? KEYWORDS.cs : [])]
  const fq = fold(q)
  const kw = words.find((k) => fold(k.word).startsWith(fq))
  if (kw) {
    const date = addDays(today, kw.n)
    return [{ date, label: `${kw.label}, ${date}`, keyword: kw.word }]
  }
  if (parseDate(q)) return [{ date: q, label: q, keyword: null }]
  const short = lang === 'cs' ? /^([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{4})$/.exec(q) : lang === 'en' ? /^([0-9]{1,2})\/([0-9]{1,2})\/([0-9]{4})$/.exec(q) : null
  if (short) {
    const [a, b, y] = [Number(short[1]), Number(short[2]), Number(short[3])]
    const [d, m] = lang === 'cs' ? [a, b] : [b, a]
    if (validYmd(y, m, d)) {
      const date = iso(y, m, d)
      return [{ date, label: date, keyword: null }]
    }
  }
  return []
}
