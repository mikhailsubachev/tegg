#!/usr/bin/env node
// Writes the AND-2 overlay `tests/fixtures/vaults/phone/` byte-exact (docs/acceptance/android-phone.md "Fixtures"):
// LF, NFC, UTF-8 without BOM, one final newline; ids `01JBAN2…N0nn`. Synthetic content only (D-50, D-62). The PNG
// `_attachments/široký.png` (2,000 × 400) uses the routine of `trash-media/make-media.mjs` (RGB, filter 0, zlib).
// Run from anywhere: `node tests/fixtures/vaults/phone/make-phone.mjs`; the output is committed.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const HERE = import.meta.dirname;
const id = (nn) => `01JBAN2${'0'.repeat(15)}N0${String(nn).padStart(2, '0')}`;
function out(rel, data) {
  const p = join(HERE, rel.normalize('NFC'));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof data === 'string' ? data.normalize('NFC') : data);
}
const fm = (lines) => `---\n${lines.join('\n')}\n---\n`;

// ------------------------------------------------------------------------------------------------ Mapa výletu
out('Pages/Mapa výletu.md', fm([`id: ${id(1)}`, 'type: page', 'title: Mapa výletu', 'created: 2026-11-10T09:00:00+01:00', 'modified: 2026-11-10T09:00:00+01:00']) + [
  'Plán letošního výletu.',
  '',
  '> [!mindmap] Výlet',
  '> - Výjezd 2026',
  '>   - Program',
  '>     - Přehled Q4',
  '>     - Plán 2027',
  '>   - Místo',
  '>     - Lisabon [[Mapa bez severu]]',
  '>   - Doprava',
  '',
  '- [x] Pasy',
  '',
  '> [!mindmap|spider] Pavouk',
  '> - Střed',
  '>   - Alfa',
  '>     - A1',
  '>     - A2',
  '>   - Beta',
  '>     - B1',
  '>   - Gama',
  '>   - Delta',
  '',
].join('\n'));

// ------------------------------------------------------------------------------------------------ Široký obsah
const rows = [
  ['Chata pod Sněžkou', '4 800 Kč', '12 lůžek', '182 km', 'Krásný výhled na hřebeny', 'Jiří Dvořák, správce'],
  ['Penzion U Žíznivého koně', '3 250 Kč', '8 lůžek', '96 km', 'Snídaně v ceně, parkování', 'paní Řeháková'],
  ['Horská bouda Šumava', '5 100 Kč', '20 lůžek', '214 km', 'Sauna a lyžárna v suterénu', 'Tomáš Šťastný'],
  ['Kemp u Ještědu', '1 900 Kč', '6 chatek', '110 km', 'Jen v létě, vlastní spacáky', 'recepce kempu'],
];
const code = `const trasa = "${'Praha → Hradec Králové → Trutnov → Pec pod Sněžkou → '.repeat(6)}`.slice(0, 238) + '";';
const longWord = 'nejneobhospodařovávatelnějšímu'.repeat(3);
const url = ('https://example.org/' + 'vylety/hory/chaty/'.repeat(9)).slice(0, 155) + '.html';
const tipLine = ('Na výlet si vezměte pevné boty, pláštěnku, čelovku, lékárničku, mapu a dost vody, protože na hřebenech '
  + 'nejsou žádné studánky a počasí se tam mění velmi rychle, zvláště odpoledne, kdy se často stahují bouřky a vítr fouká '
  + 'od západu; nezapomeňte ani na svačinu, nabitý telefon a lístek na zpáteční autobus z údolí.').slice(0, 300);
out('Pages/Široký obsah.md', fm([`id: ${id(2)}`, 'type: page', 'title: Široký obsah', 'created: 2026-11-11T09:00:00+01:00', 'modified: 2026-11-11T09:00:00+01:00']) + [
  '| Místo | Cena | Kapacita | Vzdálenost | Poznámka | Kontakt |',
  '| --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.join(' | ')} |`),
  '',
  '```js',
  code,
  '```',
  '',
  longWord,
  '',
  `Odkaz na trasu: ${url}`,
  '',
  '![[široký.png]]',
  '',
  '> [!tip] Rada na cestu',
  `> ${tipLine}`,
  '',
].join('\n'));
if (code.length !== 240 || url.length !== 160 || [...tipLine].length !== 300) throw new Error(`lengths: code ${code.length}, url ${url.length}, tip ${[...tipLine].length}`);

// ------------------------------------------------------------------------------------------------ Odkazy ven
out('Pages/Odkazy ven.md', fm([`id: ${id(3)}`, 'type: page', 'title: Odkazy ven', 'created: 2026-11-12T09:00:00+01:00', 'modified: 2026-11-12T09:00:00+01:00']) + [
  '- Web: [web](https://example.org/čeština)',
  '- Pošta: <mailto:eva@example.org>',
  '- Skript: [skript](javascript:alert(1))',
  '- Soubor: [soubor](file:///etc/hosts)',
  '- Štítek: #cestování',
  '',
  // the wikilinks in their own list, so the editor shows them as chips (D-2554)
  'Poznámky:',
  '',
  '- Chybí: [[Neexistuje]]',
  '- Později: [[Později]]',
  '- Den: [[2026-10-20]]',
  '',
].join('\n'));

// ------------------------------------------------------------------------------------------------ Dlouhá poznámka
const para = (n) => `Odstavec ${n}: cesta vedla přes louky a lesy, kolem rybníka a staré hájovny, až k rozcestí pod kopcem.`;
out('Pages/Dlouhá poznámka.md', fm([`id: ${id(4)}`, 'type: page', 'title: Dlouhá poznámka', 'created: 2026-11-13T09:00:00+01:00', 'modified: 2026-11-13T09:00:00+01:00']) + [
  '## Úvod',
  '',
  ...Array.from({ length: 40 }, (_, i) => [para(i + 1), '']).flat(),
  '## Druhá kapitola',
  '',
  ...Array.from({ length: 30 }, (_, i) => [`Další odstavec ${i + 1}: večer jsme došli do chaty a uvařili čaj.`, '']).flat(),
].join('\n').replace(/\n+$/, '\n'));

// ------------------------------------------------------------------------------------------------ Quick Notes, Daily, Tag, Image
out('Quick Notes/Nápad z vlaku.md', fm([`id: ${id(5)}`, 'type: quick-note', 'title: Nápad z vlaku', 'review: unreviewed', 'captured: 2026-11-19T07:40:00+01:00', 'created: 2026-11-19T07:40:00+01:00', 'modified: 2026-11-19T07:40:00+01:00']) + 'Napsat průvodce po Krkonoších.\n');
out('Quick Notes/Koupit čaj.md', fm([`id: ${id(6)}`, 'type: quick-note', 'title: Koupit čaj', 'review: unreviewed', 'captured: 2026-11-18T18:05:00+01:00', 'created: 2026-11-18T18:05:00+01:00', 'modified: 2026-11-18T18:05:00+01:00']) + 'Zelený a ovocný, do termosky.\n');
out('Daily/2026-10-21.md', fm([`id: ${id(7)}`, 'type: daily-note', 'title: "2026-10-21"', 'date: 2026-10-21', 'review: reviewed', 'created: 2026-10-21T08:00:00+02:00', 'modified: 2026-10-21T08:10:00+02:00']) + 'Prohlédnout [[Mapa výletu]].\n');
out('Tags/čtení.md', fm([`id: ${id(8)}`, 'type: tag', 'title: čtení', 'color: blue', 'created: 2026-11-01T09:00:00+01:00', 'modified: 2026-11-01T09:00:00+01:00']));

// PNG (trash-media/make-media.mjs's routine): 2,000 × 400, left half teal, right half orange.
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(px(x, y), y * (1 + w * 3) + 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const wide = png(2000, 400, (x) => (x < 1000 ? [0x20, 0x90, 0x90] : [0xe0, 0x80, 0x30]));
out('_attachments/široký.png', wide);
out('Images/Široký.md', fm([`id: ${id(9)}`, 'type: image', 'title: Široký', 'created: 2026-11-11T09:05:00+01:00', 'modified: 2026-11-11T09:05:00+01:00',
  'file: "[[široký.png]]"', 'media-type: image/png', `size: ${wide.length}`, 'width: 2000', 'height: 400']));

// ------------------------------------------------------------------------------------------------ pins
out('.tegg/pinned.yml', [
  '# Tegg sidebar pins (FR-HOM-02). Pin, unpin and reorder them in the sidebar.',
  'version: 1',
  'pins:',
  `  - id: ${id(1)}`,
  '    path: Pages/Mapa výletu.md',
  '  - query: Rozečtené',
  '',
].join('\n'));
