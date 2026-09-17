import * as React from "react";

/**
 * Device-level row density of the app sidebar. Applied as
 * `data-sidebar-density` on the root element; the sizes live as CSS variables
 * in `shared/styles/globals/typography.css` and are consumed by
 * `shared/ui/sidebar.tsx`. Compact is the default: 26px rows with hairline
 * gaps, so more channels and projects fit on screen.
 */
export type SidebarDensity = "compact" | "comfortable";

export const SIDEBAR_DENSITY_STORAGE_KEY = "buzz.appearance.sidebarDensity";
export const DEFAULT_SIDEBAR_DENSITY: SidebarDensity = "compact";

const listeners = new Set<() => void>();
let sidebarDensity: SidebarDensity = DEFAULT_SIDEBAR_DENSITY;
let listeningForStorageChanges = false;

export function parseSidebarDensity(
  value: string | null | undefined,
): SidebarDensity {
  return value === "compact" || value === "comfortable"
    ? value
    : DEFAULT_SIDEBAR_DENSITY;
}

function readStoredSidebarDensity(): SidebarDensity {
  try {
    return parseSidebarDensity(
      globalThis.localStorage?.getItem(SIDEBAR_DENSITY_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_SIDEBAR_DENSITY;
  }
}

function applySidebarDensity(density: SidebarDensity): void {
  globalThis.document?.documentElement?.setAttribute(
    "data-sidebar-density",
    density,
  );
}

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

function applyStoredSidebarDensity(): void {
  const next = readStoredSidebarDensity();
  const changed = next !== sidebarDensity;
  sidebarDensity = next;
  applySidebarDensity(next);
  if (changed) notifyListeners();
}

/** Apply the persisted preference before React renders to avoid a layout jump. */
export function initializeSidebarDensityPreference(): void {
  applyStoredSidebarDensity();
  if (listeningForStorageChanges || !globalThis.window?.addEventListener) {
    return;
  }
  globalThis.window.addEventListener("storage", (event) => {
    if (event.key === SIDEBAR_DENSITY_STORAGE_KEY || event.key === null) {
      applyStoredSidebarDensity();
    }
  });
  listeningForStorageChanges = true;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSidebarDensity(): SidebarDensity {
  return sidebarDensity;
}

export function setSidebarDensity(density: SidebarDensity): void {
  sidebarDensity = density;
  applySidebarDensity(density);
  try {
    globalThis.localStorage?.setItem(SIDEBAR_DENSITY_STORAGE_KEY, density);
  } catch {
    // Persistence is best-effort; the live preference still applies.
  }
  notifyListeners();
}

/** Temporarily apply a density without changing the saved preference. */
export function previewSidebarDensity(density: SidebarDensity | null): void {
  applySidebarDensity(density ?? sidebarDensity);
}

export function useSidebarDensity(): SidebarDensity {
  return React.useSyncExternalStore(
    subscribe,
    getSidebarDensity,
    () => DEFAULT_SIDEBAR_DENSITY,
  );
}
