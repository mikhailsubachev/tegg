// The Create offer of a broken link (FR-LNK-04 AC-4…AC-8, AC-11; D-286…D-288; ms4-links §5.2): a non-modal dialog
// at the chip. Opening it plans (read-only); only `Create` writes, through `link_create`.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { errorKind, ipc } from '../ipc/client';
import type { LinkCreatePlanDto, TypeDefDto } from '../ipc/types';
import { captureTargets } from '../shell/TypeMenu';
import { createObjectForLink } from '../types/create';
import { requestOffer, type OfferRequest } from './offer';

export function CreateLinkOffer({ req, types, onClose, onCreated, onExists }: {
  req: OfferRequest; types: TypeDefDto[];
  onClose: () => void; onCreated: (path: string) => void; onExists: (path: string, title: string) => void;
}) {
  const [plan, setPlan] = useState<LinkCreatePlanDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const create = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 120, top: 120 });

  useEffect(() => {
    let live = true;
    ipc.linkCreatePlan(req.from, req.target, req.relationTo).then((p) => { if (live) setPlan(p); }, () => { if (live) setError(t('error.io')); });
    return () => { live = false; };
  }, [req]);

  useLayoutEffect(() => {
    const r = req.anchor?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 340)), top: Math.min(r.bottom + 6, window.innerHeight - 220) });
  }, [req.anchor]);
  useEffect(() => { if (plan) create.current?.focus(); }, [plan]);

  const close = () => {
    onClose();
    const a = req.anchor;
    if (a?.isConnected) {
      // A chip that can't take the focus gets it for now; the editor doesn't report a click on a chip that holds the
      // focus, so the chip asks for its offer again itself (once, until it loses the focus).
      const el = a as HTMLElement & { __teggAgain?: (e: MouseEvent) => void };
      if (el.__teggAgain) el.removeEventListener('click', el.__teggAgain, { capture: true });
      if (!a.matches('a[href], button') && a.closest('[contenteditable="true"]')) {
        a.setAttribute('tabindex', '-1');
        const again = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); el.__teggAgain = undefined; requestOffer(req); };
        el.__teggAgain = again;
        a.addEventListener('click', again, { once: true, capture: true });
        // A press anywhere else ends it (the press on the chip itself moves the focus first, so blur can't).
        const elsewhere = (e: Event) => {
          if (a.contains(e.target as Node)) return;
          a.removeAttribute('tabindex');
          a.removeEventListener('click', again, { capture: true });
          el.__teggAgain = undefined;
          document.removeEventListener('mousedown', elsewhere, true);
          document.removeEventListener('keydown', elsewhere, true);
        };
        document.addEventListener('mousedown', elsewhere, true);
        document.addEventListener('keydown', elsewhere, true);
      } else if (!a.matches('a[href], button, [tabindex]')) a.setAttribute('tabindex', '-1');
      a.focus({ preventScroll: true });
    }
  };
  // A click outside closes it (non-modal).
  useEffect(() => {
    const down = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) close(); };
    const id = setTimeout(() => document.addEventListener('mousedown', down, true), 0);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', down, true); };
  });

  const typeName = plan?.state === 'create' ? types.find((x) => x.key === plan.type)?.name ?? plan.type : null;
  const needsEdit = plan?.state === 'create' && !!plan.rewrite && !req.editor;
  const forbidden = plan?.state === 'forbidden';
  const disabled = !plan || plan.state !== 'create' || needsEdit || busy;
  const stem = plan?.state === 'create' ? plan.path.split('/').pop()!.replace(/\.md$/, '') : '';

  const run = async () => {
    if (disabled || plan?.state !== 'create') return;
    setBusy(true);
    setError(null);
    try {
      const chipPos = req.chipAt ? req.chipAt() ?? undefined : req.chipPos;
      if (plan.rewrite && chipPos === undefined) { setError(t('createLink.rewriteFailed', { stem })); return; }
      const path = await createObjectForLink(req.from, req.target, plan, { editor: req.editor, chipPos });
      onClose();
      onCreated(path);
    } catch (e) {
      const kind = errorKind(e);
      const x = e as { path?: string; now?: LinkCreatePlanDto };
      if (kind === 'Exists' && x.path) { onClose(); onExists(x.path, plan.title); return; }
      if (kind === 'RewriteFailed') setError(t('createLink.rewriteFailed', { stem }));
      else if (kind === 'PlanChanged' && x.now) { setPlan(x.now); setError(t('createLink.planChanged')); }
      else setError(t('error.io'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={box} role="dialog" aria-label={t('createLink.title')} className="create-offer popover" style={{ position: 'fixed', left: pos.left, top: pos.top }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }}>
      <h2 className="sr-only">{t('createLink.title')}</h2>
      <p>{t('createLink.noNote', { target: req.target })}</p>
      {plan?.state === 'create' && (
        <div className="offer-type">
          <span>{t('createLink.type', { type: typeName ?? '' })}</span>{' '}
          <select aria-label={t('createLink.typeLabel')} value={plan.type} tabIndex={0}
              onChange={(e) => {
                // FR-VLT-05 AC-3 (D-550): another type plans again with it (relation offers: only the allowed types).
                const key = e.target.value;
                ipc.linkCreatePlan(req.from, req.target, [key]).then(setPlan, () => setError(t('error.io')));
              }}>
              {captureTargets(types).filter((x) => !req.relationTo || req.relationTo.includes(x.key)).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
              {!captureTargets(types).some((x) => x.key === plan.type) && <option value={plan.type}>{typeName}</option>}
            </select>
        </div>
      )}
      {plan?.state === 'create' && plan.rewrite && !needsEdit && <p>{t('createLink.rewrite', { stem })}</p>}
      {needsEdit && <p>{t('createLink.needsEdit')}</p>}
      {forbidden && <p>{t('createLink.folder')}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="dialog-buttons">
        <button ref={create} tabIndex={0} type="button" data-command="createLink.create" aria-disabled={disabled ? 'true' : undefined} onClick={() => void run()}>
          {t('createLink.create', { target: req.target })}
        </button>
        <button tabIndex={0} type="button" data-command="createLink.cancel" onClick={close}>{t('createLink.cancel')}</button>
      </div>
    </div>
  );
}
