/**
 * Small, renderer-local persistence helpers for the desktop workspace shell.
 *
 * A Blipost workspace is the existing profile: the profile UUID is the stable
 * identity used by the API and is also the only key used for workspace UI
 * state. Keeping these helpers here avoids introducing a second workspace id.
 */

const WORKSPACE_ROUTES_KEY = "blipost.workspace.routes.v1";
const WORKSPACE_ORDER_KEY = "blipost.workspace.order.v1";
const ACTIVE_WORKSPACE_KEY = "editai_current_profile_id";

export interface PendingWorkspaceNavigation {
  profileId: string;
  pathname: string;
}

let pendingWorkspaceNavigation: PendingWorkspaceNavigation | null = null;

export const DEFAULT_WORKSPACE_ROUTE = "/pipeline";

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function readRouteMap(storage: Storage): Record<string, string> {
  try {
    const parsed = JSON.parse(storage.getItem(WORKSPACE_ROUTES_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string"
          && typeof entry[1] === "string"
          && entry[1].startsWith("/"),
      ),
    );
  } catch {
    return {};
  }
}

export function getLastWorkspaceRoute(profileId: string): string {
  const storage = browserStorage();
  if (!storage) return DEFAULT_WORKSPACE_ROUTE;
  return readRouteMap(storage)[profileId] || DEFAULT_WORKSPACE_ROUTE;
}

/**
 * The profile context persists a switch synchronously before Next navigation
 * settles. This lets the shell reject route updates emitted by the workspace
 * that is currently being unmounted.
 */
export function isActiveWorkspace(profileId: string): boolean {
  const storage = browserStorage();
  return storage?.getItem(ACTIVE_WORKSPACE_KEY) === profileId;
}

/**
 * Keep route-owning page effects unmounted while a profile switch and a route
 * switch settle in separate React/Next renders.
 */
export function beginWorkspaceNavigation(profileId: string, route: string): void {
  pendingWorkspaceNavigation = {
    profileId,
    pathname: route.split(/[?#]/, 1)[0] || DEFAULT_WORKSPACE_ROUTE,
  };
}

export function getPendingWorkspaceNavigation(): PendingWorkspaceNavigation | null {
  return pendingWorkspaceNavigation;
}

export function completeWorkspaceNavigation(profileId: string, pathname: string): void {
  if (
    pendingWorkspaceNavigation?.profileId === profileId
    && pendingWorkspaceNavigation.pathname === pathname
  ) {
    pendingWorkspaceNavigation = null;
  }
}

export function saveLastWorkspaceRoute(profileId: string, route: string): void {
  if (!profileId || !route.startsWith("/")) return;
  const storage = browserStorage();
  if (!storage) return;
  try {
    const routes = readRouteMap(storage);
    if (routes[profileId] === route) return;
    routes[profileId] = route;
    storage.setItem(WORKSPACE_ROUTES_KEY, JSON.stringify(routes));
  } catch {
    // Storage can be unavailable or full; workspace switching still works.
  }
}

/** Restore the saved tab order and append newly-created workspaces at the end. */
export function getWorkspaceOrder(profileIds: readonly string[]): string[] {
  const storage = browserStorage();
  if (!storage) return [...profileIds];
  try {
    const parsed = JSON.parse(storage.getItem(WORKSPACE_ORDER_KEY) || "[]");
    if (!Array.isArray(parsed)) return [...profileIds];

    const available = new Set(profileIds);
    const seen = new Set<string>();
    const ordered = parsed.filter((id): id is string => {
      if (typeof id !== "string" || !available.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    return [...ordered, ...profileIds.filter((id) => !seen.has(id))];
  } catch {
    return [...profileIds];
  }
}

export function saveWorkspaceOrder(profileIds: readonly string[]): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(WORKSPACE_ORDER_KEY, JSON.stringify(profileIds));
  } catch {
    // Reordering remains available for the current session through React state.
  }
}

/** Build a collision-free localStorage key owned by one profile/workspace. */
export function workspaceStorageKey(profileId: string, key: string): string {
  return `blipost.workspace.${profileId}.${key}`;
}

/**
 * Read workspace-owned state and migrate a pre-workspace global key once.
 * The currently active profile becomes the owner of that legacy value.
 */
export function readWorkspaceStorage(
  profileId: string,
  key: string,
  legacyKey?: string,
): string | null {
  const storage = browserStorage();
  if (!storage) return null;
  const scopedKey = workspaceStorageKey(profileId, key);
  const scopedValue = storage.getItem(scopedKey);
  if (scopedValue !== null || !legacyKey) return scopedValue;

  const legacyValue = storage.getItem(legacyKey);
  if (legacyValue === null) return null;
  try {
    storage.setItem(scopedKey, legacyValue);
    storage.removeItem(legacyKey);
  } catch {
    // Return the legacy value even when migration cannot be persisted.
  }
  return legacyValue;
}

export function writeWorkspaceStorage(profileId: string, key: string, value: string): void {
  const storage = browserStorage();
  if (!storage) return;
  storage.setItem(workspaceStorageKey(profileId, key), value);
}

export function removeWorkspaceStorage(profileId: string, key: string): void {
  const storage = browserStorage();
  if (!storage) return;
  storage.removeItem(workspaceStorageKey(profileId, key));
}
