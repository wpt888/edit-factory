/**
 * Renderer-memory UI state for pages that are unmounted during navigation.
 *
 * This intentionally has no localStorage backing: selections survive switching
 * sections in the running desktop app, but do not leak across profiles or
 * persist after the application closes.
 */
const routeSessionState = new Map<string, unknown>();

function key(route: string, profileId: string) {
  return `${profileId}::${route}`;
}

export function getRouteSessionState<T>(route: string, profileId: string): T | undefined {
  return routeSessionState.get(key(route, profileId)) as T | undefined;
}

export function setRouteSessionState<T>(route: string, profileId: string, value: T | undefined) {
  const stateKey = key(route, profileId);
  if (value === undefined) {
    routeSessionState.delete(stateKey);
    return;
  }
  routeSessionState.set(stateKey, value);
}
