// The preview popover (previews.md R102; v1-previews §3.3, §3.5, §7; D-921…D-924, D-932, D-935, D-942): a non-modal
// dialog anchored to its reference, or (the graph's full view, §7) the same content in a column. Read-only.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n/catalog';
import { events, ipc } from '../ipc/client';
import { forgetPreviewCaches, loadPreview, type PreviewModel } from './load';
import { PreviewContent, plainTitle, previewTitle } from './PreviewContent';
import { DEFAULT_WIDTH, MAX_AUTO_HEIGHT, SIZE } from './state';
import { close, getPrefs, insideDoubleClick, previewHost, promote, setCloser, setInside, updatePrefs, type Current } from './store';
import { keepHover, popoverGone, startGrace } from './hover';
import type { PreviewTarget } from './types';

type Entry = { target: PreviewTarget; scrollTop: number; title: string | null };
const GAP = 8;
const nfc = (s: string) => s.normalize('NFC');
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, textarea';

type Anchor = { text: string; offset: number };
const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, [data-embed-mode]';
/** The first block of the body whose bottom is below the body's top, and its distance from that top. */
function firstVisible(b: HTMLElement): Anchor | null {
  const top = b.getBoundingClientRect().top;
  const el = [...b.querySelectorAll<HTMLElement>(BLOCKS)].find((e) => e.getBoundingClientRect().bottom > top + 1);
  return el ? { text: (el.textContent ?? '').trim(), offset: el.getBoundingClientRect().top - top } : null;
}
function keepAnchor(b: HTMLElement, a: Anchor) {
  const el = [...b.querySelectorAll<HTMLElement>(BLOCKS)].find((e) => (e.textContent ?? '').trim() === a.text);
  if (el) b.scrollTop += el.getBoundingClientRect().top - b.getBoundingClientRect().top - a.offset;
}

/** The element the focus goes to after the reference when Tab leaves the popover (AC-13). */
function nextAfter(el: HTMLElement): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => !x.closest('[data-preview-popover]') && x.offsetParent !== null);
  const i = all.findIndex((x) => x === el || x.contains(el));
  if (i >= 0) return all[i + 1] ?? null;
  return all.find((x) => el.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING) ?? null;
}

export function PreviewPopover({ cur }: { cur: Current }) {
  const column = cur.host.placement === 'column';
  const uid = useId();
  const box = useRef<HTMLDivElement | null>(null);
  const body = useRef<HTMLElement | null>(null);
  const [stack, setStack] = useState<Entry[]>(() => [{ target: cur.target, scrollTop: 0, title: null }]);
  const seqRef = useRef(cur.seq);
  const [model, setModel] = useState<PreviewModel | null>(null);
  const top = stack[stack.length - 1];
  const prefs = getPrefs();
  const [size, setSize] = useState<{ w: number; h: number | null }>({ w: prefs.width ?? DEFAULT_WIDTH, h: prefs.height });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null);
  const [shown, setShown] = useState(false);
  const restore = useRef<number | null>(null);
  const ready = useRef(false);

  // A new reference (not one inside this popover) starts a new history (D-932).
  useEffect(() => {
    if (seqRef.current === cur.seq) return;
    seqRef.current = cur.seq;
    setStack([{ target: cur.target, scrollTop: 0, title: null }]);
    ready.current = false;
  }, [cur.seq]);

  // ------------------------------------------------------------------ content
  // One read per shown target: React's development double effects reuse it (FR-LNK-10 AC-4: at most two embed_load
  // calls per preview); a live update reads again.
  const reads = useRef(new Map<string, Promise<PreviewModel>>());
  const load = useCallback((target: PreviewTarget, keepScroll: boolean) => {
    const key = JSON.stringify(target);
    if (keepScroll) reads.current.delete(key);
    let p = reads.current.get(key);
    if (!p) {
      p = loadPreview(target, new AbortController().signal, (k) => t(k));
      reads.current.set(key, p);
    }
    const ctl = new AbortController();
    void p.then((m) => {
      if (ctl.signal.aborted) return;
      // A live update keeps the first visible block where it was (D-935: ± one line).
      const anchor = keepScroll && body.current ? firstVisible(body.current) : null;
      setModel(m);
      // The duplicate details (FR-LNK-10 AC-15) join the header when read; the preview doesn't wait for them.
      if (m.state === 'ok' && m.detailsLater) void m.detailsLater.then((d) => { if (d && !ctl.signal.aborted) setModel((x) => (x === m ? { ...m, details: d } : x)); });
      if (anchor) {
        const fix = () => { if (body.current) keepAnchor(body.current, anchor); };
        requestAnimationFrame(() => { fix(); requestAnimationFrame(fix); });
      }
      // Back to an earlier preview (D-932) shows it at its scroll position, once its body is drawn.
      requestAnimationFrame(() => {
        if (restore.current !== null && body.current) { body.current.scrollTop = restore.current; restore.current = null; }
      });
    }, () => {});
    return ctl;
  }, []);
  useEffect(() => {
    const ctl = load(top.target, false);
    restore.current = top.scrollTop || null;
    return () => ctl.abort();
  }, [top]);

  // Live updates (D-935, NFR-PERF-08): the previewed file, its type file or its media file changed.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ctl: AbortController | null = null;
    const off = events.changed((c) => {
      forgetPreviewCaches();
      const m = modelRef.current;
      const paths = c.paths.map(nfc);
      const mine = top.target.kind === 'note' ? nfc(top.target.path) : null;
      const hit = top.target.kind === 'tag' || paths.some((p) => p === mine || p.startsWith('.tegg/types/') || p.startsWith('_attachments/'));
      if (!hit) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        ctl?.abort();
        const gone = mine !== null && paths.includes(mine) && m?.state === 'ok';
        if (gone && m?.state === 'ok' && m.id) {
          // A rename keeps the `id`: the preview follows the file (D-935).
          const probe = await ipc.embedLoad([mine!]).catch(() => []);
          if (!probe[0] || probe[0].state === 'missing') {
            const next = await ipc.indexPathById(m.id).catch(() => null);
            if (next) { retarget({ ...top.target, path: nfc(next) }); return; }
            setModel({ state: 'gone' });
            return;
          }
        }
        ctl = load(top.target, true);
      }, 150);
    });
    return () => { void off.then((f) => f()); if (timer) clearTimeout(timer); ctl?.abort(); };
  }, [top]);
  const modelRef = useRef(model);
  modelRef.current = model;
  const retarget = (target: PreviewTarget) => setStack((s) => [...s.slice(0, -1), { ...s[s.length - 1], target }]);

  // ------------------------------------------------------------------ history inside the popover (D-932)
  useEffect(() => {
    setInside((target) => {
      const scrollTop = body.current?.scrollTop ?? 0;
      const title = modelRef.current ? plainTitle(modelRef.current, stack[stack.length - 1].target) : null;
      setStack((s) => [...s.slice(0, -1), { ...s[s.length - 1], scrollTop, title }, { target, scrollTop: 0, title: null }]);
      requestAnimationFrame(() => box.current?.focus({ preventScroll: true }));
    });
    return () => setInside(null);
  }, [stack]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  // ------------------------------------------------------------------ position (AC-5)
  const place = useCallback(() => {
    if (column) return;
    const a = cur.anchor;
    const el = 'el' in a ? a.el : null;
    if (el && !el.isConnected) { close('outside'); return; }
    const r = el ? el.getBoundingClientRect() : (a as { rect: DOMRect }).rect;
    if (r.bottom < 0 || r.top > window.innerHeight) { close('outside'); return; }
    const W = window.innerWidth, H = window.innerHeight;
    const w = Math.min(size.w, W - 2 * GAP);
    // The height it wants: the stored one, else its content's up to 480 px (measured without the room limit).
    let h = size.h ?? MAX_AUTO_HEIGHT;
    const pop = box.current;
    if (pop && !size.h) {
      const prev = pop.style.maxHeight;
      pop.style.maxHeight = `${MAX_AUTO_HEIGHT}px`;
      h = pop.offsetHeight || h;
      pop.style.maxHeight = prev;
    }
    const side = el?.closest('[data-preview-side="left"]') as HTMLElement | null;
    if (side) {
      // The Context panel's chips: to the left of the panel (AC-4).
      const p = side.getBoundingClientRect();
      const maxH = H - 2 * GAP;
      setPos({ left: Math.max(GAP, p.left - GAP - w), top: Math.max(GAP, Math.min(r.top, H - GAP - Math.min(h, maxH))), maxH });
      return;
    }
    const below = H - GAP - (r.bottom + GAP);
    const above = r.top - GAP - GAP;
    const useAbove = h > below && above > below;
    const maxH = Math.max(120, useAbove ? above : below);
    const hh = Math.min(h, maxH);
    const topPx = useAbove ? r.top - GAP - hh : r.bottom + GAP;
    const left = Math.max(GAP, Math.min(r.left, W - GAP - w));
    setPos({ left, top: topPx, maxH });
  }, [cur, size, column]);
  // A preview asked for by key (⌥Space on a selected embed) brings its reference into view first.
  useLayoutEffect(() => {
    if (column || cur.origin !== 'key' || !('el' in cur.anchor)) return;
    const r = cur.anchor.el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) cur.anchor.el.scrollIntoView({ block: 'nearest' });
  }, [cur.seq]);
  useLayoutEffect(() => { place(); }, [place, model]);
  // A reference removed (an external change deleted the chip) closes the preview (AC-5).
  useEffect(() => {
    if (column || !('el' in cur.anchor)) return;
    const a = cur.anchor;
    const id = setInterval(() => {
      if (a.el.isConnected) return;
      // A surface that redraws its references (the editor's chips after an edit or autosave) gives the new element.
      const now = cur.opts.relocate?.();
      if (now && now.isConnected) { a.el = now; place(); } else close('outside');
    }, 200);
    return () => clearInterval(id);
  }, [cur.seq]);
  useEffect(() => {
    const on = () => place();
    // The page scrolling under the popover moves its anchor; the popover's own body scrolling doesn't (and measuring a
    // long body on each of its scroll steps would stall it, D-934).
    const onScroll = (e: Event) => { if (!(e.target instanceof Node && box.current?.contains(e.target))) place(); };
    window.addEventListener('resize', on);
    window.addEventListener('scroll', onScroll, true);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('scroll', onScroll, true); };
  }, [place]);

  // ------------------------------------------------------------------ focus and closing (D-924)
  useEffect(() => {
    if (column) return;
    if (cur.origin !== 'hover') box.current?.focus({ preventScroll: true });
    const outside = (e: PointerEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      close('outside'); // the event goes on: the clicked control also acts (AC-11)
    };
    document.addEventListener('pointerdown', outside, true);
    setCloser(() => undefined);
    return () => { document.removeEventListener('pointerdown', outside, true); setCloser(null); };
  }, [cur.seq]);
  useEffect(() => {
    if (cur.origin === 'hover' || column) return;
    // The focus leaving to elsewhere in the window (the palette, a menu, Tab) closes it; the window losing focus doesn't.
    const off = (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (to && box.current?.contains(to)) return;
      setTimeout(() => {
        if (!document.hasFocus()) return;
        const now = document.activeElement;
        if (now && box.current?.contains(now)) return;
        if (now === document.body || !now) return;
        close('tab');
      }, 0);
    };
    const el = box.current;
    el?.addEventListener('focusout', off);
    return () => el?.removeEventListener('focusout', off);
  }, [cur.seq, cur.origin]);

  useEffect(() => () => popoverGone(), []);
  // preview-ready (§8, NFR-PERF-12): header, strip and the first screen painted.
  useEffect(() => {
    if (!model || ready.current) return;
    ready.current = true;
    requestAnimationFrame(() => { void ipc.perfMark('preview-ready').catch(() => {}); });
  }, [model]);
  useEffect(() => { requestAnimationFrame(() => setShown(true)); }, []);
  useLayoutEffect(() => {
    if (restore.current !== null && body.current) { body.current.scrollTop = restore.current; restore.current = null; }
  }, [model]);

  const openIt = () => {
    if (!model || model.state === 'gone') return;
    const target = stack.length === 1 ? cur.target : top.target;
    const own = stack.length === 1 && top.target === cur.target ? cur.opts.open : undefined;
    close('open');
    if (own) own();
    else previewHost()?.open(target.kind === 'note' && model.state === 'ok' ? { ...target, path: model.path } : target);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    const inLink = !!el.closest('[data-preview-ref]') && el !== box.current;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close('esc'); return; }
    if (e.key === 'Enter' && !inLink && !el.closest('button, [role="button"]')) { e.preventDefault(); e.stopPropagation(); openIt(); return; }
    if (e.key === 'Tab' && !column) {
      const list = [...box.current!.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      const last = list[list.length - 1];
      if (!e.shiftKey && (el === last || list.length === 0)) {
        e.preventDefault();
        const a = 'el' in cur.anchor ? cur.anchor.el : null;
        const next = a ? nextAfter(a) : null;
        close('tab');
        next?.focus();
      }
      return;
    }
    const b = body.current;
    if (b && !inLink && !el.closest('[data-preview-resize]')) {
      const line = 40, page = Math.max(line, b.clientHeight - line);
      const by: Record<string, number> = { ArrowDown: line, ArrowUp: -line, PageDown: page, PageUp: -page, ' ': e.shiftKey ? -page : page };
      if (e.key in by && !e.metaKey && !e.altKey) { e.preventDefault(); b.scrollBy({ top: by[e.key] }); return; }
      if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        // A windowed body (D-934) draws its last blocks first, then goes to the end.
        if (e.key === 'End') b.dispatchEvent(new CustomEvent('preview-end'));
        else b.scrollTop = 0;
        requestAnimationFrame(() => { if (e.key === 'End') b.scrollTop = b.scrollHeight; });
        return;
      }
    }
    // Read-only (FR-LNK-11 AC-9): editing keys never reach the note behind it; ⌘C, ⌘A and the palette do.
    const k = e.key.toLowerCase();
    // Only the editing keys are kept from the note behind (⌘Z, ⌘V, ⌘X, ⌘B…); navigation shortcuts (⇧⌘F, ⌘K, ⌘[) still work.
    const editing = ['z', 'y', 'v', 'x', 'b', 'i', 'u', 'e', 'h', 's', 't', 'o', '/', 'backspace'];
    if (((e.metaKey || e.ctrlKey) && editing.includes(k)) || k === 'backspace' || k === 'delete') {
      e.stopPropagation();
      // WebKit goes back in history on ⌫ outside a text field (the app's own guard is on the window).
      if (k === 'backspace' || k === 'delete' || ['z', 'v', 'x'].includes(k)) e.preventDefault();
    }
  };

  // ------------------------------------------------------------------ resize (AC-4, D-922)
  const clampW = (w: number) => Math.round(Math.max(SIZE.minW, Math.min(SIZE.maxW, w, window.innerWidth - 16)));
  const clampH = (h: number) => Math.round(Math.max(SIZE.minH, Math.min(SIZE.maxH, h, window.innerHeight - 16)));
  const commitSize = (w: number, h: number) => updatePrefs((d) => ({ ...d, width: w, height: h }));
  const drag = useRef<{ x: number; y: number; w: number; h: number; moved: boolean } | null>(null);
  // The size the window allows now (it can be smaller than dragged or stepped), stored once per change (AC-15).
  const commitShown = () => commitSize(box.current!.offsetWidth || sizeRef.current.w, box.current!.offsetHeight || sizeRef.current.h || MAX_AUTO_HEIGHT);
  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h ?? (box.current!.offsetHeight || MAX_AUTO_HEIGHT), moved: false };
  };
  const onResizeMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (e.clientX === d.x && e.clientY === d.y) return;
    d.moved = true;
    const next = { w: clampW(d.w + e.clientX - d.x), h: clampH(d.h + e.clientY - d.y) };
    sizeRef.current = next;
    setSize(next);
  };
  const onResizeUp = () => {
    const d = drag.current;
    drag.current = null;
    // A click on the handle (or the first of a double-click that resets) isn't a size change.
    if (d?.moved) commitShown();
  };
  const keyChanged = useRef(false);
  const onResizeKey = (e: React.KeyboardEvent) => {
    const dw = e.key === 'ArrowRight' ? 16 : e.key === 'ArrowLeft' ? -16 : 0;
    const dh = e.key === 'ArrowDown' ? 16 : e.key === 'ArrowUp' ? -16 : 0;
    if (!dw && !dh) return;
    e.preventDefault();
    e.stopPropagation();
    const cw = sizeRef.current.w, ch = sizeRef.current.h ?? (box.current!.offsetHeight || MAX_AUTO_HEIGHT);
    const next = { w: dw ? clampW(cw + dw) : cw, h: dh ? clampH(ch + dh) : sizeRef.current.h };
    sizeRef.current = next;
    setSize(next);
    keyChanged.current = true;
  };
  const onResizeKeyUp = () => {
    if (!keyChanged.current) return;
    keyChanged.current = false;
    commitShown();
  };
  const resetSize = (e: React.MouseEvent) => {
    e.preventDefault();
    setSize({ w: DEFAULT_WIDTH, h: null });
    updatePrefs((d) => { const { width: _w, height: _h, ...rest } = d; void _w; void _h; return rest; });
  };

  const title = plainTitle(model, top.target);
  const prev = stack.length > 1 ? stack[stack.length - 2] : null;
  const content = (
    <PreviewContent uid={uid} model={model} target={top.target} extraLine={cur.extraLine} bodyRef={body} back={prev ? { title: prev.title ?? '', onBack: back } : null}
      onClose={() => close('button')} onOpen={openIt} resize={column ? null : { onPointerDown: onResizeDown, onPointerMove: onResizeMove, onPointerUp: onResizeUp, onKeyDown: onResizeKey, onKeyUp: onResizeKeyUp, onDoubleClick: resetSize }}
      scrollToEmbedOf={stack.length === 1 ? cur.target.scrollToEmbedOf ?? null : null} />
  );
  if (column) {
    return createPortal(
      <div className="preview preview-column" role="region" aria-label={t('preview.name', { title })} data-preview-path={model?.state === 'ok' ? model.path : undefined} onKeyDown={onKeyDown}>{content}</div>,
      (cur.host as { container: HTMLElement }).container,
    );
  }
  const style: React.CSSProperties = {
    left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: Math.min(size.w, window.innerWidth - 16),
    ...(size.h ? { height: Math.min(size.h, pos?.maxH ?? size.h) } : { maxHeight: Math.min(MAX_AUTO_HEIGHT, pos?.maxH ?? MAX_AUTO_HEIGHT) }),
  };
  return createPortal(
    <div ref={box} role="dialog" aria-modal="false" tabIndex={-1} data-preview-popover="" className={`preview preview-popover${shown && !reducedMotion() ? ' shown' : ''}${reducedMotion() ? ' no-motion' : ''}`}
      data-preview-path={model?.state === 'ok' ? model.path : model?.state === 'tag' ? model.path ?? undefined : top.target.kind === 'note' ? nfc(top.target.path) : undefined}
      aria-label={t('preview.name', { title })} aria-describedby={cur.extraLine ? `${uid}-type ${uid}-extra` : `${uid}-type`} style={style}
      onKeyDown={onKeyDown}
      onDoubleClick={(e) => {
        const tg = insideDoubleClick();
        if (!tg) return;
        e.preventDefault();
        close('open');
        previewHost()?.open(tg);
      }}
      onPointerEnter={() => keepHover()} onPointerLeave={() => startGrace(true)}
      onPointerDown={() => { if (cur.origin === 'hover') { promote(); box.current?.focus({ preventScroll: true }); } }}>
      {content}
    </div>,
    document.body,
  );
}
