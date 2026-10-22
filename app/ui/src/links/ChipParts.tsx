// The React side of links/chip.ts (D-600): a chip's data attributes, its description, the task box in place of the
// type icon, and the suffix after the title, for the read view, embeds and relation values.
import type { ReactNode } from 'react';
import { Icon } from '../shell/Icon';
import { chipAttrs, chipState, taskGlyph, taskIconDef, unreviewedText, type ChipState, type ChipTarget } from './chip';

export type ChipParts = { state: ChipState; attrs: Record<string, string>; description: string | null; icon: ReactNode | null; suffix: ReactNode | null };

export function chipParts(info: ChipTarget | null | undefined, size = 13): ChipParts {
  const state = chipState(info);
  const glyph = taskGlyph(state);
  return {
    state,
    attrs: chipAttrs(state),
    description: state.unreviewed ? unreviewedText() : null,
    icon: glyph ? <Icon name={glyph} dataIcon={taskIconDef(state)} size={size} /> : null,
    suffix: <ChipSuffix state={state} />,
  };
}

/** Joins descriptions (a broken chip's, an embed's, `Unreviewed`). */
export function joinDescriptions(...d: (string | null | undefined)[]): string | undefined {
  const s = d.filter((x): x is string => !!x).join(', ');
  return s || undefined;
}

export function ChipSuffix({ state }: { state: ChipState }) {
  if (!state.unreviewed && !state.task) return null;
  const task = state.task;
  const dot = task ? (task.color ? `var(--type-${task.color})` : task.state === 'done' ? 'var(--accent)' : task.state === 'in-progress' ? 'var(--link)' : undefined) : undefined;
  return (
    <span className="chip-suffix">
      {task && <span className="chip-div" aria-hidden="true" />}
      {task?.date && <><span className="chip-date" data-tone={task.tone}>{task.date}</span><span className="chip-sep" aria-hidden="true">·</span></>}
      {task && <span className="chip-status"><span className="chip-status-dot" aria-hidden="true" style={dot ? { background: dot } : undefined} /><span data-user-content>{task.status}</span></span>}
      {state.unreviewed && <span className="chip-unrev" aria-hidden="true" />}
    </span>
  );
}
