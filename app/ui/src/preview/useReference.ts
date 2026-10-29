// One hook for every reference of R104 (v1-previews §3.2): the element's click, double-click, keys and hover map
// through `resolveRefInput` (R103) to the surface's open, the preview or the Create offer. Surfaces never branch on
// the mode themselves (contract §11.4).
import { createElement, useRef, useSyncExternalStore, type HTMLAttributes } from 'react';
import { resolveRefInput, type RefAction, type RefInput, type RefKind } from './input';
import { hoverLeave, hoverMove } from './hover';
import { getPrefs, getCurrent, insideDoubleClick, previewHost, setFocusedRef, show, subscribe, close } from './store';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import { showLinkMenu } from './linkUi';
import type { PreviewTarget } from './types';

export type ReferenceOpts = {
  target: PreviewTarget | null;
  kind: RefKind;
  open(): void;
  createOffer?(anchor: HTMLElement): void;
  /** A chip in a read-only view (the read view, a read-only note): the right-click opens the `Link` menu with `Open`
   *  and `Show preview` (FR-LNK-13 AC-5); a broken one offers `Create "<target>"`. */
  menu?: { name: string };
};
export type ReferenceProps = HTMLAttributes<HTMLElement> & { 'data-preview-ref': ''; 'aria-description'?: string };

/** The description of a reference in the mode (`link.hint.*`, FR-LNK-11 AC-13); none when Off. */
export const hintText = (mode: string): string | null => (mode === 'click' ? t('link.hint.click') : mode === 'hover' ? t('link.hint.hover') : null);
/** Adds the mode's description to the element's own (`Unreviewed`, a task suffix, a broken link's). */
export const withHint = (own: string | null | undefined, mode: string): string | undefined =>
  [own, hintText(mode)].filter((x): x is string => !!x).join(', ') || undefined;

export function usePreviewMode() {
  return useSyncExternalStore(subscribe, () => getPrefs().mode);
}

/** Runs what an input does; returns whether it acted (so the caller prevents the default). */
export function act(o: ReferenceOpts, input: RefInput, el: HTMLElement): RefAction {
  const action = resolveRefInput(getPrefs().mode, o.kind, input, o.target === null);
  if (action === 'preview' && o.target) {
    show(o.target, { el }, input === 'click' || input === 'dblclick' ? 'click' : 'key', undefined, undefined, { open: o.open });
  } else if (action === 'open') {
    if (getCurrent()) close('open');
    o.open();
  } else if (action === 'createOffer') {
    if (getCurrent()) close('open');
    o.createOffer?.(el);
  }
  return action;
}

const mod = (e: { metaKey: boolean; ctrlKey: boolean }) => e.metaKey || e.ctrlKey;

export function useReference(opts: ReferenceOpts, extra?: { description?: string | null }): { props: ReferenceProps } {
  const o = useRef(opts);
  o.current = opts;
  const mode = usePreviewMode();
  // A drag (the pointer moved ≥ 4 px before release, FR-LNK-08 AC-7) is never a click on the reference.
  const down = useRef<{ x: number; y: number } | null>(null);
  const lastClick = useRef(-Infinity);
  // A broken reference never previews (D-939): it keeps only its own description.
  const described = opts.target ? withHint(extra?.description, mode) : extra?.description ?? undefined;
  const props: ReferenceProps = {
    'data-preview-ref': '',
    'aria-description': described,
    // NFR-PERF-12 (v1-previews §8): the benchmark measures from the pointer-up on a reference.
    onPointerUp: () => { if (getPrefs().mode !== 'off') void ipc.perfMark('preview-click').catch(() => {}); },
    onPointerDown: (e) => { down.current = { x: e.clientX, y: e.clientY }; },
    onClick: (e) => {
      if (e.button !== 0) return;
      const d = down.current;
      down.current = null;
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 4) return;
      // The second click of a double-click is the dblclick's (D-37: the first one previewed).
      const now = performance.now();
      const second = e.detail > 1 && now - lastClick.current < 600;
      lastClick.current = now;
      if (second) { e.preventDefault(); return; }
      const a = act(o.current, mod(e) ? 'modClick' : 'click', e.currentTarget as HTMLElement);
      if (a !== 'default') { e.preventDefault(); e.stopPropagation(); }
    },
    onDoubleClick: (e) => {
      // The first click of this double-click replaced a preview's content: the double-click opens that target.
      const first = insideDoubleClick();
      if (first) { e.preventDefault(); e.stopPropagation(); close('open'); previewHost()?.open(first); return; }
      const a = act(o.current, mod(e) ? 'modDblclick' : 'dblclick', e.currentTarget as HTMLElement);
      if (a !== 'default') { e.preventDefault(); e.stopPropagation(); }
    },
    onKeyDown: (e) => {
      const input: RefInput | null = e.key === 'Enter' ? (mod(e) ? 'modEnter' : 'enter') : e.key === ' ' && e.altKey && !mod(e) ? 'altSpace' : null;
      if (!input || e.target !== e.currentTarget && !(e.currentTarget as HTMLElement).contains(e.target as Node)) return;
      const a = act(o.current, input, e.currentTarget as HTMLElement);
      if (a !== 'default') { e.preventDefault(); e.stopPropagation(); }
    },
    onFocus: (e) => {
      const el = e.currentTarget as HTMLElement;
      setFocusedRef({ el, run: () => act(o.current, 'altSpace', el) });
    },
    onContextMenu: (e) => {
      const cur = o.current;
      if (!cur.menu || resolveRefInput(getPrefs().mode, cur.kind, 'contextmenu', cur.target === null) !== 'menu') return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget as HTMLElement;
      showLinkMenu({
        anchor: el, target: cur.menu.name, broken: cur.target === null,
        open: () => act(cur, 'modEnter', el),
        preview: () => act(cur, 'altSpace', el),
        create: cur.createOffer ? () => cur.createOffer!(el) : undefined,
        restore: () => el.focus(),
      });
    },
    onPointerMove: (e) => {
      if (e.pointerType === 'touch') return;
      const cur = o.current;
      if (getPrefs().mode !== 'hover' || !cur.target || resolveRefInput('hover', cur.kind, 'hoverRest', false) !== 'preview') return;
      hoverMove(cur.target, e.currentTarget as HTMLElement, e.buttons !== 0, cur.open);
    },
    onPointerLeave: () => hoverLeave(),
  };
  return { props };
}

type RefElementProps = HTMLAttributes<HTMLElement> & { as: 'tr' | 'a' | 'div' | 'span' | 'li' | 'article'; reference: ReferenceOpts; href?: string; [k: `data-${string}`]: unknown };

/** An element that is a reference (R104 rows 7…10: rows, cards' titles): the hook's handlers run first, the element's
 *  own handlers then run for what the hook left alone (arrow keys, focus tracking, the context menu). */
export function RefElement({ as, reference, onClick, onKeyDown, onDoubleClick, onFocus, onBlur, onPointerDown, onContextMenu, children, ...rest }: RefElementProps) {
  const { props } = useReference(reference, { description: (rest as { 'aria-description'?: string })['aria-description'] });
  const chain = <E extends React.SyntheticEvent>(a?: (e: E) => void, b?: (e: E) => void) => (e: E) => { a?.(e); if (!e.defaultPrevented) b?.(e); };
  return createElement(as, {
    ...rest,
    ...props,
    onClick: chain(props.onClick, onClick),
    onDoubleClick: chain(props.onDoubleClick, onDoubleClick),
    onKeyDown: chain(props.onKeyDown, onKeyDown),
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => { props.onPointerDown?.(e); onPointerDown?.(e); },
    onContextMenu: chain(props.onContextMenu, onContextMenu),
    onFocus: (e: React.FocusEvent<HTMLElement>) => { props.onFocus?.(e); onFocus?.(e); },
    onBlur: (e: React.FocusEvent<HTMLElement>) => { props.onBlur?.(e); onBlur?.(e); },
  }, children);
}
