/**
 * Owner tool policy for a managed agent: Claude Code permission rules
 * (`Write`, `Bash(git push:*)`, `Edit(src/**)`) carried as the env var
 * `BUZZ_ACP_TOOL_POLICY` = JSON `{"allow":[…],"deny":[…]}`. buzz-acp applies
 * the rules natively through the Claude adapter's session meta and rejects
 * matching prompts at its own permission seam. Same env tiers as the
 * permission mode: persona env (definition), instance env (wins at spawn).
 */
export const TOOL_POLICY_ENV_KEY = "BUZZ_ACP_TOOL_POLICY";

export type ToolPolicy = {
  allow: string[];
  deny: string[];
};

export const EMPTY_TOOL_POLICY: ToolPolicy = { allow: [], deny: [] };

/** `Tool` or `Tool(specifier)`; MCP tool names (`mcp__server__tool`) included. */
const RULE_PATTERN = /^[A-Za-z0-9_-]+(\([^()]*\))?$/;

export function isValidToolRule(rule: string): boolean {
  return RULE_PATTERN.test(rule.trim());
}

/** Rules one per line (blank lines ignored); the invalid ones are returned. */
export function parseToolRules(text: string): {
  rules: string[];
  invalid: string[];
} {
  const rules: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const rule = raw.trim();
    if (!rule) continue;
    if (isValidToolRule(rule)) {
      if (!rules.includes(rule)) rules.push(rule);
    } else {
      invalid.push(rule);
    }
  }
  return { rules, invalid };
}

export function readToolPolicy(
  envVars: Record<string, string> | null | undefined,
): ToolPolicy {
  const raw = envVars?.[TOOL_POLICY_ENV_KEY];
  if (!raw?.trim()) return EMPTY_TOOL_POLICY;
  try {
    const parsed = JSON.parse(raw) as { allow?: unknown; deny?: unknown };
    const list = (value: unknown) =>
      Array.isArray(value)
        ? value.filter(
            (v): v is string => typeof v === "string" && isValidToolRule(v),
          )
        : [];
    return { allow: list(parsed.allow), deny: list(parsed.deny) };
  } catch {
    return EMPTY_TOOL_POLICY;
  }
}

/** An empty policy removes the key rather than storing `{}`. */
export function withToolPolicy(
  envVars: Record<string, string>,
  policy: ToolPolicy,
): Record<string, string> {
  const next = { ...envVars };
  if (policy.allow.length === 0 && policy.deny.length === 0) {
    delete next[TOOL_POLICY_ENV_KEY];
    return next;
  }
  next[TOOL_POLICY_ENV_KEY] = JSON.stringify({
    allow: policy.allow,
    deny: policy.deny,
  });
  return next;
}

export function toolPolicyIsEmpty(policy: ToolPolicy): boolean {
  return policy.allow.length === 0 && policy.deny.length === 0;
}

/** Quick-add presets; each is a set of deny rules with a label. */
export const TOOL_POLICY_PRESETS: readonly {
  label: string;
  description: string;
  deny: readonly string[];
}[] = [
  {
    label: "No file changes",
    description: "Can read and run commands, but never writes or edits files.",
    deny: ["Write", "Edit", "MultiEdit", "NotebookEdit"],
  },
  {
    label: "No shell",
    description: "Never runs shell commands (the buzz CLI keeps working).",
    deny: ["Bash"],
  },
  {
    label: "No git push",
    description: "Commits locally but never pushes.",
    deny: ["Bash(git push:*)"],
  },
  {
    label: "No web",
    description: "No web fetches or searches.",
    deny: ["WebFetch", "WebSearch"],
  },
];

/** Add rules to a list, keeping order and skipping duplicates. */
export function addToolRules(
  current: readonly string[],
  added: readonly string[],
): string[] {
  const next = [...current];
  for (const rule of added) {
    if (!next.includes(rule)) next.push(rule);
  }
  return next;
}
