// Slice 6A (docs/contracts/ms6-trash-media.md §6.2; R77, D-622): an image embed: `figure` with `img` (alt = the
// object's title, natural size up to the column width, `loading="lazy"`), loaded through the media URL (D-626). A
// click selects (the editor), a double-click or ⌘-click opens the object; the context menu has Open, Open in Preview
// and Reveal in Finder.
import { useState } from 'react';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import { mediaUrl } from '../ipc/media';
import { PopupMenu, type MenuEntry } from '../shell/Menu';

export function MediaMenu({ at, path, object, onOpen, onClose }: {
  at: { x: number; y: number }; path: string; object: string | null; onOpen: (p: string) => void; onClose: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const item = (key: string, label: string, run: () => void): MenuEntry => ({ kind: 'item', key, label, content: label, onChoose: () => { onClose(); run(); } });
  const entries: MenuEntry[] = [
    ...(object ? [item('open', t('media.open'), () => onOpen(object))] : []),
    item('preview', t('media.openPreview'), () => { void ipc.mediaOpen(path).catch(() => {}); }),
    item('reveal', t('media.reveal'), () => { void ipc.mediaReveal(path).catch(() => {}); }),
  ];
  return (
    <>
      <span ref={setAnchor} aria-hidden="true" style={{ position: 'fixed', left: at.x, top: at.y, width: 0, height: 0 }} />
      {anchor && <PopupMenu label={t('media.menu')} anchor={anchor} entries={entries} onClose={onClose} />}
    </>
  );
}

export function MediaFigure({ path, title, object, onOpen }: { path: string; title: string; object: string | null; onOpen?: (p: string) => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const open = () => { if (object && onOpen) onOpen(object); };
  return (
    // A double-click anywhere on the figure opens the object (FR-ATT-01 AC-13; slice P keeps it, D-938).
    <figure className="media-figure" data-media-path={path.normalize('NFC')} data-media-object={object ?? undefined}
      onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); open(); }}>
      <img src={mediaUrl(path)} alt={title} loading="lazy" draggable={false}
        onClick={(e) => { if (e.metaKey) { e.preventDefault(); e.stopPropagation(); open(); } }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }); }}
        onLoad={() => { void ipc.perfMark(`media-ready:${path.normalize('NFC')}`).catch(() => {}); }} />
      {menu && <MediaMenu at={menu} path={path} object={object} onOpen={(p) => onOpen?.(p)} onClose={() => setMenu(null)} />}
    </figure>
  );
}
