/**
 * How a managed agent's harness talks to its model vendor: the harness's own
 * login (a Claude or ChatGPT subscription) or an API key billed to the
 * owner's developer account. Carried on the same env tiers as the permission
 * mode — persona env (definition), instance env (wins at spawn); persona env
 * never leaves this device (`persona_event_content` publishes no env).
 *
 * Runtime facts this encodes (verified 2026-09-14 against the local CLIs):
 * - Claude Code honours `ANTHROPIC_API_KEY` over a live subscription login,
 *   no approval prompt in SDK mode.
 * - Codex prefers its ChatGPT login over `OPENAI_API_KEY`, so an API-key
 *   agent must run in a Codex home the login never touched — the Desktop
 *   sets `CODEX_HOME` at spawn when `BUZZ_AGENT_CONNECTION=api-key`.
 */
export const AGENT_CONNECTION_ENV_KEY = "BUZZ_AGENT_CONNECTION";

export type AgentConnection = "subscription" | "api-key";

export type ConnectionCatalogEntry = {
  runtimeId: string;
  /** Env var the harness's CLI reads the API key from. */
  apiKeyEnv: string;
  subscriptionLabel: string;
  apiKeyLabel: string;
  keyPlaceholder: string;
  /** True when the CLI would prefer its login over the key (Codex). */
  isolatedHome: boolean;
};

export const AGENT_CONNECTION_CATALOG: readonly ConnectionCatalogEntry[] = [
  {
    runtimeId: "claude",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    subscriptionLabel: "Claude subscription (harness login)",
    apiKeyLabel: "Anthropic API key",
    keyPlaceholder: "sk-ant-…",
    isolatedHome: false,
  },
  {
    runtimeId: "codex",
    apiKeyEnv: "OPENAI_API_KEY",
    subscriptionLabel: "ChatGPT login (harness login)",
    apiKeyLabel: "OpenAI API key",
    keyPlaceholder: "sk-…",
    isolatedHome: true,
  },
];

export function connectionCatalogFor(
  runtimeId: string | null | undefined,
): ConnectionCatalogEntry | null {
  const id = runtimeId?.trim().toLowerCase();
  if (!id) return null;
  return AGENT_CONNECTION_CATALOG.find((e) => e.runtimeId === id) ?? null;
}

export function parseAgentConnection(
  raw: string | null | undefined,
): AgentConnection | null {
  const v = raw?.trim().toLowerCase();
  if (v === "api-key" || v === "apikey" || v === "api_key") return "api-key";
  if (v === "subscription") return "subscription";
  return null;
}

/** The connection an env map configures for `runtimeId`; subscription when unset. */
export function readAgentConnection(
  envVars: Record<string, string> | null | undefined,
  runtimeId: string | null | undefined,
): {
  mode: AgentConnection;
  apiKey: string;
  entry: ConnectionCatalogEntry | null;
} {
  const entry = connectionCatalogFor(runtimeId);
  const mode =
    parseAgentConnection(envVars?.[AGENT_CONNECTION_ENV_KEY]) ?? "subscription";
  const apiKey = entry ? (envVars?.[entry.apiKeyEnv] ?? "") : "";
  return { mode, apiKey, entry };
}

/**
 * Write a connection choice. Subscription removes both keys (the harness
 * default); API key stores the marker and the key (an empty key keeps the
 * marker so the field can show the requirement).
 */
export function withAgentConnection(
  envVars: Record<string, string>,
  runtimeId: string | null | undefined,
  mode: AgentConnection,
  apiKey: string,
): Record<string, string> {
  const entry = connectionCatalogFor(runtimeId);
  const next = { ...envVars };
  if (mode === "subscription" || !entry) {
    delete next[AGENT_CONNECTION_ENV_KEY];
    if (entry) delete next[entry.apiKeyEnv];
    return next;
  }
  next[AGENT_CONNECTION_ENV_KEY] = "api-key";
  const trimmed = apiKey.trim();
  if (trimmed) next[entry.apiKeyEnv] = trimmed;
  else delete next[entry.apiKeyEnv];
  return next;
}

export function connectionLabel(mode: AgentConnection): string {
  return mode === "api-key" ? "API key" : "Subscription";
}

/** Env keys the Connection field owns; the raw env editor hides them. */
export function connectionHiddenEnvKeys(
  runtimeId: string | null | undefined,
): string[] {
  const entry = connectionCatalogFor(runtimeId);
  return entry
    ? [AGENT_CONNECTION_ENV_KEY, entry.apiKeyEnv]
    : [AGENT_CONNECTION_ENV_KEY];
}
