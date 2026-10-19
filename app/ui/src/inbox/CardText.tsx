// D-590 (inbox.md R60, FR-INB-01 AC-13): an object card's text as simplified Markdown from `@tegg/doc`'s parse. Only
// rendered cards read their note (the Inbox is virtualized, D-586); texts are cached by path and version. React
// renders every value as text, so nothing from the file becomes HTML.
import { cardBlocks, type CardBlock, type CardSpan } from '@tegg/doc';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { VersionDto } from '../ipc/types';

const cache = new Map<string, CardBlock[]>();
/** The excerpt is part of the key: a reloaded row whose text changed reads again even if its version didn't. */
const keyOf = (path: string, v: VersionDto, excerpt: string) => `${path}\u0000${v.hash}\u0000${excerpt}`;

function span(s: CardSpan, i: number): ReactNode {
  switch (s.kind) {
    case 'break': return <br key={i} />;
    case 'image': return <span key={i} className="muted">{t('card.image')}</span>;
    case 'embed': return <span key={i} className="muted">{t('card.embed', { name: s.name })}</span>;
    case 'text': {
      let n: ReactNode = s.text;
      for (const m of s.marks) n = m === 'strong' ? <strong>{n}</strong> : m === 'em' ? <em>{n}</em> : m === 'strike' ? <s>{n}</s> : <code>{n}</code>;
      return <Fragment key={i}>{n}</Fragment>;
    }
  }
}
const spans = (ss: CardSpan[]) => ss.map(span);

export function CardText({ path, version, excerpt }: { path: string; version: VersionDto; excerpt: string }) {
  const key = keyOf(path, version, excerpt);
  const [blocks, setBlocks] = useState<CardBlock[] | null>(() => cache.get(key) ?? null);
  useEffect(() => {
    const hit = cache.get(key);
    if (hit) { setBlocks(hit); return; }
    let live = true;
    ipc.noteRead(path).then((n) => {
      const b = cardBlocks(n.text);
      cache.set(key, b);
      if (cache.size > 400) cache.delete(cache.keys().next().value!);
      if (live) setBlocks(b);
    }, () => {});
    return () => { live = false; };
  }, [key]);
  if (!blocks) return excerpt ? <div className="inbox-card-text" data-user-content><p>{excerpt}</p></div> : null;
  if (blocks.length === 0) return null;
  return (
    <div className="inbox-card-text" data-user-content>
      {blocks.map((b, i) => {
        if (b.kind === 'paragraph') return <p key={i}>{spans(b.spans)}</p>;
        if (b.kind === 'heading') return <p key={i}><strong>{spans(b.spans)}</strong></p>;
        const items = b.items.map((it, j) => (
          <li key={j} className={it.checked !== null ? 'check' : undefined}>
            {it.checked !== null && <input type="checkbox" checked={it.checked} disabled readOnly tabIndex={-1} aria-hidden="true" />}
            {spans(it.spans)}
          </li>
        ));
        return b.ordered ? <ol key={i} start={b.start}>{items}</ol> : <ul key={i}>{items}</ul>;
      })}
    </div>
  );
}
