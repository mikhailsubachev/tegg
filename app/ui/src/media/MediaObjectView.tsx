// Slice 6A (docs/contracts/ms6-trash-media.md §6.2; R76, D-618): above the body of an Image or PDF object's page: the
// image at its natural size (or the PDF card), the file's name and metadata, `Open in Preview` and `Reveal in Finder`.
import { useEffect, useState } from 'react';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import { MediaFigure } from './MediaFigure';
import { PdfCard } from './PdfCard';
import { sizeText } from './format';

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : null);

export function MediaObjectView({ path, type, title, data }: { path: string; type: string; title: string; data: Record<string, unknown> }) {
  const raw = typeof data.file === 'string' ? data.file : '';
  const target = raw.replace(/^!?\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
  const [file, setFile] = useState<string | null>(null);
  useEffect(() => {
    if (!target) return;
    let live = true;
    void ipc.linkResolve(path, [target]).then((r) => { if (live) setFile(r[0]?.kind === 'media' || r[0]?.kind === 'trashed' ? r[0].path ?? null : null); }, () => {});
    return () => { live = false; };
  }, [path, target]);
  if (!target) return null;
  const size = num(data.size);
  const w = num(data.width);
  const h = num(data.height);
  const meta = [target.split('/').pop(), typeof data['media-type'] === 'string' ? data['media-type'] : null, size !== null ? sizeText(size) : null, w !== null && h !== null ? `${w} × ${h}` : null].filter(Boolean).join(' · ');
  return (
    <div className="media-object">
      {file && (type === 'pdf' ? <PdfCard path={file} title={title} object={path} /> : <MediaFigure path={file} title={title} object={null} />)}
      {!file && <p className="media-missing">{t('media.missing', { name: target.split('/').pop() ?? target })}</p>}
      <p className="muted media-object-meta" data-user-content>{meta}</p>
      {file && (
        <div className="media-object-actions">
          <button type="button" tabIndex={0} onClick={() => void ipc.mediaOpen(file).catch(() => {})}>{t('media.openPreview')}</button>
          <button type="button" tabIndex={0} onClick={() => void ipc.mediaReveal(file).catch(() => {})}>{t('media.reveal')}</button>
        </div>
      )}
    </div>
  );
}
