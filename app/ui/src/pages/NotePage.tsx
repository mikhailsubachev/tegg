// The note route in slice 3A (FR-UX-02 AC-14): breadcrumb, title and the file's text unchanged (the MS2 view
// until the read view of 3B, D-117). Toolbar: source view (3B), right panel and focus mode; header: icon and cover
// (3E). Opening a note writes nothing to the vault.
import { useEffect, useState } from 'react';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { TypeDefDto } from '../ipc/types';
import { Disabled } from '../shell/Disabled';
import { Icon } from '../shell/Icon';
import { pluralOf } from '../shell/types';

export type NoteMeta = { title: string; type: string };

/** Title and type from the frontmatter (untyped files are Pages, D-103), else the file name. */
export function noteMeta(path: string, text: string): NoteMeta {
  const stem = path.split('/').pop()!.replace(/\.md$/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const get = (k: string) => {
    if (!m) return undefined;
    const line = m[1].split(/\r?\n/).find((l) => l.startsWith(`${k}:`));
    return line?.slice(k.length + 1).trim().replace(/^["']|["']$/g, '') || undefined;
  };
  return { title: (get('title') ?? stem).normalize('NFC'), type: (get('type') ?? 'page').toLowerCase().normalize('NFC') };
}

export function NotePage({ path, types, heading, onType, onMeta, toolbar }: {
  path: string;
  types: TypeDefDto[];
  heading: React.RefObject<HTMLHeadingElement | null>;
  onType: (key: string) => void;
  onMeta: (m: NoteMeta | null) => void;
  toolbar: React.ReactNode;
}) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setText(null);
    ipc.noteRead(path).then((n) => {
      if (!live) return;
      setText(n.text);
      onMeta(noteMeta(path, n.text));
    }, () => live && onMeta(null));
    return () => {
      live = false;
    };
  }, [path]);
  if (text === null) return null;
  const meta = noteMeta(path, text);
  const plural = pluralOf(types, meta.type);
  return (
    <>
      {toolbar}
      <div className="note-column">
        <nav className="breadcrumb" aria-label={t('note.breadcrumb')}>
          <a href="#" tabIndex={0} data-command={`goto.type:${meta.type}`} onClick={(e) => { e.preventDefault(); onType(meta.type); }}>
            <span data-user-content>{plural}</span>
          </a>
          <span className="sep" aria-hidden="true">/</span>
          <span data-user-content>{meta.title}</span>
        </nav>
        <div className="note-header-controls">
          <Disabled control="ctl.addIcon" />
          <Disabled control="ctl.addCover" />
        </div>
        <h1 ref={heading} tabIndex={-1} className="note-title">
          <span data-user-content>{meta.title}</span>
        </h1>
        <pre className="note-raw" data-user-content>{text}</pre>
      </div>
    </>
  );
}

export function NoteToolbar({ onTogglePanel, onFocus }: { onTogglePanel: () => void; onFocus: () => void }) {
  return (
    <div className="note-toolbar" role="toolbar" aria-label={t('note.toolbar')}>
      <Disabled control="ctl.showSource" />
      <span className="spacer" />
      <button tabIndex={0} type="button" className="icon-button" aria-label={t('frame.focusMode')} data-command="view.toggleFocus" onClick={onFocus}>
        <Icon name="focus" />
      </button>
      <button tabIndex={0} type="button" className="icon-button" aria-label={t('cmd.toggleRightPanel')} data-command="view.toggleRightPanel" onClick={onTogglePanel}>
        <Icon name="panel" />
      </button>
    </div>
  );
}
