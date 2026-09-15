import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MODEL_RATES,
  estimateModelCost,
  formatUsd,
  OPENAI_AUTHORITY,
  pricingKey,
  resolveModelRates,
} from "./modelPricing.ts";

function usage(overrides = {}) {
  const field = (value) => ({ value, incomplete: false });
  return {
    inputTokens: field("1000000"),
    outputTokens: field("100000"),
    totalTokens: field(null),
    estimatedCostUsd: { value: null, incomplete: false },
    cacheReadTokens: field("400000"),
    cacheWriteTokens: field("0"),
    freshInputTokens: field("600000"),
    ...overrides,
  };
}

test("resolves exact ids, dated snapshots, then the longest prefix", () => {
  const exact = resolveModelRates(OPENAI_AUTHORITY, "gpt-5.3-codex", {});
  assert.equal(exact?.source, "default");
  assert.equal(exact?.matchedModel, "gpt-5.3-codex");

  const dated = resolveModelRates(
    OPENAI_AUTHORITY,
    "gpt-5-mini-2026-03-01",
    {},
  );
  assert.equal(dated?.matchedModel, "gpt-5-mini");

  const prefixed = resolveModelRates(
    OPENAI_AUTHORITY,
    "gpt-5.3-codex-spark",
    {},
  );
  assert.equal(prefixed?.matchedModel, "gpt-5.3-codex");

  assert.equal(
    resolveModelRates(OPENAI_AUTHORITY, "totally-unknown", {}),
    null,
  );
  assert.equal(resolveModelRates("api.example.com", "gpt-5", {}), null);
  assert.equal(resolveModelRates(null, "gpt-5", {}), null);
  assert.equal(resolveModelRates(OPENAI_AUTHORITY, null, {}), null);
});

test("an owner override beats the built-in table for the exact model", () => {
  const custom = {
    inputPerMillion: 9,
    cachedInputPerMillion: 1,
    outputPerMillion: 90,
  };
  const overrides = { [pricingKey(OPENAI_AUTHORITY, "gpt-5")]: custom };
  const resolved = resolveModelRates(OPENAI_AUTHORITY, "gpt-5", overrides);
  assert.equal(resolved?.source, "override");
  assert.deepEqual(resolved?.rates, custom);
  // A different model still falls through to the defaults.
  assert.equal(
    resolveModelRates(OPENAI_AUTHORITY, "gpt-5-mini", overrides)?.source,
    "default",
  );
});

test("estimates split uncached, cached and output tokens at their rates", () => {
  const row = {
    pricingAuthority: OPENAI_AUTHORITY,
    pricingModel: "gpt-5",
    usage: usage(),
  };
  const estimate = estimateModelCost(row, {});
  assert.ok(estimate);
  const r = DEFAULT_MODEL_RATES[OPENAI_AUTHORITY]["gpt-5"];
  const expected =
    (600000 * r.inputPerMillion +
      400000 * r.cachedInputPerMillion +
      100000 * r.outputPerMillion) /
    1_000_000;
  assert.ok(Math.abs(estimate.usd - expected) < 1e-9);
  assert.equal(estimate.approximate, false);
});

test("falls back to input minus cache-read, then to an uncached upper bound", () => {
  const withoutFresh = estimateModelCost(
    {
      pricingAuthority: OPENAI_AUTHORITY,
      pricingModel: "gpt-5",
      usage: usage({ freshInputTokens: { value: null, incomplete: true } }),
    },
    {},
  );
  assert.equal(withoutFresh?.approximate, false);

  const noCacheInfo = estimateModelCost(
    {
      pricingAuthority: OPENAI_AUTHORITY,
      pricingModel: "gpt-5",
      usage: usage({
        freshInputTokens: { value: null, incomplete: true },
        cacheReadTokens: { value: null, incomplete: true },
      }),
    },
    {},
  );
  assert.equal(noCacheInfo?.approximate, true);
  const r = DEFAULT_MODEL_RATES[OPENAI_AUTHORITY]["gpt-5"];
  const upper =
    (1000000 * r.inputPerMillion + 100000 * r.outputPerMillion) / 1_000_000;
  assert.ok(Math.abs(noCacheInfo.usd - upper) < 1e-9);
});

test("no billing identity or no counts means no estimate", () => {
  assert.equal(
    estimateModelCost(
      { pricingAuthority: null, pricingModel: null, usage: usage() },
      {},
    ),
    null,
  );
  assert.equal(
    estimateModelCost(
      {
        pricingAuthority: OPENAI_AUTHORITY,
        pricingModel: "gpt-5",
        usage: usage({ inputTokens: { value: null, incomplete: true } }),
      },
      {},
    ),
    null,
  );
});

test("formats tiny amounts with more digits", () => {
  assert.equal(formatUsd(0.0042), "$0.0042");
  assert.equal(formatUsd(1.234), "$1.23");
  assert.equal(formatUsd(0), "$0.00");
  assert.equal(formatUsd(Number.NaN), "—");
});
