// `All tasks` (D-516): the type page of Task (FR-TYP-09) under the Tasks header (D-517), on route `type/task`.
import { useEffect, type ComponentProps } from 'react';
import { t } from '../i18n/catalog';
import { TypePage } from '../pages/TypePage';
import { TasksHeader, tasksSummary, type TasksView } from './TasksHeader';
import { useTasks } from './useTasks';
import { counts as countsOf } from './views';

export function AllTasks({ go, onShown, ...page }: ComponentProps<typeof TypePage> & { go: (view: TasksView) => void; /** Remembers `all` as the last view (D-481). */ onShown: () => void }) {
  useEffect(() => { onShown(); }, []);
  const { tasks, defs, today, firstWeekday, zone, region, loaded } = useTasks(page.refresh);
  const c = countsOf({ tasks, defs, today, firstWeekday, collator: new Intl.Collator(region), dateFilter: 'all', tagFilter: [], timeZone: zone });
  const name = page.type?.name ?? page.typeKey;
  const [before, after = ''] = t('cmd.newOfType', { name: '\u0000' }).split('\u0000');
  const header = (
    <TasksHeader view="all" heading={page.heading} summary={loaded ? tasksSummary(c) : null} go={go} onSettings={page.onSettings}>
      {page.type && (
        <button tabIndex={0} type="button" className="text-button primary" data-command="type.newObject" onClick={page.onNew}>
          {before}<span data-user-content>{name}</span>{after}
        </button>
      )}
    </TasksHeader>
  );
  return <TypePage {...page} header={header} />;
}
