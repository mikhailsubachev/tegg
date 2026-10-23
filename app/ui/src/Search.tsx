import { useEffect, useRef, useState } from 'react';
import { ipc } from './ipc/client';
import type { SearchPageDto } from './ipc/types';
import { Highlighted } from './Highlighted';
import { TypeIcon } from './icons';
import { t } from './i18n/catalog';
import { collator } from './i18n/collate';
import { TagFilter } from './tasks/TagFilter';
import { useTags } from './tags/store';
import { tagKey } from './tags/keys';

/** FR-SRC-01…04: full-text search with type icon, title and highlighted snippet, and the tag filter (D-652: any
 *  number of tags, all must match). `tag` presets it (an old `search/tag:<x>` route, ms4-tags §1.5). */
export function Search({ onOpen, refresh, inputRef, tag }: { onOpen: (path: string) => void; refresh: number; inputRef: React.RefObject<HTMLInputElement | null>; tag?: string }) {
  const [text, setText] = useState('');
  const [tagFilter, setTagFilter] = useState<string[]>(tag ? [tagKey(tag)] : []);
  useEffect(() => setTagFilter(tag ? [tagKey(tag)] : []), [tag]);
  const all = useTags();
  const options = all.filter((r) => r.count >= 1).sort((a, b) => b.count - a.count || collator().compare(a.name, b.name)).map((r) => ({ key: r.key, label: r.name, count: r.count }));
  const colors = Object.fromEntries(all.map((r) => [r.key, r.color]));
  const [page, setPage] = useState<SearchPageDto | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const n = ++seq.current;
    if (!text.trim() && tagFilter.length === 0) {
      setPage(null);
      return;
    }
    const timer = setTimeout(() => {
      ipc.search({ text, types: [], tags: tagFilter, offset: 0, limit: 50 }).then((p) => n === seq.current && setPage(p), () => {});
    }, text.trim() ? 120 : 0);
    return () => clearTimeout(timer);
  }, [text, tagFilter, refresh]);

  return (
    <section className="search">
      <input ref={inputRef} type="search" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} aria-label={t('search.label')} placeholder={t('search.placeholder')} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="filters">
        <TagFilter tags={options} selected={tagFilter} onChange={setTagFilter} colors={colors} allHint={t('search.tagAll')} />
      </div>
      {page && <div className="count">{page.total === 0 ? t('search.none') : t('search.count', { count: page.total })}</div>}
      <ul aria-label={t('search.results')}>
        {page?.results.map((r) => (
          <li key={r.path}>
            {/* A link row, not a <button>: WebKit centres a flex button's content, so results with a wrapped snippet
                jumped to the middle (3C preview feedback). */}
            <a href="#" tabIndex={0} className="result" onClick={(e) => { e.preventDefault(); onOpen(r.path); }}>
              <span className="icon"><TypeIcon type={r.type} /></span>
              <span className="title" data-user-content>{r.title}</span>
              {r.typo && <span className="typo">{t('search.typo')}</span>}
              {r.file_name && (() => {
                // D-254: a hit by its file name only says so, with the stem's matches highlighted.
                const [before, after = ''] = t('search.fileName').split('{stem}');
                return (
                  <span className="file-name">
                    {before}<span data-user-content><Highlighted text={r.file_name.text} ranges={r.file_name.highlights} /></span>{after}
                  </span>
                );
              })()}
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
