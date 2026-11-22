// Slice AND-2 (docs/contracts/android-phone.md §8.4): the bottom sheet. A modal dialog over a scrim; the scrim, Close,
// Esc and system Back close it; the focus returns to the control that opened it.
import { useEffect, useRef, type ReactNode } from 'react';
import { t } from '../i18n/catalog';
import { Icon } from '../shell/Icon';
import { pushLayer } from './back';

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const done = () => {
      close.current();
      const o = opener.current as HTMLElement | null;
      if (o?.isConnected) o.focus();
    };
    const pop = pushLayer(done);
    box.current?.querySelector<HTMLElement>('button')?.focus();
    return pop;
  }, []);
  const closeNow = () => {
    onClose();
    const o = opener.current as HTMLElement | null;
    if (o?.isConnected) setTimeout(() => o.focus(), 0);
  };
  return (
    <div className="phone-sheet-layer">
      <div className="phone-scrim" onClick={closeNow} />
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} className="phone-sheet"
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeNow(); } }}>
        <div className="phone-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-button" aria-label={t('phone.close')} data-command="phone.sheet.close" onClick={closeNow}>
            <Icon name="x" />
          </button>
        </div>
        <div className="phone-sheet-body">{children}</div>
      </div>
    </div>
  );
}
