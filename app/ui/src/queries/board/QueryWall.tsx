// Slice Q3: a wall bound to a `QueryResultDto` (docs/contracts/v1-views.md §40.1 `QueryWall.tsx`, §41.3, §41.4; R224;
// boards W1, D1, D2). With a grouping (`group` Some) it is part one's board (`QueryBoard`: lanes `columns` = vertical,
// `rows` = horizontal, period and done lanes, card drags, lane drags, the `+` tile); without one it is the ungrouped
// wall (`WallGrid`). The `def` handed in carries the usage's effective `lanes` and `lane_order`; `apply` routes a lanes
// or lane-order change to the usage (§33.2). There is no toolbar lanes switch (D-2173).
import type { MutableRefObject } from 'react';
import type { QueryDefDto, QueryEnvDto, QueryResultDto } from '../../ipc/queries';
import type { TypeDto } from '../../ipc/types';
import { QueryBoard, type BoardControl, type BoardFilter } from './QueryBoard';
import { WallGrid } from './WallGrid';

export type { BoardControl, BoardFilter };

export function QueryWall({ result, rows, name, title, readOnly, types, filter, apply, rerun, controlRef, foldKey = null, env }: {
  result: QueryResultDto & { def: QueryDefDto };
  /** The ungrouped wall's results (narrowed by the toolbar's filters); a grouped wall narrows its lanes itself. */
  rows?: QueryResultDto['rows'];
  name: string | null;
  title: string;
  readOnly: string | null;
  types: TypeDto[];
  filter?: BoardFilter;
  apply: (patch: Partial<QueryDefDto>) => void;
  rerun: () => void;
  controlRef?: MutableRefObject<BoardControl | null>;
  foldKey?: string | null;
  env?: QueryEnvDto | null;
}) {
  if (result.group) {
    return <QueryBoard result={{ ...result, group: result.group }} name={name} title={title} readOnly={readOnly} types={types} filter={filter}
      apply={apply} rerun={rerun} controlRef={controlRef} foldKey={foldKey} env={env} />;
  }
  if (controlRef) controlRef.current = null;
  return <WallGrid rows={rows ?? result.rows} title={title} name={name} types={types} readOnly={readOnly} rerun={rerun} taskDefs={result.taskDefs} env={env} />;
}
