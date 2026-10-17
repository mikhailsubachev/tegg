// @tegg/schema: the TypeScript twin of tegg-schema's reading rules (docs/contracts/ms3-shell.md §14.4, D-241).
// Value validity (R10, D-231), input parsing (D-230), key derivation (D-223), name and folder rules (D-222), type
// matching (D-239). Pure TypeScript, platform-neutral (AR-03): no DOM, no Tauri. Checked against the shared corpora
// tests/fixtures/types/{values,rules}.json, which the Rust crate reads too.

import { formatScalar, typeKey as docTypeKey, typeMatch as docTypeMatch, type Value } from '@tegg/doc';

export type { Value };

/** Structural copies of the IPC shapes (`app/ui/src/ipc/types.ts`, §14.3). */
/** `state`: ms5-tasks §2.2 (D-473), a Task status option's `state` as written. */
export type OptionDto = { label: string; color: string | null; state?: string | null };
export type AttributeDto = {
  key: string; name: string; type: string; supported: boolean;
  readOnlyReason: 'file' | 'color' | 'recurrence' | 'unsupported' | null;
  default: unknown | null; required: boolean; options: OptionDto[];
  to: string[] | null; multiple: boolean; description: string | null; builtIn: boolean;
};
export type TypeDto = {
  key: string; name: string; plural: string; folder: string; icon: string; color: string; system: boolean; invalid: boolean;
  exists: boolean; version: unknown | null; state: 'ok' | 'newer' | 'invalid'; error: { message: string; line: number } | null;
  declaredVersion: number | null; description: string | null; review: 'off' | 'on' | 'locked'; preview: string[];
  previewIgnored: string[]; template: string | null; attributes: AttributeDto[];
};

/** AR-07 AC-1. */
export const CURRENT_VERSION = 1;

/** R10, in the order offered (FR-TYP-02 AC-1); labels are catalog keys. */
const R10 = ['text', 'long-text', 'number', 'checkbox', 'date', 'date-time', 'date-range', 'select', 'multi-select', 'url', 'email', 'relation'] as const;
export const ATTR_TYPES: readonly { type: string; label: string }[] = R10.map((type) => ({ type, label: `attrType.${type}` }));

/** R14 (FR-TYP-01 AC-4). */
export const COLORS: readonly string[] = ['gray', 'blue', 'green', 'orange', 'purple', 'red', 'teal', 'yellow'];
export const ICONS: readonly string[] = [
  'file-text', 'check-square', 'zap', 'calendar', 'hash', 'image', 'file', 'book', 'book-open', 'lightbulb', 'users', 'user',
  'folder', 'map', 'star', 'flag', 'bookmark', 'briefcase', 'coffee', 'globe', 'graduation-cap', 'pen-line', 'utensils', 'plane',
];

/** FR-TYP-15. */
const RESERVED = new Set(['id', 'type', 'title', 'description', 'aliases', 'tags', 'created', 'modified', 'source', 'review', 'icon', 'cover', 'previous', 'file', 'import-id', 'captured']);

const nfc = (s: string) => s.normalize('NFC');
const fold = (s: string) => nfc(s).toLowerCase();

/** Universal attributes every type has, with the control type they use (D-248: `source` is text). */
export const UNIVERSAL_ATTRS: Readonly<Record<string, { type: string }>> = {
  description: { type: 'text' },
  source: { type: 'text' },
  aliases: { type: 'multi-select' },
  tags: { type: 'multi-select' },
};

/** The YAML scalar for a text value: plain when YAML allows it, else double-quoted; text with a `[[link]]` and
 *  date-like text are always double-quoted (D-230, D-249, D-257). Same as `@tegg/doc`'s formatter. */
export function formatText(value: string): string {
  return formatScalar(value);
}

/** D-251, D-222, D-259: can a `type:` value without a definition get one as it is? */
export function canDefine(value: string): { ok: true } | { ok: false; reason: 'fileName' } {
  const v = nfc(value).trim();
  const key = typeKey(v);
  if (!v || !key || /[\\/:*?"<>|#^[\]]/.test(v) || new TextEncoder().encode(key).length > 200) return { ok: false, reason: 'fileName' };
  return { ok: true };
}

// ------------------------------------------------------------------------------------------------ keys

/** D-96 / D-239: equal to `@tegg/doc` `typeKey`. */
export function typeKey(name: string): string {
  return docTypeKey(name);
}

/** D-223: as `typeKey`, then characters other than letters, digits, `-` and `_` removed, then leading characters
 *  that aren't letters removed. `Telefon do práce` → `telefon-do-práce`. */
export function deriveAttrKey(name: string): string {
  return typeKey(name).replace(/[^\p{L}\p{N}_-]/gu, '').replace(/^[^\p{L}]+/u, '');
}

/** D-239 (re-export of `@tegg/doc`): absent → Page (single); not one non-empty string → Page, not single. */
export function typeMatch(value: unknown): { key: string; single: boolean } {
  return docTypeMatch(value);
}

// ------------------------------------------------------------------------------------------------ rules (§14.1.2)

export type RuleError = { reason: string; field?: string; key?: string };

/** D-52, D-68: forbidden in names and folder segments, with control characters. */
const FORBIDDEN = /[/:\\*?"<>|#^[\]\p{Cc}]/u;
const utf8Len = (s: string) => new TextEncoder().encode(s).length;

/** FR-TYP-01 AC-3, D-222. A key equal to an undefined `type` value is allowed (it adopts those objects). */
export function checkTypeName(name: string, plural: string, types: TypeDto[], _undefinedKeys: string[]): RuleError | null {
  if (name.trim() === '') return { reason: 'empty', field: 'name' };
  if (plural.trim() === '') return { reason: 'empty', field: 'plural' };
  if (FORBIDDEN.test(name)) return { reason: 'forbiddenChar', field: 'name' };
  if (FORBIDDEN.test(plural)) return { reason: 'forbiddenChar', field: 'plural' };
  const key = typeKey(name);
  if (types.some((t) => fold(t.key) === fold(key))) return { reason: 'keyTaken' };
  if (utf8Len(key) > 200) return { reason: 'keyTooLong' };
  return checkFolder(plural.trim(), types);
}

const SYSTEM_DIRS = new Set(['_templates', '_attachments', '.trash', '.tegg']);

/** FR-TYP-01 AC-5, D-222: relative, `/`-separated, no empty segment, no `..` or `.` segment, not under the system
 *  folders, unique among the other types (case-insensitive, NFC). A trailing `/` is ignored. */
export function checkFolder(folder: string, types: TypeDto[], selfKey?: string): RuleError | null {
  let f = nfc(folder).trim();
  if (f === '') return { reason: 'empty', field: 'folder' };
  if (f.startsWith('/')) return { reason: 'folderInvalid' };
  f = f.replace(/\/+$/, '');
  if (f === '') return { reason: 'folderInvalid' };
  const segs = f.split('/');
  for (const s of segs) {
    if (s === '' || s.startsWith('.')) return { reason: 'folderInvalid' };
  }
  if (SYSTEM_DIRS.has(segs[0].toLowerCase())) return { reason: 'folderInvalid' };
  for (const s of segs) if (FORBIDDEN.test(s)) return { reason: 'forbiddenChar', field: 'folder' };
  const self = selfKey === undefined ? null : fold(selfKey);
  if (types.some((t) => fold(t.key) !== self && fold(t.folder).replace(/\/+$/, '') === fold(f))) return { reason: 'folderTaken' };
  return null;
}

/** FR-TYP-03 AC-2, D-223: letters (any script), digits, `-`, `_`, starting with a letter; not reserved (any case);
 *  unique in the type; no date-range collision. */
export function checkAttrKey(key: string, type: TypeDto, attrType: string): RuleError | null {
  const k = nfc(key);
  if (k === '') return { reason: 'empty', field: 'attrKey' };
  if (RESERVED.has(k.toLowerCase())) return { reason: 'reservedKey', key };
  if (!/^\p{L}[\p{L}\p{N}_-]*$/u.test(k)) return { reason: 'attrKeyInvalid' };
  const keys = type.attributes.map((a) => nfc(a.key));
  if (keys.includes(k)) return { reason: 'attrKeyTaken' };
  for (const a of type.attributes) {
    if (a.type === 'date-range' && (k === `${nfc(a.key)}-start` || k === `${nfc(a.key)}-end`)) return { reason: 'rangeCollision' };
  }
  if (attrType === 'date-range' && (keys.includes(`${k}-start`) || keys.includes(`${k}-end`))) return { reason: 'rangeCollision' };
  return null;
}

// ------------------------------------------------------------------------------------------------ validity (§14.1.3)

export type Validity = { state: 'empty' | 'valid' } | { state: 'invalid'; items: number[] };

const EMPTY: Validity = { state: 'empty' };
const VALID: Validity = { state: 'valid' };
const WHOLE: Validity = { state: 'invalid', items: [] };

function lookup(data: Record<string, unknown>, key: string): unknown {
  if (key in data) return data[key];
  const k = nfc(key);
  for (const [dk, v] of Object.entries(data)) if (nfc(dk) === k) return v;
  return undefined;
}
const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function isCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  return validYmd(+m[1], +m[2], +m[3]);
}
function validYmd(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}
function isDateTime(s: string): boolean {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(s);
  if (!m || !isCalendarDate(m[1])) return false;
  if (+m[2] > 23 || +m[3] > 59 || +m[4] > 60) return false;
  return m[7] === undefined || (+m[7] <= 23 && +m[8] <= 59);
}
function isUrl(s: string): boolean {
  if (!/^https?:\/\//i.test(s) || /\s/.test(s)) return false;
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '';
  } catch {
    return false;
  }
}
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const isLink = (v: unknown) => typeof v === 'string' && /^\[\[[^\n]+\]\]$/.test(v);
const isScalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** R10 "Valid when read" (D-231). Empty (absent, null, "", []) is never invalid; `items` are invalid list positions
 *  (empty = the whole value). Types not in R10 are always valid (read-only). */
export function validate(attr: AttributeDto, data: Record<string, unknown>): Validity {
  const t = attr.type;
  if (!(R10 as readonly string[]).includes(t)) return VALID;
  if (t === 'date-range') {
    const s = lookup(data, `${attr.key}-start`);
    const e = lookup(data, `${attr.key}-end`);
    if (isEmpty(s) && isEmpty(e)) return EMPTY;
    for (const h of [s, e]) if (!isEmpty(h) && !(typeof h === 'string' && isCalendarDate(h))) return WHOLE;
    if (!isEmpty(s) && !isEmpty(e) && (e as string) < (s as string)) return WHOLE;
    return VALID;
  }
  const v = lookup(data, attr.key);
  if (isEmpty(v)) return EMPTY;
  const ok = (b: boolean): Validity => (b ? VALID : WHOLE);
  const options = new Set(attr.options.map((o) => nfc(o.label)));
  switch (t) {
    case 'text':
    case 'long-text':
      return ok(isScalar(v));
    case 'number':
      return ok(typeof v === 'number');
    case 'checkbox':
      return ok(typeof v === 'boolean');
    case 'date':
      return ok(typeof v === 'string' && isCalendarDate(v));
    case 'date-time':
      return ok(typeof v === 'string' && isDateTime(v));
    case 'select':
      return ok(typeof v === 'string' && options.has(nfc(v)));
    case 'multi-select': {
      const list = typeof v === 'string' ? [v] : v;
      if (!Array.isArray(list)) return WHOLE;
      const items = list.flatMap((x, i) => (typeof x === 'string' && options.has(nfc(x)) ? [] : [i]));
      return items.length ? { state: 'invalid', items } : VALID;
    }
    case 'url':
      return ok(typeof v === 'string' && isUrl(v));
    case 'email':
      return ok(typeof v === 'string' && isEmail(v));
    case 'relation': {
      if (!attr.multiple) return ok(isLink(v));
      if (typeof v === 'string') return ok(isLink(v));
      if (!Array.isArray(v)) return WHOLE;
      const items = v.flatMap((x, i) => (isLink(x) ? [] : [i]));
      return items.length ? { state: 'invalid', items } : VALID;
    }
  }
  return VALID;
}

// ------------------------------------------------------------------------------------------------ input (D-230)

/** Committed input → the Value to write, or a catalog error key. */
export type Parsed = { ok: true; value: Value } | { ok: false; error: string };
const fail = (error: string): Parsed => ({ ok: false, error });

function separators(region: string): { decimal: string; group: string } {
  try {
    const parts = new Intl.NumberFormat(region || undefined).formatToParts(12345.5);
    return { decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.', group: parts.find((p) => p.type === 'group')?.value ?? ',' };
  } catch {
    return { decimal: '.', group: ',' };
  }
}

/** `3,5`, `3.5` → 3.5; `250 000` (space, no-break space, narrow no-break space) → 250000. Written with `.`. */
export function parseNumber(text: string, region: string): Parsed {
  let s = text.trim().replace(/[\s   ]/g, '').replace(/−/g, '-');
  if (s === '') return fail('value.notNumber');
  const { decimal } = separators(region);
  if (decimal === ',') {
    if ((s.match(/,/g) ?? []).length > 1 || (s.includes(',') && s.includes('.'))) return fail('value.notNumber');
    s = s.replace(',', '.');
  } else if (s.includes(',')) {
    // A region with a decimal point: commas are group separators only in groups of three.
    if (!/^[-+]?\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) return fail('value.notNumber');
    s = s.replace(/,/g, '');
  }
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(s)) return fail('value.notNumber');
  const n = Number(s);
  return Number.isFinite(n) ? { ok: true, value: n } : fail('value.notNumber');
}

function monthFirst(region: string): boolean {
  try {
    const parts = new Intl.DateTimeFormat(region || undefined, { timeZone: 'UTC' }).formatToParts(new Date(Date.UTC(2026, 10, 22)));
    return parts.findIndex((p) => p.type === 'month') < parts.findIndex((p) => p.type === 'day');
  } catch {
    return false;
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** `8. 10. 2026` (day first), `2026-10-08`, or the region's slash order → `{ date }`. Pure calendar arithmetic, so the
 *  result never depends on the time zone (FR-EDT-07 AC-5). Impossible dates are refused. */
export function parseDate(text: string, region: string): Parsed {
  const s = text.trim();
  let y: number, mo: number, d: number;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/.exec(s))) [d, mo, y] = [+m[1], +m[2], +m[3]];
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) {
    [d, mo, y] = monthFirst(region) ? [+m[2], +m[1], +m[3]] : [+m[1], +m[2], +m[3]];
  } else return fail('value.notDate');
  if (!validYmd(y, mo, d)) return fail('value.notDate');
  return { ok: true, value: { date: `${pad(y, 4)}-${pad(mo)}-${pad(d)}` } };
}

/** Offset (minutes east of UTC) of `zone` at the instant `utcMs`. */
function offsetAt(utcMs: number, zone: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(utcMs))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((wall - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** A local date and time in `zone` (default: Intl's zone) → `{ datetime }` with that moment's offset. A time in a
 *  spring-forward gap is refused (`value.timeNotExist`); an ambiguous one takes the first occurrence (D-230). */
export function parseDateTime(date: string, time: string, zone?: string): Parsed {
  const pd = parseDate(date, '');
  if (!pd.ok) return pd;
  const ymd = (pd.value as { date: string }).date;
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!tm || +tm[1] > 23 || +tm[2] > 59 || +(tm[3] ?? 0) > 59) return fail('value.notTime');
  const [y, mo, d] = ymd.split('-').map(Number);
  const [h, mi, se] = [+tm[1], +tm[2], +(tm[3] ?? 0)];
  const tz = zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const wall = Date.UTC(y, mo - 1, d, h, mi, se);
  const offsets = new Set([-864e5, 0, 864e5].map((dt) => offsetAt(wall + dt, tz)));
  const hits = [...offsets].map((o) => wall - o * 60000).filter((u) => offsetAt(u, tz) === (wall - u) / 60000).sort((a, b) => a - b);
  if (hits.length === 0) return fail('value.timeNotExist');
  const off = (wall - hits[0]) / 60000;
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return { ok: true, value: { datetime: `${ymd}T${pad(h)}:${pad(mi)}:${pad(se)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}` } };
}

/** An absolute `http`/`https` URL, kept as typed (trimmed). */
export function parseUrl(text: string): Parsed {
  const s = text.trim();
  return isUrl(s) ? { ok: true, value: s } : fail('value.notUrl');
}

/** `local@domain`, a dot in the domain, no whitespace. */
export function parseEmail(text: string): Parsed {
  const s = text.trim();
  return isEmail(s) ? { ok: true, value: s } : fail('value.notEmail');
}

/** Both halves as `YYYY-MM-DD` or null; the value is `[start, end]` (each `{ date }` or null). End before start is
 *  refused (FR-TYP-02 AC-3). */
export function parseDateRange(start: string | null, end: string | null): Parsed {
  const half = (h: string | null): Value | undefined => {
    if (h === null || h.trim() === '') return null;
    const p = parseDate(h, '');
    return p.ok ? p.value : undefined;
  };
  const s = half(start);
  const e = half(end);
  if (s === undefined || e === undefined) return fail('value.notDate');
  if (s && e && (e as { date: string }).date < (s as { date: string }).date) return fail('value.endBeforeStart');
  return { ok: true, value: [s, e] };
}

// ------------------------------------------------------------------------------------------------ slice 5A-1 (ms5-tasks §2.2)
// Stubs until 5A-1 is built: deliberately wrong results so the red tests fail on their assertions (TS-I1).

export type TaskState = 'open' | 'in-progress' | 'done' | 'cancelled';

/** D-471: an option's semantic state; absent or unknown `state` is Open. Stub: always 'open'. */
export function taskState(_option: OptionDto): TaskState {
  return 'open';
}

/** D-473: `needOpen` / `needDone` when no status option with state Open / Done remains. Stub: never refuses. */
export function checkStatusOptions(_options: OptionDto[]): RuleError | null {
  return null;
}
