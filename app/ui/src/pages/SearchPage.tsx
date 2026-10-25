// The Search route (D-125): the MS2 full-text search (FR-SRC-01…04) as a page of the frame.
import { useEffect } from 'react';
import { t } from '../i18n/catalog';
import { Search } from '../Search';
import type { SwitcherItemDto } from '../ipc/types';
import type { Prepared } from '../types/create';

export function SearchPage({ refresh, heading, inputRef, onOpen, onGoTo, onCreate, onLeave, tag }: {
  refresh: number;
  heading: React.RefObject<HTMLHeadingElement | null>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onOpen: (path: string) => void;
  onGoTo: (path: string) => void;
  onCreate: (item: SwitcherItemDto, prepared?: Prepared | null) => void;
  onLeave: () => boolean;
  tag?: string;
}) {
  // Search starts in its field (owner feedback F3, docs/feedback/ms3-3d.md), unless a dialog has the focus.
  useEffect(() => {
    const id = requestAnimationFrame(() => { if (!document.querySelector('[role="dialog"]')) inputRef.current?.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className="page-column">
      <h1 ref={heading} tabIndex={-1}>{t('route.search')}</h1>
      <Search onOpen={onOpen} onGoTo={onGoTo} onCreate={onCreate} onLeave={onLeave} refresh={refresh} inputRef={inputRef} tag={tag} />
    </div>
  );
}
