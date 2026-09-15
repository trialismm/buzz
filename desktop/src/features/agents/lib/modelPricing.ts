import * as React from "react";

import type { AgentUsageModel } from "@/shared/api/tauriArchive";

/**
 * Per-token rates for pricing NIP-AM usage the harness could not price
 * itself. Keyed by the event's `pricingIdentity` (`authority` + billable
 * `model`) — never by the session `model` alias, per NIP-AM. The app ships
 * defaults for the OpenAI API (Claude Code reports its own cost, so Anthropic
 * needs none) and the owner can override any row; overrides live in this
 * device's localStorage. Every figure this module produces is an estimate
 * and is labelled as such by its consumers.
 */
export type ModelRates = {
  /** USD per 1M uncached input tokens. */
  inputPerMillion: number;
  /** USD per 1M cache-served input tokens. */
  cachedInputPerMillion: number;
  /** USD per 1M output tokens. */
  outputPerMillion: number;
};

export type RatesSource = "override" | "default";

export type ResolvedRates = {
  rates: ModelRates;
  source: RatesSource;
  /** The table key that matched — the model id itself or a prefix of it. */
  matchedModel: string;
};

/** Authority hostnames per NIP-AM's registered set. */
export const OPENAI_AUTHORITY = "api.openai.com";

/**
 * Built-in OpenAI API list prices (USD / 1M tokens). Last checked against
 * platform.openai.com/pricing by the app author on 2026-09-14; treat as a
 * starting point and correct any row from the Usage card.
 */
export const DEFAULT_MODEL_RATES: Readonly<
  Record<string, Readonly<Record<string, ModelRates>>>
> = {
  [OPENAI_AUTHORITY]: {
    "gpt-5": rates(1.25, 0.125, 10),
    "gpt-5-mini": rates(0.25, 0.025, 2),
    "gpt-5-nano": rates(0.05, 0.005, 0.4),
    "gpt-5-codex": rates(1.25, 0.125, 10),
    "gpt-5.1": rates(1.25, 0.125, 10),
    "gpt-5.1-codex": rates(1.25, 0.125, 10),
    "gpt-5.1-codex-mini": rates(0.25, 0.025, 2),
    "gpt-5.2": rates(1.75, 0.175, 14),
    "gpt-5.2-codex": rates(1.75, 0.175, 14),
    "gpt-5.3-codex": rates(1.75, 0.175, 14),
    "gpt-4.1": rates(2, 0.5, 8),
    "gpt-4.1-mini": rates(0.4, 0.1, 1.6),
    o3: rates(2, 0.5, 8),
    "o4-mini": rates(1.1, 0.275, 4.4),
  },
};

function rates(
  inputPerMillion: number,
  cachedInputPerMillion: number,
  outputPerMillion: number,
): ModelRates {
  return { inputPerMillion, cachedInputPerMillion, outputPerMillion };
}

// ── Overrides (localStorage) ─────────────────────────────────────────────────

const STORAGE_KEY = "buzz:model-pricing-overrides";
const listeners = new Set<() => void>();
let overridesCache: Record<string, ModelRates> | null = null;

export function pricingKey(authority: string, model: string): string {
  return `${authority.trim().toLowerCase()}|${model.trim()}`;
}

function isRates(value: unknown): value is ModelRates {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    isRate(v.inputPerMillion) &&
    isRate(v.cachedInputPerMillion) &&
    isRate(v.outputPerMillion)
  );
}

function isRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function readOverrides(): Record<string, ModelRates> {
  if (overridesCache) return overridesCache;
  let parsed: Record<string, ModelRates> = {};
  try {
    const raw =
      typeof window === "undefined"
        ? null
        : window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      for (const [key, value] of Object.entries(obj)) {
        if (isRates(value)) parsed[key] = value;
      }
    }
  } catch {
    parsed = {};
  }
  overridesCache = parsed;
  return parsed;
}

function writeOverrides(next: Record<string, ModelRates>): void {
  overridesCache = next;
  try {
    if (Object.keys(next).length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Storage unavailable — the in-memory cache still serves this session.
  }
  for (const listener of listeners) listener();
}

export function getPricingOverrides(): Record<string, ModelRates> {
  return readOverrides();
}

export function setPricingOverride(
  authority: string,
  model: string,
  next: ModelRates | null,
): void {
  const key = pricingKey(authority, model);
  const current = { ...readOverrides() };
  if (next && isRates(next)) {
    current[key] = next;
  } else {
    delete current[key];
  }
  writeOverrides(current);
}

/** Test seam: forget cached overrides so the next read hits storage. */
export function resetPricingOverridesForTests(): void {
  overridesCache = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePricingOverrides(): Record<string, ModelRates> {
  return React.useSyncExternalStore(subscribe, readOverrides, readOverrides);
}

// ── Resolution ───────────────────────────────────────────────────────────────

/** Strip a trailing `-YYYY-MM-DD` snapshot suffix (`gpt-5-2026-03-01`). */
function baseModelId(model: string): string {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

/**
 * Rates for a billing identity: an owner override for the exact model wins,
 * then the built-in table by exact id, by id without its date suffix, then
 * by the longest built-in key the id starts with (`gpt-5.3-codex-…`).
 */
export function resolveModelRates(
  authority: string | null,
  model: string | null,
  overrides: Record<string, ModelRates> = readOverrides(),
): ResolvedRates | null {
  if (!authority || !model) return null;
  const override = overrides[pricingKey(authority, model)];
  if (override) {
    return { rates: override, source: "override", matchedModel: model };
  }
  const table = DEFAULT_MODEL_RATES[authority.trim().toLowerCase()];
  if (!table) return null;
  const trimmed = model.trim();
  const base = baseModelId(trimmed);
  for (const candidate of [trimmed, base]) {
    const exact = table[candidate];
    if (exact)
      return { rates: exact, source: "default", matchedModel: candidate };
  }
  let best: string | null = null;
  for (const key of Object.keys(table)) {
    if (
      base.startsWith(`${key}-`) &&
      (best === null || key.length > best.length)
    ) {
      best = key;
    }
  }
  return best
    ? { rates: table[best], source: "default", matchedModel: best }
    : null;
}

// ── Estimation ───────────────────────────────────────────────────────────────

export type CostEstimate = {
  usd: number;
  /**
   * True when the cache split was unknown and every input token was priced
   * at the uncached rate — an upper bound rather than the exact figure.
   */
  approximate: boolean;
  resolved: ResolvedRates;
};

function tokens(value: string | null): bigint | null {
  if (value === null) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * Price one per-model usage rollup: uncached input × input rate + cached
 * input × cached rate + output × output rate. `null` when the row has no
 * billing identity, no known rates, or no complete input/output counts.
 */
export function estimateModelCost(
  row: Pick<AgentUsageModel, "pricingAuthority" | "pricingModel" | "usage">,
  overrides?: Record<string, ModelRates>,
): CostEstimate | null {
  const resolved = resolveModelRates(
    row.pricingAuthority,
    row.pricingModel,
    overrides,
  );
  if (!resolved) return null;
  const input = tokens(row.usage.inputTokens.value);
  const output = tokens(row.usage.outputTokens.value);
  if (input === null || output === null) return null;
  const fresh = tokens(row.usage.freshInputTokens.value);
  const cacheRead = tokens(row.usage.cacheReadTokens.value);
  let uncached: bigint;
  let cached: bigint;
  let approximate = false;
  if (fresh !== null && cacheRead !== null) {
    uncached = fresh;
    cached = cacheRead;
  } else if (cacheRead !== null && cacheRead <= input) {
    uncached = input - cacheRead;
    cached = cacheRead;
  } else {
    uncached = input;
    cached = 0n;
    approximate = true;
  }
  const { rates } = resolved;
  const usd =
    (Number(uncached) * rates.inputPerMillion +
      Number(cached) * rates.cachedInputPerMillion +
      Number(output) * rates.outputPerMillion) /
    1_000_000;
  return { usd, approximate, resolved };
}

/** `$0.0042`, `$1.23`, `$120.50` — more digits only when the value is tiny. */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd)) return "—";
  const digits = usd > 0 && usd < 0.01 ? 4 : 2;
  return `$${usd.toFixed(digits)}`;
}
