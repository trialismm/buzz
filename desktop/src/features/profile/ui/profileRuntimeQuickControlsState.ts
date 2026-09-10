import type {
  AgentPersona,
  UpdatePersonaInput,
} from "@/shared/api/personaTypes";
import type { AcpRuntimeCatalogEntry, ManagedAgent } from "@/shared/api/types";

export type ProfileRuntimeQuickControlsState = {
  /** Owner is viewing the exact local record this profile belongs to. */
  visible: boolean;
  /** Absent when the record reports no agent command (rule: never synthesize). */
  harness: { label: string; editable: boolean } | null;
};

/**
 * Decide whether the profile hero shows the runtime quick controls
 * (harness / model / effort pills) and how the harness pill presents.
 *
 * Only the owner of the exact managed record gets controls, and only values
 * the record actually reports are shown — the Model and Effort pills gate
 * themselves on live data.
 */
export function profileRuntimeQuickControlsState(input: {
  managedAgent: Pick<ManagedAgent, "agentCommand"> | undefined;
  isOwner: boolean | undefined;
  canEditAgent: boolean;
  runtimeLabel: (command: string) => string;
}): ProfileRuntimeQuickControlsState {
  const { managedAgent, isOwner, canEditAgent, runtimeLabel } = input;
  if (isOwner !== true || managedAgent === undefined) {
    return { visible: false, harness: null };
  }
  const command = managedAgent.agentCommand.trim();
  return {
    visible: true,
    harness:
      command.length > 0
        ? { label: runtimeLabel(command), editable: canEditAgent }
        : null,
  };
}

/**
 * The catalog entry the record currently runs, matched the same way the
 * instance edit dialog re-derives its runtime id: by command first, then id.
 */
export function currentRuntimeEntry<
  T extends Pick<AcpRuntimeCatalogEntry, "id" | "command">,
>(runtimes: readonly T[], agentCommand: string): T | undefined {
  const command = agentCommand.trim();
  if (command.length === 0) return undefined;
  return (
    runtimes.find((runtime) => runtime.command?.trim() === command) ??
    runtimes.find((runtime) => runtime.id === command)
  );
}

/**
 * Where a model pick must be written so it actually takes effect.
 *
 * A persona-linked instance resolves its model from the definition
 * (`resolve_linked` in Rust ignores `record.model`), so the write goes to the
 * persona and is then propagated to the instance exactly like the profile's
 * persona editor does. A definition-less record owns its own `model`.
 */
export function modelWriteTarget(
  agent: Pick<ManagedAgent, "personaId">,
  persona: AgentPersona | undefined,
):
  | { kind: "persona"; persona: AgentPersona }
  | { kind: "instance" }
  | { kind: "unavailable"; reason: "personaNotLoaded" } {
  if (agent.personaId === null) return { kind: "instance" };
  if (persona === undefined) {
    return { kind: "unavailable", reason: "personaNotLoaded" };
  }
  return { kind: "persona", persona };
}

/**
 * Build the full-record persona update the backend expects, changing only the
 * model. Every other field echoes the stored value, so the write is idempotent
 * for them regardless of how the backend treats an absent field; `envVars` and
 * `behavior` are omitted on purpose — absent means "don't touch".
 */
/**
 * Full-record persona update that replaces only `envVars` (present = replace
 * the stored map). Used by env-carried settings such as the permission mode so
 * a linked agent's value lives on the definition, where its Edit dialog reads it.
 */
export function personaEnvVarsUpdateInput(
  persona: AgentPersona,
  envVars: Record<string, string>,
): UpdatePersonaInput {
  return {
    ...personaModelUpdateInput(persona, persona.model),
    envVars: { ...envVars },
  };
}

export function personaModelUpdateInput(
  persona: AgentPersona,
  model: string | null,
): UpdatePersonaInput {
  return {
    id: persona.id,
    displayName: persona.displayName,
    avatarUrl: persona.avatarUrl ?? undefined,
    description: persona.description,
    systemPrompt: persona.systemPrompt,
    runtime: persona.runtime ?? undefined,
    model: model ?? undefined,
    provider: persona.provider ?? undefined,
    namePool: [...persona.namePool],
  };
}

export type RestartNotice =
  | { kind: "nextStart" }
  | { kind: "autoRestart"; description: string }
  | { kind: "manualRestart"; description: string };

/**
 * What a persisted config write means for the running agent, worded to match
 * the app's actual auto-restart policy: it fires only after the agent has been
 * idle for ~3 minutes with `needsRestart` set (`AUTO_RESTART_QUIESCENCE_MS`),
 * never immediately. Saying "restarting…" would describe a restart that is not
 * happening yet.
 */
export function restartNoticeFor(
  agent: Pick<ManagedAgent, "status" | "autoRestartOnConfigChange">,
): RestartNotice {
  const isRunning = agent.status === "running" || agent.status === "deployed";
  if (!isRunning) return { kind: "nextStart" };
  return agent.autoRestartOnConfigChange
    ? {
        kind: "autoRestart",
        description: "Auto-restarts after ~3 minutes idle, or restart now.",
      }
    : { kind: "manualRestart", description: "Restart the agent to apply." };
}
