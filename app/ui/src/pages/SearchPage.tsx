// The Search route (D-125): the MS2 full-text search (FR-SRC-01…04) as a page of the frame.
import { useLayoutEffect } from 'react';
import { t } from '../i18n/catalog';
import { Search } from '../Search';
import type { DateTimeUiDto, SwitcherItemDto, TypeDto } from '../ipc/types';
import type { SearchState } from '../shell/history';
import type { Prepared } from '../types/create';

export function SearchPage({ refresh, heading, inputRef, onOpen, onGoTo, onCreate, onLeave, tag, types, dateTime, initial, onState }: {
  refresh: number;
  heading: React.RefObject<HTMLHeadingElement | null>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onOpen: (path: string) => void;
  onGoTo: (path: string) => void;
  onCreate: (item: SwitcherItemDto, prepared?: Prepared | null) => void;
  onLeave: () => boolean;
  tag?: string;
  types: TypeDto[];
  dateTime?: DateTimeUiDto;
  /** The entry's saved state on Back/Forward (D-1217). */
  initial?: SearchState;
  onState: (s: SearchState) => void;
}) {
  // Search starts in its field (owner feedback F3, docs/feedback/ms3-3d.md), unless a dialog has the focus. At once
  // when the page mounts, not a frame later: text typed right after ⇧⌘F goes into the field (D-760's Go to).
  useLayoutEffect(() => {
    // Back to an entry whose row was focused: the page focuses that row once it is shown (D-1217).
    if (!document.querySelector('[role="dialog"]') && !initial?.focusPath) inputRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="page-column">
      <h1 ref={heading} tabIndex={-1}>{t('route.search')}</h1>
      <Search onOpen={onOpen} onGoTo={onGoTo} onCreate={onCreate} onLeave={onLeave} refresh={refresh} inputRef={inputRef} tag={tag}
        types={types} dateTime={dateTime} initial={initial} onState={onState} />
    </div>
  );
}
