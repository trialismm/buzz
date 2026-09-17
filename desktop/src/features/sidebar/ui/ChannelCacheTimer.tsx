import {
  type CacheTimerSettings,
  CACHE_PROFILE_LABELS,
  cacheProfileFor,
  computeCacheTimer,
  formatCountdown,
  useCacheTimerSettings,
} from "@/features/agents/lib/cacheTimer";
import {
  formatUsd,
  usePricingOverrides,
} from "@/features/agents/lib/modelPricing";
import {
  type ChannelCacheEntry,
  useChannelCacheHeads,
} from "@/features/agents/lib/useChannelCacheHeads";
import { cn } from "@/shared/lib/cn";
import { useNow } from "@/shared/lib/useNow";

const RING_RADIUS = 5;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * Prompt-cache countdown for a sidebar row: a small ring that drains from the
 * end of my agent's last turn in this channel and disappears when the cache
 * is (estimated to be) gone. See `features/agents/lib/cacheTimer.ts`.
 */
export function ChannelCacheTimer({
  channelId,
  className,
  isActive = false,
}: {
  channelId: string | null | undefined;
  className?: string;
  isActive?: boolean;
}) {
  const settings = useCacheTimerSettings();
  const entry = useChannelCacheHeads(settings.enabled).get(channelId ?? "");
  if (!settings.enabled || !entry) return null;
  return (
    <CacheTimerRing
      className={className}
      entry={entry}
      isActive={isActive}
      settings={settings}
    />
  );
}

function CacheTimerRing({
  className,
  entry,
  isActive,
  settings,
}: {
  className?: string;
  entry: ChannelCacheEntry;
  isActive: boolean;
  settings: CacheTimerSettings;
}) {
  // Short caches are worth a per-second clock; hour-long ones are not.
  const profile = cacheProfileFor(entry.head.harness, entry.connection);
  const now = useNow(settings.ttlMinutes[profile] <= 10 ? 1_000 : 5_000);
  const overrides = usePricingOverrides();
  const timer = computeCacheTimer(
    entry.head,
    entry.connection,
    settings,
    now,
    overrides,
  );
  if (!timer) return null;

  const minutes = settings.ttlMinutes[timer.profile];
  const parts = [
    `Prompt cache warm · ${formatCountdown(timer.remainingMs)} left`,
    `${CACHE_PROFILE_LABELS[timer.profile]}, about ${minutes} min (estimate)`,
  ];
  if (timer.contextTokens) {
    parts.push(
      `~${new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(timer.contextTokens)} tokens in context`,
    );
  }
  if (timer.missPenaltyUsd !== null) {
    parts.push(`a miss costs about ${formatUsd(timer.missPenaltyUsd)} more`);
  }
  const label = `${parts.join(" · ")}. Continue now or let it go — pinging just to keep it warm costs more than it saves.`;
  const low = timer.fraction <= 0.2;

  return (
    <span
      aria-label={label}
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center",
        isActive
          ? "text-sidebar-active-foreground/80"
          : low
            ? "text-amber-500"
            : "text-emerald-500",
        className,
      )}
      data-cache-timer-state={low ? "low" : "warm"}
      data-testid="channel-cache-timer"
      role="img"
      title={label}
    >
      <svg
        aria-hidden="true"
        className="size-3.5 -rotate-90"
        viewBox="0 0 14 14"
      >
        <circle
          cx="7"
          cy="7"
          fill="none"
          opacity="0.25"
          r={RING_RADIUS}
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle
          cx="7"
          cy="7"
          fill="none"
          r={RING_RADIUS}
          stroke="currentColor"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - timer.fraction)}
          strokeLinecap="round"
          strokeWidth="2"
        />
      </svg>
    </span>
  );
}
