// Generated note for the performance probe (NFR-PERF-05/-06): ~5,000 words of Czech/English
// text with headings, lists, links, tags, embeds, a table and code — deterministic.

const WORDS = 'note link idea system čtení poznámka řeka žluť project meeting budget travel learning kniha strom data logic people'.split(' ')

export function largeNote(words = 5000): string {
  let seed = 42
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  const word = () => WORDS[Math.floor(rnd() * WORDS.length)]
  const sentence = (n: number) => {
    const w = Array.from({ length: n }, word)
    if (rnd() < 0.3) w[Math.floor(rnd() * n)] = `[[Note ${Math.floor(rnd() * 500)}]]`
    if (rnd() < 0.15) w[Math.floor(rnd() * n)] = `#tag${Math.floor(rnd() * 50)}`
    if (rnd() < 0.15) w[Math.floor(rnd() * n)] = `**${word()}**`
    return w.join(' ') + '.'
  }
  const out: string[] = ['---', 'id: 01J9ZK4M7Q2R8F3V6X1T0B5PERF', 'type: page', 'title: Performance note', '---', '']
  let count = 0
  let section = 0
  while (count < words) {
    out.push(`## Section ${++section}`, '')
    for (let p = 0; p < 4; p++) {
      const n = 20 + Math.floor(rnd() * 40)
      out.push(sentence(n), '')
      count += n
    }
    out.push(...Array.from({ length: 4 }, () => `- ${sentence(8)}`), '')
    count += 32
    if (section % 5 === 0) out.push(`![[Note ${section}]]`, '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', '```js', 'const x = 1', '```', '')
  }
  return out.join('\n')
}
