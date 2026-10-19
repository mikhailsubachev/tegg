// Shared helpers of the 3D type UI (ms3-shell §14.7): error messages, attribute-type labels, value display in the
// region format (D-160, FR-FMT-11: dates are never shifted by a time zone) and type lookup by matched key (D-239).
import { dateTimeSetting, formatDateTime as formatDateTimeWith } from '../i18n/dates';
import { appZone } from '../zone';
import { COLORS, typeMatch } from '@tegg/schema';
import { t } from '../i18n/catalog';
import { region } from '../i18n/collate';
import type { TypeDto } from '../ipc/types';
import { errorMessage } from '../pages/Chooser';

export const nfc = (s: string) => s.normalize('NFC');
/** An R14 colour token name; unknown names show as the first (gray) and the file is unchanged (D-236). */
export const colorName = (c: string | null | undefined): string => (c && COLORS.includes(c) ? c : COLORS[0]);
export const locale = () => region() ?? (typeof navigator !== 'undefined' ? navigator.language : 'en');

/** A core error as a catalog message (NFR-OTH-02 AC-2): `Rule` → `typeRule.<reason>`, else `error.<Kind>`. */
export function typeErrorMessage(e: unknown): string {
  const x = (e ?? {}) as { kind?: string; reason?: string; key?: string; label?: string; field?: string };
  if (x.kind === 'Rule' && x.reason) return t(`typeRule.${x.reason}`, { key: x.key ?? '', label: x.label ?? '', field: x.field ?? '' });
  if (x.kind === 'NameTaken') return t('newType.exists');
  if (x.kind && `error.${x.kind}` !== t(`error.${x.kind}`)) return t(`error.${x.kind}`);
  return errorMessage(x.kind ?? 'Unknown');
}

/** The R10 label of an attribute type; a type outside R10 (`rating`) is shown with a capital letter. */
export function attrTypeLabel(type: string): string {
  const k = `attrType.${type}`;
  const s = t(k);
  return s === k ? type.charAt(0).toUpperCase() + type.slice(1) : s;
}

/** The type whose key matches the note's `type` value (FR-TYP-13); Page when none or undefined (D-121 keeps the
 *  raw value for the sidebar, the panel shows the Page schema then). */
export function typeOfValue(types: TypeDto[], value: unknown): { type: TypeDto | null; key: string; single: boolean } {
  const m = typeMatch(value);
  const key = nfc(m.key);
  const def = types.find((x) => nfc(x.key) === key) ?? null;
  return { type: def, key, single: m.single };
}

/** A blank Page definition, for vaults whose Page type is missing from `vault_types` (never written). */
export function pageFallback(types: TypeDto[]): TypeDto {
  return types.find((x) => x.key === 'page') ?? {
    key: 'page', name: 'Page', plural: 'Pages', folder: 'Pages', icon: 'file-text', color: COLORS[0], system: true, invalid: false, exists: false,
    version: null, state: 'ok', error: null, declaredVersion: null, description: null, review: 'off', preview: [], previewIgnored: [], hidden: [], embed: 'full', embedRaw: null, template: null, attributes: [],
  };
}

const ymd = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` as the region's numeric date (`7. 10. 2026` for cs), never shifted; anything else as written. */
export function dateText(v: unknown): string {
  if (typeof v !== 'string') return v === null || v === undefined ? '' : String(v);
  const m = ymd.exec(v.trim());
  if (!m) return v;
  if (dateTimeSetting()?.date === 'iso') return `${m[1]}-${m[2]}-${m[3]}`; // FR-SET-03: ISO reads back as a date (D-566)
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(+m[1], +m[2] - 1, +m[3]));
}

/** A date-time as its local date and `HH:MM` in the machine's zone (D-104), or null when it isn't one. */
export function dateTimeParts(v: unknown): { date: string; time: string; ymd: string } | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  const iso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return { date: dateText(iso), time: `${p(d.getHours())}:${p(d.getMinutes())}`, ymd: iso };
}

/** A date-time in the region format for read-only cells and Created/Modified (D-160). */
export function dateTimeText(v: unknown): string {
  if (typeof v !== 'string') return v === null || v === undefined ? '' : String(v);
  const d = new Date(v);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(v) || Number.isNaN(d.getTime())) return v;
  const s = dateTimeSetting(); // FR-SET-03 (D-566)
  if (s && (s.date !== 'region' || s.time !== 'region')) return formatDateTimeWith(v, s, appZone());
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

/** Any frontmatter value as plain text (lists joined), for raw display of invalid and read-only values. */
export function rawText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(rawText).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** `[[Target#sub|Alias]]` → its parts. */
export function wiki(v: unknown): { target: string; alias: string | null; inner: string } | null {
  if (typeof v !== 'string') return null;
  const m = /^\[\[([^\n]+)\]\]$/.exec(v.trim());
  if (!m) return null;
  const inner = m[1];
  const bar = inner.search(/\\?\|/);
  const head = bar >= 0 ? inner.slice(0, bar) : inner;
  const alias = bar >= 0 ? inner.slice(bar).replace(/^\\?\|/, '') : null;
  return { target: head.split('#')[0].trim(), alias: alias && alias.trim() ? alias.trim() : null, inner };
}
