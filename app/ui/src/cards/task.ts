// D-1904's Task rules over the card (docs/contracts/v1-cards.md §6.1 `cards/task.ts`; cards.md R211 row `Task`, R210):
// the checkbox for the lead; `status` hidden for the first option (and as the grouping key); `priority` hidden for the
// last option, when absent and on a Done task; `due` as tasks.md R44's label with its tone (FR-TSK-09); the source chip
// (FR-TSK-08) in the footer whether or not `source` is on the card list; no text on a Done task. Pure.
import type { LinkTargetDto, TaskRowDto, TypeDto } from '../ipc/types';
import { dueLabel } from '../tasks/views';
import type { CardLink, PillItem } from './model';
import { t } from '../i18n/catalog';

const nfc = (s: string) => s.normalize('NFC');

export type TaskRules = {
  done: boolean;
  /** The footer's source chip (null when the task has no source). */
  source: CardLink | null;
  /** A pill for `status`, `priority` or `due` (without its index), `'skip'` when the rule hides it, null for other keys. */
  item: (key: string) => Omit<PillItem, 'index'> | 'skip' | null;
};

function ymdIn(ms: number, zone: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone }).formatToParts(ms);
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

/** The source chip's link (FR-TSK-08): the resolved note, the Daily Note of a date, or a broken target. */
export function sourceLink(s: LinkTargetDto | null): CardLink | null {
  if (!s) return null;
  const ok = (s.kind === 'note' || s.kind === 'daily') && !!s.path;
  const text = s.kind === 'daily' ? s.target : ok ? (s.title ?? s.target) : s.target.split(/[|#]/)[0];
  return ok ? { kind: 'note', key: 'source', target: s.target, text, info: s, more: [] } : { kind: 'broken', key: 'source', target: s.target, text, info: s, more: [] };
}

export function taskRules(type: TypeDto | null, row: TaskRowDto, o: { now: number; zone: string; region: string }): TaskRules {
  const done = row.state === 'done';
  const attr = (k: string) => type?.attributes.find((a) => nfc(a.key) === k);
  const pill = (key: string, value: string, dot: string | null, invalid: boolean, role: 'status' | 'priority' | 'due', rawValue: string, tone?: string): Omit<PillItem, 'index'> => {
    const a = attr(key);
    const name = a?.name ?? key;
    const icon = a?.resolvedIcon ?? null;
    return { kind: 'pill', key, name, icon, dataIcon: icon ? (a?.icon ?? icon.name) : null, value, dot, invalid, title: name, label: t('card.pill', { name, value }), warn: invalid ? t('panel.notOption') : null, task: { role, raw: rawValue, tone } };
  };
  return {
    done,
    source: sourceLink(row.source),
    item: (key) => {
      if (key === 'source') return 'skip';
      if (key === 'status') {
        if (row.status === null) return 'skip';
        const opts = attr('status')?.options ?? [];
        if (row.statusKnown && nfc(row.status) === nfc(opts[0]?.label ?? '')) return 'skip';
        const o2 = opts.find((x) => nfc(x.label) === nfc(row.status!));
        return pill('status', row.status, o2 ? o2.color ?? 'gray' : null, !row.statusKnown, 'status', row.status);
      }
      if (key === 'priority') {
        const opts = attr('priority')?.options ?? [];
        if (done || row.priority === null || opts.length === 0) return 'skip';
        const i = opts.findIndex((x) => nfc(x.label) === nfc(row.priority!));
        if (i < 0 || i === opts.length - 1) return 'skip';
        return pill('priority', row.priority, opts[i].color ?? 'gray', false, 'priority', row.priority);
      }
      if (key === 'due') {
        const d = dueLabel(row, ymdIn(o.now, o.zone), o.region, o.zone);
        if (!d.text) return 'skip';
        return pill('due', d.text, null, d.tone === 'invalid', 'due', row.dueRaw ?? '', d.tone);
      }
      return null;
    },
  };
}
