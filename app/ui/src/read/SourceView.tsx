// Source view: the file's text, read-only, with line numbers (FR-EDT-10, D-146, D-158; ms3-shell §11.3). Links,
// tags and URLs are plain text here. A final newline gives no empty last line; the gutter is aria-hidden and
// excluded from selection.
import { t } from '../i18n/catalog';
import type { FrontmatterWarning } from './warning';

export function sourceLines(text: string): string[] {
  const lines = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function WarningBanner({ warning }: { warning: FrontmatterWarning }) {
  return (
    <div role="alert" className="fm-warning">
      {t(warning.kind === 'notClosed' ? 'warn.notClosed' : 'warn.invalidYaml', { line: warning.line })}
    </div>
  );
}

export function SourceView({ text, warning }: { text: string; warning?: FrontmatterWarning | null }) {
  const lines = sourceLines(text);
  return (
    <div className="source-view-wrap">
      {warning && <WarningBanner warning={warning} />}
      <section className="source-view" aria-label={t('note.source')} data-user-content>
        {lines.map((l, i) => (
          <div key={i} className="source-line" data-line={i + 1}>
            <span className="source-gutter" aria-hidden="true">{i + 1}</span>
            <span className="source-text">{l}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
