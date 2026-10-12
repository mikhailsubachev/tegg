import { useCallback, useEffect, useRef, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { events, ipc } from './ipc/client';
import type { NoteDto, ProgressDto, SwitcherItemDto, VaultInfo } from './ipc/types';
import { Search } from './Search';
import { Switcher } from './Switcher';
import { renderNewNote } from './newNote';
import { t } from './strings';

/** MS2 main window (architecture §12): vault header, non-blocking progress, search, switcher, note view. */
export function App() {
  const [vault, setVault] = useState<VaultInfo | null | undefined>(undefined);
  const [progress, setProgress] = useState<ProgressDto | null>(null);
  const [switcher, setSwitcher] = useState(false);
  const [note, setNote] = useState<NoteDto | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ipc.vaultCurrent().then(setVault, () => setVault(null));
    const un = [
      events.progress(setProgress),
      events.changed(() => setRefresh((n) => n + 1)),
      events.conflict((c) => setMessage(t.conflict(c.path))),
    ];
    return () => un.forEach((p) => p.then((f) => f()));
  }, []);

  // `ui-ready` (contract §1): after the first paint of a usable window.
  useEffect(() => {
    if (vault === undefined) return;
    // After the next frame; WebKit pauses frames for a hidden or occluded window, so a timer backs it up
    // (the shell writes each mark once).
    const mark = () => ipc.perfMark('ui-ready');
    requestAnimationFrame(() => setTimeout(mark, 0));
    const fallback = setTimeout(mark, 250);
    return () => clearTimeout(fallback);
  }, [vault === undefined]);

  // ⌘O switcher, ⌘⇧F search (FR-UX-03; the command palette comes with MS3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        setSwitcher(true);
      } else if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openNote = useCallback((path: string) => {
    setSwitcher(false);
    ipc.noteRead(path).then(setNote, (e) => setMessage(String(e?.message ?? e)));
  }, []);

  const create = useCallback((item: SwitcherItemDto) => {
    setSwitcher(false);
    ipc
      .noteCreate(item.folder, item.title, renderNewNote(item.type, item.title))
      .then(openNote, (e) => setMessage(String(e?.message ?? e)));
  }, [openNote]);

  const chooseVault = async () => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir !== 'string') return;
    ipc.vaultOpen(dir).then(setVault, () => setMessage(t.openVaultFailed));
  };

  if (vault === undefined) return null;
  if (vault === null) {
    return (
      <main className="welcome">
        <p>{t.openVaultHint}</p>
        <button aria-label={t.openVault} onClick={chooseVault}>{t.openVault}</button>
        {message && <p className="message">{message}</p>}
      </main>
    );
  }

  const running = progress && progress.state === 'running';
  return (
    <div className="app">
      <header>
        <strong>{vault.name}</strong>
        <span className="progress" role="status" aria-label={t.indexingLabel}>
          {running && (
            <>
              <progress max={progress.total || 1} value={progress.done} />
              {t.indexing(progress.done, progress.total)}
            </>
          )}
          {progress?.state === 'cancelled' && t.indexCancelled}
        </span>
      </header>
      {vault.placeholders > 0 && <div className="banner">{t.placeholders(vault.placeholders)}</div>}
      {message && <div className="banner" onClick={() => setMessage(null)}>{message}</div>}
      <div className="body">
        <Search onOpen={openNote} refresh={refresh} inputRef={searchRef} />
        <article className="note">
          {note ? (
            <>
              <h1>{note.path}</h1>
              <pre>{note.text}</pre>
            </>
          ) : (
            <p className="empty">{t.emptyNote}</p>
          )}
        </article>
      </div>
      {switcher && <Switcher onOpen={openNote} onCreate={create} onClose={() => setSwitcher(false)} />}
    </div>
  );
}
