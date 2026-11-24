// Slice Q3: the display switch (docs/contracts/v1-views.md §40.1 `DisplaySwitch.tsx`, §41.1, §42.1; R223; board A): a
// `group` `Display` with the buttons List, Table, Wall. The effective display is pressed; ←/→ move the focus (roving
// tab stop) and write nothing; a click, ⏎ or Space chooses (the pressed one writes nothing, the caller's rule R222).
import { useRef } from 'react';
import { t } from '../i18n/catalog';
import { Icon } from '../shell/Icon';
import type { Display } from '../views/display';

const ORDER: Display[] = ['list', 'table', 'wall'];

export function DisplaySwitch({ value, disabled, onChoose }: {
  value: Display;
  /** Why the usage can't be written (a catalog text), else null. */
  disabled: string | null;
  onChoose: (d: Display) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const move = (from: Display, dir: 1 | -1) => {
    const i = ORDER.indexOf(from);
    const j = Math.min(ORDER.length - 1, Math.max(0, i + dir));
    ref.current?.querySelector<HTMLElement>(`button[data-display="${ORDER[j]}"]`)?.focus();
  };
  return (
    <div ref={ref} role="group" aria-label={t('display.switch')} className="segmented display-switch" data-display-switch="">
      {ORDER.map((d) => {
        const name = t(`views.kind.${d}`);
        return (
          <button key={d} type="button" data-display={d} aria-label={name} title={name} aria-pressed={value === d} tabIndex={value === d ? 0 : -1}
            data-command={`display.${d}`} className={value === d ? 'on' : ''}
            aria-disabled={disabled ? 'true' : undefined} aria-description={disabled ?? undefined}
            onClick={() => { if (!disabled) onChoose(d); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); move(d, e.key === 'ArrowRight' ? 1 : -1); }
            }}>
            <span data-icon={d} aria-hidden="true" className="display-icon"><Icon name={d} size={14} /></span>
          </button>
        );
      })}
    </div>
  );
}
