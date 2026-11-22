// Slice AND-1 (docs/contracts/android-shell.md §9.3; FR-VLT-01 AC-23, AC-25, AC-26, RA4): choosing a vault on the phone,
// without a folder dialog (F4): recent vaults, the vaults found in shared storage, a typed path and New vault.
import { useEffect, useState } from 'react';
import { t } from '../i18n/catalog';
import { errorKind, ipc } from '../ipc/client';
import type { FoundVaultDto, RecentVaultDto, VaultInfo } from '../ipc/types';
import { errorMessage } from './Chooser';

/** RA5's text for a refused path or vault (the `IpcError` kinds of contract §2.2). */
function refusal(kind: string): { title: string; hint?: string } {
  if (kind === 'FullPath') return { title: t('chooser.android.fullPath') };
  if (kind === 'OutsideShared') return { title: t('chooser.android.outsideShared') };
  if (kind === 'NotATeggVault') return { title: t('chooser.android.notAVault'), hint: t('chooser.android.notAVaultHint') };
  return { title: errorMessage(kind) };
}

export function AndroidChooser({ onOpened, failed, startWithForm = false }: {
  onOpened: (v: VaultInfo) => void;
  /** RA3 `failed`: the remembered vault that couldn't be opened (FR-VLT-01 AC-7). */
  failed?: { path: string; kind: string } | null;
  startWithForm?: boolean;
}) {
  const [form, setForm] = useState(startWithForm);
  const [recent, setRecent] = useState<RecentVaultDto[]>([]);
  const [found, setFound] = useState<FoundVaultDto[] | null>(null);
  const [path, setPath] = useState('');
  const [message, setMessage] = useState<{ title: string; hint?: string } | null>(failed ? { title: t('chooser.android.failed', { path: failed.path }) } : null);

  useEffect(() => {
    let live = true;
    ipc.vaultRecent().then((r) => { if (live) setRecent(r.filter((x) => x.exists)); }, () => {});
    ipc.vaultFind().then((f) => { if (live) setFound(f); }, () => { if (live) setFound([]); });
    return () => { live = false; };
  }, []);

  const open = async (p: string) => {
    setMessage(null);
    try {
      onOpened(await ipc.vaultOpen(p));
    } catch (e) {
      setMessage(refusal(errorKind(e)));
    }
  };

  return (
    <main className="chooser android-chooser" aria-label={t('chooser.title')}>
      <div className="chooser-card">
        <h1>{t('chooser.title')}</h1>
        {form ? (
          <AndroidNewVault onCreated={onOpened} onCancel={() => setForm(false)} />
        ) : (
          <>
            {message && (
              <div className="message" role="status">
                <strong data-user-content>{message.title}</strong>
                {message.hint && <p>{message.hint}</p>}
              </div>
            )}
            {recent.length > 0 && (
              <section aria-label={t('chooser.android.recent')}>
                <h2>{t('chooser.android.recent')}</h2>
                <ul className="vault-list">
                  {recent.map((r) => (
                    <li key={r.path}>
                      <button tabIndex={0} type="button" data-command="vault.openRecent" onClick={() => void open(r.path)}>
                        <span className="name" data-user-content>{r.name}</span>
                        <span className="path" data-user-content>{r.path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section aria-label={t('chooser.android.found')}>
              <h2>{t('chooser.android.found')}</h2>
              {found === null ? (
                <p className="hint" role="status">{t('chooser.android.searching')}</p>
              ) : found.length === 0 ? (
                <p className="hint">{t('chooser.android.noneFound')}</p>
              ) : (
                <ul className="vault-list">
                  {found.map((f) => (
                    <li key={f.path}>
                      <button tabIndex={0} type="button" data-command="vault.openFound" onClick={() => void open(f.path)}>
                        <span className="name" data-user-content>{f.name}</span>
                        <span className="path" data-user-content>{f.rel}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <form className="android-path" onSubmit={(e) => { e.preventDefault(); void open(path); }}>
              <label className="field">
                <span>{t('chooser.android.path')}</span>
                <input type="text" aria-label={t('chooser.android.path')} data-command="vault.path" autoComplete="off" autoCorrect="off"
                  autoCapitalize="off" spellCheck={false} value={path} onChange={(e) => setPath(e.target.value)} />
              </label>
              <button tabIndex={0} type="submit" data-command="vault.openPath">{t('chooser.android.openPath')}</button>
            </form>
            <div className="chooser-actions">
              <button tabIndex={0} type="button" className="primary" data-command="vault.new" onClick={() => setForm(true)}>
                {t('chooser.create')}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

/** FR-VLT-01 AC-10 on the phone (D-2014): `Location` is a path field holding `<shared root>/Documents`. */
function AndroidNewVault({ onCreated, onCancel }: { onCreated: (v: VaultInfo) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [parent, setParent] = useState('/storage/emulated/0/Documents');
  const [kind, setKind] = useState<'empty' | 'starter'>('empty');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    ipc.storageAccess().then((a) => { if (live && a.sharedRoot) setParent((p) => (p === '/storage/emulated/0/Documents' ? `${a.sharedRoot}/Documents` : p)); }, () => {});
    return () => { live = false; };
  }, []);
  const clean = name.normalize('NFC').trim();
  const ready = clean.length > 0 && parent.trim().length > 0 && !busy;
  const create = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await ipc.vaultCreate(parent.trim(), clean, kind));
    } catch (e) {
      const k = errorKind(e);
      setError(k === 'NotEmpty' ? t('error.notEmpty', { name: clean }) : refusal(k).title);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="new-vault" aria-label={t('newVault.title')} onSubmit={(e) => { e.preventDefault(); void create(); }}>
      <label className="field">
        <span>{t('newVault.name')}</span>
        <input type="text" aria-label={t('newVault.name')} data-command="vault.name" autoComplete="off" autoCorrect="off" autoCapitalize="off"
          spellCheck={false} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>{t('newVault.location')}</span>
        <input type="text" aria-label={t('newVault.location')} data-command="vault.location" autoComplete="off" autoCorrect="off"
          autoCapitalize="off" spellCheck={false} value={parent} onChange={(e) => setParent(e.target.value)} />
      </label>
      <div className="field">
        <span id="kind-label">{t('newVault.kind')}</span>
        <div role="radiogroup" aria-labelledby="kind-label" className="kinds">
          {(['empty', 'starter'] as const).map((k) => (
            <button key={k} tabIndex={kind === k ? 0 : -1} type="button" role="radio" aria-checked={kind === k} data-kind={k}
              className={`kind ${kind === k ? 'on' : ''}`} data-command={k === 'empty' ? 'vault.kindEmpty' : 'vault.kindStarter'} onClick={() => setKind(k)}>
              {t(k === 'empty' ? 'newVault.empty' : 'newVault.starter')}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="message error" role="alert"><span>{error}</span></div>}
      <div className="form-actions">
        <button tabIndex={0} type="button" data-command="vault.cancel" onClick={onCancel}>{t('newVault.cancel')}</button>
        <button tabIndex={0} type="submit" className="primary" disabled={!ready} data-command="vault.create">{t('newVault.create')}</button>
      </div>
    </form>
  );
}
