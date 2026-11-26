// Slice AND-3 (docs/contracts/android-edit.md §10.8; FR-SYN-04 AC-14, AC-15; D-2410, D-2524): resolving a conflict
// pair on the phone. Under the stacked `Compare` each version gets `Keep this version`; the choice asks in a sheet
// (`Move to trash?`) and runs the desktop's writes (§2.4 row 13: keep the primary trashes the copy; keep the copy
// writes its bytes into the primary, then trashes the copy). `Merge…` opens `Merge versions`: the primary as an
// editable phone editor with the bar above the other version read-only; `Done` writes the draft into the primary and
// trashes the other, `Cancel` and system Back write nothing. Every write is base-checked (FR-SYN-04 AC-11).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n/catalog';
import type { TypeDefDto, VersionDto } from '../ipc/types';
import { EditorPane, type EditorPaneApi } from '../edit/EditorPane';
import { pushLayer } from './back';
import { Sheet } from './Sheet';

export type ConflictPair = {
  primary: string; other: string; kind: string;
  left: { text: string; v: VersionDto }; right: { text: string; v: VersionDto };
};

export type ConflictActions = {
  /** Keeps `which` (1 the primary, 2 the copy) and trashes the other one. */
  keep: (which: 1 | 2) => void;
  /** Gives the copy a new id (kind `duplicateId`). */
  newId: () => void;
  /** Writes `text` into the primary and trashes the other one. */
  merge: (text: string) => void;
};

const base = (p: string) => p.split('/').pop()!;

/** The `Keep this version` button under one version of the stacked compare. */
export function KeepThis({ which, path, onKeep }: { which: 1 | 2; path: string; onKeep: (which: 1 | 2) => void }) {
  return (
    <button type="button" className="phone-keep-this" aria-description={path.normalize('NFC')} data-command={`phone.conflict.keep:${which}`}
      onClick={() => onKeep(which)}>{t('phone.keepThis')}</button>
  );
}

/** The actions below the compare: `Merge…` and, for a duplicate id, `Give the copy a new id`; the confirmation sheet
 *  and the merge dialog. `confirmFor` is the version chosen by a `Keep this version` (null: none asked). */
export function ConflictResolve({ pair, types, confirmFor, onConfirmClose, actions }: {
  pair: ConflictPair; types: TypeDefDto[]; confirmFor: 1 | 2 | null; onConfirmClose: () => void; actions: ConflictActions;
}) {
  const [merging, setMerging] = useState(false);
  const other = confirmFor === 1 ? pair.other : pair.primary;
  return (
    <>
      <div className="phone-conflict-actions">
        <button type="button" data-command="phone.conflict.merge" onClick={() => setMerging(true)}>{t('conflicts.merge')}</button>
        {pair.kind === 'duplicateId' && (
          <button type="button" data-command="phone.conflict.newId" onClick={() => actions.newId()}>{t('conflicts.newId')}</button>
        )}
      </div>
      {confirmFor !== null && (
        <Sheet title={t('conflicts.trashConfirmTitle')} onClose={onConfirmClose}>
          <div className="phone-conflict-confirm">
            <p>{t('phone.trashCopy', { name: '\u0000' }).split('\u0000')[0]}<span data-user-content>{base(other)}</span>{t('phone.trashCopy', { name: '\u0000' }).split('\u0000')[1]}</p>
            <div className="phone-sheet-buttons">
              <button type="button" data-command="phone.conflict.cancel" onClick={onConfirmClose}>{t('conflicts.cancel')}</button>
              <button type="button" className="primary" data-command="phone.conflict.confirm"
                onClick={() => { const w = confirmFor; onConfirmClose(); actions.keep(w); }}>{t('conflicts.move')}</button>
            </div>
          </div>
        </Sheet>
      )}
      {merging && <MergeVersions pair={pair} types={types} onCancel={() => setMerging(false)} onDone={(text) => { setMerging(false); actions.merge(text); }} />}
    </>
  );
}

/** `Merge versions` (§10.8): full screen, modal; the draft (the primary) is the phone editor. */
function MergeVersions({ pair, types, onCancel, onDone }: { pair: ConflictPair; types: TypeDefDto[]; onCancel: () => void; onDone: (text: string) => void }) {
  const pane = useRef<EditorPaneApi | null>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const pop = pushLayer(() => cancel.current());
    const layer = box.current;
    const root = layer?.parentElement;
    const others = root ? [...root.children].filter((c) => c !== layer) : [];
    for (const o of others) o.setAttribute('inert', '');
    return () => { pop(); for (const o of others) o.removeAttribute('inert'); };
  }, []);
  const lines = pair.right.text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return createPortal(
    <div ref={box} role="dialog" aria-modal="true" aria-label={t('phone.mergeVersions')} className="phone-merge-versions">
      <div className="phone-merge-head">
        <h2>{t('phone.mergeVersions')}</h2>
        <button type="button" data-command="phone.conflictMerge.cancel" onClick={onCancel}>{t('conflicts.cancel')}</button>
        <button type="button" className="primary" data-command="phone.conflictMerge.done"
          onClick={() => onDone(pane.current?.ed?.text() ?? pair.left.text)}>{t('conflicts.done')}</button>
      </div>
      <div className="phone-merge-scroll">
        <div className="compare-head" data-user-content>{pair.primary}</div>
        <EditorPane apiRef={pane} text={pair.left.text} path={pair.primary} types={types} labelBody={t('editor.body')}
          onChange={() => {}} onReady={() => {}} onOpen={() => {}} onTag={() => {}} onExternal={() => {}} onImagePaste={() => {}} onFailedLoad={() => {}} />
        <div className="compare-col phone-merge-other">
          <div className="compare-head" data-user-content>{pair.other}</div>
          <div className="compare-lines" data-user-content>
            {lines.map((l, i) => <div key={i} className="compare-line">{l || ' '}</div>)}
          </div>
        </div>
      </div>
    </div>,
    document.querySelector('.app') ?? document.body,
  );
}
