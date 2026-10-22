// Slice 6A (docs/contracts/ms6-trash-media.md §6; R74, R77): a block embed of a file, for the editor and the read view:
// an image figure, a PDF card, another file's card, `Can't find "<name>"`, or the trashed placeholder with Restore.
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { LinkTargetDto } from '../ipc/types';
import { Icon } from '../shell/Icon';
import { isImageFile, isPdfFile } from './format';
import { MediaFigure } from './MediaFigure';
import { PdfCard } from './PdfCard';

export type MediaInfo = Pick<LinkTargetDto, 'kind' | 'path' | 'title' | 'type'> & { object?: string | null };

export function MediaView({ target, info, onOpen }: { target: string; info: MediaInfo | null | undefined; onOpen?: (p: string) => void }) {
  const name = target.split('/').pop() ?? target;
  if (info?.kind === 'trashed') {
    const title = info.title ?? name;
    return (
      <section className="embed embed-trashed" aria-label={title} data-embed-state="trashed" data-embed-target={info.path ?? ''}>
        <p className="embed-trashed-text">
          {t('trash.placeholder', { title })}{' '}
          <button type="button" tabIndex={0} onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (info.path) void ipc.trashRestore(info.path).catch(() => {}); }}>{t('cmd.trashRestore')}</button>
        </p>
      </section>
    );
  }
  if (!info || info.kind !== 'media' || !info.path) {
    return <p className="media-missing" data-embed-state="broken">{t('media.missing', { name })}</p>;
  }
  const path = info.path;
  const object = info.object ?? null;
  const title = info.title ?? name;
  if (info.type === 'image' || (!info.type && isImageFile(path))) return <MediaFigure path={path} title={title} object={object} onOpen={onOpen} />;
  if (info.type === 'pdf' || isPdfFile(path)) return <PdfCard path={path} title={title} object={object} onOpen={onOpen} />;
  return (
    <div className="media-file-card" data-media-path={path.normalize('NFC')}>
      <Icon name="file" size={18} />
      <span className="media-file-name" data-user-content>{name}</span>
      <button type="button" tabIndex={0} onClick={(e) => { e.preventDefault(); e.stopPropagation(); void ipc.mediaReveal(path).catch(() => {}); }}>{t('media.reveal')}</button>
    </div>
  );
}
