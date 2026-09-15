import assert from "node:assert/strict";
import test from "node:test";

import {
  dayBoundaries,
  formatTokens,
  localMidnight,
  sumTrailingBuckets,
} from "./usageWindow.ts";

test("boundaries are local midnights ending at tomorrow, days + 1 long", () => {
  const now = new Date(2026, 8, 14, 15, 42, 7); // 14 Sep 2026, 15:42 local
  const bounds = dayBoundaries(now, 7);
  assert.equal(bounds.length, 8);
  for (const b of bounds) {
    const d = new Date(b * 1000);
    assert.equal(d.getHours(), 0);
    assert.equal(d.getMinutes(), 0);
    assert.equal(d.getSeconds(), 0);
  }
  const last = new Date(bounds[bounds.length - 1] * 1000);
  assert.equal(last.getDate(), 15);
  const first = new Date(bounds[0] * 1000);
  assert.equal(first.getDate(), 8);
  for (let i = 1; i < bounds.length; i += 1) {
    assert.ok(bounds[i] > bounds[i - 1], "strictly increasing");
  }
  assert.equal(localMidnight(now).getTime(), new Date(2026, 8, 14).getTime());
  assert.throws(() => dayBoundaries(now, 0), RangeError);
});

test("boundaries walk the calendar across a month edge", () => {
  const bounds = dayBoundaries(new Date(2026, 9, 1, 9, 0, 0), 2); // 1 Oct
  const days = bounds.map((b) => {
    const d = new Date(b * 1000);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });
  // days + 1 boundaries: the two buckets are 9/30 and 10/1 (today).
  assert.deepEqual(days, ["9/30", "10/1", "10/2"]);
});

function bucket(
  input,
  output,
  cost,
  { incomplete = false, unknown = false } = {},
) {
  const field = (value) => ({ value, incomplete });
  return {
    start: 0,
    end: 0,
    usage: {
      inputTokens: field(input),
      outputTokens: field(output),
      totalTokens: field(null),
      estimatedCostUsd: { value: cost, incomplete },
      cacheReadTokens: field(null),
      cacheWriteTokens: field(null),
      freshInputTokens: field(null),
    },
    reportCount: 1,
    hasUnknownUsage: unknown,
  };
}

test("trailing sums add the last N buckets field-wise and carry incompleteness", () => {
  const buckets = [
    bucket("10", "1", 0.1),
    bucket("20", "2", null),
    bucket("30", "3", 0.3, { incomplete: true, unknown: true }),
  ];
  const all = sumTrailingBuckets(buckets, 30);
  assert.equal(all.usage.inputTokens.value, "60");
  assert.equal(all.usage.outputTokens.value, "6");
  assert.equal(all.usage.inputTokens.incomplete, true);
  assert.ok(Math.abs(all.usage.estimatedCostUsd.value - 0.4) < 1e-12);
  assert.equal(all.reportCount, 3);
  assert.equal(all.hasUnknownUsage, true);

  const today = sumTrailingBuckets(buckets, 1);
  assert.equal(today.usage.inputTokens.value, "30");
  assert.equal(today.reportCount, 1);

  const none = sumTrailingBuckets([], 7);
  assert.equal(none.usage.inputTokens.value, null);
  assert.equal(none.reportCount, 0);
});

test("token formatting is compact and marks lower bounds", () => {
  assert.equal(formatTokens({ value: null, incomplete: false }), "—");
  assert.equal(formatTokens({ value: "950", incomplete: false }), "950");
  assert.match(formatTokens({ value: "1234567", incomplete: false }), /1\.2M/);
  assert.match(formatTokens({ value: "1500", incomplete: true }), /^≥1\.5K/);
});
