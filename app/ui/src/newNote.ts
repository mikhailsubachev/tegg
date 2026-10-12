// New notes are rendered by the one text engine (D-82, architecture §5.5); the core only writes the bytes.
import { newNote } from '@tegg/doc';

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

/** ISO 8601 with the local offset (FR-FMT-11). */
export function localIso(d = new Date()): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`
  );
}

export function renderNewNote(type: string, title: string): string {
  return newNote({ type, title, now: localIso(), newId: () => ulid() });
}
