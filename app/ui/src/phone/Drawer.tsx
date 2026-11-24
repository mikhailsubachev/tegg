// Slice AND-2 (docs/contracts/android-phone.md §8.3; RA10, FR-NAV-04 AC-13…AC-15; CP-7, CP-8 → D-2435, D-2436): the
// drawer from the left edge, over a scrim that covers the rest of the viewport (the bottom bar included). It holds the
// vault switcher and the sidebar in its drawer variant. While it is open the rest of the app is inert.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n/catalog';
import { pushLayer } from './back';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Drawer({ open, onClose, children }: { open: boolean; onClose: (navigated: boolean) => void; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (open) {
      setMounted(true);
      const r = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    if (!mounted) return;
    const h = setTimeout(() => setMounted(false), reduced() ? 0 : 200);
    return () => clearTimeout(h);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // While open: system Back closes it, the rest of the app is inert, the focus starts on Inbox (CP-8).
  useEffect(() => {
    if (!open) return;
    const pop = pushLayer(() => close.current(false));
    const root = box.current?.closest('.app');
    const others = root ? [...root.children].filter((c) => c !== box.current?.parentElement) : [];
    for (const o of others) o.setAttribute('inert', '');
    const first = box.current?.querySelector<HTMLElement>('[data-command="goto.inbox"]') ?? box.current?.querySelector<HTMLElement>('a, button');
    first?.focus();
    return () => {
      pop();
      for (const o of others) o.removeAttribute('inert');
    };
  }, [open, mounted]);

  if (!mounted) return null;
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(false); return; }
    if (e.key !== 'Tab') return;
    const all = [...(box.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]') ?? [])].filter((x) => x.getClientRects().length > 0);
    if (all.length === 0) return;
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); all[all.length - 1].focus(); }
    else if (!e.shiftKey && i === all.length - 1) { e.preventDefault(); all[0].focus(); }
  };
  return (
    // A closing drawer (its 200 ms transition) is already gone for touch and assistive tech.
    <div className={`phone-drawer-layer ${shown && open ? 'open' : ''}${open ? '' : ' closing'}`} aria-hidden={open ? undefined : 'true'}>
      <div className="phone-scrim" onClick={() => onClose(false)} />
      <div ref={box} role="dialog" aria-modal="true" aria-label={t('phone.drawer')} className="phone-drawer" onKeyDown={onKeyDown}
        onClick={(e) => { if ((e.target as HTMLElement).closest('a[href]')) onClose(true); }}>
        {children}
      </div>
    </div>
  );
}
