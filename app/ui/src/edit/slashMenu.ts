// The slash menu's model (docs/acceptance/new-object-menu.md R234, R235; contract docs/contracts/new-object-menu.md §2;
// D-2483, D-2490…D-2492, D-2506, D-2508): the registry's static rows (R6 as reordered by R234), then the computed New
// object group, one `New <type>` row per creatable type of the vault; filtering over every group; the `+` trigger.
import { t } from '../i18n/catalog';
import { collator } from '../i18n/collate';
import type { TypeDefDto } from '../ipc/types';
import { rank } from '../shell/commands';
import { SLASH_ITEMS, type SlashDef } from '../shell/registry';

export type MenuRow = {
  /** The static row's id, or `new:<type key>`. */
  id: string;
  group: 'blocks' | 'objects' | 'media' | 'advanced' | 'newObject';
  /** The shown text: the catalog text, `New <type name>` for a New row. */
  label: string;
  /** `Block embed` (Coming in v1.0). */
  disabled: boolean;
  /** New rows: the type key. */
  type?: string;
  /** New rows: the type file's `icon`. */
  icon?: string;
  /** Static rows: the registry entry. */
  def?: SlashDef;
};

const FIRST = ['page', 'task', 'quick-note'];

/** Page, Task, Quick Note, then the user types by name in the region's order (D-122); never Daily Note, Tag, Image,
 *  PDF or a type whose file doesn't parse (D-2490). The `New object` picker's targets (capture.md FR-VLT-05 AC-8). */
export function creatableTypes(types: TypeDefDto[]): TypeDefDto[] {
  const first = FIRST.map((k) => types.find((x) => x.key.normalize('NFC') === k)).filter((x): x is TypeDefDto => !!x && !x.invalid);
  const c = collator();
  const user = types.filter((x) => !x.system && !x.invalid && !FIRST.includes(x.key.normalize('NFC'))).sort((a, b) => c.compare(a.name, b.name));
  return [...first, ...user];
}

/** The rows the menu shows for `query`, in display order. With `/` the ranking of FR-EDT-03 AC-2 over every group;
 *  with `+` the matching New rows first, then the other matches in `/`'s order (D-2508). */
export function menuRows(o: { types: TypeDefDto[]; query: string; trigger: '/' | '+' }): MenuRow[] {
  const statics: MenuRow[] = SLASH_ITEMS.map((def) => ({ id: def.id, group: def.group, label: t(def.label), disabled: !def.status.built, def }));
  const news: MenuRow[] = creatableTypes(o.types).map((ty) => ({
    id: `new:${ty.key}`, group: 'newObject', label: t('slash.newObject', { type: ty.name }), disabled: false, type: ty.key, icon: ty.icon,
  }));
  const all = [...statics, ...news];
  const q = o.query.normalize('NFC').trim();
  if (!q) return all;
  // R235 (AP-2124): `+1`, `+420` are numbers, not a query: no row matches them, so ⏎ does what it does without a menu.
  if (o.trigger === '+' && /^\p{N}/u.test(q)) return [];
  const ranked = rank(q, all.map((r) => ({ ...r, title: r.label }))).map(({ title: _t, ...r }) => r as MenuRow);
  const ordered = o.trigger === '/' ? ranked : [...ranked.filter((r) => r.group === 'newObject'), ...ranked.filter((r) => r.group !== 'newObject')];
  // Each group with a match is shown once under its header (D-2508): the groups in the order of their best match,
  // the rows inside a group in rank order, so the best match stays first.
  const groups: MenuRow['group'][] = [];
  for (const r of ordered) if (!groups.includes(r.group)) groups.push(r.group);
  return groups.flatMap((g) => ordered.filter((r) => r.group === g));
}

/** The row an opened menu selects: `New Page` (the first New row) for `+` without a query (D-2508), else the first
 *  enabled row. */
export function firstRow(rows: MenuRow[], trigger: '/' | '+', query: string): number {
  const i = trigger === '+' && !query.trim() ? rows.findIndex((r) => r.group === 'newObject') : rows.findIndex((r) => !r.disabled);
  return i < 0 ? 0 : i;
}

/** R235 (D-2506): `+` opens the menu at the start of a block or after whitespace; never inside a word or after
 *  punctuation. `before` is the text block's text before the `+`. Where `+` never opens (code, links, fields) is the
 *  editor's context, not this function's. */
export function plusOpens(before: string): boolean {
  return before === '' || /\s$/u.test(before);
}
