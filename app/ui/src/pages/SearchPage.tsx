// The Search route (D-125): the MS2 full-text search (FR-SRC-01…04) as a page of the frame.
import { useLayoutEffect } from 'react';
import { t } from '../i18n/catalog';
import { Search } from '../Search';
import type { DateTimeUiDto, SwitcherItemDto, TypeDto } from '../ipc/types';
import type { SearchState } from '../shell/history';
import type { Prepared } from '../types/create';
import { PageHeading, useHeadingSlot } from '../phone/PageHeading';
import { isPhone } from '../phone/layout';

export function SearchPage({ refresh, heading, inputRef, onOpen, onCreate, onLeave, tag, types, dateTime, initial, onState }: {
  refresh: number;
  heading: React.RefObject<HTMLHeadingElement | null>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onOpen: (path: string) => void;
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
  // when the page mounts, not a frame later: text typed right after ⇧⌘F goes into the field (D-1340: ⏎ opens the first result).
  useLayoutEffect(() => {
    // Back to an entry whose row was focused: the page focuses that row once it is shown (D-1217).
    if (!document.querySelector('[role="dialog"]') && !initial?.focusPath) inputRef.current?.focus({ preventScroll: true });
  }, []);
  // Slice AND-2 (android-phone §8.2, §9.8; FR-SRC-03 AC-22): on the phone the field is in the app bar, the page's `h1`
  // stays in `main` visually hidden; since AND-3 it has the desktop's create buttons (android-edit §10.7, FR-NAV-01 AC-25).
  const phone = isPhone();
  const slot = useHeadingSlot();
  return (
    <div className="page-column">
      {phone ? <h1 ref={heading} tabIndex={-1} className="sr-only">{t('route.search')}</h1> : <PageHeading ref={heading} tabIndex={-1}>{t('route.search')}</PageHeading>}
      <Search onOpen={onOpen} onCreate={onCreate} onLeave={onLeave} refresh={refresh} inputRef={inputRef} tag={tag}
        types={types} dateTime={dateTime} initial={initial} onState={onState} phone={phone} fieldSlot={phone ? slot : null} />
    </div>
  );
}
