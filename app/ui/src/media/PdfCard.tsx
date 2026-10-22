// Slice 6A (docs/contracts/ms6-trash-media.md §6.2; R77, FR-ATT-02): the PDF link card (icon, title,
// `<n> pages · <size>`); a click opens the PDF object (or, without one, the file in the default app).
import { useEffect, useState } from 'react';
import { parse } from '@tegg/doc';
import { ipc } from '../ipc/client';
import { Icon } from '../shell/Icon';
import { pdfMeta } from './format';

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : null);

/** `pages` and `size` of an Image/PDF object, read from its file. */
export function useObjectMeta(object: string | null): { pages: number | null; size: number | null } {
  const [m, setM] = useState<{ pages: number | null; size: number | null }>({ pages: null, size: null });
  useEffect(() => {
    if (!object) return;
    let live = true;
    void ipc.noteRead(object).then((n) => {
      const d = (parse(n.text).frontmatter?.data ?? {}) as Record<string, unknown>;
      if (live) setM({ pages: num(d.pages), size: num(d.size) });
    }, () => {});
    return () => { live = false; };
  }, [object]);
  return m;
}

export function PdfCard({ path, title, object, onOpen }: { path: string; title: string; object: string | null; onOpen?: (p: string) => void }) {
  const meta = useObjectMeta(object);
  const text = pdfMeta(meta.pages, meta.size);
  return (
    <button type="button" tabIndex={0} className="media-pdf-card" data-media-path={path.normalize('NFC')}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (object && onOpen) onOpen(object); else void ipc.mediaOpen(path).catch(() => {}); }}>
      <Icon name="pdf" size={20} />
      <span className="media-pdf-text">
        <span className="media-pdf-title" data-user-content>{title}</span>
        {text && <span className="media-pdf-meta muted">{text}</span>}
      </span>
    </button>
  );
}
