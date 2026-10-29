// The body of a preview (previews.md R105; v1-previews §3.4; D-933…D-938): the read view's renderer with every embed a
// card, the section of a `#Heading` / `#^id` link, all attributes for an empty body, the image or PDF of a media
// object, a tag's objects, and the notices. Long bodies are windowed (D-934): at most 300 blocks in the DOM.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { markdownTree, parse } from '@tegg/doc';
import { t } from '../i18n/catalog';
import type { LinkTargetDto, TypeDto } from '../ipc/types';
import { chipTypes } from '../links/icons';
import { ReadView } from '../read/ReadView';
import { attributeRows } from '../read/properties';
import { PropertyRows } from '../read/PropertiesStrip';
import { Embed } from '../embeds/Embed';
import { mediaUrl } from '../ipc/media';
import { PdfCard } from '../media/PdfCard';
import { ObjectChip } from './ObjectChip';
import { previewHost } from './store';
import type { PreviewModel } from './load';
import type { PreviewTarget } from './types';

const nfc = (s: string) => s.normalize('NFC');
const WINDOW = 120;
const LIMIT = 300;
const noop = () => {};
/** A reference inside a preview opens its target (a double-click, ⌘↩); a click on it replaces the content (D-932). */
const openPath = (path: string, fragment?: string) => previewHost()?.open({ path: nfc(path), fragment: fragment ?? null, kind: 'note' });

function linkMap(links: LinkTargetDto[]): Map<string, LinkTargetDto> {
  const m = new Map<string, LinkTargetDto>();
  for (const l of links) { if (!m.has(l.target)) m.set(l.target, l); if (!m.has(nfc(l.target))) m.set(nfc(l.target), l); }
  return m;
}

function lineBefore(text: string, at: number): number {
  let n = 0;
  for (let i = text.indexOf('\n'); i >= 0 && i < at; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

/** An Image or PDF object's file (D-938): the image fit to the popover, or the R77 PDF card. */
function MediaPart({ m }: { m: Extract<PreviewModel, { state: 'ok' }> }) {
  const file = typeof m.data.file === 'string' ? /^\[\[([^\]|#]+)/.exec(m.data.file.trim())?.[1]?.trim() ?? null : null;
  if (!file) return null;
  const info = m.links.find((l) => nfc(l.target) === nfc(file));
  const path = info?.kind === 'media' && info.path ? info.path : null;
  const name = file.split('/').pop() ?? file;
  if (!path) return <p className="media-missing" data-embed-state="broken">{t('media.missing', { name })}</p>;
  if (m.type === 'image') {
    // D-938: fit to the content width, at most 240 px high, the aspect ratio kept (from `width` / `height` when known).
    const w = Number(m.data.width), h = Number(m.data.height);
    const ar = w > 0 && h > 0 ? w / h : null;
    const style = ar ? { width: `min(100%, ${240 * ar}px)`, aspectRatio: `${w} / ${h}` } : undefined;
    return <img className="preview-image" src={mediaUrl(path)} alt={m.title} draggable={false} style={style} />;
  }
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : null);
  return <PdfCard path={path} title={m.title} object={m.path} meta={{ pages: num(m.data.pages), size: num(m.data.size) }} />;
}

export function PreviewBody({ model, target, scrollToEmbedOf, scroller }: { model: PreviewModel; target: PreviewTarget; scrollToEmbedOf: string | null; scroller: RefObject<HTMLElement | null> }) {
  if (model.state === 'gone') return <p className="preview-message">{t('preview.gone')}</p>;
  if (model.state === 'error') return <p className="preview-message">{t('preview.loadFailed')}</p>;
  if (model.state === 'day') return <p className="preview-message">{t('embed.noDay')}</p>;
  if (model.state === 'tag') {
    return (
      <div className="preview-tag">
        <p className="preview-count">{t('preview.tag.count', { n: model.count, count: model.count })}</p>
        <div className="chips">
          {model.objects.map((o) => <ObjectChip key={o.path} path={o.path} title={o.title} type={o.type} />)}
        </div>
      </div>
    );
  }
  void target;
  return <NoteBody m={model} scrollToEmbedOf={scrollToEmbedOf} scroller={scroller} />;
}

export function Notice({ m }: { m: Extract<PreviewModel, { state: 'ok' }> }) {
  if (!m.notice) return null;
  const f = (m.fragment ?? '').replace(/^\^/, '');
  const text = m.notice === 'readError' ? t('preview.readError') : m.notice === 'noBlock' ? t('embed.noBlock', { id: f, block: f, title: m.title }) : t('embed.noHeading', { heading: f, title: m.title });
  return <p className="preview-notice" role="note">{text}</p>;
}

function NoteBody({ m, scrollToEmbedOf, scroller }: { m: Extract<PreviewModel, { state: 'ok' }>; scrollToEmbedOf: string | null; scroller: RefObject<HTMLElement | null> }) {
  const links = useMemo(() => linkMap(m.links), [m.links]);
  const media = m.type === 'image' || m.type === 'pdf';
  const slice = m.text.slice(m.section.from, m.section.to);
  const lineBase = lineBefore(m.text, m.section.from);
  const count = useMemo(() => (markdownTree(slice) as unknown as { children: unknown[] }).children.length, [slice]);
  const [range, setRange] = useState<[number, number]>([0, Math.min(count, count > LIMIT ? WINDOW : count)]);
  const heights = useRef(new Map<number, number>());
  const jumping = useRef(false);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => { setRange([0, Math.min(count, count > LIMIT ? WINDOW : count)]); heights.current.clear(); }, [slice]);

  // Cards of nested embeds (D-933), matched by line (each embed has its own), else by value.
  const renderEmbed = (value: string, line: number, inline: boolean): ReactNode => {
    const kids = m.tree.embeds;
    const child = kids.find((c) => c.line === line && nfc(c.value) === nfc(value) && c.inline === inline) ?? kids.find((c) => nfc(c.value) === nfc(value));
    if (!child) return null;
    return <Embed node={child} host={m.path} editable={false} onOpen={openPath} modeDisabled={t('embed.cantEdit')} inPreview />;
  };

  // D-939: the source preview starts at the task's first embed, marked.
  useLayoutEffect(() => {
    if (!scrollToEmbedOf || !box.current || !scroller.current) return;
    const el = [...box.current.querySelectorAll<HTMLElement>('[data-embed-target]')].find((x) => nfc(x.dataset.embedTarget ?? '') === nfc(scrollToEmbedOf));
    if (!el) return;
    el.setAttribute('data-preview-target', '');
    const s = scroller.current;
    // Room below the content so the card can reach the top of the body even near the note's end.
    if (padRef.current) padRef.current.style.height = `${s.clientHeight}px`;
    // After the popover has its size and place (the next frames), the card goes to the top of the body.
    const go = () => { s.scrollTop += el.getBoundingClientRect().top - s.getBoundingClientRect().top; };
    go();
    const f = requestAnimationFrame(() => { go(); requestAnimationFrame(go); });
    return () => cancelAnimationFrame(f);
  }, [scrollToEmbedOf, m]);

  // Windowing (D-934): measure what's mounted, move the window with the scroll position.
  const windowed = count > LIMIT;
  const avg = () => { const v = [...heights.current.values()]; return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 24; };
  const h = (i: number) => heights.current.get(i) ?? avg();
  const sum = (a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += h(i); return s; };
  useLayoutEffect(() => {
    if (!windowed || !box.current) return;
    const kids = [...box.current.querySelectorAll<HTMLElement>(':scope > .read-view > [data-preview-block]')];
    for (const k of kids) heights.current.set(Number(k.dataset.previewBlock), k.offsetHeight + parseFloat(getComputedStyle(k).marginTop || '0') + parseFloat(getComputedStyle(k).marginBottom || '0'));
  });
  useEffect(() => {
    if (!windowed) return;
    const s = scroller.current;
    if (!s) return;
    const on = () => {
      if (jumping.current) return;
      const offset = box.current ? box.current.offsetTop : 0;
      const y = Math.max(0, s.scrollTop - offset);
      let acc = 0, first = 0;
      while (first < count - 1 && acc + h(first) < y) { acc += h(first); first++; }
      // Always a full window: near the end it is the last WINDOW blocks, so the end can be reached and stays put.
      const start = Math.min(Math.max(0, first - 20), Math.max(0, count - WINDOW));
      const end = Math.min(count, start + WINDOW);
      setRange((r) => (r[0] === start && r[1] === end ? r : [start, end]));
    };
    const toEnd = () => {
      jumping.current = true;
      setRange([Math.max(0, count - WINDOW), count]);
      // Measured heights replace the estimates as the last blocks are drawn: follow the end until it holds still.
      let n = 0;
      const chase = () => {
        s.scrollTop = s.scrollHeight;
        if (++n < 20) requestAnimationFrame(chase);
        else jumping.current = false;
      };
      requestAnimationFrame(chase);
    };
    s.addEventListener('scroll', on, { passive: true });
    s.addEventListener('preview-end', toEnd);
    return () => { s.removeEventListener('scroll', on); s.removeEventListener('preview-end', toEnd); };
  }, [windowed, count]);

  // After End the body stays at its end while the last blocks are measured and their cards and images are drawn (each
  // can grow the content), until the reader moves it themselves (FR-LNK-11 AC-3).
  useEffect(() => {
    const s = scroller.current;
    if (!s || !box.current || typeof ResizeObserver === 'undefined') return;
    let stick = false;
    const grown = new ResizeObserver(() => { if (stick) s.scrollTop = s.scrollHeight; });
    grown.observe(box.current);
    grown.observe(s);
    const toEnd = () => { stick = true; };
    const unstick = () => { stick = false; };
    const key = (e: Event) => { const k = (e as KeyboardEvent).key; if (k !== 'End') stick = false; };
    s.addEventListener('preview-end', toEnd);
    s.addEventListener('wheel', unstick, { passive: true });
    s.addEventListener('pointerdown', unstick);
    window.addEventListener('keydown', key, true);
    return () => {
      grown.disconnect();
      s.removeEventListener('preview-end', toEnd);
      s.removeEventListener('wheel', unstick);
      s.removeEventListener('pointerdown', unstick);
      window.removeEventListener('keydown', key, true);
    };
  }, [scroller]);

  const rows = m.body === 'properties' ? propertyRows(m) : null;
  const padRef = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={box} className="preview-content">
      {media && <MediaPart m={m} />}
      {m.body === 'empty' && <p className="preview-message">{t('embed.empty')}</p>}
      {rows}
      {m.body === 'blocks' && slice.trim() !== '' && (
        <div style={windowed ? { paddingTop: sum(0, range[0]), paddingBottom: sum(range[1], count) } : undefined}>
          <ReadView text={slice} path={m.path} links={links} lineBase={lineBase} bare minHeading={3}
            range={windowed ? range : undefined}
            onOpen={openPath} onTag={(k) => previewHost()?.open({ path: '', fragment: null, kind: 'tag', key: k })} onExternal={(u) => previewHost()?.external?.(u)} onScrollInNote={noop} renderEmbed={renderEmbed} />
        </div>
      )}
      {scrollToEmbedOf && <div ref={padRef} aria-hidden="true" />}
    </div>
  );
}

/** D-936 a: an empty body shows every attribute by the read-view Properties rules, named as the type names them. */
function propertyRows(m: Extract<PreviewModel, { state: 'ok' }>) {
  const doc = parse(m.text);
  const type = (chipTypes() as TypeDto[]).find((x) => nfc(x.key) === m.type);
  const rows = attributeRows(doc).rows.map((r) => {
    const a = type?.attributes.find((x) => nfc(x.key) === nfc(r.key));
    return a ? { ...r, label: a.name } : r;
  });
  const emails = new Set((type?.attributes ?? []).filter((a) => a.type === 'email').map((a) => a.key));
  return <PropertyRows rows={rows} links={linkMap(m.links)} from={m.path} emails={emails} />;
}
