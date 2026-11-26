// Slice AND-3 (docs/contracts/android-edit.md §10.6; FR-SYN-03 AC-41, AC-43, D-2510): on the phone a note that changed
// on disk while it had unsaved edits shows this banner first in `main` instead of the desktop's merge dialog. Nothing is
// written until a choice; the editor is read-only and the keyboard hidden meanwhile. `Compare` stacks the two versions.
// The same banner offers a recovery copy kept when the app went to the background (§11.2).
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n/catalog';
import { Compare } from '../edit/Compare';
import { Icon } from '../shell/Icon';
import { pushLayer } from './back';

export type BannerMerge = { mine: string; theirs: string; compare: boolean; recovered?: string | null };

export function MergeBanner({ merge, onCompare, onCloseCompare, onMine, onTheirs, onBoth }: {
  merge: BannerMerge;
  onCompare: () => void;
  onCloseCompare: () => void;
  onMine: () => void;
  onTheirs: () => void;
  onBoth: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const buttons = (where: 'banner' | 'compare') => (
    <div className="phone-merge-buttons">
      {where === 'banner' && <button type="button" data-command="phone.merge.compare" onClick={onCompare}>{t('merge.compare')}</button>}
      <button type="button" data-command={where === 'banner' ? 'phone.merge.keepMine' : undefined} onClick={onMine}>{t('merge.keepMine')}</button>
      <button type="button" data-command={where === 'banner' ? 'phone.merge.keepTheirs' : undefined} onClick={onTheirs}>{t('merge.keepTheirs')}</button>
      <button type="button" data-command={where === 'banner' ? 'phone.merge.keepBoth' : undefined} onClick={onBoth}>{t('merge.keepBoth')}</button>
    </div>
  );
  return (
    <>
      <div ref={ref} role="alert" aria-label={t('phone.conflict.title')} className="phone-merge" tabIndex={-1}>
        <strong>{t('phone.conflict.title')}</strong>
        {merge.recovered != null
          ? <p data-user-content>{t('phone.recovered', { title: merge.recovered })}</p>
          : <p>{t('phone.conflict.text')}</p>}
        {buttons('banner')}
      </div>
      {merge.compare && <CompareDialog merge={merge} onClose={onCloseCompare}>{buttons('compare')}</CompareDialog>}
    </>
  );
}

function CompareDialog({ merge, onClose, children }: { merge: BannerMerge; onClose: () => void; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const pop = pushLayer(() => close.current());
    box.current?.querySelector<HTMLElement>('button')?.focus();
    return pop;
  }, []);
  return createPortal(
    <div className="phone-sheet-layer">
      <div ref={box} role="dialog" aria-modal="true" aria-label={t('compare.label')} className="phone-compare">
        <div className="phone-sheet-head">
          <h2>{t('compare.label')}</h2>
          <button type="button" className="icon-button" aria-label={t('phone.close')} onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="phone-compare-body">
          <Compare left={merge.mine} right={merge.theirs} leftLabel={t('compare.mine')} rightLabel={t('compare.theirs')} />
        </div>
        {children}
      </div>
    </div>,
    document.querySelector('.app') ?? document.body,
  );
}
