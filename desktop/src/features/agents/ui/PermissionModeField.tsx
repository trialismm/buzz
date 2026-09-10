import {
  isLegacyPermissionMode,
  parsePermissionMode,
  permissionModeLabel,
  readPermissionMode,
  SELECTABLE_PERMISSION_MODES,
  withPermissionMode,
} from "@/features/agents/lib/permissionMode";
import { PERSONA_LABEL_OPTIONAL_CLASS } from "./agentConfigOptions";
import type { EnvVarsValue } from "./EnvVarsEditor";
import { PersonaDropdownField } from "./PersonaDropdownField";

/**
 * Permission-mode select bound to an env map (see `lib/permissionMode.ts`).
 * The create dialog binds it to the persona's env (definition tier); the edit
 * dialog binds it to the instance's env, which wins at spawn.
 *
 * Offers the three modes that differ under buzz-acp. "Run everything" is the
 * harness default, so choosing it removes the key rather than pinning a value.
 */
export function PermissionModeField({
  disabled,
  envVars,
  id,
  onEnvVarsChange,
}: {
  disabled?: boolean;
  envVars: EnvVarsValue;
  id: string;
  onEnvVarsChange: (next: EnvVarsValue) => void;
}) {
  const current = readPermissionMode(envVars);
  const effective = current ?? "bypassPermissions";
  const options = SELECTABLE_PERMISSION_MODES.map((mode) => ({
    label: mode.label,
    value: mode.value,
  }));
  if (isLegacyPermissionMode(current) && current) {
    options.push({ label: permissionModeLabel(current), value: current });
  }
  const description =
    SELECTABLE_PERMISSION_MODES.find((m) => m.value === effective)
      ?.description ??
    "Behaves like Run everything under the harness; pick one of the three modes to replace it.";
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground" htmlFor={id}>
        Permission mode
        <span className={PERSONA_LABEL_OPTIONAL_CLASS}>Optional</span>
      </label>
      <PersonaDropdownField
        disabled={disabled}
        id={id}
        onValueChange={(value) => {
          const picked = parsePermissionMode(value);
          onEnvVarsChange(
            withPermissionMode(
              envVars,
              picked === "bypassPermissions" ? null : picked,
            ),
          );
        }}
        options={options}
        placeholder="Run everything"
        value={effective}
      />
      <p className="text-xs text-muted-foreground">
        {description} Applied at the next start.
      </p>
    </div>
  );
}
