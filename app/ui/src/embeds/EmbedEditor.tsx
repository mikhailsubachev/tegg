// The nested editor of an editable full embed (FR-EMB-03, D-421; docs/contracts/ms4-embeds.md §6): an editor on the
// embedded file (or one `#Heading` section of it) with its own base version, autosave, conflict and deleted handling
// and undo history. Leaving it saves it; other instances of the same file reload from its writes.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parse as parseDoc } from '@tegg/doc';
import { mindmapUi } from '../mindmap/mount';
import { noteTitle } from '../read/ReadView';
import { createEditor, type EditorUi, type TeggEditor } from '@tegg/editor';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { VersionDto } from '../ipc/types';
import { Saver, type Failure, type SaveState } from '../edit/autosave';
import { chipIcon } from '../links/icons';
import { iconElement } from '../shell/Icon';
import { ulid } from '../newNote';
import { localIso } from '../zone';
import { MergeDialog, type Merge } from '../pages/NotePage';
import { mountEmbed } from './slot';
import type { EmbedStore } from './store';
import type { EmbedNode } from './tree';

const nfc = (s: string) => s.normalize('NFC');
const localNow = () => localIso(Date.now());

function stamp(): string {
  const x = localIso(Date.now());
  return `${x.slice(0, 10)} ${x.slice(11, 13)}-${x.slice(14, 16)}`;
}

export function EmbedEditor({ node, store, getPos, title, gone = false, taskCard = false }: { node: EmbedNode; store: EmbedStore; getPos: () => number | undefined; title: string; gone?: boolean; taskCard?: boolean }) {
  const host = useRef<HTMLDivElement | null>(null);
  const edRef = useRef<TeggEditor | null>(null);
  const saverRef = useRef<Saver | null>(null);
  const disk = useRef<string>(node.note?.text ?? '');
  const nodeRef = useRef(node);
  nodeRef.current = node;
  const [save, setSave] = useState<{ state: SaveState; failure: Failure }>({ state: 'saved', failure: null });
  const [merge, setMerge] = useState<Merge | null>(null);
  const [deleted, setDeleted] = useState(false);
  const path = node.note!.path;

  useLayoutEffect(() => {
    if (!host.current || !node.note?.text) return;
    const note = { ...node.note, text: node.note.text };
    const links = new Map(note.links.map((l) => [nfc(l.target), l]));
    const childEmbeds = (value: string) => nodeRef.current.children.filter((c) => !c.inline && nfc(c.value) === nfc(value));
    const ui: EditorUi = {
      resolve: (target) => {
        const l = links.get(nfc(target));
        return l ? { kind: l.kind as 'note', path: l.path, type: l.type, title: l.title } : undefined;
      },
      unresolved: (target) => t('link.noNote', { target }),
      sourceBlock: t('editor.sourceBlock'),
      checkbox: t('editor.checkbox'),
      chipIcon: (type) => {
        if (!type) return null;
        const i = chipIcon(type);
        return iconElement(i.glyph, 13, i.def);
      },
      hint: t('embed.empty'),
      hideBlockIds: true,
      placeholder: (kind, value) => {
        const v = value.replace(/^!\[\[|\]\]$/g, '');
        const name = kind === 'query' ? t('ph.query') : /\.pdf(\||#|$)/i.test(v) ? t('ph.embedPdf') : /\.[A-Za-z0-9]{1,6}(\||#|$)/.test(v) && !/\.md(\||#|$)/i.test(v) && !/\.(png|jpe?g|gif|webp|svg|heic|avif|bmp|tiff?)(\||#|$)/i.test(v) ? t('ph.embedOther') : t('ph.embedImage');
        const id = kind !== 'embed' ? kind : name === t('ph.embedPdf') ? 'embed-pdf' : name === t('ph.embedOther') ? 'embed-other' : 'embed-image';
        return { name, text: kind === 'embed' ? `${name}: ${v}` : name, id };
      },
      onLink: (target) => {
        const l = links.get(nfc(target));
        if (l?.path) store.host?.onOpen(l.path);
      },
      onTag: (v) => store.host?.onTag(nfc(v).toLowerCase()),
      onExternal: (url) => store.host?.onExternal(url),
      // Slice MM (FR-MMP-02 AC-16, D-769): a top-level mindmap of the embedded note is drawn as in the note.
      ...mindmapUi({
        path: () => path,
        title: () => { try { return noteTitle(parseDoc(disk.current), path); } catch { return path.split('/').pop()!.replace(/\.md$/, ''); } },
        onOpen: (p) => store.host?.onOpen(p),
        onTag: (k) => store.host?.onTag(k),
        onExternal: (u) => store.host?.onExternal(u),
      }),
      // Depth-2 embeds inside an editable embed are shown read-only (D-421).
      embed: (source, dom) => mountEmbed(store, source, dom, () => undefined, (value, k) => childEmbeds(value)[k] ?? null),
      embedChip: (value) => {
        const c = nodeRef.current.children.find((x) => x.inline && nfc(x.value) === nfc(value));
        if (!c) return undefined;
        return { title: c.target.title ?? c.target.target, type: c.target.type, state: c.state === 'broken' ? 'broken' : c.state === 'too-deep' ? 'too-deep' : 'ok', description: c.state === 'broken' ? t('link.noNote', { target: c.target.target }) : t('embed.chip') };
      },
    };
    const sub = node.subpath && !node.subpath.startsWith('^') ? node.subpath : null;
    let ed: TeggEditor;
    try {
      ed = createEditor({
        text: note.text,
        element: host.current,
        now: localNow,
        newId: ulid,
        label: title,
        ui,
        section: sub,
        convertible: false, // D-494: open the embedded note to convert its blocks
        ...(taskCard ? { emptyHint: t('task.addDetails') } : {}),
        onChange: (dirty) => { if (dirty) saverRef.current?.changed(); },
        onLeave: (how) => {
          const pos = getPos();
          if (pos === undefined) return false;
          void saverRef.current?.flush();
          store.host?.leave(pos, how);
          return true;
        },
      });
    } catch {
      return;
    }
    (ed.view.dom as HTMLElement).setAttribute('aria-description', t('embed.chip'));
    edRef.current = ed;
    disk.current = note.text;
    const s = new Saver(note.path, ed, (note.version ?? null) as VersionDto | null, {
      state: (state, failure) => { setSave({ state, failure }); store.stateChanged(); },
      conflict: (c) => setMerge({ mine: c.mine, theirs: c.theirs, theirsVersion: c.theirsVersion, compare: false }),
      gone: () => setDeleted(true),
      written: (text, v) => {
        disk.current = text;
        store.wrote(reg.id, note.path, text, v);
      },
    });
    saverRef.current = s;
    const reg = store.register({
      path: note.path,
      depth: 1,
      editable: true,
      text: () => ed.text(),
      mark: (m) => { ed.commands.toggleMark(m); ed.view.focus(); },
      dirty: () => ed.dirty() || s.pending,
      historyDepth: () => ed.historyDepth(),
      state: () => s.state,
      flush: () => s.flush(),
      peerWrote: (text, version) => {
        if (text === disk.current) return;
        if (ed.dirty() || s.pending) return; // its own next save checks the base (NFR-REL-02)
        ed.reload(text);
        s.base = version as VersionDto;
        disk.current = text;
      },
      focusStart: () => {
        ed.view.focus();
        ed.commands.selectBlockAt(0);
        ed.clearBlockSelection();
        const dom = ed.view.dom.querySelector('p, h1, h2, h3, h4, h5, h6, li');
        if (dom) {
          const r = document.createRange();
          r.setStart(dom, 0);
          r.collapse(true);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(r);
        }
      },
      el: () => host.current,
    });
    // Leaving the embed saves it (FR-EMB-03 AC-7).
    const out = (e: FocusEvent) => {
      if (!host.current?.contains(e.relatedTarget as Node | null)) void s.flush();
    };
    const el = host.current;
    el.addEventListener('focusout', out);
    return () => {
      el.removeEventListener('focusout', out);
      void s.flush().finally(() => s.dispose());
      store.unregister(reg.id);
      edRef.current = null;
      ed.destroy();
    };
  }, []);

  // A newer version of the file (vault:changed → a new tree): reload a clean editor, ask for an edited one.
  const incoming = node.note?.text ?? null;
  const incomingVersion = node.note?.version ?? null;
  useEffect(() => {
    const ed = edRef.current, s = saverRef.current;
    if (!ed || !s || incoming === null || incoming === disk.current) return;
    if (merge) {
      setMerge((m) => (m ? { ...m, theirs: incoming, theirsVersion: incomingVersion as VersionDto } : m));
      return;
    }
    if (ed.dirty() || s.pending) {
      if (incoming === ed.text()) {
        ed.markSaved(incoming);
        s.resume(incomingVersion as VersionDto);
        disk.current = incoming;
        return;
      }
      s.block();
      setMerge({ mine: ed.text(), theirs: incoming, theirsVersion: incomingVersion as VersionDto, compare: false });
      return;
    }
    ed.reload(incoming);
    s.base = incomingVersion as VersionDto;
    disk.current = incoming;
  }, [incoming]);

  // ------------------------------------------------------------------ the merge dialog and the deleted alert
  const keepMine = async () => {
    const m = merge, ed = edRef.current, s = saverRef.current;
    if (!m || !ed || !s) return;
    const text = (await ed.save()) ?? ed.text();
    try {
      const r = await ipc.noteWrite(path, text, m.theirsVersion);
      ed.markSaved(text);
      disk.current = text;
      setMerge(null);
      s.resume(r.version);
    } catch (e) {
      const x = e as { kind?: string; theirs?: string; theirsVersion?: VersionDto };
      if (x.kind === 'Conflict' && x.theirsVersion) setMerge({ ...m, theirs: x.theirs ?? m.theirs, theirsVersion: x.theirsVersion });
    }
  };
  const keepTheirs = () => {
    const m = merge, ed = edRef.current, s = saverRef.current;
    if (!m || !ed || !s) return;
    ed.reload(m.theirs);
    disk.current = m.theirs;
    setMerge(null);
    s.resume(m.theirsVersion);
  };
  const keepBoth = async () => {
    const m = merge, ed = edRef.current, s = saverRef.current;
    if (!m || !ed || !s) return;
    const mine = (await ed.save()) ?? ed.text();
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    const stem = path.slice(dir.length).replace(/\.md$/, '');
    const base = `${dir}${stem} (conflict ${stamp()})`;
    for (let n = 1; n < 50; n++) {
      try {
        await ipc.noteCreateExact(`${base}${n > 1 ? ` (${n})` : ''}.md`, mine);
        break;
      } catch (e) {
        if ((e as { kind?: string }).kind !== 'NameTaken') return;
      }
    }
    ed.reload(m.theirs);
    disk.current = m.theirs;
    setMerge(null);
    s.resume(m.theirsVersion);
  };
  const restore = async () => {
    const ed = edRef.current, s = saverRef.current;
    if (!ed || !s) return;
    const text = (await ed.save()) ?? ed.text();
    try {
      const r = await ipc.noteWrite(path, text, null);
      ed.markSaved(text);
      disk.current = text;
      setDeleted(false);
      s.resume(r.version);
    } catch {
      setDeleted(false);
    }
  };
  const discard = () => {
    saverRef.current?.dispose();
    setDeleted(false);
    store.stateChanged();
  };

  useEffect(() => { edRef.current?.editor.setEditable(!merge && !deleted); }, [merge, deleted]);
  // The file was deleted outside Tegg while edited: no write before a choice (FR-SYN-03 AC-17).
  useEffect(() => {
    if (!gone) return;
    saverRef.current?.block();
    setDeleted(true);
  }, [gone]);

  return (
    <>
      <div ref={host} className="embed-editor" />
      {save.state === 'failed' && save.failure === 'io' && (
        <div role="alert" className="save-alert">
          <span>{t('embed.saveFailed', { title })}</span>
          <button type="button" onClick={() => saverRef.current?.retryNow()}>{t('save.tryAgain')}</button>
        </div>
      )}
      {deleted && (
        <div role="alert" className="save-alert">
          <span><strong>{t('deleted.title')}</strong> <span data-user-content>{title}</span> {t('deleted.body')}</span>
          <button type="button" onClick={() => void restore()}>{t('deleted.restore')}</button>
          <button type="button" onClick={discard}>{t('deleted.discard')}</button>
        </div>
      )}
      {merge && (
        <MergeDialog merge={merge} description={title}
          onCompare={() => setMerge({ ...merge, compare: true })}
          onMine={() => void keepMine()} onTheirs={keepTheirs} onBoth={() => void keepBoth()} />
      )}
    </>
  );
}
