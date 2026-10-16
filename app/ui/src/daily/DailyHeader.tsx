// The header of a Daily Note (daily-notes.md R17, R19; D-321, D-329, D-330, D-337): previous/next day, Today, Pick date,
// the localized long date, the review toggle on a written note, the virtual marker and the D-319 duplicate notice.
import { useRef } from 'react';
import { localDate } from '../zone';
import { t } from '../i18n/catalog';
import { Icon } from '../shell/Icon';
import { longDate } from './Calendar';

export type DailyInfo = {
  date: string;
  /** Set while the note is virtual: the bytes the editor opens on (ms4-daily §4.1). */
  virtual: { text: string; stamp: string } | null;
  /** The other notes of this date (D-319). */
  duplicates: string[];
  /** Non-modal messages: an invalid daily-format (D-336) or template (D-325). */
  messages: string[];
  onCreate: (text: string) => Promise<{ path: string; version: import('../ipc/types').VersionDto }>;
  onDay: (n: number) => void;
  onToday: () => void;
  onPickDate: (anchor: HTMLElement | null) => void;
  onOpenPath: (path: string) => void;
  onDuplicateTitles: () => void;
};

export function DailyHeader({ info, review, written, onReview }: { info: DailyInfo; review: boolean; written: boolean; onReview: (r: boolean) => void }) {
  const pick = useRef<HTMLButtonElement | null>(null);
  const isToday = info.date === localDate(Date.now());
  const n = info.duplicates.length;
  return (
    <div className="daily-header">
      <div className="daily-nav" role="group" aria-label={t('daily.header')}>
        <button type="button" tabIndex={0} className="icon-button small" aria-label={t('daily.previous')} title={t('daily.previous')} data-command="daily.previous" onClick={() => info.onDay(-1)}><Icon name="chevron-left" size={14} /></button>
        <button type="button" tabIndex={0} className="icon-button small" aria-label={t('daily.next')} title={t('daily.next')} data-command="daily.next" onClick={() => info.onDay(1)}><Icon name="chevron-right" size={14} /></button>
        <button type="button" tabIndex={0} className="text-button" aria-disabled={isToday ? true : undefined} data-command="daily.today" onClick={() => { if (!isToday) info.onToday(); }}>{t('daily.today')}</button>
        <button ref={pick} type="button" tabIndex={0} className="text-button" aria-haspopup="dialog" data-command="daily.pickDate" onClick={() => info.onPickDate(pick.current)}>
          <Icon name="calendar" size={14} /><span>{t('daily.pickDate')}</span>
        </button>
        <span className="spacer" />
        {written && (
          <button type="button" tabIndex={0} className={`text-button review ${review ? 'on' : ''}`} aria-pressed={review} data-command={review ? 'daily.markUnreviewed' : 'daily.markReviewed'}
            onClick={() => onReview(!review)}>
            {review && <Icon name="check" size={14} />}<span>{t(review ? 'daily.reviewed' : 'daily.markReviewed')}</span>
          </button>
        )}
      </div>
      {/* Region-formatted (D-133, D-337), not catalog text: marked like user content for the pseudo-locale check. */}
      <p className="daily-subtitle" data-user-content>{longDate(info.date)}</p>
      {info.virtual && <p role="status" className="daily-virtual">{t('daily.notSaved')}</p>}
      {info.messages.map((m) => <p key={m} role="status" className="daily-message">{m}</p>)}
      {n > 0 && (
        <div role="region" aria-label={t('daily.otherNotesRegion')} className="daily-duplicates">
          <span>{t('daily.otherNotes', { count: n })}</span>{' '}
          {info.duplicates.map((p, i) => (
            <span key={p}>{i > 0 && ', '}<a href="#" tabIndex={0} data-user-content onClick={(e) => { e.preventDefault(); info.onOpenPath(p); }}>{p}</a></span>
          ))}
          {' · '}
          <a href="#" tabIndex={0} onClick={(e) => { e.preventDefault(); info.onDuplicateTitles(); }}>{t('daily.duplicateTitles')}</a>
        </div>
      )}
    </div>
  );
}
