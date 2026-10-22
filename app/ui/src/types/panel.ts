// The attribute panel's row model (FR-EDT-07 AC-1, AC-2, D-229; ms3-shell §14.7.1). Rows: the type's attributes in
// schema order (a date range once), then the universal Tags, Aliases, Source, Review (when the workflow is on or
// locked, or the note has `review`), Created, Modified. Other properties are the remaining non-empty keys in file
// order. The type's hidden properties (FR-TYP-17, D-316) leave the rows for the Other properties group. Validity comes
// from @tegg/schema (D-231); nothing here writes.
import type { Doc } from '@tegg/doc';
import { typeMatch, validate, type Validity } from '@tegg/schema';
import { t } from '../i18n/catalog';
import type { AttributeDto, TypeDto } from '../ipc/types';

export type PanelRow = {
  key: string;
  label: string;
  attr: AttributeDto | null;
  raw: unknown;
  validity: Validity;
  editable: boolean;
  required: boolean;
};

/** Keys never shown as rows (read-view FR-TYP-08 AC-1); `description` is the subtitle. */
export const HIDDEN_KEYS = new Set(['id', 'type', 'title', 'description', 'icon', 'cover', 'import-id', 'previous', 'captured']); // captured: D-595
export const UNIVERSAL_KEYS = ['tags', 'aliases', 'source', 'review', 'created', 'modified'] as const;
const LABEL: Record<string, string> = {
  tags: 'attr.tags', aliases: 'attr.aliases', source: 'attr.source', review: 'attr.review', created: 'attr.created', modified: 'attr.modified',
};

const nfc = (s: string) => s.normalize('NFC');
const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** The universal Source attribute: free text on every type (D-248; FR-TYP-08 AC-13). */
export const SOURCE_ATTR: AttributeDto = {
  key: 'source', name: 'Source', type: 'text', supported: true, readOnlyReason: null, default: null, required: false,
  options: [], to: null, multiple: false, description: null, builtIn: false,
};

function lookup(data: Record<string, unknown>, key: string): unknown {
  if (key in data) return data[key];
  const k = nfc(key);
  for (const [dk, v] of Object.entries(data)) if (nfc(dk) === k) return v;
  return undefined;
}

function universalValidity(key: string, v: unknown): Validity {
  if (isEmpty(v)) return { state: 'empty' };
  if (key === 'source') return { state: 'valid' }; // any value is text (D-248)
  if (key === 'review') return v === 'unreviewed' || v === 'reviewed' ? { state: 'valid' } : { state: 'invalid', items: [] };
  if (key === 'tags' || key === 'aliases') {
    if (typeof v === 'string') return { state: 'valid' };
    if (!Array.isArray(v)) return { state: 'invalid', items: [] };
    const items = v.flatMap((x, i) => (typeof x === 'string' || typeof x === 'number' ? [] : [i]));
    return items.length ? { state: 'invalid', items } : { state: 'valid' };
  }
  return { state: 'valid' };
}

export function panelRows(doc: Doc, type: TypeDto): {
  subtitle: string | null;
  rows: PanelRow[];
  /** Rows of the type's hidden properties, in row order; shown under Other properties (D-316). */
  hidden: PanelRow[];
  other: { key: string; value: unknown }[];
  typeWarning: boolean;
} {
  const fm = doc.frontmatter;
  const data: Record<string, unknown> = (fm && !fm.error && fm.data) || {};
  const writable = !fm?.error && !doc.frontmatterError;
  const desc = data.description;
  const subtitle = typeof desc === 'string' && desc.trim() !== '' ? desc : null;
  const rows: PanelRow[] = [];
  const claimed = new Set<string>();
  for (const a of type.attributes) {
    const key = nfc(a.key);
    let raw: unknown;
    if (a.type === 'date-range') {
      claimed.add(`${key}-start`);
      claimed.add(`${key}-end`);
      const s = lookup(data, `${key}-start`);
      const e = lookup(data, `${key}-end`);
      raw = isEmpty(s) && isEmpty(e) ? null : { start: isEmpty(s) ? null : s, end: isEmpty(e) ? null : e };
    } else {
      claimed.add(key);
      raw = lookup(data, key);
    }
    rows.push({
      key, label: a.name, attr: a as AttributeDto, raw: raw ?? null, validity: validate(a as never, data) as Validity,
      editable: writable && a.readOnlyReason === null && a.supported, required: a.required,
    });
  }
  const showReview = type.review === 'on' || type.review === 'locked' || 'review' in data;
  for (const key of UNIVERSAL_KEYS) {
    if (claimed.has(key)) continue;
    claimed.add(key);
    if (key === 'review' && !showReview) continue;
    const raw = lookup(data, key);
    rows.push({
      key, label: t(LABEL[key]), attr: null, raw: raw ?? null, validity: universalValidity(key, raw),
      editable: writable && key !== 'created' && key !== 'modified', required: false,
    });
  }
  const other: { key: string; value: unknown }[] = [];
  const seen = new Set<string>();
  for (const e of fm?.entries ?? []) {
    const k = nfc(e.key);
    if (seen.has(k) || claimed.has(k) || HIDDEN_KEYS.has(k)) continue;
    seen.add(k);
    const v = lookup(data, k);
    if (isEmpty(v)) continue;
    other.push({ key: e.key, value: v });
  }
  const hiddenKeys = new Set((type.hidden ?? []).map(nfc));
  return {
    subtitle,
    rows: rows.filter((r) => !hiddenKeys.has(r.key)),
    hidden: rows.filter((r) => hiddenKeys.has(r.key)),
    other,
    typeWarning: !typeMatch(data.type).single,
  };
}
