import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, FolderPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  PERSONA_WORKDIR_LABELS,
  type PersonaWorkdirMode,
  readPersonaWorkdir,
  withPersonaWorkdir,
} from "@/features/agents/lib/personaWorkdir";
import {
  addPersonaSkill,
  getPersonaWorkdir,
  type PersonaWorkdirInfo,
  removePersonaSkill,
  revealPersonaWorkdir,
} from "@/shared/api/personaSkills";
import { Button } from "@/shared/ui/button";
import { PERSONA_LABEL_OPTIONAL_CLASS } from "./agentConfigOptions";
import type { EnvVarsValue } from "./EnvVarsEditor";
import { PersonaDropdownField } from "./PersonaDropdownField";

export const personaWorkdirKey = (personaId: string) =>
  ["persona-workdir", personaId] as const;

/**
 * Working directory select bound to the persona env (see
 * `lib/personaWorkdir.ts`), plus the Skills panel for a saved persona that
 * runs in its own folder: the skills under `.agents/skills`, a Finder
 * button, and a folder picker to import one.
 */
export function PersonaWorkdirField({
  disabled,
  envVars,
  id,
  onEnvVarsChange,
  personaId,
}: {
  disabled?: boolean;
  envVars: EnvVarsValue;
  id: string;
  onEnvVarsChange: (next: EnvVarsValue) => void;
  /** The saved persona's id; `null` while the persona is still being created. */
  personaId: string | null;
}) {
  const mode = readPersonaWorkdir(envVars);
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground" htmlFor={id}>
          Working directory
          <span className={PERSONA_LABEL_OPTIONAL_CLASS}>Optional</span>
        </label>
        <PersonaDropdownField
          disabled={disabled}
          id={id}
          onValueChange={(value) =>
            onEnvVarsChange(
              withPersonaWorkdir(
                envVars,
                (value as PersonaWorkdirMode) === "own" ? "own" : "shared",
              ),
            )
          }
          options={(
            Object.keys(PERSONA_WORKDIR_LABELS) as PersonaWorkdirMode[]
          ).map((value) => ({ label: PERSONA_WORKDIR_LABELS[value], value }))}
          placeholder={PERSONA_WORKDIR_LABELS.shared}
          value={mode}
        />
        <p className="text-xs text-muted-foreground">
          {mode === "own"
            ? "Agents from this persona start in their own folder under the nest — the same layout, plus Skills only they see. Applied at the next start."
            : "Agents from this persona start in the shared nest and see only its built-in skill."}
        </p>
      </div>
      {mode === "own" ? (
        personaId ? (
          <PersonaSkillsPanel
            disabled={disabled}
            id={id}
            personaId={personaId}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            Save the agent first, then add Skills to its folder from Edit agent.
          </p>
        )
      ) : null}
    </div>
  );
}

function PersonaSkillsPanel({
  disabled,
  id,
  personaId,
}: {
  disabled?: boolean;
  id: string;
  personaId: string;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: personaWorkdirKey(personaId),
    queryFn: () => getPersonaWorkdir(personaId),
  });
  const setInfo = (info: PersonaWorkdirInfo) =>
    queryClient.setQueryData(personaWorkdirKey(personaId), info);
  const addMutation = useMutation({
    mutationFn: () => addPersonaSkill(personaId),
    onSuccess: setInfo,
    onError: (error) =>
      toast.error(errorText(error, "Could not add the skill.")),
  });
  const removeMutation = useMutation({
    mutationFn: (folder: string) => removePersonaSkill(personaId, folder),
    onSuccess: setInfo,
    onError: (error) =>
      toast.error(errorText(error, "Could not remove the skill.")),
  });
  const busy = disabled || addMutation.isPending || removeMutation.isPending;
  const skills = query.data?.skills ?? [];

  return (
    <div className="space-y-2" data-testid={`${id}-skills`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Skills
        </span>
        <span
          className="min-w-0 truncate font-mono text-2xs text-muted-foreground/70"
          title={query.data?.path}
        >
          {query.data?.path ?? ""}
        </span>
      </div>
      {query.error instanceof Error ? (
        <p className="text-xs text-destructive">{query.error.message}</p>
      ) : null}
      {skills.length > 0 ? (
        <ul className="divide-y divide-border/55 rounded-lg border border-border/60">
          {skills.map((skill) => (
            <li
              className="flex items-center gap-3 px-3 py-2"
              data-testid={`${id}-skill-${skill.folder}`}
              key={skill.folder}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {skill.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground/70">
                  {skill.description || skill.folder}
                </span>
              </span>
              <Button
                aria-label={`Remove skill ${skill.name}`}
                disabled={busy}
                onClick={() => removeMutation.mutate(skill.folder)}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : query.isSuccess ? (
        <p className="text-xs text-muted-foreground">
          No skills yet. Add a folder that contains a SKILL.md (with a{" "}
          <code>name</code> in its frontmatter); it is copied into the persona's
          folder and linked for every harness.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid={`${id}-add-skill`}
          disabled={busy}
          onClick={() => addMutation.mutate()}
          size="sm"
          type="button"
          variant="outline"
        >
          <FolderPlus aria-hidden="true" className="h-3.5 w-3.5" />
          Add skill…
        </Button>
        <Button
          disabled={disabled}
          onClick={() =>
            void revealPersonaWorkdir(personaId).catch((error) =>
              toast.error(errorText(error, "Could not open the folder.")),
            )
          }
          size="sm"
          type="button"
          variant="ghost"
        >
          <FolderOpen aria-hidden="true" className="h-3.5 w-3.5" />
          Open folder
        </Button>
      </div>
    </div>
  );
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
