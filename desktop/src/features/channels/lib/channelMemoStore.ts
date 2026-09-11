import * as React from "react";

/**
 * Per-channel memo: a local, private Markdown note pad for "what to ask
 * this channel next". Local-first by design — stored in this device's
 * localStorage, keyed by relay origin + channel so communities never bleed
 * into each other. Event-shaped (`content` + `updatedAt`) so a later relay
 * escalation is a serialization change, not a model change.
 */
export type ChannelMemo = {
  content: string;
  /** Unix seconds of the last edit; 0 when never written. */
  updatedAt: number;
};

const STORAGE_PREFIX = "buzz:channel-memo:";
const EMPTY: ChannelMemo = { content: "", updatedAt: 0 };
const listeners = new Set<() => void>();
const cache = new Map<string, ChannelMemo>();

export function channelMemoKey(
  relayOrigin: string | null,
  channelId: string,
): string {
  return `${relayOrigin ?? "unknown"}::${channelId}`;
}

function readStored(key: string): ChannelMemo {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<ChannelMemo>;
    return {
      content: typeof parsed.content === "string" ? parsed.content : "",
      updatedAt:
        typeof parsed.updatedAt === "number" &&
        Number.isFinite(parsed.updatedAt)
          ? parsed.updatedAt
          : 0,
    };
  } catch {
    return EMPTY;
  }
}

export function getChannelMemo(key: string): ChannelMemo {
  let memo = cache.get(key);
  if (!memo) {
    memo = readStored(key);
    cache.set(key, memo);
  }
  return memo;
}

export function setChannelMemo(key: string, content: string): ChannelMemo {
  const next: ChannelMemo = {
    content,
    updatedAt: Math.floor(Date.now() / 1000),
  };
  cache.set(key, next);
  try {
    if (content.trim()) {
      window.localStorage.setItem(
        `${STORAGE_PREFIX}${key}`,
        JSON.stringify(next),
      );
    } else {
      window.localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
    }
  } catch {
    // Storage unavailable: the in-memory memo still holds for this session.
  }
  for (const listener of listeners) listener();
  return next;
}

/** Community-switch reset (see `resetCommunityState`): drop the in-memory
 *  mirror so the next community re-reads its own keys from storage. */
export function resetChannelMemoCache(): void {
  cache.clear();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useChannelMemo(key: string | null): ChannelMemo {
  return React.useSyncExternalStore(
    subscribe,
    () => (key ? getChannelMemo(key) : EMPTY),
    () => EMPTY,
  );
}
