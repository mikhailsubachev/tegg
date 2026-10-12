// STUB (MS3 slice 3A red tests, D-61 / TS-I1): docs/contracts/ms3-shell.md §3.3. No commands, no ranking.
import type { Due } from './registry';

/** Not specified by the contract yet (see the red-test report); the real shell defines it. */
export type ShellContext = Record<string, unknown>;

export type Command = {
  id: string;
  title: string;
  section: 'navigate' | 'create' | 'view' | 'vault' | 'app';
  shortcut?: string;
  due?: Due;
  needsVault: boolean;
  run: (ctx: ShellContext) => void | Promise<void>;
};

export function commands(_ctx: ShellContext): Command[] {
  return [];
}

export function rank(_query: string, _list: Command[]): Command[] {
  return [];
}
