import type * as React from "react";
import {
  type AgentConnector,
  CONNECTOR_KIND_LABELS,
  connectorTarget,
} from "@/features/agents/lib/agentConnectors";
import type { ExtensionEntry } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";

type McpServersSectionProps = {
  extensions: ExtensionEntry[];
  runtimeId: string | null;
  mcpConfigFilePath?: string | null;
  /** Connectors from the agent's persona (`lib/agentConnectors.ts`). */
  personaConnectors?: AgentConnector[];
  variant?: "compact" | "profile";
  buzzAgentSlot?: React.ReactNode;
};

export function shouldRenderMcpServers(
  runtimeId: string | null,
  extensions: ExtensionEntry[],
  personaConnectors: AgentConnector[] = [],
): boolean {
  // buzz-agent always surfaces its built-in MCP servers even with no
  // user-configured extensions; every other runtime shows the section only
  // once it has extensions parsed from its config file or persona Connectors.
  return (
    runtimeId === "buzz-agent" ||
    extensions.length > 0 ||
    personaConnectors.length > 0
  );
}

// #3493: the servers are read from the isolated `.claude.json` under a custom
// `CLAUDE_CONFIG_DIR`. Attribute them to that actual file so the panel never
// implies the default `~/.claude.json` when isolation is in effect.
export function mcpConfigFileCaption(
  mcpConfigFilePath: string | null | undefined,
): string | null {
  return mcpConfigFilePath ? `From config file (${mcpConfigFilePath})` : null;
}

export function McpServersSection({
  buzzAgentSlot,
  extensions,
  mcpConfigFilePath,
  personaConnectors = [],
  runtimeId,
  variant = "compact",
}: McpServersSectionProps) {
  const isBuzzAgent = runtimeId === "buzz-agent";

  if (!shouldRenderMcpServers(runtimeId, extensions, personaConnectors)) {
    return null;
  }

  const fileCaption = mcpConfigFileCaption(mcpConfigFilePath);

  return (
    <div
      className={cn(
        variant === "compact"
          ? "mt-3 border-t border-border/50 pt-2"
          : "divide-y divide-border/55",
      )}
    >
      {variant === "compact" ? (
        <p className="py-2 text-xs font-medium text-foreground">MCP servers</p>
      ) : null}

      {isBuzzAgent && buzzAgentSlot ? buzzAgentSlot : null}

      {personaConnectors.length > 0 ? (
        <div className="divide-y divide-border/55">
          {personaConnectors.map((connector) => (
            <PersonaConnectorRow
              connector={connector}
              key={`persona:${connector.name}`}
              variant={variant}
            />
          ))}
          <p
            className={cn(
              "truncate text-xs text-muted-foreground/70",
              variant === "compact" ? "py-1" : "px-4 py-2",
            )}
          >
            From the agent's persona (Connectors)
          </p>
        </div>
      ) : null}

      {extensions.length > 0 ? (
        <div className="divide-y divide-border/55">
          {extensions.map((extension) => (
            <McpServerRow
              extension={extension}
              key={`${extension.kind}:${extension.name}`}
              variant={variant}
            />
          ))}
        </div>
      ) : personaConnectors.length === 0 ? (
        <p
          className={cn(
            "text-sm text-muted-foreground",
            variant === "compact"
              ? "py-2"
              : "flex min-h-16 items-center px-4 py-3",
          )}
        >
          No custom servers configured.
        </p>
      ) : null}

      {extensions.length > 0 && fileCaption ? (
        <p
          className={cn(
            "truncate text-xs text-muted-foreground/70",
            variant === "compact" ? "py-1" : "px-4 py-2",
          )}
        >
          {fileCaption}
        </p>
      ) : null}
    </div>
  );
}

function McpServerRow({
  extension,
  variant,
}: {
  extension: ExtensionEntry;
  variant: "compact" | "profile";
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3",
        variant === "compact" ? "py-2" : "min-h-16 px-4 py-3",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {extension.name}
        </span>
        <span className="mt-0.5 block truncate text-sm text-muted-foreground/70">
          {extension.kind}
        </span>
      </span>
      <span className="shrink-0 text-sm text-muted-foreground">
        {extension.enabled ? "Enabled" : "Disabled"}
      </span>
    </div>
  );
}

function PersonaConnectorRow({
  connector,
  variant,
}: {
  connector: AgentConnector;
  variant: "compact" | "profile";
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3",
        variant === "compact" ? "py-2" : "min-h-11 px-4 py-2",
      )}
      data-testid={`mcp-persona-connector-${connector.name}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {connector.name}
        </span>
        <span
          className="mt-0.5 block truncate font-mono text-xs text-muted-foreground/70"
          title={connectorTarget(connector)}
        >
          {connectorTarget(connector)}
        </span>
      </span>
      <span className="shrink-0 text-sm text-muted-foreground">
        {CONNECTOR_KIND_LABELS[connector.kind]}
      </span>
    </div>
  );
}
