import * as React from "react";

import type { Channel } from "@/shared/api/types";

/**
 * "Rename channel…" hand-off from the channel context menu (rendered deep in
 * the sidebar tree, and unmounted the moment the menu closes) to the single
 * dialog host mounted by `AppSidebar`. Transient UI state only — cleared on
 * community switch via `resetRenameChannelRequest`.
 */
let pending: Channel | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function requestChannelRename(channel: Channel): void {
  pending = channel;
  emit();
}

export function clearChannelRenameRequest(): void {
  if (pending === null) return;
  pending = null;
  emit();
}

/** Community switch: never reopen a rename for the previous community. */
export function resetRenameChannelRequest(): void {
  clearChannelRenameRequest();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useChannelRenameRequest(): Channel | null {
  return React.useSyncExternalStore(
    subscribe,
    () => pending,
    () => null,
  );
}
