// The "just created" marker (D-247, D-367): a note opened by a create path places its caret as a new note once.
// A Daily Note is marked by its date, taken from the route that is opened (not a second reading of the clock), and
// the marker is dropped when a navigation lands anywhere else.
import type { Route } from './routes';

const DAILY = 'daily/YYYY-MM-DD';

export function createdMarker(route: Route): string | null {
  if (!route.param) return null;
  return route.id === DAILY ? `daily:${route.param}` : route.param.normalize('NFC');
}

export function isCreated(marker: string | null, route: Route): boolean {
  return marker !== null && marker === createdMarker(route);
}

/** The marker after a navigation landed on `route`: kept only when it names that route. */
export function settleCreated(marker: string | null, route: Route): string | null {
  return isCreated(marker, route) ? marker : null;
}
