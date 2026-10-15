// The details line that tells objects with the same title apart (FR-LNK-14 AC-6, D-289, D-308): type name · created
// date (medium, machine zone) · up to 2 preview values (40 characters each) · the file stem when it differs.
import type { DuplicateDetailsDto } from '../ipc/types';
import { formatDateTime, formatDate } from '../read/PropertiesStrip';
import { region } from '../i18n/collate';

const cut = (s: string) => ([...s].length > 40 ? `${[...s].slice(0, 39).join('')}…` : s);

function created(v: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return formatDate(v);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const locale = region() ?? (typeof navigator !== 'undefined' ? navigator.language : 'en');
  void formatDateTime;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
}

function valueText(v: unknown): string {
  if (Array.isArray(v)) return v.map(valueText).join(', ');
  if (typeof v === 'string') return v.replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, a: string, b?: string) => b ?? a);
  if (v === null || v === undefined) return '';
  return String(v);
}

export function detailsText(d: DuplicateDetailsDto, typeName: string): string {
  const parts = [typeName];
  if (d.created) parts.push(created(d.created));
  for (const [, v] of d.preview) { const s = valueText(v); if (s) parts.push(cut(s)); }
  if (d.stem) parts.push(d.stem);
  return parts.join(' · ');
}

export function DuplicateDetails({ details, typeName }: { details: DuplicateDetailsDto; typeName: string }) {
  return <span className="meta details" data-user-content>{detailsText(details, typeName)}</span>;
}
