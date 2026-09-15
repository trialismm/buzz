import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import {
  type AgentUsageSeries,
  getAgentUsageSeries,
  onAgentMetricsChanged,
} from "@/shared/api/tauriArchive";
import { normalizePubkey } from "@/shared/lib/pubkey";

import { dayBoundaries } from "./usageWindow";

export const AGENT_USAGE_SERIES_QUERY_KEY = "agent-usage-series";

/**
 * The last `days` calendar days of archived NIP-AM usage for one agent,
 * refreshed when the archive persists a new turn metric. Boundaries are
 * recomputed when the local calendar day changes so "today" stays today.
 */
export function useAgentUsageSeries(
  agentPubkey: string | null | undefined,
  days = 30,
) {
  const pubkey = agentPubkey ? normalizePubkey(agentPubkey) : null;
  const [dayKey, setDayKey] = React.useState(() => todayKey());
  React.useEffect(() => {
    const timer = window.setInterval(() => {
      const next = todayKey();
      setDayKey((current) => (current === next ? current : next));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  // `dayKey` is the dependency that makes the boundaries roll over at
  // local midnight; the value itself is not read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: dayKey drives the recompute
  const boundaries = React.useMemo(
    () => dayBoundaries(new Date(), days),
    [days, dayKey],
  );

  const queryClient = useQueryClient();
  React.useEffect(
    () =>
      onAgentMetricsChanged(() => {
        void queryClient.invalidateQueries({
          queryKey: [AGENT_USAGE_SERIES_QUERY_KEY],
        });
      }),
    [queryClient],
  );

  return useQuery<AgentUsageSeries>({
    queryKey: [AGENT_USAGE_SERIES_QUERY_KEY, pubkey, boundaries],
    queryFn: () =>
      getAgentUsageSeries({
        bucketBoundaries: boundaries,
        ...(pubkey ? { agentPubkey: pubkey } : {}),
      }),
    enabled: pubkey !== null,
    staleTime: 30_000,
  });
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
