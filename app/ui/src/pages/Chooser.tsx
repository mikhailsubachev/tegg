// The vault chooser and the New vault form (FR-VLT-01 AC-9…AC-15, FR-VLT-02; D-91, D-137). Errors show catalog
// messages, never the core's text (NFR-OTH-02 AC-2); cancelling writes nothing.
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { errorKind, ipc } from '../ipc/client';
import type { VaultInfo } from '../ipc/types';
import { openImport } from '../import/store';

export function errorMessage(kind: string, vars: Record<string, string> = {}): string {
  const key = `error.${kind.charAt(0).toLowerCase()}${kind.slice(1)}`;
  const s = t(key, vars);
  return s === key ? t('error.unknown') : s;
}

export function Chooser({ startWithForm, onOpened, onCancel }: {
  startWithForm: boolean;
  onOpened: (v: VaultInfo) => void;
  /** Present when a vault is open: Esc and Cancel return to it (FR-VLT-01 AC-15). */
  onCancel?: () => void;
}) {
  const [form, setForm] = useState(startWithForm);
  const [message, setMessage] = useState<{ title: string; hint?: string } | null>(null);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!form) first.current?.focus();
  }, [form]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      if (form) setForm(false);
      else onCancel?.();
      if (form && startWithForm) onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [form, onCancel, startWithForm]);

  const openExisting = async () => {
    setMessage(null);
    const dir = await ipc.vaultPickDir().catch(() => null);
    if (!dir) return;
    try {
      onOpened(await ipc.vaultOpen(dir));
    } catch (e) {
      const kind = errorKind(e);
      setMessage(kind === 'NotATeggVault' ? { title: t('chooser.importUnavailable'), hint: t('chooser.importUnavailableHint') } : { title: errorMessage(kind) });
    }
  };

  return (
    <main className="chooser" aria-label={t('chooser.title')}>
      <div className="chooser-card">
        <h1>{t('chooser.title')}</h1>
        {form ? (
          <NewVaultForm
            onCreated={onOpened}
            onCancel={() => (startWithForm && onCancel ? onCancel() : setForm(false))}
          />
        ) : (
          <>
            <p className="hint">{t('chooser.hint')}</p>
            <div className="chooser-actions">
              <button tabIndex={0} ref={first} type="button" className="primary" data-command="vault.create" onClick={() => setForm(true)}>
                {t('chooser.create')}
              </button>
              <button tabIndex={0} type="button" data-command="vault.open" onClick={openExisting}>
                {t('chooser.open')}
              </button>
              {/* Slice I2 (v1-import-window §4.3, R154): the Import window, also with no vault open. */}
              <button tabIndex={0} type="button" data-command="import.open" onClick={(e) => openImport(e.currentTarget)}>
                {t('cmd.import')}
              </button>
            </div>
            {message && (
              <div className="message" role="status">
                <strong>{message.title}</strong>
                {message.hint && <p>{message.hint}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function NewVaultForm({ onCreated, onCancel }: { onCreated: (v: VaultInfo) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; target?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<'empty' | 'starter'>('empty');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const clean = name.normalize('NFC').trim();
  const ready = clean.length > 0 && parent !== null && !busy;

  const choose = async () => {
    const dir = await ipc.vaultPickDir().catch(() => null);
    if (dir) setParent(dir);
  };

  const create = async () => {
    if (!ready || !parent) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await ipc.vaultCreate(parent, clean, kind));
    } catch (e) {
      const kind = errorKind(e);
      const target = `${parent.replace(/\/+$/, '')}/${clean}`;
      setError(kind === 'NotEmpty' ? { text: t('error.notEmpty', { name: clean }), target } : { text: errorMessage(kind) });
    } finally {
      setBusy(false);
    }
  };

  const openInstead = async (target: string) => {
    try {
      onCreated(await ipc.vaultOpen(target));
    } catch (e) {
      setError({ text: errorMessage(errorKind(e)) });
    }
  };

  return (
    <form
      className="new-vault"
      aria-label={t('newVault.title')}
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <label className="field">
        <span>{t('newVault.name')}</span>
        <input
          ref={input}
          type="text"
          aria-label={t('newVault.name')}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="field location">
        <span>{t('newVault.location')}</span>
        <span className="path">{parent ? <span data-user-content>{parent}</span> : t('newVault.noLocation')}</span>
        <button tabIndex={0} type="button" data-command="vault.pickDir" onClick={choose}>
          {t('newVault.choose')}
        </button>
      </div>
      <div className="field">
        <span id="kind-label">{t('newVault.kind')}</span>
        <div role="radiogroup" aria-labelledby="kind-label" className="kinds"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const next = kind === 'empty' ? 'starter' : 'empty';
            setKind(next);
            (e.currentTarget.querySelector(`[data-kind="${next}"]`) as HTMLElement | null)?.focus();
          }}>
          {(['empty', 'starter'] as const).map((k) => (
            <button key={k} tabIndex={kind === k ? 0 : -1} type="button" role="radio" aria-checked={kind === k} data-kind={k}
              aria-description={t(k === 'empty' ? 'newVault.emptyHint' : 'newVault.starterHint')}
              className={`kind ${kind === k ? 'on' : ''}`} data-command={k === 'empty' ? 'vault.kindEmpty' : 'vault.kindStarter'} onClick={() => setKind(k)}>
              {t(k === 'empty' ? 'newVault.empty' : 'newVault.starter')}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <div className="message error" role="alert">
          <span>{error.text}</span>
          {error.target && (
            <button tabIndex={0} type="button" data-command="vault.openInstead" onClick={() => void openInstead(error.target!)}>
              {t('newVault.openInstead')}
            </button>
          )}
        </div>
      )}
      <div className="form-actions">
        <button tabIndex={0} type="button" data-command="vault.cancel" onClick={onCancel}>
          {t('newVault.cancel')}
        </button>
        <button tabIndex={0} type="submit" className="primary" disabled={!ready} data-command="vault.createSubmit">
          {t('newVault.create')}
        </button>
      </div>
    </form>
  );
}
