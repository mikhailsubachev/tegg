// The parts of a preview (previews.md R102, R105; board ObjectPreview): Back, Close, the header (type icon, title,
// type name, details, the graph's line D-917), the preview-attribute strip, the body and the footer. The popover
// and the graph's column (v1-previews §7) render this same component.
import type { RefObject } from 'react';
import { t } from '../i18n/catalog';
import type { TypeDto } from '../ipc/types';
import { chipIcon, chipTypes, typeNameOf } from '../links/icons';
import { chipState, taskGlyph, taskIconDef } from '../links/chip';
import { Icon } from '../shell/Icon';
import { Notice, PreviewBody } from './PreviewBody';
import { StripList } from '../embeds/strip';
import type { PreviewModel } from './load';
import { getPrefs } from './store';
import type { PreviewTarget } from './types';

const nfc = (s: string) => s.normalize('NFC');

/** The object's own title (the dialog's name and its content's, R102). */
export function plainTitle(m: PreviewModel | null, target: PreviewTarget): string {
  if (!m) return '';
  return m.state === 'ok' ? m.title : previewTitle(m, target);
}

/** The header title: `<title> › <heading>` for a `#Heading` link (D-156), `#<name>` for a tag. */
export function previewTitle(m: PreviewModel, target: PreviewTarget): string {
  if (m.state === 'tag') return `#${m.name}`;
  if (m.state === 'day') return m.date;
  if (m.state !== 'ok') return target.kind === 'note' ? nfc(target.path.split('/').pop()!.replace(/\.md$/i, '')) : target.key ?? '';
  const f = target.fragment;
  return f && !f.startsWith('^') ? `${m.title} › ${f}` : m.title;
}

function HeaderIcon({ m }: { m: PreviewModel }) {
  if (m.state === 'tag') return <span className="tag-tile preview-icon" data-icon="hash" data-color={m.color ?? 'none'} aria-hidden="true">#</span>;
  if (m.state === 'day') { const i = chipIcon('daily-note'); return <span className="preview-icon"><Icon name={i.glyph} dataIcon={i.def} size={16} /></span>; }
  if (m.state !== 'ok') return null;
  if (m.type === 'task') {
    // D-600: the task box by state instead of the Task icon.
    const s = chipState({ kind: 'note', type: 'task', status: typeof m.data.status === 'string' ? m.data.status : null, due: null, completed: null });
    const g = taskGlyph(s);
    if (g) return <span className="preview-icon"><Icon name={g} dataIcon={taskIconDef(s)} size={16} /></span>;
  }
  const i = chipIcon(m.type);
  const type = (chipTypes() as TypeDto[]).find((x) => nfc(x.key) === m.type);
  return <span className="preview-icon" data-color={type?.color ?? undefined}><Icon name={i.glyph} dataIcon={i.def} size={16} /></span>;
}

export type ContentProps = {
  uid: string;
  model: PreviewModel | null;
  target: PreviewTarget;
  extraLine: string | null;
  bodyRef: RefObject<HTMLElement | null>;
  back: { title: string; onBack: () => void } | null;
  onClose: () => void;
  onOpen: () => void;
  resize: null | Pick<React.HTMLAttributes<HTMLElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onKeyDown' | 'onKeyUp' | 'onDoubleClick'>;
  scrollToEmbedOf: string | null;
};

export function PreviewContent({ uid, model, target, extraLine, bodyRef, back, onClose, onOpen, resize, scrollToEmbedOf }: ContentProps) {
  const m = model;
  const title = m ? previewTitle(m, target) : '';
  const typeName = !m ? '' : m.state === 'tag' ? typeNameOf('tag') : m.state === 'day' ? typeNameOf('daily-note') : m.state === 'ok' ? typeNameOf(m.type) : '';
  const mode = getPrefs().mode;
  const gone = m?.state === 'gone';
  return (
    <>
      <header className="preview-header">
        <div className="preview-head">
          {m && <HeaderIcon m={m} />}
          <div className="preview-heading">
            <h2 data-user-content>{title}</h2>
            {m?.state === 'ok' && m.unreviewed && <span className="preview-unrev" data-review="unreviewed"><span className="chip-unrev" aria-hidden="true" /> {t('review.unreviewed')}</span>}
            <div id={`${uid}-type`} className="preview-type">
              <span data-user-content>{typeName}</span>
              {m?.state === 'ok' && m.details && <span data-user-content>{` · ${m.details.replace(new RegExp(`^${typeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · `), '')}`}</span>}
            </div>
            {extraLine && <div id={`${uid}-extra`} className="preview-extra" data-user-content>{extraLine}</div>}
          </div>
        </div>
        {back && (
          <button type="button" tabIndex={0} className="preview-back" data-command="preview.back" aria-label={t('preview.back', { title: back.title })} onClick={back.onBack}>
            <Icon name="back" size={14} />
            <span data-user-content>{back.title}</span>
          </button>
        )}
        <button type="button" tabIndex={0} className="icon-button small preview-close" data-command="preview.close" aria-label={t('preview.close')} onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </header>
      {m?.state === 'ok' && m.strip.length > 0 && (
        <div role="region" aria-label={t('preview.properties')} className="preview-strip">
          <StripList cols={m.strip} data={m.data} links={m.links} path={m.path} title={m.title} typeKey={m.type} className="preview-props" />
        </div>
      )}
      {m?.state === 'ok' && <Notice m={m} />}
      <article ref={bodyRef as RefObject<HTMLElement>} className="preview-body" aria-label={t('preview.content', { title: plainTitle(m, target) })} tabIndex={-1}>
        {m && <PreviewBody model={m} target={target} scrollToEmbedOf={scrollToEmbedOf} scroller={bodyRef} />}
      </article>
      <footer className="preview-footer">
        <span className="preview-hint">{t(`preview.hint.${mode}`)}</span>
        <button type="button" tabIndex={0} className="preview-open" data-command="preview.open" aria-label={t('preview.open', { title })} aria-disabled={gone ? 'true' : undefined} onClick={() => { if (!gone) onOpen(); }}>
          {t('preview.openShort')} <span className="preview-key" aria-hidden="true">↩</span>
        </button>
        {resize && (
          <span role="button" tabIndex={0} className="preview-resize" data-command="preview.resize" data-preview-resize="" aria-label={t('preview.resize')} aria-description={t('preview.resizeHint')} {...resize}>
            <Icon name="resize" size={14} />
          </span>
        )}
      </footer>
    </>
  );
}
