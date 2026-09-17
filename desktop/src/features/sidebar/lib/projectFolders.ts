/**
 * Sidebar project folders: one owner-defined level of grouping inside the
 * Projects section ("Ongoing", "Pending", "Killed", …). Local to this device
 * and scoped to the relay + identity like the section's other preferences
 * (filter, sort, expansion) — a relay-synced version would need its own event
 * kind, so it stays a view preference for now. Keyed by `projectAddress`,
 * which survives project renames.
 */
const STORAGE_KEY = "buzz.sidebar.projects.folders";
export const MAX_PROJECT_FOLDERS = 50;

export type ProjectFolder = {
  id: string;
  name: string;
  icon?: string;
  order: number;
};

export type ProjectFolderStore = {
  version: 1;
  folders: ProjectFolder[];
  /** projectAddress → folder id. */
  assignments: Record<string, string>;
  /** folder id → collapsed. */
  collapsed: Record<string, boolean>;
};

export const EMPTY_PROJECT_FOLDER_STORE: ProjectFolderStore = Object.freeze({
  version: 1,
  folders: [],
  assignments: {},
  collapsed: {},
});

function storageKey(relayOrigin: string | null, currentPubkey?: string) {
  return `${STORAGE_KEY}:${encodeURIComponent(relayOrigin ?? "unknown")}:${currentPubkey ?? "anonymous"}`;
}

/** Drop anything malformed and any assignment to a folder that is gone. */
export function parseProjectFolderStore(value: unknown): ProjectFolderStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return EMPTY_PROJECT_FOLDER_STORE;
  }
  const raw = value as Record<string, unknown>;
  const folders: ProjectFolder[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(raw.folders) ? raw.folders : []) {
    if (!entry || typeof entry !== "object") continue;
    const f = entry as Record<string, unknown>;
    const id = typeof f.id === "string" ? f.id : "";
    const name = typeof f.name === "string" ? f.name.trim() : "";
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    folders.push({
      id,
      name,
      icon: typeof f.icon === "string" && f.icon ? f.icon : undefined,
      order:
        typeof f.order === "number" && Number.isFinite(f.order)
          ? f.order
          : folders.length,
    });
    if (folders.length >= MAX_PROJECT_FOLDERS) break;
  }
  folders.sort((a, b) => a.order - b.order);
  const assignments: Record<string, string> = {};
  if (raw.assignments && typeof raw.assignments === "object") {
    for (const [address, folderId] of Object.entries(
      raw.assignments as Record<string, unknown>,
    )) {
      if (typeof folderId === "string" && seen.has(folderId)) {
        assignments[address] = folderId;
      }
    }
  }
  const collapsed: Record<string, boolean> = {};
  if (raw.collapsed && typeof raw.collapsed === "object") {
    for (const [folderId, isCollapsed] of Object.entries(
      raw.collapsed as Record<string, unknown>,
    )) {
      if (isCollapsed === true && seen.has(folderId))
        collapsed[folderId] = true;
    }
  }
  return { version: 1, folders, assignments, collapsed };
}

export function readProjectFolderStore(
  relayOrigin: string | null,
  currentPubkey?: string,
): ProjectFolderStore {
  try {
    const value = globalThis.localStorage?.getItem(
      storageKey(relayOrigin, currentPubkey),
    );
    return value
      ? parseProjectFolderStore(JSON.parse(value))
      : EMPTY_PROJECT_FOLDER_STORE;
  } catch {
    return EMPTY_PROJECT_FOLDER_STORE;
  }
}

export function writeProjectFolderStore(
  store: ProjectFolderStore,
  relayOrigin: string | null,
  currentPubkey?: string,
): void {
  try {
    globalThis.localStorage?.setItem(
      storageKey(relayOrigin, currentPubkey),
      JSON.stringify(store),
    );
  } catch {
    // Persistence is best-effort; the in-memory grouping still works.
  }
}

// ── Pure operations ──────────────────────────────────────────────────────────

/** Add a folder at the end; a blank name or a full store is a no-op. */
export function addProjectFolder(
  store: ProjectFolderStore,
  id: string,
  name: string,
  icon?: string,
): ProjectFolderStore {
  const trimmed = name.trim();
  if (!trimmed || !id || store.folders.length >= MAX_PROJECT_FOLDERS)
    return store;
  if (store.folders.some((f) => f.id === id)) return store;
  const order =
    store.folders.reduce((max, f) => Math.max(max, f.order), -1) + 1;
  return {
    ...store,
    folders: [
      ...store.folders,
      { id, name: trimmed, icon: icon || undefined, order },
    ],
  };
}

export function renameProjectFolder(
  store: ProjectFolderStore,
  id: string,
  name: string,
  icon?: string,
): ProjectFolderStore {
  const trimmed = name.trim();
  if (!trimmed) return store;
  return {
    ...store,
    folders: store.folders.map((f) =>
      f.id === id ? { ...f, name: trimmed, icon: icon || undefined } : f,
    ),
  };
}

/** Remove a folder; its projects fall back to the ungrouped list. */
export function removeProjectFolder(
  store: ProjectFolderStore,
  id: string,
): ProjectFolderStore {
  const assignments = Object.fromEntries(
    Object.entries(store.assignments).filter(([, folderId]) => folderId !== id),
  );
  const { [id]: _dropped, ...collapsed } = store.collapsed;
  return {
    ...store,
    folders: store.folders.filter((f) => f.id !== id),
    assignments,
    collapsed,
  };
}

/** Put a project in a folder, or take it out with `null`. */
export function assignProjectToFolder(
  store: ProjectFolderStore,
  projectAddress: string,
  folderId: string | null,
): ProjectFolderStore {
  const { [projectAddress]: _previous, ...rest } = store.assignments;
  if (folderId === null || !store.folders.some((f) => f.id === folderId)) {
    return { ...store, assignments: rest };
  }
  return { ...store, assignments: { ...rest, [projectAddress]: folderId } };
}

/**
 * Apply a new folder order (from a drag). Ids that are missing from
 * `orderedIds` keep their relative order after the listed ones; unknown ids
 * are ignored.
 */
export function reorderProjectFolders(
  store: ProjectFolderStore,
  orderedIds: readonly string[],
): ProjectFolderStore {
  const byId = new Map(store.folders.map((f) => [f.id, f]));
  const listed = orderedIds.flatMap((id) => {
    const folder = byId.get(id);
    if (!folder) return [];
    byId.delete(id);
    return [folder];
  });
  const folders = [...listed, ...byId.values()].map((folder, order) => ({
    ...folder,
    order,
  }));
  return { ...store, folders };
}

export function setProjectFolderCollapsed(
  store: ProjectFolderStore,
  id: string,
  isCollapsed: boolean,
): ProjectFolderStore {
  const { [id]: _previous, ...rest } = store.collapsed;
  return { ...store, collapsed: isCollapsed ? { ...rest, [id]: true } : rest };
}

export type GroupedProjects<T> = {
  /** Projects in no folder, in the list's own order. */
  ungrouped: T[];
  folders: { folder: ProjectFolder; projects: T[] }[];
};

/** Split an ordered project list by folder, keeping each list's order. */
export function groupProjectsByFolder<T extends { projectAddress: string }>(
  projects: readonly T[],
  store: ProjectFolderStore,
): GroupedProjects<T> {
  const byFolder = new Map<string, T[]>(store.folders.map((f) => [f.id, []]));
  const ungrouped: T[] = [];
  for (const project of projects) {
    const bucket = byFolder.get(
      store.assignments[project.projectAddress] ?? "",
    );
    if (bucket) bucket.push(project);
    else ungrouped.push(project);
  }
  return {
    ungrouped,
    folders: store.folders.map((folder) => ({
      folder,
      projects: byFolder.get(folder.id) ?? [],
    })),
  };
}
