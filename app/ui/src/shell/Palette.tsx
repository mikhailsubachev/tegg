// The command palette (FR-UX-03, D-130): every command, ranked by folded title; disabled commands are listed with
// "Coming in …" and never run. Esc or running a command closes it and returns the focus (D-139).
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { rank, type Command } from './commands';
import { showDue } from './registry';

export function Palette({ list, onRun, onClose }: { list: Command[]; onRun: (c: Command) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const shown = useMemo(() => rank(q, list, (c) => t(c.title, c.vars)), [q, list]);
  useEffect(() => setSel(0), [q]);

  const choose = (c: Command | undefined) => {
    if (!c || c.due) return;
    onRun(c);
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog palette" role="dialog" aria-label={t('palette.title')} onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-label={t('palette.query')}
          placeholder={t('palette.placeholder')}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, shown.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(shown[sel]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
        />
        <ul id="palette-list" role="listbox" aria-label={t('palette.list')}>
          {shown.map((c, n) => (
            <li
              key={c.id}
              role="option"
              aria-selected={n === sel}
              aria-disabled={c.due ? 'true' : undefined}
              className={`${n === sel ? 'selected' : ''} ${c.due ? 'dim' : ''}`}
              onMouseEnter={() => setSel(n)}
              onClick={() => choose(c)}
            >
              <div className="cmd-title">{t(c.title, c.vars)}</div>
              <div className="cmd-meta">{c.due ? t('due.comingIn', { due: showDue(c.due) }) : c.shortcut ? t('shortcut.keys', { keys: c.shortcut }) : ''}</div>
            </li>
          ))}
          {shown.length === 0 && <li className="empty" role="presentation">{t('palette.empty')}</li>}
        </ul>
      </div>
    </div>
  );
}
