// Slice Q2-T: `Filter by tag` in a type page's toolbar, on every view tab and on `All <plural>` (docs/contracts/
// v1-views.md §29.6, §30.1; D-1892…D-1894, D-1908): the Tasks tag filter (D-518), a combobox with the selected tags as
// chips (`data-tag`) and a `Filter by tag` button that opens its list. Options and counts come from `tagOptions` over the rows the tab
// shows before the tag and text filters. The selection is the caller's (kept per tab on this Mac, `ui-state.json`).
import { t } from '../i18n/catalog';
import { collator } from '../i18n/collate';
import { TagFilter } from '../tasks/TagFilter';
import { useTagLook } from '../tags/store';
import { tagOptions } from './tagFilter';

export function TagFilterControl({ rows, selected, onChange, command = 'views.tagFilter', allHint = null }: {
  rows: readonly { tags: readonly string[] }[];
  selected: string[];
  onChange: (tags: string[]) => void;
  command?: string;
  /** The hint under two or more chips (D-518's `Tasks with all selected tags` on the Tasks page). */
  allHint?: string | null;
}) {
  const look = useTagLook();
  const options = tagOptions(rows, selected, (k) => look(k).name, collator());
  return (
    <TagFilter tags={options} selected={selected} onChange={onChange} allHint={allHint ?? ''}
      button={{ label: t('tasks.tagFilter'), command }} />
  );
}
