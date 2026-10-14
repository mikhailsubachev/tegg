// NFR-PERF-06 AC-4 benchmark helpers (docs/acceptance/editor.md; docs/contracts/ms3-shell.md §13.4, D-66, D-190):
// a synthetic 5,000-word Czech note with 10 embeds and 50 links (the shape of `tools/gen-vault --perf-note`, made here so
// the push gate needn't generate the 3 GB reference vault), 200 keystrokes one every 40 ms in a middle paragraph while
// the fake core emits `vault:changed` for 50 other paths per second. The latency probe reports each keystroke's paint
// frame through `perf_mark` `{ mark: 'key', frame, ms }`. No assertions about the AC outcome here.
import type { Page } from '@playwright/test';
import type { FakeCoreHandle } from './helpers';

const WORDS = ['žluťoučký', 'kůň', 'úpěl', 'ďábelské', 'ódy', 'příliš', 'čeština', 'řeka', 'šťovík', 'ýbr', 'les', 'dům', 'cesta', 'plán', 'zápis'];

/** Deterministic note text: frontmatter, 100 paragraphs of 50 words, 10 embeds and 50 links spread through it. */
export function perfNote(): string {
  let seed = 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const paras: string[] = [];
  for (let p = 0; p < 100; p++) {
    const w: string[] = [];
    for (let i = 0; i < 50; i++) w.push(WORDS[Math.floor(rnd() * WORDS.length)]);
    if (p % 2 === 0) w.push(`[[Cíl ${p}]]`);
    paras.push(w.join(' ') + '.');
    if (p % 10 === 5) paras.push(`![[Cíl ${p}]]`);
  }
  return `---\nid: 01JB0P0000000000000000P001\ntype: page\ntitle: Dlouhá poznámka\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\n${paras.join('\n\n')}\n`;
}

export type KeyMark = { frame: number; ms: number };

/** Types 200 keys, one every 40 ms, while 50 other paths change per second; returns the probe's records. */
export async function typingRun(page: Page, core: FakeCoreHandle): Promise<KeyMark[]> {
  const n0 = (await core.calls()).length;
  await page.evaluate(() => {
    const paths = Array.from({ length: 50 }, (_, i) => `Pages/Jiná ${i}.md`);
    (window as any).__perfTimer = setInterval(() => (window as any).__teggFake.emit('vault:changed', { paths }), 1000);
  });
  const start = Date.now();
  for (let k = 0; k < 200; k++) {
    await page.keyboard.press('a');
    const next = start + (k + 1) * 40;
    const wait = next - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => clearInterval((window as any).__perfTimer));
  return (await core.calls()).slice(n0)
    .filter((c) => c.cmd === 'perf_mark' && (c.args as any)?.mark === 'key')
    .map((c) => ({ frame: Number((c.args as any).frame), ms: Number((c.args as any).ms) }));
}

export function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : NaN;
}
