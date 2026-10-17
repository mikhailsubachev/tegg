// New notes are rendered by the one text engine (D-82, architecture §5.5); the core only writes the bytes.
import { newNote } from '@tegg/doc';
import { localIso as zonedIso } from './zone';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID (26 characters, time-ordered), the `id` format of Tegg notes (FR-FMT-02). */
export function ulid(now = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rnd = crypto.getRandomValues(new Uint8Array(16));
  let rest = '';
  for (let i = 0; i < 16; i++) rest += CROCKFORD[rnd[i] % 32];
  return time + rest;
}

/** ISO 8601 with the offset of the app's zone (FR-FMT-11, zone.ts). */
export function localIso(d = new Date()): string {
  return zonedIso(d.getTime());
}

export function renderNewNote(type: string, title: string): string {
  return newNote({ type, title, now: localIso(), newId: () => ulid() });
}
