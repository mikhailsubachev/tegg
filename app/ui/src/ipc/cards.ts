// Slice OC IPC (docs/contracts/v1-cards.md §4.1): the type settings' example card, read once when the Card section
// mounts (D-2096). Through the one client (architecture §10).
import { ipc } from './client';
import type { CardExampleDto } from './types';

export function typeCardExample(key: string): Promise<CardExampleDto | null> {
  return ipc.typeCardExample(key);
}
