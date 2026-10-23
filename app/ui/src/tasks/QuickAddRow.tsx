// Slice 5A-1: the quick-add row (FR-TSK-10; D-380, D-470, D-483): tokens at the end of the text set the due date, the
// priority and tags; chips show what ↩ will write and `Clear …` puts a parsed word back into the title. Presets come
// from the place (top row, a section, a column). ↩ creates through the one creation path (D-245); Esc clears.
import { useEffect, useId, useRef, useState } from 'react';
import type { Value } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { Icon } from '../shell/Icon';
import { parseQuickAdd } from './quickAdd';
import { shortDate } from './views';

export type Presets = { due: string | null; status?: string | null; tag?: string | null };

export type QuickAddProps = {
  presets: Presets;
  today: string;
  region: string;
  priorities: string[];
  /** Creates the task; resolves true when it was written. */
  onCreate: (title: string, values: [string, Value][]) => Promise<boolean>;
  autoFocus?: boolean;
  inline?: boolean;
  /** Inline fields close on Esc. */
  onClose?: () => void;
  hint?: boolean;
  label?: string;
};

/** D-643 (D-668 (e)): `New with #tag` on a tag page opens the quick-add with ` #<tag>` and the caret before it. */
let prefill: string | null = null;
export function prefillQuickAdd(text: string): void {
  prefill = text;
}

export function QuickAdd({ presets, today, region, priorities, onCreate, autoFocus, inline, onClose, hint, label }: QuickAddProps) {
  // D-668 (e): a prefilled row puts the caret before the tag, also when it is focused before it renders. The prefill is
  // consumed after mounting (render functions may run twice).
  const caretStart = useRef(!inline && prefill !== null);
  const [text, setText] = useState(() => (inline ? '' : prefill ?? ''));
  useEffect(() => {
    if (!inline) prefill = null;
    if (caretStart.current && input.current) input.current.setSelectionRange(0, 0);
  }, []);
  const [noTitle, setNoTitle] = useState(false);
  const [dueCleared, setDueCleared] = useState(false);
  /** Words from here on stay in the title (a token the user cleared, AP-413 / D-483). */
  const [literalAt, setLiteralAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const desc = useId();
  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);

  const parse = (src: string) => {
    if (literalAt === null || literalAt > src.length) return parseQuickAdd(src, { today, priorities });
    const head = parseQuickAdd(src.slice(0, literalAt), { today, priorities });
    return { ...head, title: `${head.title} ${src.slice(literalAt)}`.trim() };
  };
  const parsed = parse(text);
  const dueTok = parsed.tokens.find((x) => x.kind === 'due');
  const prioTok = parsed.tokens.find((x) => x.kind === 'priority');
  const due = dueTok ? parsed.due : dueCleared ? null : presets.due;
  const priority = prioTok ? parsed.priority : null;

  const putBack = (kind: 'due' | 'priority') => {
    const tok = parsed.tokens.find((x) => x.kind === kind);
    if (!tok) { if (kind === 'due') setDueCleared(true); return; }
    const at = (literalAt === null ? text : text.slice(0, literalAt)).lastIndexOf(tok.word);
    if (at >= 0) setLiteralAt(at);
    if (kind === 'due') setDueCleared(true);
  };

  const submit = async () => {
    const p = parse(text);
    const title = p.title.trim();
    if (!title) { setNoTitle(true); return; }
    const values: [string, Value][] = [];
    if (presets.status) values.push(['status', presets.status]);
    const pr = p.tokens.some((x) => x.kind === 'priority') ? p.priority : null;
    if (pr) values.push(['priority', pr]);
    const d = p.tokens.some((x) => x.kind === 'due') ? p.due : dueCleared ? null : presets.due;
    if (d) values.push(['due', { date: d }]);
    const tags = [...(presets.tag ? [presets.tag] : []), ...p.tags].filter((x, i, a) => a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
    if (tags.length) values.push(['tags', tags]);
    setBusy(true);
    const ok = await onCreate(title, values);
    setBusy(false);
    if (ok) {
      setText('');
      setDueCleared(false);
      setLiteralAt(null);
      input.current?.focus();
    }
  };

  return (
    <div className={`quick-add${inline ? ' inline' : ''}`} data-quick-add>
      <input
        ref={input}
        type="text"
        className="quick-add-input"
        aria-label={label ?? t('tasks.add')}
        aria-description={t('tasks.add.example')}
        aria-describedby={noTitle ? desc : undefined}
        placeholder={t('tasks.add')}
        value={text}
        onFocus={(e) => { if (caretStart.current) { caretStart.current = false; e.currentTarget.setSelectionRange(0, 0); } }}
        aria-busy={busy || undefined}
        onChange={(e) => { const v = e.target.value; setText(v); setNoTitle(false); if (literalAt !== null && literalAt > v.length) setLiteralAt(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (!busy) void submit(); }
          else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setText('');
            setNoTitle(false);
            setDueCleared(false);
            setLiteralAt(null);
            if (inline) onClose?.();
          }
        }}
      />
      <span className="quick-chip" role="status">
        {due === today ? t('tasks.add.dueToday') : due ? t('tasks.add.due', { date: shortDate(due, region) }) : t('tasks.add.noDue')}
        {due && <button type="button" className="icon-button" data-command="tasks.add" aria-label={t('tasks.add.clearDue')} onClick={() => putBack('due')}><Icon name="x" size={10} /></button>}
      </span>
      <span className="quick-chip" role="status">
        {priority ? t('tasks.add.priority', { label: priority }) : t('tasks.add.noPriority')}
        {priority && <button type="button" className="icon-button" data-command="tasks.add" aria-label={t('tasks.add.clearPriority')} onClick={() => putBack('priority')}><Icon name="x" size={10} /></button>}
      </span>
      {hint && <span className="quick-hint">{t('tasks.add.hotkey')}</span>}
      {noTitle && <p id={desc} className="quick-error">{t('tasks.add.noTitle')}</p>}
    </div>
  );
}

