import assert from "node:assert/strict";
import test from "node:test";

import {
  cacheProfileFor,
  claudeCacheWriteMultiplier,
  computeCacheTimer,
  DEFAULT_CACHE_TIMER_SETTINGS,
  formatCountdown,
  impliedClaudeInputRate,
  parseCacheTimerSettings,
} from "./cacheTimer.ts";

const NOW = 1_800_000_000_000;
const head = (over = {}) => ({
  channelId: "c",
  agentPubkey: "a",
  sessionId: "s",
  reportedAt: NOW / 1000 - 60,
  harness: "claude-agent-acp",
  model: null,
  contextTokens: 84_000,
  turnInputTokens: 84_606,
  turnOutputTokens: 79,
  turnCacheReadTokens: 83_744,
  turnCacheWriteTokens: 860,
  turnCostUsd: 0.0209828,
  pricingAuthority: null,
  pricingModel: null,
  ...over,
});

test("profiles follow harness and connection", () => {
  assert.equal(
    cacheProfileFor("claude-agent-acp", "subscription"),
    "claudeSubscription",
  );
  assert.equal(cacheProfileFor("claude-agent-acp", "api-key"), "claudeApiKey");
  assert.equal(cacheProfileFor("codex-acp", "api-key"), "codex");
  assert.equal(cacheProfileFor("goose", "subscription"), "other");
});

test("a warm cache counts down against its profile's TTL", () => {
  const api = computeCacheTimer(
    head(),
    "api-key",
    DEFAULT_CACHE_TIMER_SETTINGS,
    NOW,
  );
  assert.equal(api.profile, "claudeApiKey");
  assert.equal(api.remainingMs, 4 * 60_000);
  assert.ok(Math.abs(api.fraction - 0.8) < 1e-9);
  const sub = computeCacheTimer(
    head(),
    "subscription",
    DEFAULT_CACHE_TIMER_SETTINGS,
    NOW,
  );
  assert.equal(sub.remainingMs, 59 * 60_000);
  assert.equal(
    sub.missPenaltyUsd,
    null,
    "a subscription has no per-token bill",
  );
});

test("expired, disabled and small sessions show nothing", () => {
  const s = DEFAULT_CACHE_TIMER_SETTINGS;
  assert.equal(
    computeCacheTimer(
      head({ reportedAt: NOW / 1000 - 301 }),
      "api-key",
      s,
      NOW,
    ),
    null,
  );
  assert.equal(
    computeCacheTimer(head(), "api-key", { ...s, enabled: false }, NOW),
    null,
  );
  assert.equal(
    computeCacheTimer(head({ contextTokens: 9_000 }), "api-key", s, NOW),
    null,
  );
  // Older harness: no occupancy → the turn's input total gates visibility,
  // but no size or penalty is claimed.
  const legacy = computeCacheTimer(
    head({ contextTokens: null }),
    "api-key",
    s,
    NOW,
  );
  assert.equal(legacy.contextTokens, null);
  assert.equal(legacy.missPenaltyUsd, null);
});

test("the Claude miss penalty is solved from the turn's own cost", () => {
  // A turn billed at $3/M input on the 5-minute cache (write 1.25×):
  // fresh 1,000 + read 80,000 + write 3,000, output 200.
  const rate = 3 / 1e6;
  const priced = head({
    contextTokens: 84_000,
    turnInputTokens: 84_000,
    turnCacheReadTokens: 80_000,
    turnCacheWriteTokens: 3_000,
    turnOutputTokens: 200,
    turnCostUsd: rate * (1_000 + 80_000 * 0.1 + 3_000 * 1.25 + 200 * 5),
  });
  assert.ok(Math.abs(impliedClaudeInputRate(priced, 1.25) - rate) < 1e-12);
  const timer = computeCacheTimer(
    priced,
    "api-key",
    DEFAULT_CACHE_TIMER_SETTINGS,
    NOW,
  );
  // A miss rewrites 84K at 1.25× instead of reading it at 0.1×.
  assert.ok(Math.abs(timer.missPenaltyUsd - 84_000 * rate * 1.15) < 1e-9);
  // Hour-long caches pay the 2× write tier.
  assert.equal(claudeCacheWriteMultiplier(60), 2);
  assert.equal(claudeCacheWriteMultiplier(5), 1.25);
  assert.equal(impliedClaudeInputRate(head({ turnCostUsd: null }), 1.25), null);
});

test("Codex penalties come from the rate table", () => {
  const codex = head({
    harness: "codex-acp",
    turnCostUsd: null,
    pricingAuthority: "api.openai.com",
    pricingModel: "gpt-5",
    contextTokens: 100_000,
  });
  const timer = computeCacheTimer(
    codex,
    "api-key",
    DEFAULT_CACHE_TIMER_SETTINGS,
    NOW,
    {},
  );
  // 100K × ($1.25 − $0.125)/M
  assert.ok(Math.abs(timer.missPenaltyUsd - 0.1125) < 1e-9);
});

test("settings are sanitised and countdowns format", () => {
  const parsed = parseCacheTimerSettings({
    enabled: false,
    minContextTokens: -5,
    ttlMinutes: { claudeApiKey: 0, codex: 12, other: "x" },
  });
  assert.equal(parsed.enabled, false);
  assert.equal(parsed.minContextTokens, 20_000);
  assert.deepEqual(parsed.ttlMinutes, {
    claudeSubscription: 60,
    claudeApiKey: 5,
    codex: 12,
    other: 5,
  });
  assert.equal(formatCountdown(247_000), "4:07");
  assert.equal(formatCountdown(3_725_000), "1:02:05");
  assert.equal(formatCountdown(-5), "0:00");
});
