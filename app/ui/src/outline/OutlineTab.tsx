// Slice OL (docs/contracts/v1-outline.md §3.1, §3.7, §3.8; outline.md R170, D-1612, D-1613): the Context panel's
// `Outline` tab: the header (count, Expand all, Collapse all), the tree in its own scroll container, the empty state.
// Folds go to the App through `onFolds` (one `ui_state_set` per user action, §5); showing the tab sends no IPC.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { Icon } from '../shell/Icon';
import { jump } from './jump';
import { allKeys, countText, foldButtons, shownCurrent, toggle, visibleRows } from './model';
import { OutlineTree, type FoldOp } from './OutlineTree';
import { takeFocus, useCurrent, useFocusReq, useOutline } from './store';
import { markOutlineReady } from './ready';

/** One fold change of the tab (D-1612): the collapsed keys after `op` on row `i`, in note order. */
export function foldAfter(tree: Parameters<typeof toggle>[0], collapsed: ReadonlySet<string>, i: number, op: FoldOp): string[] {
  const n = tree[i];
  if (!n) return [...collapsed];
  if (op === 'toggle' || op === 'branch') return toggle(tree, collapsed, i, op === 'branch');
  const s = new Set(collapsed);
  const set = (k: string, on: boolean) => { if (on) s.add(k); else s.delete(k); };
  const on = op === 'collapse' || op === 'collapseBranch';
  set(n.key, on);
  // ⌥→ / ⌥←: the row and every descendant with children take one state.
  if (op === 'expandBranch' || op === 'collapseBranch') for (let j = i + 1; j <= i + n.descendants; j++) if (tree[j]?.children.length) set(tree[j].key, on);
  return tree.filter((x) => x.children.length > 0 && s.has(x.key)).map((x) => x.key);
}

export type OutlineTabProps = {
  /** The note's collapsed fold keys (machine-local, R176). */
  collapsed: readonly string[];
  /** A user's fold change: the note's collapsed keys after it, in note order. */
  onFolds: (keys: string[]) => void;
};

export function OutlineTab({ collapsed, onFolds }: OutlineTabProps) {
  const source = useOutline();
  const current = useCurrent();
  const focusReq = useFocusReq();
  const tree = source?.tree ?? [];
  const set = useMemo(() => new Set(collapsed.map((k) => k.normalize('NFC'))), [collapsed]);
  const rows = useMemo(() => visibleRows(tree, set), [tree, set]);
  const shown = shownCurrent(tree, rows, current);
  const buttons = foldButtons(tree, set);
  const chevrons = useMemo(() => new Set(tree.filter((n) => n.children.length > 0).map((n) => n.index)), [tree]);
  const scroll = useRef<HTMLDivElement | null>(null);
  const empty = useRef<HTMLParagraphElement | null>(null);
  const pointerIn = useRef(false);
  const focusIn = useRef(false);
  const [req, setReq] = useReqState();

  // `panel.outline` and ⌘J (§6.1): the focus on the current row, else the first, else the empty state's text.
  useLayoutEffect(() => {
    if (!focusReq || focusReq.where !== 'tab' || !source) return;
    takeFocus('tab');
    if (!tree.length) { empty.current?.focus({ preventScroll: true }); return; }
    setReq(shown);
  }, [focusReq, source]); // eslint-disable-line react-hooks/exhaustive-deps

  // D-1613: the shown current row is kept in view (centred), except while the pointer is over the tree or the focus
  // is in it. The container never scrolls the note.
  useLayoutEffect(() => {
    const sc = scroll.current;
    if (!sc || shown === null || pointerIn.current || focusIn.current) return;
    const el = sc.querySelector<HTMLElement>(`[data-outline-row="${shown}"]`);
    if (!el) return;
    const sb = sc.getBoundingClientRect();
    const eb = el.getBoundingClientRect();
    if (eb.top >= sb.top && eb.bottom <= sb.bottom) return;
    const want = sc.scrollTop + (eb.top + eb.height / 2) - (sb.top + sb.height / 2);
    sc.scrollTop = Math.max(0, Math.min(want, sc.scrollHeight - sc.clientHeight));
  }, [shown]);

  useEffect(() => { if (tree.length) markOutlineReady(); }, [tree.length > 0]);

  if (!source) return <div role="tabpanel" className="panel-body outline-panel" aria-label={t('tab.outline')} />;
  const fold = (keys: string[]) => onFolds(keys);
  const hint = t('outline.emptyHint', { hash: '\u0000' }).split('\u0000');
  return (
    <div role="tabpanel" className="panel-body outline-panel" aria-label={t('tab.outline')}>
      {tree.length > 0 ? (
        <>
          <div className="outline-header">
            <span data-outline-count="">{countText(tree.length)}</span>
            <span className="spacer" />
            {buttons.expandAll && (
              <button type="button" tabIndex={0} className="icon-button outline-fold-all" aria-label={t('outline.expandAll')} title={t('outline.expandAll')}
                data-command="outline.expandAll" onClick={() => fold([])}>
                <Icon name="chevron-down" size={14} />
              </button>
            )}
            {buttons.collapseAll && (
              <button type="button" tabIndex={0} className="icon-button outline-fold-all" aria-label={t('outline.collapseAll')} title={t('outline.collapseAllHint')}
                data-command="outline.collapseAll" onClick={() => fold(allKeys(tree))}>
                <Icon name="chevron-right" size={14} />
              </button>
            )}
          </div>
          <div className="outline-scroll" data-outline-scroll="" ref={scroll}
            onPointerEnter={() => { pointerIn.current = true; }} onPointerLeave={() => { pointerIn.current = false; }}
            onFocus={() => { focusIn.current = true; }}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focusIn.current = false; }}>
            <OutlineTree variant="tab" tree={tree} rows={rows} current={shown} collapsed={set} chevrons={chevrons}
              onJump={(i) => jump(i, 'tab')}
              onFold={(i, op) => fold(foldAfter(tree, set, i, op))}
              onEscape={() => source.refocus()}
              focusReq={req} />
          </div>
        </>
      ) : (
        <div className="outline-empty">
          <p tabIndex={-1} ref={empty}>{t('outline.empty')}</p>
          <p>{hint[0]}<code>#</code>{hint[1] ?? ''}</p>
        </div>
      )}
    </div>
  );
}

/** A focus request for the tree (a counter and the row). */
function useReqState(): [{ n: number; index: number | null } | null, (i: number | null) => void] {
  const [req, setReq] = useState<{ n: number; index: number | null } | null>(null);
  return [req, (i) => setReq((r) => ({ n: (r?.n ?? 0) + 1, index: i }))];
}
