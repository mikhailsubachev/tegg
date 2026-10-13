// In-note placeholder of registry table R5 (D-144; ms3-shell §11.3): what it is, `Coming in <milestone>` and the
// requirement IDs, plus the row's "Also shown" parts as children. Sends no IPC command.
import type { ReactNode } from 'react';
import { t } from '../i18n/catalog';
import { IN_NOTE_PLACEHOLDERS, showDue } from '../shell/registry';

export function InNotePlaceholder({ id, children, inline, line }: { id: string; children?: ReactNode; inline?: boolean; line?: number }) {
  const def = IN_NOTE_PLACEHOLDERS.find((d) => d.id === id)!;
  const body = (
    <>
      <span className="ph-name">{t(def.name)}</span>{' '}
      {children && <span className="ph-shown">{children}</span>}{children && ' '}
      <span className="ph-due">{t('due.comingIn', { due: showDue(def.due) })}</span>{' '}
      <span className="ph-reqs">{def.reqs.join(', ')}</span>
    </>
  );
  return inline ? (
    <span role="region" className="in-note-ph inline" aria-label={t(def.name)} data-placeholder={id}>{body}</span>
  ) : (
    <section className="in-note-ph" aria-label={t(def.name)} data-placeholder={id} data-src-line={line}>{body}</section>
  );
}
