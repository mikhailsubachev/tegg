// The Search route (D-125): the MS2 full-text search (FR-SRC-01…04) as a page of the frame.
import { t } from '../i18n/catalog';
import { Search } from '../Search';

export function SearchPage({ refresh, heading, inputRef, onOpen }: {
  refresh: number;
  heading: React.RefObject<HTMLHeadingElement | null>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onOpen: (path: string) => void;
}) {
  return (
    <div className="page-column">
      <h1 ref={heading} tabIndex={-1}>{t('route.search')}</h1>
      <Search onOpen={onOpen} refresh={refresh} inputRef={inputRef} />
    </div>
  );
}
