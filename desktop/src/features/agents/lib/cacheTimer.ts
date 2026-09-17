import * as React from "react";

import type { AgentConnection } from "@/features/agents/lib/agentConnection";
import {
  type ModelRates,
  resolveModelRates,
} from "@/features/agents/lib/modelPricing";
import type { ChannelCacheHead } from "@/shared/api/tauriArchive";

/**
 * Prompt-cache timer. Providers keep a session's prompt cached for a short
 * while after each request; a turn that lands inside that window re-reads the
 * context at roughly a tenth of the input price, one that lands after it pays
 * full price again. The timer counts down from the end of the agent's last
 * turn so the owner can decide whether to continue now or let the cache go.
 *
 * The time-to-live is NOT one number — it depends on the provider and on how
 * the agent is connected — so every value here is an owner-editable estimate:
 * Claude Code on a subscription keeps about an hour, the Anthropic API five
 * minutes (refreshed by every hit), OpenAI a few minutes of inactivity.
 */
export type CacheProfile =
  | "claudeSubscription"
  | "claudeApiKey"
  | "codex"
  | "other";

export type CacheTimerSettings = {
  enabled: boolean;
  /** Sessions smaller than this are not worth a timer. */
  minContextTokens: number;
  ttlMinutes: Record<CacheProfile, number>;
};

export const DEFAULT_CACHE_TIMER_SETTINGS: CacheTimerSettings = Object.freeze({
  enabled: true,
  minContextTokens: 20_000,
  ttlMinutes: Object.freeze({
    claudeSubscription: 60,
    claudeApiKey: 5,
    codex: 5,
    other: 5,
  }),
});

export const CACHE_PROFILE_LABELS: Record<CacheProfile, string> = {
  claudeSubscription: "Claude · subscription",
  claudeApiKey: "Claude · API key",
  codex: "Codex",
  other: "Other harnesses",
};

export function cacheProfileFor(
  harness: string,
  connection: AgentConnection,
): CacheProfile {
  const h = harness.toLowerCase();
  if (h.includes("claude")) {
    return connection === "api-key" ? "claudeApiKey" : "claudeSubscription";
  }
  if (h.includes("codex")) return "codex";
  return "other";
}

// ── Settings store (localStorage, device-wide) ───────────────────────────────

const STORAGE_KEY = "buzz.cacheTimer.v1";
const listeners = new Set<() => void>();
let cached: CacheTimerSettings | null = null;

function clampMinutes(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(value, 24 * 60)
    : fallback;
}

export function parseCacheTimerSettings(value: unknown): CacheTimerSettings {
  const d = DEFAULT_CACHE_TIMER_SETTINGS;
  if (!value || typeof value !== "object") return d;
  const raw = value as Record<string, unknown>;
  const ttl = (raw.ttlMinutes ?? {}) as Record<string, unknown>;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : d.enabled,
    minContextTokens:
      typeof raw.minContextTokens === "number" &&
      Number.isFinite(raw.minContextTokens) &&
      raw.minContextTokens >= 0
        ? raw.minContextTokens
        : d.minContextTokens,
    ttlMinutes: {
      claudeSubscription: clampMinutes(
        ttl.claudeSubscription,
        d.ttlMinutes.claudeSubscription,
      ),
      claudeApiKey: clampMinutes(ttl.claudeApiKey, d.ttlMinutes.claudeApiKey),
      codex: clampMinutes(ttl.codex, d.ttlMinutes.codex),
      other: clampMinutes(ttl.other, d.ttlMinutes.other),
    },
  };
}

function read(): CacheTimerSettings {
  if (cached) return cached;
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    cached = raw
      ? parseCacheTimerSettings(JSON.parse(raw))
      : DEFAULT_CACHE_TIMER_SETTINGS;
  } catch {
    cached = DEFAULT_CACHE_TIMER_SETTINGS;
  }
  return cached;
}

export function setCacheTimerSettings(next: CacheTimerSettings): void {
  cached = parseCacheTimerSettings(next);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // Persistence is best-effort; the live setting still applies.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCacheTimerSettings(): CacheTimerSettings {
  return React.useSyncExternalStore(
    subscribe,
    read,
    () => DEFAULT_CACHE_TIMER_SETTINGS,
  );
}

// ── Timer maths ──────────────────────────────────────────────────────────────

export type CacheTimer = {
  profile: CacheProfile;
  ttlMs: number;
  remainingMs: number;
  /** 1 → just refreshed, 0 → expiring now. */
  fraction: number;
  /** Size of what a miss re-reads; null when the harness did not report it. */
  contextTokens: number | null;
  /**
   * Extra dollars a miss costs over a hit, or null when it cannot be priced
   * (a subscription has no per-token bill; unknown rates).
   */
  missPenaltyUsd: number | null;
};

// Anthropic prices every model with the same multipliers off its input rate:
// output 5×, cache read 0.1×, cache write 1.25× for the 5-minute cache and 2×
// for the 1-hour one. Which write tier a session uses follows its TTL.
const CLAUDE_OUTPUT_MULTIPLIER = 5;
const CLAUDE_CACHE_READ_MULTIPLIER = 0.1;
const LONG_CACHE_MINUTES = 30;

export function claudeCacheWriteMultiplier(ttlMinutes: number): number {
  return ttlMinutes >= LONG_CACHE_MINUTES ? 2 : 1.25;
}

/**
 * Input price per token implied by a Claude turn's own reported cost. The
 * harness publishes no billable model id for Claude, but the cost and the
 * token split are enough to solve for the rate.
 */
export function impliedClaudeInputRate(
  head: ChannelCacheHead,
  cacheWriteMultiplier: number,
): number | null {
  const { turnCostUsd, turnInputTokens, turnOutputTokens } = head;
  if (!turnCostUsd || turnCostUsd <= 0 || !turnInputTokens) return null;
  const read = head.turnCacheReadTokens ?? 0;
  const write = head.turnCacheWriteTokens ?? 0;
  const fresh = Math.max(0, turnInputTokens - read - write);
  const weighted =
    fresh +
    read * CLAUDE_CACHE_READ_MULTIPLIER +
    write * cacheWriteMultiplier +
    (turnOutputTokens ?? 0) * CLAUDE_OUTPUT_MULTIPLIER;
  return weighted > 0 ? turnCostUsd / weighted : null;
}

function missPenaltyUsd(
  head: ChannelCacheHead,
  profile: CacheProfile,
  contextTokens: number | null,
  ttlMinutes: number,
  overrides?: Record<string, ModelRates>,
): number | null {
  if (!contextTokens) return null;
  if (profile === "claudeApiKey") {
    // A miss rewrites the context into the cache instead of reading it.
    const writeMultiplier = claudeCacheWriteMultiplier(ttlMinutes);
    const rate = impliedClaudeInputRate(head, writeMultiplier);
    return rate === null
      ? null
      : contextTokens * rate * (writeMultiplier - CLAUDE_CACHE_READ_MULTIPLIER);
  }
  if (profile === "codex") {
    const resolved = resolveModelRates(
      head.pricingAuthority,
      head.pricingModel,
      overrides,
    );
    if (!resolved) return null;
    const { inputPerMillion, cachedInputPerMillion } = resolved.rates;
    return (contextTokens * (inputPerMillion - cachedInputPerMillion)) / 1e6;
  }
  return null;
}

/**
 * The timer for one channel head, or null when there is nothing to show:
 * timers off, cache already expired, or a session too small to matter.
 */
export function computeCacheTimer(
  head: ChannelCacheHead,
  connection: AgentConnection,
  settings: CacheTimerSettings,
  nowMs: number,
  overrides?: Record<string, ModelRates>,
): CacheTimer | null {
  if (!settings.enabled) return null;
  const profile = cacheProfileFor(head.harness, connection);
  const ttlMs = settings.ttlMinutes[profile] * 60_000;
  const remainingMs = head.reportedAt * 1000 + ttlMs - nowMs;
  if (remainingMs <= 0) return null;
  // Older harness builds report no occupancy; the turn's input total is an
  // upper bound, good enough for the "is this session big?" test only.
  const sizeForThreshold = head.contextTokens ?? head.turnInputTokens ?? 0;
  if (sizeForThreshold < settings.minContextTokens) return null;
  return {
    profile,
    ttlMs,
    remainingMs,
    fraction: Math.min(1, remainingMs / ttlMs),
    contextTokens: head.contextTokens,
    missPenaltyUsd: missPenaltyUsd(
      head,
      profile,
      head.contextTokens,
      settings.ttlMinutes[profile],
      overrides,
    ),
  };
}

/** `4:07`, `58:20`, `1:02:05`. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
