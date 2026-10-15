// The name-ordered parts of the 4A lists, with the region collator (docs/contracts/ms4-links.md §5.1; D-122, D-276,
// D-284, D-290). The core orders system types and instants; only names are sorted here.
import type { BacklinksPanelDto, BrokenGroupDto, DuplicateGroupDto, TypeDefDto } from '../ipc/types';

const FIRST = ['page', 'task', 'quick-note', 'daily-note'];
const LAST = ['image', 'pdf'];

const instant = (v: string | null): number | null => {
  if (!v) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? `${v.trim()}T00:00:00Z` : v);
  return Number.isNaN(t) ? null : t;
};

/** D-121 group order (system types, user types by plural, Image, PDF, undefined types by raw value); entries keep the
 *  core's instant order, those without `modified` last by title. */
export function orderBacklinks(panel: BacklinksPanelDto, types: TypeDefDto[], collator: Intl.Collator): BacklinksPanelDto {
  const plural = (k: string) => types.find((t) => t.key === k)?.plural ?? k;
  const isUser = (k: string) => types.some((t) => t.key === k && !t.system) && !FIRST.includes(k) && !LAST.includes(k);
  const rank = (g: BacklinksPanelDto['groups'][number]): number =>
    FIRST.includes(g.type) ? FIRST.indexOf(g.type) : isUser(g.type) ? 10 : LAST.includes(g.type) ? 20 + LAST.indexOf(g.type) : 30;
  const groups = [...panel.groups]
    .map((g) => {
      const dated = g.entries.filter((e) => e.modified && instant(e.modified) !== null);
      const undated = g.entries.filter((e) => !(e.modified && instant(e.modified) !== null)).sort((a, b) => collator.compare(a.title, b.title));
      return { ...g, entries: [...dated, ...undated] };
    })
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === 10 ? collator.compare(plural(a.type), plural(b.type)) : rank(a) === 30 ? collator.compare(a.raw, b.raw) : 0));
  return { ...panel, groups };
}

export function orderBroken(groups: BrokenGroupDto[], collator: Intl.Collator): BrokenGroupDto[] {
  return [...groups].sort((a, b) => b.count - a.count || collator.compare(a.label, b.label));
}

export function orderDuplicates(groups: DuplicateGroupDto[], collator: Intl.Collator): DuplicateGroupDto[] {
  return [...groups]
    .map((g) => ({
      ...g,
      objects: [...g.objects].sort((a, b) => {
        const x = instant(a.details.created), y = instant(b.details.created);
        return x !== null && y !== null ? x - y : x !== null ? -1 : y !== null ? 1 : 0;
      }),
    }))
    .sort((a, b) => b.objects.length - a.objects.length || collator.compare(a.label, b.label));
}
