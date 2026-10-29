// The preview-attribute strip (FR-TYP-11; D-427): the type's preview properties that are set, in preview order,
// formatted as on the type page. Embed cards (ms4-embeds §6) and object previews (v1-previews §3.4) share it.
import { t } from '../i18n/catalog';
import type { LinkTargetDto, TypeDto } from '../ipc/types';
import { chipTypes } from '../links/icons';
import { formatDate } from '../read/PropertiesStrip';
import { TypeCell, type TypeColumn } from '../types/cell';
import { chipState } from '../links/chip';
import { currentRegion } from '../tasks/useTasks';
import { dueLabel } from '../tasks/views';
import { appZone, localDate } from '../zone';

const nfc = (s: string) => s.normalize('NFC');
const UNIVERSAL: Record<string, string> = { tags: 'attr.tags', aliases: 'attr.aliases', source: 'attr.source', created: 'attr.created', modified: 'attr.modified', review: 'attr.review' };
const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** The columns of a type's strip that have a value in `data`, at most `limit`. */
export function stripColumns(typeKey: string, data: Record<string, unknown>, limit = Infinity): TypeColumn[] {
  const types = chipTypes() as TypeDto[];
  const type = types.find((x) => nfc(x.key) === nfc(typeKey));
  const cols: TypeColumn[] = [];
  for (const k of type?.preview ?? []) {
    const a = type?.attributes.find((x) => nfc(x.key) === nfc(k));
    if (a) cols.push({ key: a.key, label: a.name, attr: a, userNamed: true });
    else if (UNIVERSAL[k]) cols.push({ key: k, label: t(UNIVERSAL[k]), attr: null, userNamed: false });
  }
  return cols.filter((c) => (c.attr?.type === 'date-range' ? !empty(data[`${c.key}-start`]) : !empty(data[c.key]))).slice(0, limit);
}

export function StripList({ cols, data, links, path, title, typeKey, label, className = 'embed-props', onOpen, onTag }: {
  cols: TypeColumn[]; data: Record<string, unknown>; links: LinkTargetDto[]; path: string; title: string; typeKey: string;
  label?: string; className?: string; onOpen?: (p: string) => void; onTag?: (k: string) => void;
}) {
  if (cols.length === 0) return null;
  const types = chipTypes() as TypeDto[];
  const type = types.find((x) => nfc(x.key) === nfc(typeKey));
  const row = { path, id: null, title, created: null, modified: null, values: data, links, typeSingle: true };
  return (
    <ul className={className} aria-label={label}>
      {cols.map((c) => (
        <li key={c.key}>
          <span className="embed-prop-name" data-user-content>{c.label}</span>{' '}
          <span className="embed-prop-value">
            {typeKey === 'task' && c.key === 'due' && typeof data.due === 'string'
              ? <TaskDue data={data} />
              : c.attr?.type === 'date' && typeof data[c.key] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(String(data[c.key]).trim())
              ? <span data-user-content>{formatDate(String(data[c.key]).trim())}</span> // D-160 medium date (FR-EMB-02 AC-4)
              : <TypeCell row={row} col={c} type={type} types={types} onOpen={(p) => onOpen?.(p)} onTag={onTag ?? (() => {})} typeKey={typeKey} />}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A task's due date as on its cards (tasks.md R44, FR-TSK-09): the short label and its tone (overdue in `danger`). */
function TaskDue({ data }: { data: Record<string, unknown> }) {
  const raw = String(data.due).trim();
  const st = chipState({ kind: 'note', type: 'task', status: typeof data.status === 'string' ? data.status : null, due: raw, completed: typeof data.completed === 'string' ? data.completed : null });
  const d = dueLabel({ state: st.task?.state ?? 'open', due: /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null, dueRaw: raw, completed: typeof data.completed === 'string' ? data.completed : null } as never,
    localDate(Date.now()), currentRegion(), appZone());
  return <span className={`task-chip due tone-${d.tone}`} data-tone={d.tone}>{d.text}</span>;
}
