// D-607 (design board `MainUnreviewed`; restyles D-591, D-330): the review state of an object as a checkbox button,
// amber while unreviewed, a filled box with a tick once reviewed. The note's type row and the Daily Note header use it.
import { t } from '../i18n/catalog';
import { Icon } from './Icon';

export function ReviewCheck({ reviewed, onToggle, commands }: { reviewed: boolean; onToggle: (next: boolean) => void; commands: [on: string, off: string] }) {
  return (
    <button type="button" tabIndex={0} role="checkbox" aria-checked={reviewed} className={`review-check ${reviewed ? 'on' : ''}`}
      data-command={reviewed ? commands[1] : commands[0]}
      title={t(reviewed ? 'review.markUnreviewedHint' : 'review.markReviewedHint')}
      onClick={() => onToggle(!reviewed)}>
      <span className="review-box" aria-hidden="true">{reviewed && <Icon name="check" size={10} />}</span>
      <span>{t(reviewed ? 'daily.reviewed' : 'daily.markReviewed')}</span>
    </button>
  );
}
