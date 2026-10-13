// Attribute strip rows (FR-TYP-08 display, D-147; ms3-shell §11.3). Order: tags, aliases, other attributes in file
// order, then source, review, created, modified; `description` is the subtitle. Read-only (editing is 3D).
import type { Doc } from '@tegg/doc';
import { t } from '../i18n/catalog';

export type AttrRow = {
  key: string;
  label: string;
  value:
    | { kind: 'text' | 'number'; text: string }
    | { kind: 'checkbox'; checked: boolean }
    | { kind: 'date'; date: string }
    | { kind: 'datetime'; datetime: string }
    | { kind: 'range'; start: string; end: string }
    | { kind: 'tags'; tags: string[] }
    | { kind: 'links'; targets: string[] }
    | { kind: 'list'; items: string[] }
    | { kind: 'review'; value: string }
    | { kind: 'yaml'; source: string };
};

const HIDDEN = new Set(['id', 'type', 'title', 'description', 'icon', 'cover', 'import-id', 'previous', 'file']);
const FIRST = ['tags', 'aliases'];
const LAST = ['source', 'review', 'created', 'modified'];
const LABELS: Record<string, string> = {
  tags: 'attr.tags', aliases: 'attr.aliases', source: 'attr.source', review: 'attr.review', created: 'attr.created', modified: 'attr.modified',
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const LINK = /^\[\[([^\]]+)\]\]$/;

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

/** `[[Target#sub|alias]]` → `Target`. */
function linkTarget(s: string): string | null {
  const m = LINK.exec(s.trim());
  if (!m) return null;
  return m[1].split(/\\?\|/)[0].split('#')[0].trim();
}

function value(key: string, v: unknown, source: string): AttrRow['value'] {
  if (key === 'tags') return { kind: 'tags', tags: (Array.isArray(v) ? v : [v]).map((x) => String(x).replace(/^#/, '')) };
  if (key === 'review' && typeof v === 'string') return { kind: 'review', value: v };
  if (typeof v === 'boolean') return { kind: 'checkbox', checked: v };
  if (typeof v === 'number') return { kind: 'number', text: String(v) };
  if (typeof v === 'string') {
    const link = linkTarget(v);
    if (link !== null) return { kind: 'links', targets: [link] };
    if (DATE.test(v)) return { kind: 'date', date: v };
    if (DATETIME.test(v)) return { kind: 'datetime', datetime: v };
    return { kind: 'text', text: v };
  }
  if (v instanceof Date) return { kind: 'datetime', datetime: v.toISOString() };
  if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) {
    const links = v.map((x) => linkTarget(String(x)));
    if (links.every((x) => x !== null)) return { kind: 'links', targets: links as string[] };
    return { kind: 'list', items: v.map(String) };
  }
  return { kind: 'yaml', source };
}

export function attributeRows(doc: Doc): { subtitle: string | null; rows: AttrRow[] } {
  const fm = doc.frontmatter;
  const data = fm?.data;
  if (!fm || !data) return { subtitle: null, rows: [] };
  const desc = data.description;
  const subtitle = typeof desc === 'string' && desc.trim() !== '' ? desc.trim() : null;
  const entrySource = new Map(fm.entries.map((e) => [e.key, doc.text.slice(e.range[0], e.range[1]).replace(/\r?\n$/, '')]));
  const keys = fm.entries.map((e) => e.key).filter((k, i, a) => a.indexOf(k) === i);
  const rows: AttrRow[] = [];
  const ranges = new Set<string>();
  for (const k of keys) {
    const base = k.endsWith('-start') ? k.slice(0, -6) : k.endsWith('-end') ? k.slice(0, -4) : null;
    if (base && keys.includes(`${base}-start`) && keys.includes(`${base}-end`)) {
      if (ranges.has(base)) continue;
      ranges.add(base);
      const s = data[`${base}-start`];
      const e = data[`${base}-end`];
      if (isEmpty(s) && isEmpty(e)) continue;
      rows.push({ key: base, label: base.normalize('NFC'), value: { kind: 'range', start: String(s ?? ''), end: String(e ?? '') } });
      continue;
    }
    if (HIDDEN.has(k) || isEmpty(data[k])) continue;
    rows.push({ key: k, label: LABELS[k] ? t(LABELS[k]) : k.normalize('NFC'), value: value(k, data[k], entrySource.get(k) ?? '') });
  }
  const rank = (k: string) => (FIRST.includes(k) ? FIRST.indexOf(k) - 10 : LAST.includes(k) ? 100 + LAST.indexOf(k) : 0);
  rows.sort((a, b) => rank(a.key) - rank(b.key)); // stable: file order within the middle group
  return { subtitle, rows };
}
