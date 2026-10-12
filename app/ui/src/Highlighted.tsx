/** Text with `[start, end)` UTF-16 ranges marked (FR-SRC-03 AC-2: offsets, never HTML from the core). */
export function Highlighted({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  [...ranges].sort((a, b) => a[0] - b[0]).forEach(([a, b], i) => {
    if (a < at) return;
    if (a > at) parts.push(text.slice(at, a));
    parts.push(<mark key={i}>{text.slice(a, b)}</mark>);
    at = b;
  });
  parts.push(text.slice(at));
  return <>{parts}</>;
}
