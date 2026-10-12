import { useEffect, useRef, useState } from 'react';
import { ipc } from './ipc/client';
import type { SearchPageDto } from './ipc/types';
import { Highlighted } from './Highlighted';
import { typeIcon } from './icons';
import { t } from './i18n/catalog';

/** FR-SRC-01…04: full-text search with type icon, title and highlighted snippet. */
export function Search({ onOpen, refresh, inputRef }: { onOpen: (path: string) => void; refresh: number; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const [text, setText] = useState('');
  const [page, setPage] = useState<SearchPageDto | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const n = ++seq.current;
    if (!text.trim()) {
      setPage(null);
      return;
    }
    const timer = setTimeout(() => {
      ipc.search({ text, types: [], tags: [], offset: 0, limit: 50 }).then((p) => n === seq.current && setPage(p), () => {});
    }, 120);
    return () => clearTimeout(timer);
  }, [text, refresh]);

  return (
    <section className="search">
      <input ref={inputRef} type="search" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} aria-label={t('search.label')} placeholder={t('search.placeholder')} value={text} onChange={(e) => setText(e.target.value)} />
      {page && <div className="count">{page.total === 0 ? t('search.none') : t('search.count', { count: page.total })}</div>}
      <ul aria-label={t('search.results')}>
        {page?.results.map((r) => (
          <li key={r.path}>
            <button tabIndex={0} onClick={() => onOpen(r.path)}>
              <span className="icon">{typeIcon(r.type)}</span>
              <span className="title" data-user-content>{r.title}</span>
              {r.typo && <span className="typo">{t('search.typo')}</span>}
              {r.snippet && (
                <span className="snippet" data-user-content>
                  <Highlighted text={r.snippet.text} ranges={r.snippet.highlights} />
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
