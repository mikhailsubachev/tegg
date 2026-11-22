// Slice AND-2 (docs/contracts/android-phone.md §8.1, §8.2, §8.6; RA8, FR-UX-04 AC-2…AC-4, FR-UX-07 AC-18): the phone
// frame, rendered instead of the title bar, sidebar, context panel and palette: the app bar (Back, the page's heading,
// More actions), the indexing line, `main` (the only vertical scroller), the bottom bar and the notice.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n/catalog';
import type { ProgressDto } from '../ipc/types';
import { Icon } from '../shell/Icon';
import { setHistoryBack, systemBack } from './back';
import { nativeState, onNative, setBackHandler, type NativeState } from './native';
import { setHeadingSlot } from './PageHeading';

/** §8.1: the insets as CSS variables on `<html>`, `data-keyboard` while the keyboard is shown. */
function applyNative(s: NativeState) {
  const r = document.documentElement;
  r.style.setProperty('--inset-top', `${s.insets.top}px`);
  r.style.setProperty('--inset-bottom', `${s.insets.bottom}px`);
  r.style.setProperty('--inset-left', `${s.insets.left}px`);
  r.style.setProperty('--inset-right', `${s.insets.right}px`);
  if (s.keyboard) r.setAttribute('data-keyboard', 'shown');
  else r.removeAttribute('data-keyboard');
}

/** The native state, kept current; the frame and the start screens use it. */
export function useNative(): NativeState {
  const [s, setS] = useState<NativeState>(() => ({ ...nativeState() }));
  useEffect(() => {
    applyNative(nativeState());
    return onNative((n) => { applyNative(n); setS({ ...n, insets: { ...n.insets } }); });
  }, []);
  return s;
}

export type BarTab = 'search' | 'today' | null;

export function PhoneFrame(props: {
  canBack: boolean;
  onBack: () => void;
  /** `More actions` in the app bar (note routes and daily routes with a file, CP-10 → D-2092). */
  more: boolean;
  onMore: (anchor: HTMLElement) => void;
  moreOpen: boolean;
  progress: ProgressDto | null;
  menuOpen: boolean;
  onMenu: () => void;
  onSearch: () => void;
  onToday: () => void;
  current: BarTab;
  /** A full-screen map hides the bottom bar too (§8.2). */
  fullScreen: boolean;
  notice: string | null;
  mainName: string | undefined;
  mainClass: string;
  children: ReactNode;
  overlays?: ReactNode;
}) {
  const native = useNative();
  const slot = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    setHeadingSlot(slot.current);
    return () => setHeadingSlot(null);
  }, []);
  const back = useRef(props);
  back.current = props;
  useEffect(() => {
    setHistoryBack(() => { if (!back.current.canBack) return false; back.current.onBack(); return true; });
    setBackHandler(systemBack);
  }, []);
  // §8.5: a long press does nothing: no WebView context menu anywhere on the phone.
  // The click that ends a long press is dropped too, so a long press on a row or card doesn't open it.
  useEffect(() => {
    let downAt = 0;
    let swallowUntil = 0;
    const menu = (e: Event) => { e.preventDefault(); swallowUntil = performance.now() + 1500; };
    const down = (e: PointerEvent) => { if (e.pointerType === 'touch') downAt = performance.now(); };
    const up = (e: PointerEvent) => { if (e.pointerType === 'touch' && performance.now() - downAt >= 500) swallowUntil = performance.now() + 700; };
    const click = (e: MouseEvent) => {
      if (performance.now() >= swallowUntil) return;
      swallowUntil = 0;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('contextmenu', menu, true);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('click', click, true);
    return () => {
      document.removeEventListener('contextmenu', menu, true);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('click', click, true);
    };
  }, []);
  // §8.6: after each viewport resize the focused field stays in view; FR-UX-04 AC-7 (D-2071): a rotation keeps the first
  // visible block at the top.
  useEffect(() => {
    const m = () => document.querySelector<HTMLElement>('main.phone-main');
    let anchor: { el: Element; offset: number } | null = null;
    const remember = () => {
      const main = m();
      if (!main) return;
      const top = main.getBoundingClientRect().top;
      const blocks = main.querySelectorAll('article > *, .page-column > *, li, tr, p, h2, h3');
      anchor = null;
      for (const el of blocks) {
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.bottom > top + 1) { anchor = { el, offset: r.top - top }; break; }
      }
    };
    const onScroll = () => remember();
    document.addEventListener('scroll', onScroll, true);
    remember();
    const f = () => {
      const el = document.activeElement as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) { el.scrollIntoView({ block: 'nearest' }); return; }
      const main = m();
      const a = anchor;
      if (main && a && a.el.isConnected) {
        const top = main.getBoundingClientRect().top;
        main.scrollTop += a.el.getBoundingClientRect().top - top - a.offset;
      }
    };
    window.addEventListener('resize', f);
    return () => { window.removeEventListener('resize', f); document.removeEventListener('scroll', onScroll, true); };
  }, []);
  const [indexing, setIndexing] = useState(false);
  const running = props.progress?.state === 'running';
  useEffect(() => {
    if (running) { setIndexing(true); return; }
    const h = setTimeout(() => setIndexing(false), 300);
    return () => clearTimeout(h);
  }, [running]);
  const showBar = !native.keyboard && !props.fullScreen;
  const tab = (name: 'Menu' | 'Search' | 'New' | 'Today', key: string, icon: string, cmd: string, extra: Record<string, unknown>, onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void) => (
    <button type="button" className="phone-tab" data-command={cmd} onClick={onClick} aria-label={t(key)} {...extra}>
      <Icon name={icon} />
      <span className="phone-tab-label" aria-hidden="true">{t(key)}</span>
    </button>
  );
  return (
    <>
      <header role="banner" className="phone-appbar">
        <div className="phone-appbar-row">
          {props.canBack && (
            <button type="button" className="icon-button phone-back" aria-label={t('phone.back')} data-command="nav.back" onClick={props.onBack}>
              <Icon name="back" />
            </button>
          )}
          <div className="phone-title" ref={slot} />
          {props.more && (
            <button type="button" className="icon-button phone-more" aria-label={t('phone.more')} aria-haspopup="menu" aria-expanded={props.moreOpen}
              data-command="phone.more" onClick={(e) => props.onMore(e.currentTarget)}>
              <Icon name="more-horizontal" />
            </button>
          )}
        </div>
      </header>
      {indexing && props.progress && (
        <div role="status" aria-label={t('progress.label')} className="phone-indexing">
          <progress max={props.progress.total || 1} value={props.progress.done} />
          <span>{t('progress.running', { done: props.progress.done, total: props.progress.total })}</span>
        </div>
      )}
      <main aria-label={props.mainName} className={`phone-main ${props.mainClass}`}>
        {props.children}
      </main>
      {showBar && (
        <nav aria-label={t('phone.bottomBar')} className="phone-bottombar">
          {tab('Menu', 'phone.menu', 'sidebar', 'phone.menu', { 'aria-haspopup': 'dialog', 'aria-expanded': props.menuOpen, ref: menuButton }, () => props.onMenu())}
          {tab('Search', 'phone.search', 'search', 'goto.search', props.current === 'search' ? { 'aria-current': 'page' } : {}, () => props.onSearch())}
          {tab('New', 'phone.new', 'plus', 'object.new', { 'aria-disabled': 'true', 'aria-description': t('phone.newLater') })}
          {tab('Today', 'phone.today', 'calendar', 'daily.today', props.current === 'today' ? { 'aria-current': 'page' } : {}, () => props.onToday())}
        </nav>
      )}
      {props.notice && <div role="status" aria-live="polite" className="phone-notice">{props.notice}</div>}
      {props.overlays}
    </>
  );
}
