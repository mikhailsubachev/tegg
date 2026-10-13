// Side-by-side compare of two versions of a note (FR-SYN-03 AC-15, FR-SYN-04 AC-7): read-only, lines that differ are
// marked `data-diff="changed"` on both sides. The diff is a longest-common-subsequence over lines.
import { t } from '../i18n/catalog';

function lines(text: string): string[] {
  const l = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  if (l.length > 1 && l[l.length - 1] === '') l.pop();
  return l;
}

/** For each line of `a` and `b`: true when it isn't part of the common subsequence. */
export function changedLines(a: string[], b: string[]): [boolean[], boolean[]] {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ca = new Array<boolean>(n).fill(true), cb = new Array<boolean>(m).fill(true);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ca[i] = false; cb[j] = false; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return [ca, cb];
}

export function Compare({ left, right, leftLabel, rightLabel }: { left: string; right: string; leftLabel: string; rightLabel: string }) {
  const a = lines(left), b = lines(right);
  const [ca, cb] = changedLines(a, b);
  const col = (ls: string[], ch: boolean[], label: string) => (
    <div className="compare-col">
      <div className="compare-head" data-user-content>{label}</div>
      <div className="compare-lines" data-user-content>
        {ls.map((l, i) => (
          <div key={i} className={`compare-line ${ch[i] ? 'changed' : ''}`} {...(ch[i] ? { 'data-diff': 'changed' } : {})}>{l || ' '}</div>
        ))}
      </div>
    </div>
  );
  return (
    <section role="region" aria-label={t('compare.label')} className="compare">
      {col(a, ca, leftLabel)}
      {col(b, cb, rightLabel)}
    </section>
  );
}
