/**
 * Persona Connectors: MCP servers every session of an agent gets, on top of
 * the built-in dev MCP server. Carried on the persona env as JSON under
 * `BUZZ_ACP_MCP_SERVERS` — the same local-only tier as the other
 * env-carried choices (permission mode, tool policy, connection), so a
 * header or env value that is a token never reaches the relay
 * (`persona_event_content` publishes no env). The harness
 * (`crates/buzz-acp/src/connectors.rs`) parses the same shape and appends the
 * entries to `session/new`'s `mcpServers`; claude-agent-acp and codex-acp
 * accept both kinds, buzz-agent takes local commands only.
 */
export const AGENT_CONNECTORS_ENV_KEY = "BUZZ_ACP_MCP_SERVERS";

/** The built-in server's name; a connector may not shadow it. */
export const RESERVED_CONNECTOR_NAMES: readonly string[] = ["buzz-dev-mcp"];

export type StdioConnector = {
  kind: "stdio";
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
};

export type HttpConnector = {
  kind: "http";
  name: string;
  url: string;
  headers: Record<string, string>;
};

export type AgentConnector = StdioConnector | HttpConnector;

export type ConnectorKind = AgentConnector["kind"];

export const CONNECTOR_KIND_LABELS: Record<ConnectorKind, string> = {
  stdio: "Local command",
  http: "HTTP server",
};

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string" && k.trim()) out[k.trim()] = v;
  }
  return out;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/** One entry from stored JSON, or `null` when it is not a connector. */
export function parseConnector(value: unknown): AgentConnector | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const name = typeof v.name === "string" ? v.name.trim() : "";
  if (!name) return null;
  if (v.kind === "stdio") {
    const command = typeof v.command === "string" ? v.command.trim() : "";
    return {
      kind: "stdio",
      name,
      command,
      args: stringList(v.args),
      env: stringMap(v.env),
    };
  }
  if (v.kind === "http") {
    const url = typeof v.url === "string" ? v.url.trim() : "";
    return { kind: "http", name, url, headers: stringMap(v.headers) };
  }
  return null;
}

/** The connectors an env map carries; malformed JSON reads as none. */
export function readAgentConnectors(
  envVars: Record<string, string>,
): AgentConnector[] {
  const raw = envVars[AGENT_CONNECTORS_ENV_KEY];
  if (!raw || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseConnector)
      .filter((c): c is AgentConnector => c !== null);
  } catch {
    return [];
  }
}

/** Write `connectors` onto the env map; an empty list removes the key. */
export function withAgentConnectors(
  envVars: Record<string, string>,
  connectors: AgentConnector[],
): Record<string, string> {
  const next = { ...envVars };
  if (connectors.length === 0) {
    delete next[AGENT_CONNECTORS_ENV_KEY];
  } else {
    next[AGENT_CONNECTORS_ENV_KEY] = JSON.stringify(connectors);
  }
  return next;
}

/** Keys the raw env editor hides because the Connectors field owns them. */
export function connectorHiddenEnvKeys(): string[] {
  return [AGENT_CONNECTORS_ENV_KEY];
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/**
 * Why `name` cannot be used, or `null` when it can. Mirrors the harness:
 * letters, digits, `_`, `-`, `.`; no `__`; not the built-in server; not
 * already taken (`taken` excludes the connector being edited).
 */
export function connectorNameError(
  name: string,
  taken: readonly string[],
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Name is required.";
  if (!NAME_PATTERN.test(trimmed)) {
    return "Use letters, digits, '_', '-' or '.' (max 64), starting with a letter or digit.";
  }
  if (trimmed.includes("__")) return "Name may not contain '__'.";
  if (RESERVED_CONNECTOR_NAMES.includes(trimmed)) {
    return `${trimmed} is the built-in server.`;
  }
  if (taken.includes(trimmed))
    return "Another connector already uses this name.";
  return null;
}

/** All problems with a connector draft; empty when it can be saved. */
export function connectorErrors(
  connector: AgentConnector,
  taken: readonly string[],
): string[] {
  const errors: string[] = [];
  const nameError = connectorNameError(connector.name, taken);
  if (nameError) errors.push(nameError);
  if (connector.kind === "stdio") {
    if (!connector.command.trim()) errors.push("Command is required.");
  } else if (!/^https?:\/\/\S+$/.test(connector.url.trim())) {
    errors.push("URL must start with http:// or https://.");
  }
  return errors;
}

/**
 * Split a command-line style argument string on whitespace, honouring
 * single and double quotes so `--path "My Dir"` stays one argument.
 */
export function parseArgs(text: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let hasToken = false;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasToken) {
        args.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (hasToken) args.push(current);
  return args;
}

/** Render arguments for editing: quote the ones that contain spaces. */
export function formatArgs(args: string[]): string {
  return args
    .map((arg) =>
      /\s/.test(arg) || arg === "" ? `"${arg.replace(/"/g, '\\"')}"` : arg,
    )
    .join(" ");
}

/**
 * Parse `KEY=value` (env) or `Name: value` (headers) lines. Blank lines are
 * skipped; a line without a separator is returned in `invalid`.
 */
export function parseKeyValueLines(
  text: string,
  separator: "=" | ":",
): { map: Record<string, string>; invalid: string[] } {
  const map: Record<string, string> = {};
  const invalid: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const at = line.indexOf(separator);
    const key = at > 0 ? line.slice(0, at).trim() : "";
    if (!key) {
      invalid.push(line);
      continue;
    }
    map[key] = line.slice(at + 1).trim();
  }
  return { map, invalid };
}

export function formatKeyValueLines(
  map: Record<string, string>,
  separator: "=" | ":",
): string {
  return Object.entries(map)
    .map(([k, v]) => (separator === "=" ? `${k}=${v}` : `${k}: ${v}`))
    .join("\n");
}

/** One-line description of where a connector points, with no secrets. */
export function connectorTarget(connector: AgentConnector): string {
  if (connector.kind === "stdio") {
    return [connector.command, ...connector.args].join(" ");
  }
  try {
    const url = new URL(connector.url);
    return `${url.origin}${url.pathname}`;
  } catch {
    return connector.url;
  }
}
