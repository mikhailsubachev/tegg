// The Duplicate titles page (FR-LNK-14 AC-8, AC-9; D-284, D-290, D-307): one group per shared title; `Merge…` comes
// with 4C. Browsing writes nothing.
import { RefElement } from '../preview/useReference';
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { t } from '../i18n/catalog';
import { collator } from '../i18n/collate';
import { ipc } from '../ipc/client';
import type { DuplicateGroupDto, TypeDefDto } from '../ipc/types';
import { MergeDialog } from './MergeDialog';
import { Icon } from '../shell/Icon';
import { detailsText } from './DuplicateDetails';
import { chipIcon } from './icons';
import { orderDuplicates } from './order';

export function DuplicateTitlesPage({ heading, refresh, types, onOpen, mergeRef }: {
  heading: RefObject<HTMLHeadingElement | null>; refresh: number; types: TypeDefDto[]; onOpen: (path: string) => void;
  /** The palette's `Merge…`: the group with the focus (FR-LNK-14 AC-11, R87). */
  mergeRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const [data, setData] = useState<DuplicateGroupDto[] | null>(null);
  const [merging, setMerging] = useState<DuplicateGroupDto | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    ipc.duplicateTitles().then((d) => { if (live) setData(d); }, () => {});
    return () => { live = false; };
  }, [refresh, tick]);
  useLayoutEffect(() => {
    if (!mergeRef) return;
    const f = () => {
      const sec = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('section[data-group]');
      const g = groups.find((x) => x.key === sec?.dataset.group);
      if (g) setMerging(g);
    };
    mergeRef.current = f;
    return () => { if (mergeRef.current === f) mergeRef.current = null; };
  });
  const groups = data ? orderDuplicates(data, collator()) : [];
  const objects = groups.reduce((n, g) => n + g.objects.length, 0);
  return (
    <div className="page-column vault-check">
      <h1 ref={heading} tabIndex={-1}>{t('duplicates.title')}</h1>
      {data && <p className="summary">{groups.length ? t('duplicates.summary', { count: groups.length, objects }) : t('duplicates.none')}</p>}
      {groups.map((g) => (
        <section key={g.key} role="group" aria-label={`${g.label}, ${g.objects.length}`} className="check-group" data-group={g.key}>
          <h2><span data-user-content>{g.label}</span> <span className="group-count">{g.objects.length}</span></h2>
          <button tabIndex={0} type="button" className="text-button" data-command="duplicates.merge" onClick={() => setMerging(g)}>{t('duplicates.merge')}</button>
          <ul className="dup-rows">
            {g.objects.map((o) => {
              const icon = chipIcon(o.type);
              const typeName = types.find((x) => x.key === o.type)?.name ?? o.type;
              return (
                <li key={o.path}>
                  {/* Slice P (R104 row 10): a click previews, ⏎ and a double-click open (D-929, D-930). */}
                  <RefElement as="a" reference={{ target: { path: o.path.normalize('NFC'), fragment: null, kind: 'note' }, kind: 'row', open: () => onOpen(o.path) }}
                    href="#" tabIndex={0} className="dup-row" data-command="duplicates.open">
                    <Icon name={icon.glyph} dataIcon={icon.def} size={14} />
                    <span data-user-content>{o.title}</span>
                    <span className="meta" data-user-content>{detailsText(o.details, typeName)}</span>
                    <span className="meta" data-user-content>{o.path}</span>
                    <span className="meta">{t('duplicates.backlinks', { count: o.backlinks })}</span>
                  </RefElement>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {merging && <MergeDialog group={merging} onClose={() => setMerging(null)} onDone={() => setTick((n) => n + 1)} />}
    </div>
  );
}
