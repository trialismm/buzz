import * as React from "react";
import {
  type PermissionMode,
  buildPermissionModeTag,
  parsePermissionMode,
} from "@/features/agents/lib/permissionMode";

// Per-channel composer choice: the permission mode every message sent from
// that channel carries (as a `buzz:permission-mode` tag) for the agents it
// wakes. Sticky like the Claude app's mode selector, per channel, per device.
// `null` = no choice yet — messages carry no tag and the agents keep their
// configured mode.
const STORAGE_PREFIX = "buzz:composer-permission-mode:";
const listeners = new Set<() => void>();
const cache = new Map<string, PermissionMode | null>();

function readStored(channelId: string): PermissionMode | null {
  if (typeof window === "undefined") return null;
  try {
    return parsePermissionMode(
      window.localStorage.getItem(`${STORAGE_PREFIX}${channelId}`),
    );
  } catch {
    return null;
  }
}

export function getComposerPermissionMode(
  channelId: string,
): PermissionMode | null {
  if (!cache.has(channelId)) cache.set(channelId, readStored(channelId));
  return cache.get(channelId) ?? null;
}

export function setComposerPermissionMode(
  channelId: string,
  mode: PermissionMode | null,
): void {
  cache.set(channelId, mode);
  try {
    if (mode) {
      window.localStorage.setItem(`${STORAGE_PREFIX}${channelId}`, mode);
    } else {
      window.localStorage.removeItem(`${STORAGE_PREFIX}${channelId}`);
    }
  } catch {
    // Storage unavailable: the in-memory choice still applies this session.
  }
  for (const listener of listeners) listener();
}

/** Community-switch reset (see `resetCommunityState`): drop the in-memory
 *  mirror so the next community re-reads its own channels from storage. */
export function resetComposerPermissionModeCache(): void {
  cache.clear();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useComposerPermissionMode(
  channelId: string | null,
): PermissionMode | null {
  return React.useSyncExternalStore(
    subscribe,
    () => (channelId ? getComposerPermissionMode(channelId) : null),
    () => null,
  );
}

/**
 * Outgoing tags with the channel's permission-mode tag appended when a choice
 * exists. Replaces any mode tag already present so exactly one rides along.
 */
export function withComposerPermissionModeTag(
  tags: string[][] | undefined,
  mode: PermissionMode | null,
): string[][] | undefined {
  if (!mode) return tags;
  return [...(tags ?? []), buildPermissionModeTag(mode)];
}
