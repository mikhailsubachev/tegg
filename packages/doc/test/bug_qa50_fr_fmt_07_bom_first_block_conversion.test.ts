// Found by the FR-FMT-07 AC-20 property test (push gate seed 42664997, case 289160514): in a note starting with a BOM,
// the first block's conversion unit started at 0, before the BOM, so a conversion could drop it (FR-FMT-07, D-490).
import { expect, it } from 'vitest'
import { conversionUnit, replaceUnitWithEmbed } from '../src/index.js'

it('bug_qa50_fr_fmt_07 the BOM stays outside the first block’s unit', () => {
  const text = '﻿![[Cíl]]\n\n> [!note]\n> Schůzka příští koupit.\n> schůzka Janě\n\n![[Cíl]]\n'
  const unit = conversionUnit(text, 7, 70)
  expect(unit && [unit.kind, unit.from, unit.to]).toEqual(['blocks', 1, 70])
  const r = replaceUnitWithEmbed(text, unit!, 'Nový objekt')
  expect(r.text.startsWith('﻿')).toBe(true)
})
