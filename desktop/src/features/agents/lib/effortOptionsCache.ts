import * as React from "react";
import type { AcpConfigOptionValue } from "@/shared/api/types";

/**
 * Last-known thinking-effort options per (harness, model), remembered on this
 * device. The adapter only advertises the `thought_level` option from a
 * running session, so before an agent's first session — or right after a
 * restart — the effort pill had nothing to render. Options are a property of
 * the harness + model, not of the session, so a snapshot from any earlier
 * session on the same pair is a truthful stand-in until the live one lands.
 */
export type CachedEffortOptions = {
  configId: string;
  options: AcpConfigOptionValue[];
  /** Unix seconds when the snapshot was taken. */
  seenAt: number;
};

const STORAGE_PREFIX = "buzz:effort-options:";
const listeners = new Set<() => void>();
const cache = new Map<string, CachedEffortOptions | null>();

export function effortOptionsKey(
  harness: string | null | undefined,
  model: string | null | undefined,
): string | null {
  const h = harness?.trim();
  const m = model?.trim();
  if (!h || !m) return null;
  return `${h.toLowerCase()}::${m}`;
}

function readStored(key: string): CachedEffortOptions | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedEffortOptions>;
    if (
      typeof parsed.configId !== "string" ||
      !Array.isArray(parsed.options) ||
      !parsed.options.every(
        (o) => o && typeof o === "object" && typeof o.value === "string",
      )
    ) {
      return null;
    }
    return {
      configId: parsed.configId,
      options: parsed.options,
      seenAt: typeof parsed.seenAt === "number" ? parsed.seenAt : 0,
    };
  } catch {
    return null;
  }
}

export function getCachedEffortOptions(
  key: string | null,
): CachedEffortOptions | null {
  if (!key) return null;
  if (!cache.has(key)) cache.set(key, readStored(key));
  return cache.get(key) ?? null;
}

export function rememberEffortOptions(
  key: string | null,
  configId: string,
  options: readonly AcpConfigOptionValue[],
): void {
  if (!key || options.length === 0) return;
  const current = cache.get(key) ?? readStored(key);
  const next: CachedEffortOptions = {
    configId,
    options: options.map((o) => ({ ...o })),
    seenAt: Math.floor(Date.now() / 1000),
  };
  if (
    current &&
    current.configId === next.configId &&
    JSON.stringify(current.options) === JSON.stringify(next.options)
  ) {
    return;
  }
  cache.set(key, next);
  try {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${key}`,
      JSON.stringify(next),
    );
  } catch {
    // Storage unavailable: the in-memory snapshot still serves this session.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCachedEffortOptions(
  key: string | null,
): CachedEffortOptions | null {
  return React.useSyncExternalStore(
    subscribe,
    () => getCachedEffortOptions(key),
    () => null,
  );
}

/**
 * Which effort options the picker should use: the live session's when the
 * surface has them (and record them), else the cached snapshot for the
 * harness+model, else nothing.
 */
export function resolveEffortOptionsSource({
  live,
  cached,
}: {
  live: {
    configId: string | undefined;
    options: readonly AcpConfigOptionValue[] | undefined;
  };
  cached: CachedEffortOptions | null;
}): {
  configId: string | undefined;
  options: readonly AcpConfigOptionValue[] | undefined;
  source: "session" | "cache" | null;
} {
  if (live.configId !== undefined) {
    return {
      configId: live.configId,
      options: live.options,
      source: "session",
    };
  }
  if (cached) {
    return {
      configId: cached.configId,
      options: cached.options,
      source: "cache",
    };
  }
  return { configId: undefined, options: undefined, source: null };
}
