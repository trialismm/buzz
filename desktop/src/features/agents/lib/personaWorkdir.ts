/**
 * Persona working directory: the shared nest (`~/.buzz`), or the persona's
 * own mini-nest under `<nest>/personas/<id>/` that also holds its Skills.
 * Carried on the persona env as `BUZZ_PERSONA_WORKDIR=own` — the same
 * local-only tier as the other env-carried choices, so switching it fires
 * the restart badge and never reaches the relay. The Desktop reads the
 * marker at spawn (`managed_agents/persona_workdir.rs`) and starts the
 * harness in that folder; each harness then discovers the folder's skills
 * by its own convention (`.claude/skills`, `.codex/skills`, `.goose/skills`,
 * `.agents/skills`).
 */
export const PERSONA_WORKDIR_ENV_KEY = "BUZZ_PERSONA_WORKDIR";

export type PersonaWorkdirMode = "shared" | "own";

export const PERSONA_WORKDIR_LABELS: Record<PersonaWorkdirMode, string> = {
  shared: "Shared nest",
  own: "Own folder (with Skills)",
};

export function readPersonaWorkdir(
  envVars: Record<string, string>,
): PersonaWorkdirMode {
  return envVars[PERSONA_WORKDIR_ENV_KEY]?.trim().toLowerCase() === "own"
    ? "own"
    : "shared";
}

/** `shared` removes the marker; `own` sets it. */
export function withPersonaWorkdir(
  envVars: Record<string, string>,
  mode: PersonaWorkdirMode,
): Record<string, string> {
  const next = { ...envVars };
  if (mode === "own") {
    next[PERSONA_WORKDIR_ENV_KEY] = "own";
  } else {
    delete next[PERSONA_WORKDIR_ENV_KEY];
  }
  return next;
}

/** Keys the raw env editor hides because the Working directory field owns them. */
export function personaWorkdirHiddenEnvKeys(): string[] {
  return [PERSONA_WORKDIR_ENV_KEY];
}
