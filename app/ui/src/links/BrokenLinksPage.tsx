// The Broken links page (FR-LNK-04 AC-9, AC-10; D-284, D-307): one group per target, sources with backlinks-style
// excerpts and `Create "<target>"`. Browsing writes nothing; Create opens the one offer.
import { useEffect, useState, type RefObject } from 'react';
import { t } from '../i18n/catalog';
import { collator } from '../i18n/collate';
import { ipc } from '../ipc/client';
import type { BrokenLinksDto, OccurrenceDto } from '../ipc/types';
import { Icon } from '../shell/Icon';
import { Excerpt } from './Excerpt';
import { chipIcon } from './icons';
import { requestOffer } from './offer';
import { orderBroken } from './order';

export function BrokenLinksPage({ heading, refresh, onOpen }: {
  heading: RefObject<HTMLHeadingElement | null>; refresh: number;
  onOpen: (source: string, occurrence: OccurrenceDto | null, readOnly: boolean) => void;
}) {
  const [data, setData] = useState<BrokenLinksDto | null>(null);
  useEffect(() => {
    let live = true;
    ipc.brokenLinks().then((d) => { if (live) setData(d); }, () => {});
    return () => { live = false; };
  }, [refresh]);
  const groups = data ? orderBroken(data.groups, collator()) : [];
  return (
    <div className="page-column vault-check">
      <h1 ref={heading} tabIndex={-1}>{t('brokenLinks.title')}</h1>
      {data && <p className="summary">{data.occurrences ? t('brokenLinks.summary', { count: data.occurrences, objects: data.objects }) : t('brokenLinks.none')}</p>}
      {groups.map((g) => (
        <section key={g.key} role="group" aria-label={`${g.label}, ${g.count}`} className="check-group">
          <h2><span data-user-content>{g.label}</span> <span className="group-count">{g.count}</span></h2>
          <button tabIndex={0} type="button" data-command="brokenLinks.create"
            onClick={(e) => {
              const from = g.sources[0]?.source ?? '';
              const rel = g.create.state === 'create' && g.sources.length ? null : null;
              void rel;
              requestOffer({ from, target: g.label, relationTo: relationTo(g), anchor: e.currentTarget });
            }}>
            {t('brokenLinks.create', { label: g.label })}
          </button>
          {g.sources.map((e) => {
            const icon = chipIcon(e.type);
            return (
              <article key={e.source} aria-label={e.title} className="backlink-entry">
                <a href="#" tabIndex={0} className="entry-title" data-command="brokenLinks.open" onClick={(ev) => { ev.preventDefault(); onOpen(e.source, null, e.readOnly); }}>
                  <Icon name={icon.glyph} dataIcon={icon.def} size={14} /><span data-user-content>{e.title}</span>
                </a>
                <ul className="excerpts">
                  {e.occurrences.map((o, i) => <li key={i}><Excerpt occurrence={o} source={e.source} readOnly={e.readOnly} onOpen={onOpen} command="brokenLinks.openMention" /></li>)}
                </ul>
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/** The type the group's plan names, as a relation's first allowed type (the core planned it, D-284). */
function relationTo(g: BrokenLinksDto['groups'][number]): string[] | null {
  return g.create.state === 'create' ? [g.create.type] : null;
}
