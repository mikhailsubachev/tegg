// The Duplicate titles page (FR-LNK-14 AC-8, AC-9; D-284, D-290, D-307): one group per shared title; `Merge…` comes
// with 4C. Browsing writes nothing.
import { useEffect, useState, type RefObject } from 'react';
import { t } from '../i18n/catalog';
import { collator } from '../i18n/collate';
import { ipc } from '../ipc/client';
import type { DuplicateGroupDto, TypeDefDto } from '../ipc/types';
import { Disabled } from '../shell/Disabled';
import { Icon } from '../shell/Icon';
import { detailsText } from './DuplicateDetails';
import { chipIcon } from './icons';
import { orderDuplicates } from './order';

export function DuplicateTitlesPage({ heading, refresh, types, onOpen }: {
  heading: RefObject<HTMLHeadingElement | null>; refresh: number; types: TypeDefDto[]; onOpen: (path: string) => void;
}) {
  const [data, setData] = useState<DuplicateGroupDto[] | null>(null);
  useEffect(() => {
    let live = true;
    ipc.duplicateTitles().then((d) => { if (live) setData(d); }, () => {});
    return () => { live = false; };
  }, [refresh]);
  const groups = data ? orderDuplicates(data, collator()) : [];
  const objects = groups.reduce((n, g) => n + g.objects.length, 0);
  return (
    <div className="page-column vault-check">
      <h1 ref={heading} tabIndex={-1}>{t('duplicates.title')}</h1>
      {data && <p className="summary">{groups.length ? t('duplicates.summary', { count: groups.length, objects }) : t('duplicates.none')}</p>}
      {groups.map((g) => (
        <section key={g.key} role="group" aria-label={`${g.label}, ${g.objects.length}`} className="check-group">
          <h2><span data-user-content>{g.label}</span> <span className="group-count">{g.objects.length}</span></h2>
          <Disabled control="duplicates.merge" />
          <ul className="dup-rows">
            {g.objects.map((o) => {
              const icon = chipIcon(o.type);
              const typeName = types.find((x) => x.key === o.type)?.name ?? o.type;
              return (
                <li key={o.path}>
                  <a href="#" tabIndex={0} className="dup-row" data-command="duplicates.open" onClick={(e) => { e.preventDefault(); onOpen(o.path); }}>
                    <Icon name={icon.glyph} dataIcon={icon.def} size={14} />
                    <span data-user-content>{o.title}</span>
                    <span className="meta" data-user-content>{detailsText(o.details, typeName)}</span>
                    <span className="meta" data-user-content>{o.folder}</span>
                    <span className="meta">{t('duplicates.backlinks', { count: o.backlinks })}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
