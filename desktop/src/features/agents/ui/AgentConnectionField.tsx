import {
  connectionCatalogFor,
  readAgentConnection,
  withAgentConnection,
} from "@/features/agents/lib/agentConnection";
import { PERSONA_LABEL_OPTIONAL_CLASS } from "./agentConfigOptions";
import type { EnvVarsValue } from "./EnvVarsEditor";
import { PersonaDropdownField } from "./PersonaDropdownField";
import { PersonaProviderApiKeyField } from "./PersonaProviderApiKeyField";

/**
 * Connection select bound to an env map (see `lib/agentConnection.ts`):
 * the harness's own login, or an API key billed to the owner's developer
 * account. Renders only for runtimes the catalog knows (Claude, Codex).
 */
export function AgentConnectionField({
  disabled,
  envVars,
  id,
  onEnvVarsChange,
  runtimeId,
}: {
  disabled?: boolean;
  envVars: EnvVarsValue;
  id: string;
  onEnvVarsChange: (next: EnvVarsValue) => void;
  runtimeId: string | null | undefined;
}) {
  const entry = connectionCatalogFor(runtimeId);
  if (!entry) return null;
  const { mode, apiKey } = readAgentConnection(envVars, runtimeId);
  const description =
    mode === "api-key"
      ? `Bills this agent to the ${entry.apiKeyLabel.replace(" API key", "")} developer account instead of the subscription.${
          entry.isolatedHome
            ? " Runs in its own harness home so the login is never used."
            : ""
        } Applied at the next start.`
      : "Uses the login the harness was connected with. Applied at the next start.";
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground" htmlFor={id}>
          Connection
          <span className={PERSONA_LABEL_OPTIONAL_CLASS}>Optional</span>
        </label>
        <PersonaDropdownField
          disabled={disabled}
          id={id}
          onValueChange={(value) => {
            onEnvVarsChange(
              withAgentConnection(
                envVars,
                runtimeId,
                value === "api-key" ? "api-key" : "subscription",
                apiKey,
              ),
            );
          }}
          options={[
            { label: entry.subscriptionLabel, value: "subscription" },
            { label: entry.apiKeyLabel, value: "api-key" },
          ]}
          placeholder={entry.subscriptionLabel}
          value={mode}
        />
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {mode === "api-key" ? (
        <PersonaProviderApiKeyField
          disabled={disabled ?? false}
          envVarName={entry.apiKeyEnv}
          inheritedLabel=""
          isInherited={false}
          isRequired={apiKey.trim().length === 0}
          label={entry.apiKeyLabel}
          onValueChange={(next) => {
            onEnvVarsChange(
              withAgentConnection(envVars, runtimeId, "api-key", next),
            );
          }}
          value={apiKey}
        />
      ) : null}
    </div>
  );
}
