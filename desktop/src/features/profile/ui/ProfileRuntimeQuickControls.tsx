import { useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  ChevronDown,
  Gauge,
  KeyRound,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import React from "react";
import { toast } from "sonner";

import {
  agentConfigSurfaceQueryKey,
  useAcpRuntimesQuery,
  useAgentConfigSurface,
  usePersonasQuery,
  useUpdateManagedAgentMutation,
  useUpdatePersonaMutation,
} from "@/features/agents/hooks";
import { resolveModelLabel } from "@/features/agents/lib/formatAgentModelLabel";
import {
  HARNESS_DEFAULT_PERMISSION_MODE,
  isLegacyPermissionMode,
  parsePermissionMode,
  permissionModeLabel,
  readPermissionMode,
  SELECTABLE_PERMISSION_MODES,
  withPermissionMode,
  type PermissionMode,
} from "@/features/agents/lib/permissionMode";
import {
  formatRuntimeOptionLabel,
  sortPersonaRuntimes,
} from "@/features/agents/ui/agentConfigOptions";
import {
  effortPickerState,
  effortSelectionToPersistedValue,
} from "@/features/agents/ui/effortPicker";
import {
  connectionCatalogFor,
  connectionLabel,
  readAgentConnection,
} from "@/features/agents/lib/agentConnection";
import {
  effortOptionsKey,
  rememberEffortOptions,
  resolveEffortOptionsSource,
  useCachedEffortOptions,
} from "@/features/agents/lib/effortOptionsCache";
import { useManagedAgentRuntimeAction } from "@/features/agents/managedAgentRuntimeHooks";
import { getAgentModels } from "@/shared/api/tauri";
import type { AgentModelsResponse, ManagedAgent } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Spinner } from "@/shared/ui/spinner";
import {
  currentRuntimeEntry,
  modelWriteTarget,
  personaEnvVarsUpdateInput,
  personaModelUpdateInput,
  type ProfileRuntimeQuickControlsState,
  restartNoticeFor,
} from "./profileRuntimeQuickControlsState";
import { personaManagedAgentUpdate } from "./UserProfilePanelUtils";

/** One pill style for all three controls so they read as a single row. */
const PILL_CLASS =
  "h-7 max-w-full justify-start gap-1.5 rounded-full border border-border/50 bg-muted/45 px-2.5 text-xs font-medium text-foreground shadow-none hover:bg-muted/70";
const MENU_CLASS = "max-h-64 min-w-56 overflow-y-auto";
const MENU_NOTE_CLASS = "px-3 py-2 text-xs text-muted-foreground";
const HARNESS_DEFAULT_MODEL = "__harness_default__";

/**
 * Harness / Model / Effort pills rendered directly under the agent's name.
 *
 * Every pill writes through the same IPC the edit dialogs use:
 * - Harness pins an instance-level override (`update_managed_agent` with
 *   `agentCommand` + `harnessOverride`), then opens the Model menu so the
 *   model is re-chosen for the new harness.
 * - Model writes to the persona for a linked agent (its effective model is
 *   resolved from the definition) and propagates to the instance the way the
 *   profile's persona editor does; a definition-less record gets `model`.
 * - Effort writes `effortLevel` on the instance.
 */
export function ProfileRuntimeQuickControls({
  agent,
  harness,
}: {
  agent: ManagedAgent;
  harness: ProfileRuntimeQuickControlsState["harness"];
}) {
  const [modelMenuOpen, setModelMenuOpen] = React.useState(false);
  const runtimesQuery = useAcpRuntimesQuery();
  const runtimes = runtimesQuery.data ?? [];
  const runtimeAction = useManagedAgentRuntimeAction();
  // One "saved" toast for every pill. It states the real restart policy and
  // offers the immediate restart the policy itself never performs.
  const notifySaved = React.useCallback(
    (what: string) => {
      const notice = restartNoticeFor(agent);
      if (notice.kind === "nextStart") {
        toast.success(`${what} saved — applies when the agent next starts.`);
        return;
      }
      toast.success(`${what} saved.`, {
        description: notice.description,
        action: {
          label: "Restart now",
          onClick: () =>
            runtimeAction.mutate(
              {
                action: "restart",
                pubkey: agent.pubkey,
                relayUrl: agent.relayUrl,
              },
              {
                onError: (error) =>
                  toast.error(
                    error instanceof Error
                      ? `Restart failed: ${error.message}`
                      : "Restart failed.",
                  ),
              },
            ),
        },
      });
    },
    [agent, runtimeAction],
  );
  return (
    <div
      className="flex max-w-full flex-wrap items-center justify-center gap-1.5 pt-1"
      data-testid="user-profile-quick-controls"
    >
      {harness ? (
        <HarnessPill
          agent={agent}
          harness={harness}
          notifySaved={notifySaved}
          onChanged={() => setModelMenuOpen(true)}
          runtimes={runtimes}
        />
      ) : null}
      <ModelPill
        agent={agent}
        notifySaved={notifySaved}
        onOpenChange={setModelMenuOpen}
        open={modelMenuOpen}
        runtimes={runtimes}
      />
      <EffortQuickPicker agent={agent} notifySaved={notifySaved} />
      <ConnectionPill agent={agent} runtimes={runtimes} />
      <PermissionModePill
        agent={agent}
        notifySaved={notifySaved}
        runtimes={runtimes}
      />
    </div>
  );
}

/**
 * Read-only: how this agent reaches its model vendor (harness login vs an
 * API key), from the instance env then the persona env. Edited in the agent's
 * settings, since an API key needs typing rather than a menu pick.
 */
function ConnectionPill({
  agent,
  runtimes,
}: {
  agent: ManagedAgent;
  runtimes: ReturnType<typeof useAcpRuntimesQuery>["data"] & object;
}) {
  const personasQuery = usePersonasQuery();
  const runtimeId = currentRuntimeEntry(runtimes, agent.agentCommand)?.id;
  const entry = connectionCatalogFor(runtimeId);
  if (!entry) return null;
  const persona = personasQuery.data?.find((p) => p.id === agent.personaId);
  const merged = { ...(persona?.envVars ?? {}), ...agent.envVars };
  const { mode } = readAgentConnection(merged, runtimeId);
  const label = connectionLabel(mode);
  return (
    <span
      className={cn(PILL_CLASS, "inline-flex items-center")}
      data-testid="user-profile-quick-connection"
      title={
        mode === "api-key"
          ? `Billed to the ${entry.apiKeyLabel} account. Change it in the agent's settings.`
          : `${entry.subscriptionLabel}. Change it in the agent's settings.`
      }
    >
      <PillIcon icon={mode === "api-key" ? KeyRound : BadgeCheck} />
      <span className="truncate">{label}</span>
    </span>
  );
}

function PillIcon({ icon: Icon }: { icon: typeof Terminal }) {
  return (
    <Icon aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
  );
}

function HarnessPill({
  agent,
  harness,
  notifySaved,
  onChanged,
  runtimes,
}: {
  agent: ManagedAgent;
  harness: NonNullable<ProfileRuntimeQuickControlsState["harness"]>;
  notifySaved: (what: string) => void;
  onChanged: () => void;
  runtimes: ReturnType<typeof useAcpRuntimesQuery>["data"] & object;
}) {
  const updateAgent = useUpdateManagedAgentMutation();
  const current = currentRuntimeEntry(runtimes, agent.agentCommand);
  const label = current?.label ?? harness.label;
  const options = React.useMemo(
    () => sortPersonaRuntimes(runtimes).filter((r) => r.command !== null),
    [runtimes],
  );

  if (!harness.editable) {
    return (
      <span
        className={cn(PILL_CLASS, "inline-flex items-center hover:bg-muted/45")}
        data-testid="user-profile-quick-harness"
      >
        <PillIcon icon={Terminal} />
        <span className="sr-only">Harness: </span>
        <span className="truncate">{label}</span>
      </span>
    );
  }

  const handlePick = async (runtimeId: string) => {
    const next = options.find((r) => r.id === runtimeId);
    if (!next?.command || next.id === current?.id) return;
    try {
      // Same pin the instance edit dialog persists on Save: an explicit
      // harness override plus that harness's default args.
      await updateAgent.mutateAsync({
        pubkey: agent.pubkey,
        agentCommand: next.command,
        harnessOverride: true,
        agentArgs: [...next.defaultArgs],
      });
      notifySaved(`Harness ${next.label}`);
      onChanged();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't change the harness.",
      );
    }
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Harness: ${label}`}
          className={PILL_CLASS}
          data-testid="user-profile-quick-harness"
          disabled={updateAgent.isPending}
          size="sm"
          type="button"
          variant="ghost"
        >
          <PillIcon icon={Terminal} />
          <span className="truncate">{label}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={MENU_CLASS}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {options.length === 0 ? (
          <div className={MENU_NOTE_CLASS}>
            {runtimesQueryPendingNote(runtimes)}
          </div>
        ) : (
          <DropdownMenuRadioGroup
            onValueChange={(value) => void handlePick(value)}
            value={current?.id ?? ""}
          >
            {options.map((runtime) => (
              <DropdownMenuRadioItem
                disabled={runtime.availability !== "available"}
                key={runtime.id}
                value={runtime.id}
              >
                {formatRuntimeOptionLabel(runtime)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}
        <div className={MENU_NOTE_CLASS}>
          Changing the harness reopens the model list.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function runtimesQueryPendingNote(runtimes: readonly unknown[]) {
  return runtimes.length === 0
    ? "Loading harnesses…"
    : "No runnable harness found.";
}

function ModelPill({
  agent,
  notifySaved,
  onOpenChange,
  open,
  runtimes,
}: {
  agent: ManagedAgent;
  notifySaved: (what: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  runtimes: ReturnType<typeof useAcpRuntimesQuery>["data"] & object;
}) {
  const queryClient = useQueryClient();
  const personasQuery = usePersonasQuery();
  const configSurface = useAgentConfigSurface(agent.pubkey);
  const updateAgent = useUpdateManagedAgentMutation();
  const updatePersona = useUpdatePersonaMutation();
  const [modelsData, setModelsData] =
    React.useState<AgentModelsResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const persona = personasQuery.data?.find((p) => p.id === agent.personaId);
  const target = modelWriteTarget(agent, persona);
  // Explicit choice at the tier that owns it; otherwise the effective value the
  // config surface reports (rule 13: effective values, never synthesized).
  const explicitModel =
    target.kind === "persona" ? target.persona.model : agent.model;
  const effectiveModel = configSurface.data?.normalized.model?.value ?? null;
  const displayLabel = explicitModel
    ? resolveModelLabel(explicitModel, null, agent.provider)
    : effectiveModel
      ? `${resolveModelLabel(effectiveModel, null, agent.provider)} (default)`
      : "Harness default";
  const saving = updateAgent.isPending || updatePersona.isPending;

  const fetchModels = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setModelsData(await getAgentModels(agent.pubkey));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agent.pubkey]);

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (next && !loading && !modelsData) void fetchModels();
  };

  const handlePick = async (value: string) => {
    const modelId = value === HARNESS_DEFAULT_MODEL ? null : value;
    if (modelId === (explicitModel ?? null)) return;
    const pickedLabel = modelId
      ? resolveModelLabel(
          modelId,
          modelsData?.models.find((m) => m.id === modelId)?.name ?? null,
          agent.provider,
        )
      : "Harness default";
    try {
      if (target.kind === "unavailable") {
        toast.error("The agent's persona hasn't loaded yet — try again.");
        return;
      }
      if (target.kind === "persona") {
        // Linked instances resolve their model from the definition, so write
        // there and propagate like the profile's persona editor does.
        const updated = await updatePersona.mutateAsync(
          personaModelUpdateInput(target.persona, modelId),
        );
        const agentUpdate = personaManagedAgentUpdate(agent, updated, {
          previousPersona: target.persona,
          runtimes,
        });
        if (agentUpdate) await updateAgent.mutateAsync(agentUpdate);
      } else {
        await updateAgent.mutateAsync({ pubkey: agent.pubkey, model: modelId });
      }
      await queryClient.invalidateQueries({
        queryKey: agentConfigSurfaceQueryKey(agent.pubkey),
      });
      notifySaved(`Model ${pickedLabel}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't change the model.",
      );
    }
  };

  return (
    <DropdownMenu modal={false} onOpenChange={handleOpenChange} open={open}>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Model: ${displayLabel}`}
          className={PILL_CLASS}
          data-testid="user-profile-quick-model"
          disabled={saving}
          size="sm"
          type="button"
          variant="ghost"
        >
          <span className="truncate">{displayLabel}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={MENU_CLASS}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {loading ? (
          <div className={cn(MENU_NOTE_CLASS, "flex items-center gap-2")}>
            <Spinner className="h-4 w-4 border-2" />
            Loading models…
          </div>
        ) : error ? (
          <div className="space-y-2 px-3 py-2 text-sm">
            <p className="text-destructive">Failed to load models.</p>
            <button
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => void fetchModels()}
              type="button"
            >
              Retry
            </button>
          </div>
        ) : !modelsData ? (
          <div className={MENU_NOTE_CLASS}>Open to load available models.</div>
        ) : !modelsData.supportsSwitching ? (
          <div className={MENU_NOTE_CLASS}>
            This harness does not support switching models.
          </div>
        ) : (
          <>
            <DropdownMenuRadioGroup
              onValueChange={(value) => void handlePick(value)}
              value={explicitModel ?? HARNESS_DEFAULT_MODEL}
            >
              <DropdownMenuRadioItem value={HARNESS_DEFAULT_MODEL}>
                Harness default
              </DropdownMenuRadioItem>
              {modelsData.models.map((model) => (
                <DropdownMenuRadioItem key={model.id} value={model.id}>
                  {resolveModelLabel(model.id, model.name, agent.provider)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {target.kind === "persona" ? (
              <div className={MENU_NOTE_CLASS}>
                Applies to every agent using this persona.
              </div>
            ) : null}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EffortQuickPicker({
  agent,
  notifySaved,
}: {
  agent: ManagedAgent;
  notifySaved: (what: string) => void;
}) {
  const configSurface = useAgentConfigSurface(agent.pubkey);
  const updateMutation = useUpdateManagedAgentMutation();
  const queryClient = useQueryClient();

  // Canonical effort = what the next spawn launches with (rule 14's first fact).
  const currentEffort =
    configSurface.data?.normalized.thinkingEffort?.value ?? null;
  // Options are a property of harness + model, so a snapshot from an earlier
  // session stands in before the first session / after a restart.
  const cacheKey = effortOptionsKey(
    agent.agentCommand,
    configSurface.data?.normalized.model?.value,
  );
  const cached = useCachedEffortOptions(cacheKey);
  const liveConfigId = configSurface.data?.effortConfigId;
  const liveOptions = configSurface.data?.effortOptions;
  React.useEffect(() => {
    if (liveConfigId !== undefined && liveOptions && liveOptions.length > 0) {
      rememberEffortOptions(cacheKey, liveConfigId, liveOptions);
    }
  }, [cacheKey, liveConfigId, liveOptions]);
  const effortSource = resolveEffortOptionsSource({
    live: { configId: liveConfigId, options: liveOptions },
    cached,
  });
  const { visible, options, selectValue } = effortPickerState({
    backend: agent.backend,
    effortConfigId: effortSource.configId,
    effortOptions: effortSource.options,
    currentEffort,
  });
  if (!visible) {
    return null;
  }
  const fromCache = effortSource.source === "cache";

  const displayLabel =
    options.find((option) => option.value === selectValue)?.label ??
    "Adapter default";

  const handleChange = async (next: string) => {
    if (next === selectValue) return;
    try {
      await updateMutation.mutateAsync({
        pubkey: agent.pubkey,
        effortLevel: effortSelectionToPersistedValue(next),
      });
      await queryClient.invalidateQueries({
        queryKey: agentConfigSurfaceQueryKey(agent.pubkey),
      });
      notifySaved("Effort");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't save the effort level.",
      );
    }
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Thinking effort: ${displayLabel}${fromCache ? " (options from the last session)" : ""}`}
          className={PILL_CLASS}
          data-testid="user-profile-quick-effort"
          disabled={updateMutation.isPending}
          size="sm"
          title={
            fromCache
              ? "Options remembered from this model's last session; applies at the next start."
              : undefined
          }
          type="button"
          variant="ghost"
        >
          <PillIcon icon={Gauge} />
          <span className="truncate">{displayLabel}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={MENU_CLASS}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuRadioGroup
          onValueChange={(value) => void handleChange(value)}
          value={selectValue}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Permission mode for the agent's sessions, carried as
 * `BUZZ_ACP_PERMISSION_MODE` on the instance env (the tier the edit dialog
 * writes). Shows the configured value; when none is configured it shows what
 * the running session reports, then the harness default.
 */
function PermissionModePill({
  agent,
  notifySaved,
  runtimes,
}: {
  agent: ManagedAgent;
  notifySaved: (what: string) => void;
  runtimes: ReturnType<typeof useAcpRuntimesQuery>["data"] & object;
}) {
  const configSurface = useAgentConfigSurface(agent.pubkey);
  const personasQuery = usePersonasQuery();
  const updateAgent = useUpdateManagedAgentMutation();
  const updatePersona = useUpdatePersonaMutation();
  const persona = personasQuery.data?.find((p) => p.id === agent.personaId);
  const target = modelWriteTarget(agent, persona);
  // Same tier the agent's Edit dialog edits: the definition for a linked
  // agent (its Edit opens the persona editor), the instance otherwise. The
  // instance env still wins at spawn, so show it first when present.
  const configured =
    readPermissionMode(agent.envVars) ??
    (target.kind === "persona"
      ? readPermissionMode(target.persona.envVars)
      : null);
  const live = parsePermissionMode(configSurface.data?.normalized.mode?.value);
  const shown: PermissionMode =
    configured ?? live ?? HARNESS_DEFAULT_PERMISSION_MODE;
  const displayLabel = permissionModeLabel(shown);
  const saving = updateAgent.isPending || updatePersona.isPending;

  const handlePick = async (value: string) => {
    // "Run everything" is the harness default: store nothing rather than pin it.
    const picked = parsePermissionMode(value);
    const next = picked === "bypassPermissions" ? null : picked;
    if (next === configured) return;
    try {
      if (target.kind === "unavailable") {
        toast.error("The agent's persona hasn't loaded yet — try again.");
        return;
      }
      if (target.kind === "persona") {
        // Write the definition, then propagate exactly like the persona editor
        // does; the propagation replaces the instance env, so a stale
        // instance-level override cannot shadow the new value.
        const updated = await updatePersona.mutateAsync(
          personaEnvVarsUpdateInput(
            target.persona,
            withPermissionMode(target.persona.envVars, next),
          ),
        );
        const agentUpdate = personaManagedAgentUpdate(agent, updated, {
          previousPersona: target.persona,
          runtimes,
        });
        if (agentUpdate) await updateAgent.mutateAsync(agentUpdate);
      } else {
        await updateAgent.mutateAsync({
          pubkey: agent.pubkey,
          envVars: withPermissionMode(agent.envVars, next),
        });
      }
      notifySaved(`Permission mode ${permissionModeLabel(next)}`);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Couldn't change the permission mode.",
      );
    }
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Permission mode: ${displayLabel}`}
          className={PILL_CLASS}
          data-testid="user-profile-quick-permission"
          disabled={saving}
          size="sm"
          type="button"
          variant="ghost"
        >
          <PillIcon icon={ShieldCheck} />
          <span className="truncate">{displayLabel}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={MENU_CLASS}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuRadioGroup
          onValueChange={(value) => void handlePick(value)}
          value={shown}
        >
          {isLegacyPermissionMode(configured) && configured ? (
            <DropdownMenuRadioItem className="items-start" value={configured}>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span>{permissionModeLabel(configured)}</span>
                <span className="text-2xs leading-snug text-muted-foreground">
                  Behaves like Run everything under the harness.
                </span>
              </span>
            </DropdownMenuRadioItem>
          ) : null}
          {SELECTABLE_PERMISSION_MODES.map((mode) => (
            <DropdownMenuRadioItem
              className="items-start"
              key={mode.value}
              value={mode.value}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span>{mode.label}</span>
                <span className="text-2xs leading-snug text-muted-foreground">
                  {mode.description}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <div className={MENU_NOTE_CLASS}>
          Permission prompts are answered by the harness, not a person — these
          are the only modes that differ.
          {target.kind === "persona"
            ? " Applies to every agent using this persona."
            : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
