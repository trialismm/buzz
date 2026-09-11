import assert from "node:assert/strict";
import test from "node:test";

import {
  effortOptionsKey,
  getCachedEffortOptions,
  rememberEffortOptions,
  resolveEffortOptionsSource,
} from "./effortOptionsCache.ts";

const backing = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
  },
};

const OPTIONS = [
  { value: "low", displayName: "Low" },
  { value: "high", displayName: "High" },
];

test("effortOptionsKey needs both halves and folds the harness case", () => {
  assert.equal(
    effortOptionsKey("Claude-Agent-ACP", "sonnet"),
    "claude-agent-acp::sonnet",
  );
  assert.equal(effortOptionsKey("", "sonnet"), null);
  assert.equal(effortOptionsKey("claude", null), null);
});

test("remember/get round-trips through storage; identical snapshots are not rewritten", () => {
  const key = effortOptionsKey("claude", "sonnet");
  assert.equal(getCachedEffortOptions(key), null);
  rememberEffortOptions(key, "thought_level", OPTIONS);
  const first = getCachedEffortOptions(key);
  assert.equal(first.configId, "thought_level");
  assert.deepEqual(first.options, OPTIONS);
  const stored = backing.get(`buzz:effort-options:${key}`);
  rememberEffortOptions(key, "thought_level", OPTIONS);
  assert.equal(
    backing.get(`buzz:effort-options:${key}`),
    stored,
    "unchanged snapshot is not rewritten",
  );
  rememberEffortOptions(key, "thought_level", []);
  assert.deepEqual(
    getCachedEffortOptions(key).options,
    OPTIONS,
    "empty options never overwrite a snapshot",
  );
});

test("resolveEffortOptionsSource prefers the live session, then the cache, then nothing", () => {
  const cached = { configId: "thought_level", options: OPTIONS, seenAt: 1 };
  assert.deepEqual(
    resolveEffortOptionsSource({
      live: { configId: "thought_level", options: [OPTIONS[0]] },
      cached,
    }),
    { configId: "thought_level", options: [OPTIONS[0]], source: "session" },
  );
  assert.deepEqual(
    resolveEffortOptionsSource({
      live: { configId: undefined, options: undefined },
      cached,
    }),
    { configId: "thought_level", options: OPTIONS, source: "cache" },
  );
  assert.deepEqual(
    resolveEffortOptionsSource({
      live: { configId: undefined, options: undefined },
      cached: null,
    }),
    { configId: undefined, options: undefined, source: null },
  );
});
