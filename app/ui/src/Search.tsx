import { useEffect, useRef, useState } from 'react';
import { ipc } from './ipc/client';
import type { SearchPageDto } from './ipc/types';
import { Highlighted } from './Highlighted';
import { typeIcon } from './icons';
import { t } from './i18n/catalog';

/** FR-SRC-01…04: full-text search with type icon, title and highlighted snippet. `tag` presets the tag filter
 *  (a `#tag` activated in the read view, D-143). */
export function Search({ onOpen, refresh, inputRef, tag }: { onOpen: (path: string) => void; refresh: number; inputRef: React.RefObject<HTMLInputElement | null>; tag?: string }) {
  const [text, setText] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(tag ?? null);
  useEffect(() => setTagFilter(tag ?? null), [tag]);
  const [page, setPage] = useState<SearchPageDto | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const n = ++seq.current;
    if (!text.trim() && !tagFilter) {
      setPage(null);
      return;
    }
    const timer = setTimeout(() => {
      ipc.search({ text, types: [], tags: tagFilter ? [tagFilter] : [], offset: 0, limit: 50 }).then((p) => n === seq.current && setPage(p), () => {});
    }, text.trim() ? 120 : 0);
    return () => clearTimeout(timer);
  }, [text, tagFilter, refresh]);

  return (
    <section className="search">
      <input ref={inputRef} type="search" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} aria-label={t('search.label')} placeholder={t('search.placeholder')} value={text} onChange={(e) => setText(e.target.value)} />
      {tagFilter && (
        <div className="filters">
          <span className="chip tag-chip"><span data-user-content>#{tagFilter}</span></span>
        </div>
      )}
      {page && <div className="count">{page.total === 0 ? t('search.none') : t('search.count', { count: page.total })}</div>}
      <ul aria-label={t('search.results')}>
        {page?.results.map((r) => (
          <li key={r.path}>
            {/* A link row, not a <button>: WebKit centres a flex button's content, so results with a wrapped snippet
                jumped to the middle (3C preview feedback). */}
            <a href="#" tabIndex={0} className="result" onClick={(e) => { e.preventDefault(); onOpen(r.path); }}>
              <span className="icon">{typeIcon(r.type)}</span>
              <span className="title" data-user-content>{r.title}</span>
              {r.typo && <span className="typo">{t('search.typo')}</span>}
              {r.snippet && (
                <span className="snippet" data-user-content>
                  <Highlighted text={r.snippet.text} ranges={r.snippet.highlights} />
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
