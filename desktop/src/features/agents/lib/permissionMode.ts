/**
 * Permission mode for a managed agent's harness session.
 *
 * `buzz-acp` reads it from `BUZZ_ACP_PERMISSION_MODE` at spawn and applies it
 * to every session it opens (`--permission-mode`, default `bypassPermissions`).
 *
 * Labels describe the *effective* behavior under buzz-acp, not Claude Code's
 * interactive semantics: the harness answers every `session/request_permission`
 * with `allow_once` (see `crates/buzz-acp/src/acp.rs`, `handle_permission_request`),
 * so modes that "ask" end up allowing. Only `dontAsk` and `plan` actually
 * restrict what the agent can do — which is why pickers offer exactly three
 * choices (`SELECTABLE_PERMISSION_MODES`) while the parser keeps accepting all
 * six values the harness understands.
 * Desktop carries the value as an ordinary env var on the definition/instance
 * `envVars` — the key is deliberately not reserved, so it flows through the
 * existing env resolution (definition tier, then the instance's own env), the
 * spawn snapshot (so an edit raises the restart badge), and the create/update
 * IPC without a dedicated column. This module is the single place that knows
 * the key and the value vocabulary; UI reads and writes only through it.
 */
export const PERMISSION_MODE_ENV_KEY = "BUZZ_ACP_PERMISSION_MODE";

/** What the harness uses when the env var is absent. */
export const HARNESS_DEFAULT_PERMISSION_MODE = "bypassPermissions";

export type PermissionMode =
  | "default"
  | "auto"
  | "acceptEdits"
  | "bypassPermissions"
  | "dontAsk"
  | "plan";

/**
 * Wire values in ACP spelling (what the running session reports as `mode`).
 * `buzz-acp`'s clap enum accepts these as aliases of its kebab-case names.
 */
export const PERMISSION_MODES: readonly {
  value: PermissionMode;
  label: string;
  description: string;
  /** Offered in pickers. Modes that only *ask* collapse into Run everything under buzz-acp. */
  selectable: boolean;
}[] = [
  {
    value: "bypassPermissions",
    label: "Run everything",
    description:
      "Every tool runs with no permission check. This is the harness default.",
    selectable: true,
  },
  {
    value: "dontAsk",
    label: "Read-only",
    description:
      "Anything that would need a permission prompt — file edits, shell commands, web access — is refused outright. Reading and searching still work.",
    selectable: true,
  },
  {
    value: "plan",
    label: "Plan only",
    description: "Reasons and drafts a plan without executing any tool.",
    selectable: true,
  },
  {
    value: "default",
    label: "Standard (legacy)",
    description:
      "Claude Code would prompt before risky tools, but the harness auto-approves every prompt, so this behaves like Run everything with an extra round-trip per tool.",
    selectable: false,
  },
  {
    value: "acceptEdits",
    label: "Auto-approve edits (legacy)",
    description:
      "Edits skip the prompt and every other prompt is auto-approved by the harness — behaves like Run everything.",
    selectable: false,
  },
  {
    value: "auto",
    label: "Auto (legacy)",
    description:
      "Model-gated autonomy that falls back to Standard, which the harness auto-approves — behaves like Run everything.",
    selectable: false,
  },
];

/** The three modes that actually differ under buzz-acp, in picker order. */
export const SELECTABLE_PERMISSION_MODES = PERMISSION_MODES.filter(
  (mode) => mode.selectable,
);

/**
 * A stored value that the pickers no longer offer. Shown as-is (with its
 * legacy label) until the user picks one of the three real choices.
 */
export function isLegacyPermissionMode(mode: PermissionMode | null): boolean {
  return (
    mode !== null && !SELECTABLE_PERMISSION_MODES.some((m) => m.value === mode)
  );
}

const KEBAB_ALIASES: Record<string, PermissionMode> = {
  "accept-edits": "acceptEdits",
  "bypass-permissions": "bypassPermissions",
  "dont-ask": "dontAsk",
};

/** Accepts ACP spelling or the harness's kebab-case; anything else is `null`. */
export function parsePermissionMode(
  raw: string | null | undefined,
): PermissionMode | null {
  const trimmed = raw?.trim() ?? "";
  if (trimmed.length === 0) return null;
  const known = PERMISSION_MODES.find((m) => m.value === trimmed);
  if (known) return known.value;
  return KEBAB_ALIASES[trimmed] ?? null;
}

/** The mode carried by an env map, or `null` when unset/unrecognized. */
export function readPermissionMode(
  envVars: Readonly<Record<string, string>> | null | undefined,
): PermissionMode | null {
  return parsePermissionMode(envVars?.[PERMISSION_MODE_ENV_KEY]);
}

/**
 * A copy of `envVars` with the mode set, or with the key removed for `null`
 * (meaning "harness default"). Never mutates the input.
 */
export function withPermissionMode(
  envVars: Readonly<Record<string, string>> | null | undefined,
  mode: PermissionMode | null,
): Record<string, string> {
  const next: Record<string, string> = { ...(envVars ?? {}) };
  if (mode === null) {
    delete next[PERMISSION_MODE_ENV_KEY];
  } else {
    next[PERMISSION_MODE_ENV_KEY] = mode;
  }
  return next;
}

export function permissionModeLabel(mode: PermissionMode | null): string {
  if (mode === null) return "Harness default";
  return PERMISSION_MODES.find((m) => m.value === mode)?.label ?? mode;
}
