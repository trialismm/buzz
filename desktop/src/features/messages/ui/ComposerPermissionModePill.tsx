import * as React from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import {
  useManagedAgentsQuery,
  usePersonasQuery,
} from "@/features/agents/hooks";
import {
  SELECTABLE_PERMISSION_MODES,
  parsePermissionMode,
  permissionModeLabel,
} from "@/features/agents/lib/permissionMode";
import { resolveSessionPermissionMode } from "@/features/agents/lib/sessionPermissionModeState";
import { useChannelMembersQuery } from "@/features/channels/hooks";
import {
  setComposerPermissionMode,
  useComposerPermissionMode,
} from "@/features/messages/lib/composerPermissionMode";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

/**
 * Composer-level permission mode for the agents this channel's messages wake.
 * The pick is per channel and sticky; every message sent from the channel
 * carries it as a `buzz:permission-mode` tag, which the harness applies to
 * the mentioned agents from that turn on (session tier: it outranks the
 * agent's configured mode until the agent restarts). Hidden when the channel
 * has no locally managed agent — nothing would read the tag.
 */
export function ComposerPermissionModePill({
  channelId,
  disabled,
  preferredAgentPubkey,
}: {
  channelId: string | null;
  disabled: boolean;
  /** Addressed agent, when one is locked — its configuration is the baseline shown. */
  preferredAgentPubkey?: string | null;
}) {
  const membersQuery = useChannelMembersQuery(channelId);
  const agentsQuery = useManagedAgentsQuery();
  const personasQuery = usePersonasQuery();
  const choice = useComposerPermissionMode(channelId);

  const preferred = preferredAgentPubkey
    ? normalizePubkey(preferredAgentPubkey)
    : null;
  // Managed agents this composer can reach: channel members, plus the agent
  // the parent explicitly addresses (project home adds it as a member on the
  // first send, so the member list alone would hide the pill until then).
  const localAgents = React.useMemo(() => {
    const memberKeys = new Set(
      (membersQuery.data ?? []).map((member) => normalizePubkey(member.pubkey)),
    );
    return (agentsQuery.data ?? []).filter((agent) => {
      const key = normalizePubkey(agent.pubkey);
      return memberKeys.has(key) || key === preferred;
    });
  }, [agentsQuery.data, membersQuery.data, preferred]);

  if (!channelId || localAgents.length === 0) return null;
  const subject =
    localAgents.find(
      (agent) =>
        preferred !== null && normalizePubkey(agent.pubkey) === preferred,
    ) ?? localAgents[0];
  const persona = subject.personaId
    ? personasQuery.data?.find((p) => p.id === subject.personaId)
    : undefined;
  const resolved = resolveSessionPermissionMode({
    override: choice,
    instanceEnv: subject.envVars,
    personaEnv: persona?.envVars,
    live: null,
  });
  const label = permissionModeLabel(resolved.mode);
  const baseline =
    resolved.source === "session"
      ? "Set here for this channel"
      : `${subject.name}'s configured mode`;

  return (
    <DropdownMenu modal={false}>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={`Permission mode: ${label}`}
              className="inline-flex h-8 max-w-44 items-center gap-1 rounded-full border border-border/60 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              data-testid="composer-permission-mode"
              disabled={disabled}
              type="button"
            >
              <ShieldCheck
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0"
              />
              <span className="truncate">{label}</span>
              <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          Permission mode for the agents you mention · {baseline}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Mode for agents mentioned in this channel
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={resolved.mode}
          onValueChange={(value) => {
            const picked = parsePermissionMode(value);
            if (picked) setComposerPermissionMode(channelId, picked);
          }}
        >
          {SELECTABLE_PERMISSION_MODES.map((mode) => (
            <DropdownMenuRadioItem
              className="items-start"
              data-testid={`composer-permission-mode-${mode.value}`}
              key={mode.value}
              value={mode.value}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{mode.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {mode.description}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
          Sent with each message; applies to the mentioned agents from that turn
          on and outranks their configured mode until they restart.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
