// Slice Q (v1-queries §4.2 `QueryDialogs.tsx`, §2.1; queries.md R144, FR-QRY-06 AC-3, AC-6, AC-14): the name dialogs,
// rendered once by the App from the dialogs store. `New query` creates with `free: false` (D-1477) and opens the query page
// with its editor; `Save as query…` creates from the inline fence, then the caller rewrites the fence; `Rename query`
// starts the `query-rename` job. A taken name (`NameTaken`, also when another program created it first, RENAME_EXCL) or a
// blank one says `query.newQuery.taken` under the field; nothing is written. While the first index build runs, a rename
// is refused with `IndexNotReady` (§11, D-1510, FR-QRY-06 AC-22): the dialog says `query.rename.notReady`, stays open
// and keeps the typed name; Rename can be pressed again later.
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { errorKind, ipc } from '../ipc/client';
import { Dialog } from '../pages/TypeSettingsPage';
import { runConfirmed } from '../jobs/jobs';
import { useNameDialog, openNameDialog, type NameDialogRequest } from './dialogs';
import { queryAlert } from './editorHost';
import { nowIso } from './env';
import { queryNav } from './nav';
import { refreshQueries } from './store';
import { setLastQueryRename } from './QueryMenu';
import './pages.css';

const stemOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.yml$/i, '').normalize('NFC');

export function QueryDialogs() {
  const req = useNameDialog();
  if (!req) return null;
  return <NameDialog key={`${req.kind}:${'name' in req ? req.name : ''}`} req={req} />;
}

function NameDialog({ req }: { req: NameDialogRequest }) {
  const [value, setValue] = useState(req.kind === 'saveAs' ? req.initial : req.kind === 'rename' ? req.title : '');
  const [error, setError] = useState(false);
  const [notReady, setNotReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const restore = useRef(true);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const close = (navigates = false) => {
    if (navigates) restore.current = false;
    openNameDialog(null);
    if (!navigates && req.returnFocus?.isConnected) setTimeout(() => req.returnFocus?.focus(), 0);
  };
  const blank = !value.trim();
  const submit = async () => {
    if (busy || blank) return;
    const title = value.trim().normalize('NFC');
    setBusy(true);
    setNotReady(false);
    try {
      if (req.kind === 'rename') {
        const id = await runConfirmed(() => ipc.queryRename(req.name, title), {
          confirm: false,
          started: (jobId) => { setLastQueryRename(jobId); close(); },
          finished: (rep) => {
            void refreshQueries();
            if (rep?.phase === 'done') req.onRenamed?.(rep.renamed ? stemOf(rep.renamed.to) : req.name);
          },
        });
        if (id === null) close();
        return;
      }
      const q = await ipc.queryCreate(title, null, req.kind === 'saveAs' ? req.fence : null, false, nowIso(Date.now()));
      void refreshQueries();
      if (req.kind === 'saveAs') { close(); req.onCreated(q.name); return; }
      close(true);
      queryNav()?.openQuery(q.name, { edit: true });
    } catch (e) {
      const k = errorKind(e);
      if (k === 'NameTaken' || k === 'EmptyName') setError(true);
      else if (k === 'IndexNotReady' && req.kind === 'rename') setNotReady(true);
      else if (k === 'NothingToDo') close();
      else { close(); queryAlert(t('query.saveFailed')); }
    } finally {
      setBusy(false);
    }
  };
  const label = req.kind === 'rename' ? t('queries.renameDialog') : t('query.newQuery.dialog');
  return (
    <Dialog label={label} onCancel={() => close()} className="query-name-dialog" restore={restore}>
      <h2>{label}</h2>
      <label className="field">
        <span>{t('query.newQuery.field')}</span>
        <input ref={input} type="text" aria-label={t('query.newQuery.field')} value={value} spellCheck={false} autoComplete="off"
          aria-invalid={error || undefined} aria-describedby={error ? 'query-name-error' : notReady ? 'query-name-not-ready' : undefined}
          onChange={(e) => { setValue(e.target.value); setError(false); setNotReady(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }} />
      </label>
      {error && <p id="query-name-error" role="alert" className="field-error">{t('query.newQuery.taken')}</p>}
      {notReady && <p id="query-name-not-ready" role="status" className="field-error">{t('query.rename.notReady')}</p>}
      <div className="dialog-buttons">
        <button tabIndex={0} type="button" className="text-button" onClick={() => close()}>{t('query.newQuery.cancel')}</button>
        <button tabIndex={0} type="button" className="text-button primary" disabled={blank} onClick={() => void submit()}>
          {req.kind === 'rename' ? t('tag.renameOk') : t('query.newQuery.create')}
        </button>
      </div>
    </Dialog>
  );
}
