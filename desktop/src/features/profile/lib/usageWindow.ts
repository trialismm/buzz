import type {
  AgentUsageSeriesBucket,
  CostField,
  ReportedUsage,
  UsageField,
} from "@/shared/api/tauriArchive";

/**
 * Day windows for the agent Usage card. `get_agent_usage_series` wants exact
 * local-midnight boundaries, so days are walked on the calendar (`setDate`)
 * rather than added as `86_400`s — a DST change would otherwise shift every
 * boundary after it by an hour.
 */

/** Local midnight at the start of `date`'s calendar day. */
export function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * `days + 1` Unix-second boundaries covering the last `days` calendar days
 * up to and including today: `[…, yesterday 00:00, today 00:00, tomorrow
 * 00:00]`. The final bucket is today.
 */
export function dayBoundaries(now: Date, days: number): number[] {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(
      `dayBoundaries: days must be a positive integer, got ${days}`,
    );
  }
  const end = localMidnight(now);
  end.setDate(end.getDate() + 1);
  const boundaries: number[] = [];
  for (let back = days; back >= 0; back -= 1) {
    const day = new Date(end);
    day.setDate(end.getDate() - back);
    boundaries.push(Math.floor(day.getTime() / 1000));
  }
  return boundaries;
}

// ── Bucket sums ──────────────────────────────────────────────────────────────

function addField(sum: UsageField, field: UsageField): UsageField {
  if (field.value === null) {
    return { value: sum.value, incomplete: sum.incomplete || field.incomplete };
  }
  let next: bigint;
  try {
    next = BigInt(field.value);
  } catch {
    return { value: sum.value, incomplete: true };
  }
  const current = sum.value === null ? 0n : BigInt(sum.value);
  return {
    value: (current + next).toString(),
    incomplete: sum.incomplete || field.incomplete,
  };
}

function addCost(sum: CostField, field: CostField): CostField {
  if (field.value === null) {
    return { value: sum.value, incomplete: sum.incomplete || field.incomplete };
  }
  return {
    value: (sum.value ?? 0) + field.value,
    incomplete: sum.incomplete || field.incomplete,
  };
}

const EMPTY_FIELD: UsageField = { value: null, incomplete: false };

export type WindowUsage = {
  usage: ReportedUsage;
  reportCount: number;
  hasUnknownUsage: boolean;
};

/**
 * Sum the trailing `days` buckets of a series (the card's Today / 7 days /
 * 30 days rows). Field-wise: a `null` bucket value contributes nothing, and
 * any incomplete bucket marks the sum incomplete (a lower bound).
 */
export function sumTrailingBuckets(
  buckets: AgentUsageSeriesBucket[],
  days: number,
): WindowUsage {
  const slice = buckets.slice(Math.max(0, buckets.length - days));
  let usage: ReportedUsage = {
    inputTokens: EMPTY_FIELD,
    outputTokens: EMPTY_FIELD,
    totalTokens: EMPTY_FIELD,
    estimatedCostUsd: { value: null, incomplete: false },
    cacheReadTokens: EMPTY_FIELD,
    cacheWriteTokens: EMPTY_FIELD,
    freshInputTokens: EMPTY_FIELD,
  };
  let reportCount = 0;
  let hasUnknownUsage = false;
  for (const bucket of slice) {
    usage = {
      inputTokens: addField(usage.inputTokens, bucket.usage.inputTokens),
      outputTokens: addField(usage.outputTokens, bucket.usage.outputTokens),
      totalTokens: addField(usage.totalTokens, bucket.usage.totalTokens),
      estimatedCostUsd: addCost(
        usage.estimatedCostUsd,
        bucket.usage.estimatedCostUsd,
      ),
      cacheReadTokens: addField(
        usage.cacheReadTokens,
        bucket.usage.cacheReadTokens,
      ),
      cacheWriteTokens: addField(
        usage.cacheWriteTokens,
        bucket.usage.cacheWriteTokens,
      ),
      freshInputTokens: addField(
        usage.freshInputTokens,
        bucket.usage.freshInputTokens,
      ),
    };
    reportCount += bucket.reportCount;
    hasUnknownUsage = hasUnknownUsage || bucket.hasUnknownUsage;
  }
  return { usage, reportCount, hasUnknownUsage };
}

/** Compact token count: `1.2K`, `3.4M`; `—` when unknown. */
export function formatTokens(field: UsageField): string {
  if (field.value === null) return "—";
  let n: number;
  try {
    n = Number(BigInt(field.value));
  } catch {
    return "—";
  }
  const text = new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
  return field.incomplete ? `≥${text}` : text;
}
