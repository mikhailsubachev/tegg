// Slice AND-2 (docs/contracts/android-phone.md §4.3; FR-TYP-09 AC-37, FR-QRY-05 AC-34, D-2196): the view-only line
// under a type page's or query page's tabs.
import { t } from '../i18n/catalog';
import type { SortDto } from '../ipc/queries';
import type { TypeDto } from '../ipc/types';
import { orderLabels } from '../queries/sort';
import { sortKeyName } from '../queries/SortPopover';

export function phoneSortLine(sort: readonly SortDto[], type: TypeDto | null | undefined): string {
  if (sort.length === 0) return t('phone.viewOnly');
  const [first] = sort;
  const labels = orderLabels(first.by, type);
  let line = t('phone.sortLine', { column: sortKeyName(first.by, type).label, order: first.order === 'asc' ? labels.asc : labels.desc });
  if (sort.length > 1) line += ' ' + t('sort.more', { count: sort.length - 1 });
  return t('phone.sortLineJoin', { sort: line, viewOnly: t('phone.viewOnly') });
}
