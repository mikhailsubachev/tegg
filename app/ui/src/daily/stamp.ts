// ms4-daily §3: a virtual Daily Note shows its draft stamped when it opens; the first write carries the write time.
// Only `created:` / `modified:` frontmatter lines still holding the open-time stamp change.

export function restampDraft(text: string, openStamp: string, now: string): string {
  if (!text.startsWith('---\n')) return text;
  const end = text.indexOf('\n---', 4);
  if (end < 0) return text;
  const fm = text
    .slice(0, end)
    .split('\n')
    .map((line) => (line === `created: ${openStamp}` || line === `modified: ${openStamp}` ? line.replace(openStamp, now) : line))
    .join('\n');
  return fm + text.slice(end);
}
