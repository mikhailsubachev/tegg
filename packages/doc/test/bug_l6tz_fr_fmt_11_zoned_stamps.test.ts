// Regression: the L6 daily runs pass TZ to the app, but the UI's own zone (the Mac's) stamped `created`, so
// FR-DLY-02 AC-2 in America/Los_Angeles got +02:00. Stamps and local midnights are computed in an explicit zone
// (FR-FMT-11, D-382 run of the real-app suite).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import * as doc from '../src/index.js'

const at = Date.UTC(2026, 9, 14, 10, 0, 5) // 2026-10-14 10:00:05 UTC

test('bug_l6tz_fr_fmt_11_local_iso_uses_the_given_zone', () => {
  const localIso = (doc as Record<string, unknown>).localIso as ((ms: number, tz?: string) => string) | undefined
  assert.equal(typeof localIso, 'function', '@tegg/doc exports localIso')
  assert.equal(localIso!(at, 'Europe/Prague'), '2026-10-14T12:00:05+02:00')
  assert.equal(localIso!(at, 'America/Los_Angeles'), '2026-10-14T03:00:05-07:00')
  assert.equal(localIso!(at, 'Asia/Kolkata'), '2026-10-14T15:30:05+05:30')
  assert.equal(localIso!(Date.UTC(2026, 0, 1, 0, 0, 0), 'UTC'), '2026-01-01T00:00:00+00:00')
})

test('bug_l6tz_fr_fmt_11_local_midnight_uses_the_given_zone_across_dst', () => {
  const localMidnight = (doc as Record<string, unknown>).localMidnight as ((date: string, tz?: string) => string) | undefined
  assert.equal(typeof localMidnight, 'function', '@tegg/doc exports localMidnight')
  assert.equal(localMidnight!('2026-10-14', 'America/Los_Angeles'), '2026-10-14T00:00:00-07:00')
  assert.equal(localMidnight!('2026-10-25', 'Europe/Prague'), '2026-10-25T00:00:00+02:00') // DST ends at 03:00 that day
  assert.equal(localMidnight!('2026-10-26', 'Europe/Prague'), '2026-10-26T00:00:00+01:00')
  assert.equal(localMidnight!('2026-03-08', 'America/Los_Angeles'), '2026-03-08T00:00:00-08:00')
})
