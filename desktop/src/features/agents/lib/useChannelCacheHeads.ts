import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import {
  useManagedAgentsQuery,
  usePersonasQuery,
} from "@/features/agents/hooks";
import {
  AGENT_CONNECTION_ENV_KEY,
  type AgentConnection,
  parseAgentConnection,
} from "@/features/agents/lib/agentConnection";
import {
  type ChannelCacheHead,
  getChannelCacheHeads,
  onAgentMetricsChanged,
} from "@/shared/api/tauriArchive";
import { normalizePubkey } from "@/shared/lib/pubkey";

const QUERY_KEY = ["channel-cache-heads"] as const;
/** Longest cache any profile can claim; older turns cannot still be warm. */
const WINDOW_SECONDS = 24 * 60 * 60;

export type ChannelCacheEntry = {
  head: ChannelCacheHead;
  /** How the agent that ran the turn is connected (decides the TTL). */
  connection: AgentConnection;
};

/**
 * The most recent turn of one of my agents per channel, from the local
 * metric archive, refreshed whenever the archive persists a new metric.
 */
export function useChannelCacheHeads(
  enabled = true,
): ReadonlyMap<string, ChannelCacheEntry> {
  const queryClient = useQueryClient();
  React.useEffect(
    () =>
      onAgentMetricsChanged(() => {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      }),
    [queryClient],
  );
  const headsQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () =>
      getChannelCacheHeads(Math.floor(Date.now() / 1000) - WINDOW_SECONDS),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const agentsQuery = useManagedAgentsQuery({ enabled });
  const personasQuery = usePersonasQuery({ enabled });

  return React.useMemo(() => {
    const connectionByAgent = new Map<string, AgentConnection>();
    for (const agent of agentsQuery.data ?? []) {
      const persona = personasQuery.data?.find((p) => p.id === agent.personaId);
      const marker =
        agent.envVars[AGENT_CONNECTION_ENV_KEY] ??
        persona?.envVars[AGENT_CONNECTION_ENV_KEY];
      connectionByAgent.set(
        normalizePubkey(agent.pubkey),
        parseAgentConnection(marker) ?? "subscription",
      );
    }
    const byChannel = new Map<string, ChannelCacheEntry>();
    for (const head of headsQuery.data ?? []) {
      const connection = connectionByAgent.get(
        normalizePubkey(head.agentPubkey),
      );
      if (!connection) continue; // not an agent managed on this device
      const current = byChannel.get(head.channelId);
      if (!current || current.head.reportedAt < head.reportedAt) {
        byChannel.set(head.channelId, { head, connection });
      }
    }
    return byChannel;
  }, [agentsQuery.data, headsQuery.data, personasQuery.data]);
}
