// The sidebar's Types list (D-121): Page, Task, Quick Note, Daily Note, then user types by plural (D-122), then
// Image and PDF; Tag is not listed. A `type` value without a definition gets its own entry after the rest.
import type { TypeDefDto } from '../ipc/types';
import { collator } from '../i18n/collate';

export type TypeEntry = { key: string; plural: string; name: string; color: string; icon: string; count: number; defined: boolean; folder: string };

const HEAD = ['page', 'task', 'quick-note', 'daily-note'];
const TAIL = ['image', 'pdf'];

export function typeEntries(types: TypeDefDto[], counts: Record<string, number>): TypeEntry[] {
  const entry = (t: TypeDefDto): TypeEntry => ({ key: t.key, plural: t.plural, name: t.name, color: t.color, icon: t.icon, count: counts[t.key] ?? 0, defined: true, folder: t.folder });
  const byKey = new Map(types.map((t) => [t.key.normalize('NFC'), t]));
  const head = HEAD.flatMap((k) => (byKey.has(k) ? [entry(byKey.get(k)!)] : []));
  const tail = TAIL.flatMap((k) => (byKey.has(k) ? [entry(byKey.get(k)!)] : []));
  const c = collator();
  const user = types.filter((t) => !HEAD.includes(t.key) && !TAIL.includes(t.key) && t.key !== 'tag').map(entry).sort((a, b) => c.compare(a.plural, b.plural));
  const undefinedTypes = Object.entries(counts)
    .filter(([k, n]) => n > 0 && !byKey.has(k.normalize('NFC')))
    .map(([k, n]): TypeEntry => ({ key: k, plural: k, name: k, color: '', icon: '', count: n, defined: false, folder: '' }))
    .sort((a, b) => c.compare(a.plural, b.plural));
  return [...head, ...user, ...tail, ...undefinedTypes];
}

/** The plural shown for a type value: its definition's plural, or the raw value (D-121). */
export function pluralOf(types: TypeDefDto[], key: string): string {
  return types.find((t) => t.key === key.normalize('NFC'))?.plural ?? key;
}
