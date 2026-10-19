// FR-VLT-05 AC-3 (D-550): the shared `Type` menu of `Create "<q>" as…` (switcher, `[[`, `@`) and of `Change type…` on
// an unwritten draft: the capture targets (Page, Task, Quick Note, then user types by D-122), keyboard first.
import { useEffect, useRef, useState } from 'react';
import { collator } from '../i18n/collate';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { TypeDefDto } from '../ipc/types';
import { Icon, typeIconName } from './Icon';

export function captureTargets(types: TypeDefDto[]): TypeDefDto[] {
  const first = ['page', 'task', 'quick-note'].map((k) => types.find((x) => x.key === k)).filter((x): x is TypeDefDto => !!x && !x.invalid);
  const user = types.filter((x) => !x.system && !x.invalid).sort((a, b) => collator().compare(a.name, b.name));
  return [...first, ...user];
}

export function TypeMenu({ at, current, onChoose, onClose }: { at: { left: number; top: number }; current?: string; onChoose: (t: TypeDefDto) => void; onClose: () => void }) {
  const [types, setTypes] = useState<TypeDefDto[] | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => { void ipc.vaultTypes().then(setTypes, () => setTypes([])); }, []);
  useEffect(() => {
    if (!types) return;
    const items = ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    const sel = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (sel ?? items?.[0])?.focus();
  }, [types]);
  if (!types) return null;
  const list = captureTargets(types);
  const keys = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); (document.activeElement as HTMLElement | null)?.click(); }
  };
  return (
    <div className="modal-backdrop transparent" onMouseDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="menu" aria-label={t('capture.typeMenu')} className="capture-menu type-menu" style={{ position: 'fixed', left: at.left, top: at.top }} onKeyDown={keys}>
        {list.map((x) => (
          <button key={x.key} type="button" role="menuitemradio" aria-checked={x.key === current} aria-label={x.name} tabIndex={-1} className="capture-menu-item"
            onClick={() => onChoose(x)}>
            <Icon name={typeIconName(x.key, x.icon)} size={14} />
            <span data-user-content>{x.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
